import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The tests run the compiled command as a user or an agent runs it: a separate node process in a working folder
const MAIN = fileURLToPath(new URL('../../dist/cli/main.js', import.meta.url));
const PACKAGE_JSON = fileURLToPath(new URL('../../package.json', import.meta.url));

interface Run {
    code: number | null;
    stdout: string;
    stderr: string;
}

function edge(args: string[], options: { cwd: string; stdin?: string }): Promise<Run> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [MAIN, ...args], { cwd: options.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8').on('data', chunk => (stdout += chunk));
        child.stderr.setEncoding('utf8').on('data', chunk => (stderr += chunk));
        child.on('error', reject);
        child.on('close', code => resolve({ code, stdout, stderr }));
        child.stdin.end(options.stdin ?? '');
    });
}

let cwd: string;

beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), 'hyperdb-edge-cli-'));
});

afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
});

describe('--help and --version', () => {
    it('prints the usage with both commands', async () => {
        const run = await edge(['--help'], { cwd });
        expect(run.code).toBe(0);
        expect(run.stdout).toContain('hyperdb-edge run');
        expect(run.stdout).toContain('hyperdb-edge describe');
        expect(run.stderr).toBe('');
    });

    it('prints the usage without arguments', async () => {
        const run = await edge([], { cwd });
        expect(run.code).toBe(0);
        expect(run.stdout).toContain('hyperdb-edge run');
    });

    it('prints the versions of hyperdb-edge and hyperdb-wasm and checks the runtime', async () => {
        const run = await edge(['--version'], { cwd });
        expect(run.code).toBe(0);
        const version = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')).version;
        expect(run.stdout).toContain(`hyperdb-edge ${version}`);
        expect(run.stdout).toMatch(/^hyperdb-wasm \d+\.\d+\.\d+\S*$/m);
        expect(run.stdout).toContain(process.version);
        expect(run.stdout).toMatch(/memory64, table64, exnref/);
    });

    it('fails with 2 and the usage on an unknown command', async () => {
        const run = await edge(['query', '-c', 'select 1'], { cwd });
        expect(run.code).toBe(2);
        expect(run.stdout).toBe('');
        expect(run.stderr).toContain("unknown command 'query'");
        expect(run.stderr).toContain('hyperdb-edge --help');
    });

    it('fails with 2 when run has no SQL', async () => {
        const run = await edge(['run'], { cwd });
        expect(run.code).toBe(2);
        expect(run.stderr).toMatch(/-c, -f or -/);
    });
});

