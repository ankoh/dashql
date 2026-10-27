// Compares the experimental wasm backend of hyperdb-wasm with its default backend.
//
//   bazel run //packages/dashql-app:bench_hyperdb_wasm_backend [-- --rows=100000 --repeat=2 --filter=str]
//
// Every case runs on both backends: the results must be equal, the table shows the execution time of the engine
// (QueryInfo.timings.executionSeconds, the best of the repeats) and the slowdown of the experimental backend.
// The cases separate the slow paths found in 10/2026: scans of stored tables, string functions, and sorts by doubles.
// The engines start with plain settings, the settings of the app did not change the numbers.
// A hyperdb-wasm without the experimental backend rejects its setting, the benchmark then only reports that.

import { readFileSync } from 'node:fs';
import { tableFromIPC } from 'apache-arrow';
import { HyperDB } from 'hyperdb-wasm';

const EXPERIMENTAL = { experimental_wasm_backend: true };

const options = Object.fromEntries(process.argv.slice(2).map(arg => {
    const [key, value] = arg.replace(/^--/, '').split('=');
    return [key, value ?? 'true'];
}));
const N = Number(options.rows ?? 100_000);
const REPEAT = Number(options.repeat ?? 2);
const FILTER = options.filter ?? null;

/// The tables of the cases, each with only the columns that a case needs
const SETUP = [
    `CREATE TEMPORARY TABLE nums AS SELECT i, (i * 7919) % ${N} AS r, i::DOUBLE PRECISION / 3 AS f FROM generate_series(1,${N}) g(i)`,
    `CREATE TEMPORARY TABLE nulls AS SELECT i, CASE WHEN i % 10 = 0 THEN NULL ELSE i::DOUBLE PRECISION / 3 END AS f FROM generate_series(1,${N}) g(i)`,
    `CREATE TEMPORARY TABLE nums_txt AS SELECT i, 'name_' || (i % 1000) AS s FROM generate_series(1,${N}) g(i)`,
    `CREATE TEMPORARY TABLE short_txt AS SELECT 'name_' || (i % 1000) AS s FROM generate_series(1,${N}) g(i)`,
    `CREATE TEMPORARY TABLE long_txt AS SELECT 'a_much_longer_string_value_' || (i % 1000) AS s FROM generate_series(1,${N}) g(i)`,
];

const CASES = [
    // The engine aborted after 100,000 rows of a pipeline (fixed in 0.0.27136-dev.wasm.gd997ff1c)
    ['past 100k rows', `SELECT count(*) AS n FROM generate_series(1,${Math.max(N, 100_001)}) g(i)`],
    ['gen int agg', `SELECT sum(i) FROM generate_series(1,${N}) g(i)`],
    ['gen int sort', `SELECT i FROM generate_series(1,${N}) g(i) ORDER BY (i * 7919) % ${N} DESC LIMIT 3`],
    ['gen str agg', `SELECT min('name_' || (i % 1000)) FROM generate_series(1,${N}) g(i)`],
    ['gen str sort', `SELECT 'name_' || i AS s FROM generate_series(1,${N}) g(i) ORDER BY s DESC LIMIT 3`],
    ['stored int agg', `SELECT sum(i) FROM nums`],
    ['stored dbl agg', `SELECT sum(f) FROM nums`],
    ['stored int sort', `SELECT i FROM nums ORDER BY r DESC LIMIT 3`],
    ['stored dbl sort', `SELECT i FROM nums ORDER BY f DESC LIMIT 3`],
    ['stored null agg', `SELECT avg(f) FROM nulls`],
    ['stored null sort', `SELECT i FROM nulls ORDER BY f DESC NULLS LAST LIMIT 3`],
    ['int next to txt', `SELECT sum(i) FROM nums_txt`],
    ['short str min', `SELECT min(s) FROM short_txt`],
    ['short str filter', `SELECT count(*) FROM short_txt WHERE s = 'name_5'`],
    ['short str length', `SELECT max(length(s)) FROM short_txt`],
    ['short str sort', `SELECT s FROM short_txt ORDER BY s DESC LIMIT 3`],
    ['long str min', `SELECT min(s) FROM long_txt`],
    ['long str filter', `SELECT count(*) FROM long_txt WHERE s = 'a_much_longer_string_value_5'`],
].filter(([label]) => FILTER == null || label.includes(FILTER));

