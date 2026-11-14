import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { HyperDBError } from 'hyperdb-wasm';

import { openEngine, type OpenEngine } from './node/open_engine.js';
import { runStatement } from './run_statement.js';

let engine: OpenEngine;
let directory: string;

beforeAll(async () => {
    directory = mkdtempSync(path.join(tmpdir(), 'hyperdb-edge-run-'));
    engine = await openEngine({ database: path.join(directory, 'run.hyper'), workDirectory: directory });
});

afterAll(async () => {
    await engine?.close();
    rmSync(directory, { recursive: true, force: true });
});

describe('runStatement', () => {
    it('runs a statement without rows and tells its kind', async () => {
        const result = await runStatement(engine.connection, 'create table t(a int, b text)');
        expect(result.kind).toBe('CREATE');
        expect(result.producesRows).toBe(false);
        expect(result.table).toBeNull();
        expect(result.rowCount).toBe(0n);
    });

    it('tells the affected rows of an insert', async () => {
        const result = await runStatement(engine.connection, "insert into t values (1, 'x'), (2, 'y'), (3, null)");
        expect(result.kind).toBe('INSERT');
        expect(result.producesRows).toBe(false);
        expect(result.rowCount).toBe(3n);
    });

    it('returns the rows of a query', async () => {
        const result = await runStatement(engine.connection, 'select a, b from t order by a');
        expect(result.kind).toBe('SELECT');
        expect(result.producesRows).toBe(true);
        expect(result.rowCount).toBe(3n);
        expect(result.table!.numRows).toBe(3);
        expect(result.table!.schema.fields.map(f => f.name)).toEqual(['a', 'b']);
    });

    it('returns the columns of a query without rows', async () => {
        const result = await runStatement(engine.connection, 'select a, b from t where false');
        expect(result.producesRows).toBe(true);
        expect(result.rowCount).toBe(0n);
        expect(result.table!.numRows).toBe(0);
        expect(result.table!.schema.fields.map(f => f.name)).toEqual(['a', 'b']);
    });

    it('returns the plan of EXPLAIN as rows', async () => {
        const result = await runStatement(engine.connection, 'explain select count(*) from t');
        expect(result.producesRows).toBe(true);
        expect(result.table!.schema.fields.map(f => f.name)).toEqual(['plan']);
    });

    it('rejects with the error of Hyper and leaves no unhandled rejection', async () => {
        const failed = runStatement(engine.connection, 'select * from missing_table');
        await expect(failed).rejects.toBeInstanceOf(HyperDBError);
        const error = (await failed.catch(e => e)) as HyperDBError;
        expect(error.message).toContain('missing_table');
        expect(error.sqlState).toMatch(/^[0-9A-Z]{5}$/);
    });

    it('rejects a syntax error', async () => {
        await expect(runStatement(engine.connection, 'selec 1')).rejects.toBeInstanceOf(HyperDBError);
    });

    it('rejects two statements in one call, the engine runs one at a time', async () => {
        await expect(runStatement(engine.connection, 'select 1; select 2')).rejects.toBeInstanceOf(HyperDBError);
    });

    it('returns from a cancelled statement with the connection free for the next', async () => {
        const cancel = new AbortController();
        const running = runStatement(engine.connection, 'select count(*) from generate_series(1, 2000000) a, generate_series(1, 2000) b', {
            signal: cancel.signal,
        });
        setTimeout(() => cancel.abort(), 200);
        await expect(running).rejects.toThrow();
        // At once, without waiting: the engine would otherwise answer "connection has an active operation"
        const next = await runStatement(engine.connection, 'select 1 as a');
        expect(next.table!.numRows).toBe(1);
    });

    it('keeps the connection usable after a failed statement', async () => {
        await runStatement(engine.connection, 'select * from missing_table').catch(() => null);
        const result = await runStatement(engine.connection, 'select count(*) as n from t');
        expect(Number(result.table!.getChildAt(0)!.get(0))).toBe(3);
    });
});
