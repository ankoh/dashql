import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DatabaseInUseError, lockPathOf } from './database_lock.js';
import { DatabaseFolderMissingError } from './open_engine.js';
import { EdgeSession, EngineEndedError, EngineOpenError, NoStatementError, SessionClosedError } from './session.js';

const MAIN = fileURLToPath(new URL('../../dist/cli/main.js', import.meta.url));

/// A query that runs for seconds, long enough to cancel
const SLOW_QUERY = 'select count(*) from generate_series(1, 2000000) a, generate_series(1, 2000) b';
/// A query that runs for a fraction of a second, long enough for other calls to queue up behind it
const MEDIUM_QUERY = 'select count(*) from generate_series(1, 200000) a, generate_series(1, 2000) b';

let directory: string;
const sessions: EdgeSession[] = [];

async function open(options: Partial<Parameters<typeof EdgeSession.open>[0]> = {}): Promise<EdgeSession> {
    const session = await EdgeSession.open({ workDirectory: directory, ...options });
    sessions.push(session);
    return session;
}

/// Run SLOW_QUERY after a first statement, and then `rest`. `started` resolves once the first statement printed, when
/// the slow query runs next.
function runSlow(session: EdgeSession, options: { signal?: AbortSignal } = {}, rest = '') {
    let printed!: () => void;
    const started = new Promise<void>(resolve => (printed = resolve));
    const running = session.run(`select 1 as started; ${SLOW_QUERY};${rest}`, { ...options, onOutput: () => printed() });
    return { running, started };
}

beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'hyperdb-edge-session-'));
});

afterEach(async () => {
    await Promise.all(sessions.splice(0).map(session => session.close()));
    rmSync(directory, { recursive: true, force: true });
});

describe('EdgeSession', () => {
    it('runs many calls on one engine, temporary tables stay between them', async () => {
        const session = await open();
        const pid = session.enginePid;
        expect((await session.run('create temporary table t(a int)')).stdout).toBe('CREATE\n');
        expect((await session.run('insert into t values (1), (2)')).stdout).toBe('INSERT 2\n');
        const result = await session.run('select sum(a) as total from t');
        expect(result).toMatchObject({ stderr: '', failed: null, cancelled: false });
        expect(result.stdout).toContain('\n3\n');
        expect(session.enginePid).toBe(pid);
    });

    it('runs the calls one after another in the order they came', async () => {
        const session = await open({ format: 'json' });
        await session.run('create temporary table log(call int, before int)');
        const finished: number[] = [];
        // The first call is slow, the others wait for it instead of running alongside
        const calls = [1, 2, 3, 4].map(call =>
            session
                .run(`${call === 1 ? `${MEDIUM_QUERY};` : ''} insert into log select ${call}, count(*) from log`)
                .then(result => {
                    finished.push(call);
                    return result;
                }),
        );
        const results = await Promise.all(calls);
        expect(results.every(result => result.failed == null)).toBe(true);
        expect(finished).toEqual([1, 2, 3, 4]);
        const log = await session.run('select call, before from log order by call', { maxRows: 0 });
        expect(JSON.parse(log.stdout).rows).toEqual([
            [1, 0],
            [2, 1],
            [3, 2],
            [4, 3],
        ]);
    });

    it('keeps the results of the calls apart', async () => {
        const session = await open({ format: 'json' });
        const [a, b] = await Promise.all([session.run('select 1 as a'), session.run('select 2 as b')]);
        expect(JSON.parse(a.stdout).rows).toEqual([[1]]);
        expect(JSON.parse(b.stdout).rows).toEqual([[2]]);
    });

    it('reports a failing statement and runs the next call', async () => {
        const session = await open();
        const [failed, next] = await Promise.all([
            session.run('select 1 as first;\nselect * from missing_table;\nselect 3'),
            session.run('select 4 as fourth'),
        ]);
        expect(failed.failed).toEqual({ statement: 2, line: 2, sqlState: '42P01' });
        expect(failed.stdout).toContain('first');
        expect(failed.stdout).not.toContain('3');
        expect(failed.stderr).toContain('statement 2 of 3 (line 2) failed');
        expect(failed.stderr).toContain('SQLSTATE 42P01');
        expect(next.failed).toBeNull();
        expect(next.stdout).toContain('fourth');
    });

    it('cancels a running statement and skips the rest of the call', async () => {
        const session = await open();
        const cancel = new AbortController();
        const begin = Date.now();
        const { running, started } = runSlow(session, { signal: cancel.signal }, " select 'after' as rest");
        await started;
        cancel.abort();
        const result = await running;
        expect(result.failed, result.stderr).toBeNull();
        expect(result.cancelled).toBe(true);
        expect(result.stdout).not.toContain('after');
        expect(result.stderr).toContain('cancelled');
        expect(Date.now() - begin).toBeLessThan(10_000);
        // The session goes on
        expect((await session.run('select 1 as a')).failed).toBeNull();
    });

    it('cancels a call that waits, without running it', async () => {
        const session = await open();
        await session.run('create temporary table t(a int)');
        const cancel = new AbortController();
        const slow = session.run(MEDIUM_QUERY);
        const waiting = session.run('insert into t values (1)', { signal: cancel.signal });
        cancel.abort();
        expect((await waiting).cancelled).toBe(true);
        await slow;
        expect((await session.run('select count(*) as n from t')).stdout).toContain('\n0\n');
    });

    it('passes the output on while the statements run', async () => {
        const session = await open();
        const chunks: Array<{ stream: string; text: string }> = [];
        const result = await session.run('select 1 as a; select 2 as b', { onOutput: (stream, text) => chunks.push({ stream, text }) });
        // A chunk per statement at least, together the whole output
        expect(chunks.length).toBeGreaterThan(1);
        expect(chunks.every(chunk => chunk.stream === 'stdout')).toBe(true);
        expect(chunks.map(chunk => chunk.text).join('')).toBe(result.stdout);
    });

    it('rejects SQL without statements', async () => {
        const session = await open();
        await expect(session.run(' -- nothing\n;')).rejects.toBeInstanceOf(NoStatementError);
    });

    it('rejects calls after close and closes twice', async () => {
        const session = await open();
        await session.close();
        await expect(session.run('select 1')).rejects.toBeInstanceOf(SessionClosedError);
        await session.close();
    });

    it('fails waiting calls when it closes', async () => {
        const session = await open();
        const { running: slow, started } = runSlow(session);
        const waiting = session.run('select 1');
        // Close once the slow call runs, a call that hasn't started fails as closed
        await started;
        const closed = session.close();
        expect((await slow).cancelled).toBe(true);
        await expect(waiting).rejects.toBeInstanceOf(SessionClosedError);
        await closed;
    });
});

