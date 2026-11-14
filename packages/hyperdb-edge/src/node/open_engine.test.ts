import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runStatement } from '../run_statement.js';
import { DatabaseFolderMissingError, EngineSettingsError, openEngine, WORK_MOUNT } from './open_engine.js';

let directory: string;
let workDirectory: string;

beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'hyperdb-edge-open-'));
    workDirectory = path.join(directory, 'work');
    mkdirSync(workDirectory);
});

afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
});

describe('openEngine without a database', () => {
    it('keeps temporary tables and refuses tables of a database', async () => {
        const engine = await openEngine({ workDirectory });
        try {
            expect(engine.databaseName).toBeNull();
            await runStatement(engine.connection, 'create temporary table t as select 1 as a');
            const result = await runStatement(engine.connection, 'select a from t');
            expect(result.table!.numRows).toBe(1);
            await expect(runStatement(engine.connection, 'create table u(a int)')).rejects.toThrow();
        } finally {
            await engine.close();
        }
    });

    it('stores in a temporary folder that it removes, and writes nothing into the working folder', async () => {
        const engine = await openEngine({ workDirectory });
        const storage = engine.storagePath;
        expect(existsSync(storage)).toBe(true);
        expect(storage.startsWith(workDirectory)).toBe(false);
        await engine.close();
        expect(existsSync(storage)).toBe(false);
        expect(readdirSync(workDirectory)).toEqual([]);
    });

    it('closes twice without failing', async () => {
        const engine = await openEngine({ workDirectory });
        await engine.close();
        await engine.close();
    });
});

describe('openEngine with a database', () => {
    it('creates the database file and attaches it under the name of the file', async () => {
        const database = path.join(directory, 'sales.hyper');
        const engine = await openEngine({ database, workDirectory });
        try {
            expect(engine.databaseName).toBe('sales');
            expect(engine.storagePath).toBe(directory);
            await runStatement(engine.connection, 'create table t(a int)');
            await runStatement(engine.connection, 'insert into t values (1), (2)');
            const qualified = await runStatement(engine.connection, 'select count(*) as n from sales.public.t');
            expect(Number(qualified.table!.getChildAt(0)!.get(0))).toBe(2);
        } finally {
            await engine.close();
        }
        expect(existsSync(database)).toBe(true);
    });

    it('keeps the tables for the next engine', async () => {
        const database = path.join(directory, 'keep.hyper');
        const first = await openEngine({ database, workDirectory });
        await runStatement(first.connection, 'create table t as select g from generate_series(1, 7) as s(g)');
        await first.close();

        const second = await openEngine({ database, workDirectory });
        try {
            const result = await runStatement(second.connection, 'select count(*) as n from t');
            expect(Number(result.table!.getChildAt(0)!.get(0))).toBe(7);
        } finally {
            await second.close();
        }
    });

    it('resolves a relative database path against the working folder', async () => {
        const engine = await openEngine({ database: 'relative.hyper', workDirectory });
        await engine.close();
        expect(existsSync(path.join(workDirectory, 'relative.hyper'))).toBe(true);
    });

    it('names a file without .hyper by its whole name', async () => {
        const engine = await openEngine({ database: path.join(directory, 'plain'), workDirectory });
        try {
            expect(engine.databaseName).toBe('plain');
        } finally {
            await engine.close();
        }
    });

    it('refuses a database in a folder that does not exist', async () => {
        const database = path.join(directory, 'missing', 'sales.hyper');
        await expect(openEngine({ database, workDirectory })).rejects.toBeInstanceOf(DatabaseFolderMissingError);
        expect(existsSync(path.join(directory, 'missing'))).toBe(false);
    });
});

describe('the working folder', () => {
    it('is mounted for reading and writing files', async () => {
        const engine = await openEngine({ workDirectory });
        try {
            await runStatement(
                engine.connection,
                `copy (select g from generate_series(1, 3) as s(g)) to '${WORK_MOUNT}/out.parquet' with (format => 'parquet')`,
            );
            expect(existsSync(path.join(workDirectory, 'out.parquet'))).toBe(true);
            const read = await runStatement(engine.connection, `select count(*) as n from external('${WORK_MOUNT}/out.parquet')`);
            expect(Number(read.table!.getChildAt(0)!.get(0))).toBe(3);
        } finally {
            await engine.close();
        }
    });

    it('is the only host folder the engine reaches', async () => {
        const engine = await openEngine({ workDirectory });
        try {
            await expect(
                runStatement(engine.connection, `copy (select 1) to '${directory}/outside.parquet' with (format => 'parquet')`),
            ).rejects.toThrow();
            expect(existsSync(path.join(directory, 'outside.parquet'))).toBe(false);
        } finally {
            await engine.close();
        }
    });
});

describe('engine settings', () => {
    it('passes known settings to the engine', async () => {
        const engine = await openEngine({ workDirectory, settings: { log_file_max_count: 2 } });
        await engine.close();
    });

    it('refuses unknown settings and names the given ones', async () => {
        const failed = openEngine({ workDirectory, settings: { no_such_setting: true } });
        await expect(failed).rejects.toBeInstanceOf(EngineSettingsError);
        await expect(failed).rejects.toThrow(/no_such_setting/);
    });
});