/// A running engine with the tables of the cases
class Engine {
    constructor(settings) {
        this.settings = settings;
        this.db = null;
        this.connection = null;
    }

    async open() {
        this.db = await HyperDB.create({ settings: this.settings });
        this.connection = await this.db.connect();
        for (const statement of SETUP) await this.connection.execute(statement);
    }

    async close() {
        await this.connection?.close().catch(() => {});
        await this.db?.terminate().catch(() => {});
        this.db = null;
        this.connection = null;
    }

    /// Run a case, an engine that failed is started again for the next case
    async run(sql) {
        let best = Infinity;
        let rows = null;
        for (let repeat = 0; repeat < REPEAT; ++repeat) {
            try {
                if (this.connection == null) await this.open();
                const stream = this.connection.queryStreamIPC(sql);
                const chunks = [];
                for await (const chunk of stream) chunks.push(chunk);
                const info = await stream.info;
                best = Math.min(best, info.timings.executionSeconds * 1000);
                rows ??= JSON.stringify(tableFromIPC(chunks).toArray(), (_, value) => typeof value === 'bigint' ? String(value) : value);
            } catch (error) {
                await this.close();
                return { error: String(error?.message ?? error).split('\n')[0] };
            }
        }
        return { ms: best, rows };
    }
}

function isUnknownSettingError(error) {
    return `${error?.message ?? error} ${error?.detail ?? ''}`.includes("No internal setting named 'experimental_wasm_backend'");
}

function hyperdbVersion() {
    const packageJson = new URL('../package.json', import.meta.resolve('hyperdb-wasm'));
    return JSON.parse(readFileSync(packageJson, 'utf8')).version;
}

function format(ms) {
    return ms == null ? '' : ms.toFixed(1);
}

async function main() {
    // An abort of the engine must not end the process, it was an uncaught exception in the host before
    process.on('uncaughtException', error => {
        console.log(`UNCAUGHT in the host process: ${error?.message ?? error}`);
        process.exitCode = 1;
    });

    console.log(`hyperdb-wasm ${hyperdbVersion()}, ${N} rows, best of ${REPEAT}, node ${process.version}`);
    const experimental = new Engine(EXPERIMENTAL);
    try {
        await experimental.open();
    } catch (error) {
        if (isUnknownSettingError(error)) {
            console.log('This hyperdb-wasm has no experimental wasm backend, it rejects experimental_wasm_backend.');
            return;
        }
        throw error;
    }
    const standard = new Engine({});
    await standard.open();

    const header = ['case', 'default ms', 'experimental ms', 'slowdown', 'result'];
    const lines = [];
    for (const [label, sql] of CASES) {
        const base = await standard.run(sql);
        const exp = await experimental.run(sql);
        let result;
        if (base.error != null) result = `default failed: ${base.error}`;
        else if (exp.error != null) result = `FAILED: ${exp.error}`;
        else result = base.rows === exp.rows ? 'same' : 'DIFFERENT';
        const factor = base.ms != null && exp.ms != null ? exp.ms / Math.max(base.ms, 0.1) : null;
        const slowdown = factor == null ? '' : `${factor.toFixed(factor < 10 ? 1 : 0)}x`;
        lines.push([label, format(base.ms), format(exp.ms), slowdown, result]);
        console.error(`${label}: ${result}`);
    }
    await standard.close();
    await experimental.close();

    const widths = header.map((title, column) => Math.max(title.length, ...lines.map(line => line[column].length)));
    const row = cells => cells.map((cell, column) => column === 0 || column === 4 ? cell.padEnd(widths[column]) : cell.padStart(widths[column])).join('  ');
    console.log(row(header));
    console.log(widths.map(width => '-'.repeat(width)).join('  '));
    for (const line of lines) console.log(row(line));
    if (lines.some(line => line[4] !== 'same')) process.exitCode = 1;
}

await main();
// The engine workers keep the process alive
process.exit(process.exitCode ?? 0);
