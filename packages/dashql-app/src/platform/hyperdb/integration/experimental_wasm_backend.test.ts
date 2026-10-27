import * as arrow from 'apache-arrow';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestHyperDBClient, testDatabasePath } from '../../../tests/hyperdb_test_client.js';
import { HyperDB, HyperDBEngine, type HyperDBClient } from '../hyperdb_wasm.js';
import { EXPERIMENTAL_WASM_BACKEND_SETTING, isUnknownHyperDBSettingError } from '../hyperdb_settings.js';
import { setupWebHyperDB } from '../hyperdb_provider_web.js';
import { TestLogger } from '../../logger/test_logger.js';

function toPlainObjects(table: arrow.Table): Record<string, unknown>[] {
    return table.toArray().map(row => Object.fromEntries(Object.keys(row).map(key => [key, row[key]])));
}

describe('HyperDB Wasm startup settings', () => {
    it('detects a startup setting that the engine does not know', async () => {
        let error: unknown = null;
        try {
            const client = await createTestHyperDBClient(undefined, { dashql_unknown_setting: true });
            await client.terminate();
        } catch (e) {
            error = e;
        }
        expect(error).not.toBeNull();
        expect(isUnknownHyperDBSettingError(error, 'dashql_unknown_setting')).toBe(true);
        expect(isUnknownHyperDBSettingError(error, EXPERIMENTAL_WASM_BACKEND_SETTING)).toBe(false);
    });

    it('starts the app database with the experimental wasm backend option, also without the backend', async () => {
        // The factory of the tests would hand out a database of the shared engine
        const factory = globalThis.__DASHQL_TEST_HYPERDB_FACTORY__;
        globalThis.__DASHQL_TEST_HYPERDB_FACTORY__ = undefined;
        let database: HyperDB | null = null;
        try {
            database = await setupWebHyperDB('experimental_wasm_backend_test', new TestLogger(), undefined, {
                experimentalWasmBackend: true,
            });
            const connection = await database.connect();
            try {
                expect(toPlainObjects(await connection.query('SELECT 42::INTEGER AS answer'))).toEqual([{ answer: 42 }]);
            } finally {
                await connection.close();
            }
        } finally {
            await database?.terminate();
            globalThis.__DASHQL_TEST_HYPERDB_FACTORY__ = factory;
        }
    });
});

/// The queries that broke or slowed down the first builds with the backend, with results that are small enough
/// to compare. The benchmark `bench_hyperdb_wasm_backend` measures the same shapes.
describe('HyperDB Wasm experimental backend', () => {
    let engineClient: HyperDBClient | null = null;
    let database: HyperDB | null = null;
    let nextDatabase = 1;

    // A hyperdb-wasm without the backend rejects its setting, the tests are skipped then
    beforeAll(async function (this: { skip(): never }) {
        try {
            engineClient = await createTestHyperDBClient(undefined, { [EXPERIMENTAL_WASM_BACKEND_SETTING]: true });
        } catch (error) {
            if (isUnknownHyperDBSettingError(error, EXPERIMENTAL_WASM_BACKEND_SETTING)) this.skip();
            throw error;
        }
    });

    beforeEach(async () => {
        database = await HyperDB.create(new HyperDBEngine(engineClient!), {
            computeDatabasePath: await testDatabasePath(`dashql-wasm-backend-${nextDatabase++}.hyper`),
            terminateEngine: false,
        });
    });

    afterEach(async () => {
        await database?.terminate();
        database = null;
    });

    afterAll(async () => {
        await engineClient?.terminate();
    });

    async function query(sql: string): Promise<Record<string, unknown>[]> {
        const connection = await database!.connect();
        try {
            return toPlainObjects(await connection.query(sql));
        } finally {
            await connection.close();
        }
    }

    async function execute(sql: string): Promise<void> {
        const connection = await database!.connect();
        try {
            await connection.execute(sql);
        } finally {
            await connection.close();
        }
    }

    it('scans more than 100,000 generated rows', async () => {
        // The engine aborted after 100,000 rows of a pipeline
        expect(await query('SELECT count(*)::INTEGER AS n, max(i) AS m FROM generate_series(1,100001) g(i)'))
            .toEqual([{ n: 100001, m: 100001 }]);
        expect(await query('SELECT 1 AS alive')).toEqual([{ alive: 1 }]);
    });

    it('scans a stored table with more than 100,000 rows', async () => {
        await execute('CREATE TABLE rows_ AS SELECT i FROM generate_series(1,60000) g(i)');
        await execute('INSERT INTO rows_ SELECT i FROM generate_series(60001,100001) g(i)');
        expect(await query('SELECT count(*)::INTEGER AS n, sum(i)::BIGINT AS s FROM rows_'))
            .toEqual([{ n: 100001, s: 5000150001n }]);
    });

    it('orders and aggregates strings', async () => {
        await execute(`CREATE TABLE names AS SELECT 'name_' || (i % 1000) AS s FROM generate_series(1,2000) g(i)`);
        expect(await query('SELECT min(s) AS lo, max(s) AS hi, max(length(s))::INTEGER AS len FROM names'))
            .toEqual([{ lo: 'name_0', hi: 'name_999', len: 8 }]);
        expect(await query('SELECT s FROM names ORDER BY s DESC LIMIT 2'))
            .toEqual([{ s: 'name_999' }, { s: 'name_999' }]);
        expect(await query(`SELECT count(*)::INTEGER AS n FROM names WHERE s = 'name_5'`)).toEqual([{ n: 2 }]);
        expect(await query(`SELECT min('name_' || i) AS lo FROM generate_series(1,2000) g(i)`)).toEqual([{ lo: 'name_1' }]);
    });

    it('orders doubles with NULLs', async () => {
        await execute(`
            CREATE TABLE doubles AS
            SELECT i, CASE WHEN i % 10 = 0 THEN NULL ELSE i::DOUBLE PRECISION / 3 END AS f
            FROM generate_series(1,2000) g(i)
        `);
        expect(await query('SELECT i FROM doubles ORDER BY f DESC NULLS LAST, i LIMIT 3'))
            .toEqual([{ i: 1999 }, { i: 1998 }, { i: 1997 }]);
        expect(await query('SELECT i FROM doubles ORDER BY f NULLS FIRST, i LIMIT 2'))
            .toEqual([{ i: 10 }, { i: 20 }]);
    });
});