describe('the database of a session', () => {
    it('is locked from open to close', async () => {
        const database = path.join(directory, 'sales.hyper');
        const session = await open({ database: 'sales.hyper' });
        expect(session.databaseName).toBe('sales');
        expect(readFileSync(lockPathOf(database), 'utf8')).toBe(`${process.pid}\n`);
        await expect(EdgeSession.open({ workDirectory: directory, database: 'sales.hyper' })).rejects.toBeInstanceOf(DatabaseInUseError);

        // The command line tool sees the lock too
        const cli = spawnSync(process.execPath, [MAIN, 'run', '--db', 'sales.hyper', '-c', 'select 1'], { cwd: directory, encoding: 'utf8' });
        expect(cli.status).toBe(2);
        expect(cli.stderr).toContain('in use');

        await session.close();
        expect(existsSync(lockPathOf(database))).toBe(false);
        const again = await open({ database: 'sales.hyper' });
        expect(again.databaseName).toBe('sales');
    });

    it('keeps its tables for the next session', async () => {
        const first = await open({ database: 'keep.hyper' });
        await first.run('create table t as select 7 as a');
        await first.close();
        const second = await open({ database: 'keep.hyper' });
        expect((await second.run('select a from t')).stdout).toContain('7');
    });

    it('is released when the engine process dies, and the calls fail', async () => {
        const database = path.join(directory, 'crash.hyper');
        const session = await open({ database: 'crash.hyper' });
        const { running, started } = runSlow(session);
        await started;
        process.kill(session.enginePid!, 'SIGKILL');
        await expect(running).rejects.toBeInstanceOf(EngineEndedError);
        await expect(session.run('select 1')).rejects.toBeInstanceOf(EngineEndedError);
        expect(existsSync(lockPathOf(database))).toBe(false);
        await session.close();
    });

    it('must be in a folder that exists', async () => {
        await expect(open({ database: 'missing/sales.hyper' })).rejects.toBeInstanceOf(DatabaseFolderMissingError);
    });
});

describe('opening a session', () => {
    it('fails on an unknown setting as a usage error and releases the database', async () => {
        const failed = EdgeSession.open({ workDirectory: directory, database: 'x.hyper', settings: { no_such_setting: true } });
        await expect(failed).rejects.toBeInstanceOf(EngineOpenError);
        await expect(failed).rejects.toMatchObject({ usage: true });
        expect(existsSync(lockPathOf(path.join(directory, 'x.hyper')))).toBe(false);
    });

    it('passes the stderr of the engine to engineStderr without the warnings of Node', async () => {
        const lines: string[] = [];
        const session = await open({ engineStderr: line => lines.push(line) });
        for (let i = 0; i < 3; ++i) await session.run('create temporary table if not exists t(a int); insert into t values (1)');
        await session.close();
        expect(lines).toEqual([]);
    });
});