describe('describe', () => {
    it('prints the index and the topics', async () => {
        const index = await edge(['describe'], { cwd });
        expect(index.code).toBe(0);
        expect(index.stdout).toMatch(/^# hyperdb-edge/);
        expect(index.stdout).toContain('`catalog`');

        const files = await edge(['describe', 'files'], { cwd });
        expect(files.code).toBe(0);
        expect(files.stdout).toMatch(/^# files/);
    });

    it('fails with 2 on an unknown topic and lists the topics', async () => {
        const run = await edge(['describe', 'tables'], { cwd });
        expect(run.code).toBe(2);
        expect(run.stderr).toContain("unknown topic 'tables'");
        expect(run.stderr).toContain('catalog');
    });

    it('starts no engine and writes nothing', async () => {
        const run = await edge(['describe', 'all'], { cwd });
        expect(run.code).toBe(0);
        expect(run.stdout).not.toContain('LogFile');
        expect(readdirSync(cwd)).toEqual([]);
    });
});

describe('run', () => {
    it('prints the result as a table', async () => {
        const run = await edge(['run', '-c', "select 1 as a, 'x' as b"], { cwd });
        expect(run.code).toBe(0);
        // The layout of the table is the test of format.ts
        expect(run.stdout).toMatch(/^a \| b\n/);
        expect(run.stdout).toContain('(1 row)');
        expect(run.stderr).toBe('');
    });

    it('keeps the log line and the warnings of the engine out of the output', async () => {
        // Harnesses show stdout and stderr to the model, both hold only what hyperdb-edge says
        for (let i = 0; i < 3; ++i) {
            const run = await edge(['run', '--db', 'quiet.hyper', '-c', 'create table if not exists t(a int); insert into t values (1)'], { cwd });
            expect(run.code).toBe(0);
            expect(run.stderr).toBe('');
        }
        const run = await edge(['run', '--format', 'json', '-c', 'select 42 as answer'], { cwd });
        expect(run.code).toBe(0);
        expect(run.stdout).not.toContain('LogFile');
        expect(run.stderr).toBe('');
        const lines = run.stdout.trimEnd().split('\n');
        expect(lines).toHaveLength(1);
        expect(JSON.parse(lines[0])).toMatchObject({ statement: 1, kind: 'SELECT', rows: [[42]] });
    });

    it('prints one line of JSON per statement', async () => {
        const run = await edge(
            ['run', '--format', 'json', '-c', 'create temporary table t(a int); insert into t values (1), (2); select a from t order by a'],
            { cwd },
        );
        expect(run.code).toBe(0);
        const lines = run.stdout.trimEnd().split('\n').map(line => JSON.parse(line));
        expect(lines.map(line => [line.statement, line.kind])).toEqual([
            [1, 'CREATE'],
            [2, 'INSERT'],
            [3, 'SELECT'],
        ]);
        expect(lines[2].rows).toEqual([[1], [2]]);
    });

    it('prints csv', async () => {
        const run = await edge(['run', '--format', 'csv', '-c', "select 'a,b' as x, null::int as y"], { cwd });
        expect(run.code).toBe(0);
        expect(run.stdout).toMatch(/^x,y\n/);
        expect(run.stdout).toContain('"a,b"');
    });

    it('separates the results of several statements with an empty line', async () => {
        const run = await edge(['run', '-c', 'select 1 as a; select 2 as b'], { cwd });
        expect(run.code).toBe(0);
        expect(run.stdout).toBe(['a', '-', '1', '(1 row)', '', 'b', '-', '2', '(1 row)', ''].join('\n'));
    });

    it('reads the SQL of a file', async () => {
        writeFileSync(path.join(cwd, 'query.sql'), '-- the answer\nselect 42 as answer;\n');
        const run = await edge(['run', '-f', 'query.sql'], { cwd });
        expect(run.code).toBe(0);
        expect(run.stdout).toContain('42');
    });

    it('reads the SQL of stdin', async () => {
        const viaDash = await edge(['run', '-'], { cwd, stdin: 'select 7 as seven' });
        expect(viaDash.code).toBe(0);
        expect(viaDash.stdout).toContain('7');
        const viaFile = await edge(['run', '-f', '-'], { cwd, stdin: 'select 8 as eight' });
        expect(viaFile.code).toBe(0);
        expect(viaFile.stdout).toContain('8');
    });

    it('fails with 2 on a file that does not exist', async () => {
        const run = await edge(['run', '-f', 'missing.sql'], { cwd });
        expect(run.code).toBe(2);
        expect(run.stderr).toContain('missing.sql');
    });

    it('fails with 2 on SQL without statements', async () => {
        const run = await edge(['run', '-c', ' -- nothing\n;'], { cwd });
        expect(run.code).toBe(2);
        expect(run.stderr).toMatch(/no statement/);
    });

    it('stops at the first failing statement, prints the results before it and fails with 1', async () => {
        writeFileSync(path.join(cwd, 'steps.sql'), 'select 1 as first;\n\nselect * from missing_table;\nselect 3 as third;\n');
        const run = await edge(['run', '-f', 'steps.sql'], { cwd });
        expect(run.code).toBe(1);
        expect(run.stdout).toContain('first');
        expect(run.stdout).not.toContain('third');
        const stderr = run.stderr;
        expect(stderr).toContain('statement 2 of 3 (line 3) failed');
        expect(stderr).toContain('missing_table');
        expect(stderr).toMatch(/SQLSTATE [0-9A-Z]{5}/);
    });

    it('limits the printed rows and says how many there are', async () => {
        const run = await edge(['run', '--max-rows', '3', '-c', 'select g from generate_series(1, 10) as s(g) order by g'], { cwd });
        expect(run.code).toBe(0);
        expect(run.stdout).toContain('(10 rows, 3 shown)');
        expect(run.stdout).not.toContain('4');
    });

    it('prints EXPLAIN as a readable plan', async () => {
        const run = await edge(['run', '-c', 'explain select count(*) from generate_series(1, 10) as s(g)'], { cwd });
        expect(run.code).toBe(0);
        expect(run.stdout.split('\n').length).toBeGreaterThan(3);
        expect(run.stdout).not.toContain('\\n');
    });

    it('fails with 2 on an unknown engine setting', async () => {
        const run = await edge(['run', '--setting', 'no_such_setting=1', '-c', 'select 1'], { cwd });
        expect(run.code).toBe(2);
        expect(run.stderr).toContain('no_such_setting');
    });

    it('passes a known engine setting', async () => {
        const run = await edge(['run', '--setting', 'log_file_max_count=2', '-c', 'select 1 as a'], { cwd });
        expect(run.code).toBe(0);
    });

    it('writes nothing into the working folder without a database', async () => {
        const run = await edge(['run', '-c', 'create temporary table t as select 1 as a; select * from t'], { cwd });
        expect(run.code).toBe(0);
        expect(readdirSync(cwd)).toEqual([]);
    });
});

describe('run with a database', () => {
    it('creates the database and keeps its tables for the next call', async () => {
        const create = await edge(['run', '--db', 'sales.hyper', '-c', "create table sales(region text, amount int); insert into sales values ('north', 10), ('south', 20)"], { cwd });
        expect(create.code).toBe(0);
        expect(create.stdout).toBe(['CREATE', '', 'INSERT 2', ''].join('\n'));
        expect(existsSync(path.join(cwd, 'sales.hyper'))).toBe(true);

        const read = await edge(['run', '--db', 'sales.hyper', '--format', 'json', '-c', 'select sum(amount) as total from sales'], { cwd });
        expect(read.code).toBe(0);
        expect(JSON.parse(read.stdout).rows).toEqual([[30]]);
    });

    it('removes its lock file when it is done', async () => {
        const run = await edge(['run', '--db', 'sales.hyper', '-c', 'select 1'], { cwd });
        expect(run.code).toBe(0);
        expect(existsSync(path.join(cwd, 'sales.hyper.lock'))).toBe(false);
    });

    it('removes its lock file also when a statement fails', async () => {
        const run = await edge(['run', '--db', 'sales.hyper', '-c', 'select * from missing_table'], { cwd });
        expect(run.code).toBe(1);
        expect(existsSync(path.join(cwd, 'sales.hyper.lock'))).toBe(false);
    });

    it('fails with 2 while another process holds the database', async () => {
        // The test process is alive, so its lock holds
        writeFileSync(path.join(cwd, 'sales.hyper.lock'), `${process.pid}\n`);
        const run = await edge(['run', '--db', 'sales.hyper', '-c', 'select 1'], { cwd });
        expect(run.code).toBe(2);
        expect(run.stderr).toContain('in use');
        expect(run.stderr).toContain(String(process.pid));
        expect(readFileSync(path.join(cwd, 'sales.hyper.lock'), 'utf8')).toBe(`${process.pid}\n`);
    });

    it('takes over the lock of a process that ended', async () => {
        // A process id far above the default limits of Linux and macOS
        writeFileSync(path.join(cwd, 'sales.hyper.lock'), '2147480000\n');
        const run = await edge(['run', '--db', 'sales.hyper', '-c', 'select 1 as a'], { cwd });
        expect(run.code).toBe(0);
        expect(existsSync(path.join(cwd, 'sales.hyper.lock'))).toBe(false);
    });

    it('fails with 2 on a database in a folder that does not exist', async () => {
        const run = await edge(['run', '--db', 'missing/sales.hyper', '-c', 'select 1'], { cwd });
        expect(run.code).toBe(2);
        expect(run.stderr).toContain('missing');
        expect(existsSync(path.join(cwd, 'missing'))).toBe(false);
    });
});

describe('files of the working folder', () => {
    it('writes and reads files through /mnt/external/work', async () => {
        const write = await edge(
            ['run', '-c', "copy (select g from generate_series(1, 5) as s(g)) to '/mnt/external/work/five.parquet' with (format => 'parquet')"],
            { cwd },
        );
        expect(write.code).toBe(0);
        expect(write.stdout).toBe('COPY 5\n');
        expect(existsSync(path.join(cwd, 'five.parquet'))).toBe(true);

        const read = await edge(['run', '--format', 'json', '-c', "select count(*) as n from external('/mnt/external/work/five.parquet')"], { cwd });
        expect(read.code).toBe(0);
        expect(JSON.parse(read.stdout).rows).toEqual([[5]]);
    });
});
