import * as duckdb_serial from '@dashql/duckdb/src/targets/duckdb-browser-serial';
import * as duckdb_parallel from '@dashql/duckdb/src/targets/duckdb-browser-parallel';
import Worker from 'web-worker';

import { benchmarkFormat } from './format_benchmark';
import { benchmarkIterator } from './iterator_benchmark';

async function main() {
    let db: duckdb_serial.DuckDB | null = null;
    let adb: duckdb_parallel.AsyncDuckDB | null = null;
    let worker: Worker | null = null;

    const logger = new duckdb_serial.VoidLogger();
    db = new duckdb_serial.DuckDB(logger, duckdb_serial.BrowserRuntime, '/static/duckdb.wasm');
    await db.open();

    worker = new Worker('/static/duckdb-browser-parallel.worker.js');
    adb = new duckdb_parallel.AsyncDuckDB(logger, worker);
    await adb.open('/static/duckdb.wasm');

    benchmarkFormat(() => db!);
    benchmarkIterator(() => db!);
}

(window as any).karmaCustomEnv = {};
(window as any).karmaCustomEnv.execute = async function (karma: any, window: any) {
    await main();
    karma.complete();
};
