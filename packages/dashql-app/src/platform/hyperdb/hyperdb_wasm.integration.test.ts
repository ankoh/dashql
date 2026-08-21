// @vitest-environment node
import * as arrow from 'apache-arrow';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DataFrame, generateTableName } from '../../compute/data_frame.js';
import { createIsolatedNodeTestClient, createNodeTestClient } from './hyperdb_test_client.js';
import { HyperDB, type HyperDBEngineClient, type HyperDBResult } from './hyperdb_wasm.js';

function toPlainObjects(table: arrow.Table): Record<string, unknown>[] {
    return table.toArray().map(row => Object.fromEntries(Object.keys(row).map(key => [key, row[key]])));
}

class CountingClient implements HyperDBEngineClient {
    connectCount = 0;
    disconnectCount = 0;
    createDatabaseCount = 0;
    dropDatabaseCount = 0;
    attachDatabaseCount = 0;
    detachDatabaseCount = 0;

    constructor(private readonly client: HyperDBEngineClient) {}

    ready(): Promise<void> {
        return this.client.ready();
    }

    initialize(settings: string): Promise<HyperDBResult> {
        return this.client.initialize(settings);
    }

    connect(): Promise<HyperDBResult> {
        this.connectCount++;
        return this.client.connect();
    }

    disconnect(connection: number): Promise<HyperDBResult> {
        this.disconnectCount++;
        return this.client.disconnect(connection);
    }

    createDatabase(databaseName: string, persistent: boolean): Promise<HyperDBResult> {
        this.createDatabaseCount++;
        return this.client.createDatabase(databaseName, persistent);
    }

    openDatabase(databaseName: string): Promise<HyperDBResult> {
        return this.client.openDatabase(databaseName);
    }

    listDatabases(): Promise<HyperDBResult> {
        return this.client.listDatabases();
    }

    checkpointDatabase(databaseName: string): Promise<HyperDBResult> {
        return this.client.checkpointDatabase(databaseName);
    }

    dropDatabase(databaseName: string): Promise<HyperDBResult> {
        this.dropDatabaseCount++;
        return this.client.dropDatabase(databaseName);
    }

    attachDatabase(connection: number, databaseName: string, alias: string): Promise<HyperDBResult> {
        this.attachDatabaseCount++;
        return this.client.attachDatabase(connection, databaseName, alias);
    }

    detachDatabase(connection: number, alias: string): Promise<HyperDBResult> {
        this.detachDatabaseCount++;
        return this.client.detachDatabase(connection, alias);
    }

    startQuery(connection: number, sql: string): Promise<HyperDBResult> {
        return this.client.startQuery(connection, sql);
    }

    insertArrowIPCFromPath(
        connection: number,
        path: string,
        name: string,
        schema: string | null,
        create: boolean,
        internal: boolean,
    ): Promise<HyperDBResult> {
        return this.client.insertArrowIPCFromPath(connection, path, name, schema, create, internal);
    }

    createTemporaryFile(bytes: Uint8Array): Promise<HyperDBResult> {
        return this.client.createTemporaryFile(bytes);
    }

    removeFile(path: string): Promise<HyperDBResult> {
        return this.client.removeFile(path);
    }

    pollQuery(query: number): Promise<HyperDBResult> {
        return this.client.pollQuery(query);
    }

    cancelQuery(query: number): Promise<HyperDBResult> {
        return this.client.cancelQuery(query);
    }

    releaseQuery(query: number): Promise<HyperDBResult> {
        return this.client.releaseQuery(query);
    }

    shutdown(): Promise<HyperDBResult> {
        return this.client.shutdown();
    }

    terminate(): Promise<void> {
        return this.client.terminate();
    }
}

describe('HyperDB embedded database integration', () => {
    let client: CountingClient;
    let database: HyperDB | null = null;
    let releaseClient: (() => Promise<void>) | null = null;

    beforeEach(async () => {
        const { client: rawClient, release } = await createIsolatedNodeTestClient();
        releaseClient = release;
        client = new CountingClient(rawClient);
        database = await HyperDB.create(client, {
            experimental_hyper_introspection_functions: true,
            log_json_export: true,
            log_file_size_limit: '1M',
            log_file_max_count: 10,
        });
    }, 60_000);

    afterEach(async () => {
        try {
            await database?.terminate();
        } finally {
            await releaseClient?.();
        }
    });

    it('queries Hyper through Arrow IPC using the DashQL Arrow runtime', async () => {
        const connection = await database!.connect();
        const result = await connection.query("SELECT 42::INTEGER AS answer, 'hyper'::TEXT AS engine");

        expect(toPlainObjects(result)).toEqual([{ answer: 42, engine: 'hyper' }]);
        expect(await database!.getVersion()).toContain('hyper version');

        await connection.close();
    });

    it('initializes Hyper log introspection and rotation settings', async () => {
        const connection = await database!.connect();
        expect(await connection.query("SELECT * FROM hyper_log('current_session') LIMIT 0")).toBeDefined();
        await connection.close();
    });

    it('returns no Arrow IPC chunks for successful DDL', async () => {
        const connection = await database!.connect();

        const result = await connection.queryArrowIPC('CREATE TABLE foo(a INT)');

        expect(result).toHaveLength(0);
        expect(toPlainObjects(await connection.query('SELECT * FROM foo'))).toEqual([]);
        await connection.close();
    });

    it('keeps compute and pg_catalog as separate in-memory databases', async () => {
        const localConnection = await database!.connect({ defaultDatabase: 'pg_catalog' });
        await localConnection.query('CREATE TABLE local_state(user_id INT)');

        const computeConnection = await database!.connect();
        await computeConnection.query('CREATE TABLE compute_state(value INT)');

        await database!.createPersistentDatabase('source');
        await localConnection.attachPersistentDatabase('source', 'source');

        expect(toPlainObjects(await localConnection.query(
            'SELECT COUNT(*)::INTEGER AS row_count FROM pg_catalog.public.local_state',
        ))).toEqual([{ row_count: 0 }]);
        expect(toPlainObjects(await computeConnection.query(
            'SELECT COUNT(*)::INTEGER AS row_count FROM compute_state',
        ))).toEqual([{ row_count: 0 }]);
        await expect(localConnection.query(
            'SELECT * FROM pg_catalog.public.compute_state',
        )).rejects.toThrow();
        await expect(computeConnection.query(
            'SELECT * FROM local_state',
        )).rejects.toThrow();
        await localConnection.close();
        await computeConnection.close();
    });

    it('reopens a persistent database after a new engine instance starts', async () => {
        const { mkdtemp, readdir, rm } = await import('node:fs/promises');
        const { join } = await import('node:path');
        const hostPath = await mkdtemp(join(process.env.TEST_TMPDIR ?? process.cwd(), 'hyperdb-wasm-persistent-'));
        const databaseName = 'shell_persisted';
        try {
            const first = await HyperDB.create(await createNodeTestClient(hostPath));
            await first.createPersistentDatabase(databaseName);
            const writer = await first.connect();
            await writer.attachPersistentDatabase(databaseName, 'saved');
            await writer.query('CREATE TABLE saved.public.rows(id INTEGER)');
            await writer.query('INSERT INTO saved.public.rows VALUES (42)');
            await writer.close();
            await first.checkpointPersistentDatabase(databaseName);
            expect(await readdir(join(hostPath, 'hyperdb'))).toContain(`${databaseName}.hyper`);
            await first.terminate();

            const second = await HyperDB.create(await createNodeTestClient(hostPath));
            await second.openPersistentDatabase(databaseName);
            const reader = await second.connect();
            await reader.attachPersistentDatabase(databaseName, 'saved');
            expect(toPlainObjects(await reader.query('SELECT id FROM saved.public.rows'))).toEqual([{ id: 42 }]);
            await reader.close();
            await second.terminate();
        } finally {
            await rm(hostPath, { recursive: true, force: true });
        }
    }, 60_000);

    it('keeps shared tables visible across physical DataFrame connections', async () => {
        const inputName = generateTableName('__hyper_input');
        const summaryName = generateTableName('__hyper_summary');
        const input = await DataFrame.fromArrowTable(database!, arrow.tableFromArrays({
            id: new Int32Array([1, 2, 3]),
            label: ['alpha', 'beta', 'gamma'],
        }), inputName);

        const [firstRead, secondRead] = await Promise.all([
            input.readTable(),
            input.readTable(),
        ]);
        expect(toPlainObjects(firstRead)).toEqual([
            { id: 1, label: 'alpha' },
            { id: 2, label: 'beta' },
            { id: 3, label: 'gamma' },
        ]);
        expect(toPlainObjects(secondRead)).toEqual(toPlainObjects(firstRead));

        const summary = await DataFrame.fromSQL(
            database!,
            `SELECT COUNT(*)::INTEGER AS row_count FROM "${inputName}"`,
            summaryName,
        );
        expect(toPlainObjects(await summary.readTable())).toEqual([{ row_count: 3 }]);
        expect(client.createDatabaseCount).toBe(2);
        expect(client.connectCount).toBeGreaterThan(1);
        expect(client.attachDatabaseCount).toBe(client.connectCount);
        expect(client.disconnectCount).toBe(client.connectCount);
        expect(client.detachDatabaseCount).toBe(client.disconnectCount);

        await summary.destroy();
        await expect(summary.readTable()).rejects.toThrow();
        await input.destroy();
        await expect(input.readTable()).rejects.toThrow();
    });

    it('appends Arrow batches to a shared table', async () => {
        const first = await database!.connect();
        await first.insertArrowTable(arrow.tableFromArrays({ value: new Int32Array([1, 2]) }), {
            name: 'hyper_append_rows',
        });
        await first.close();

        const second = await database!.connect();
        await second.insertArrowTable(arrow.tableFromArrays({ value: new Int32Array([3, 4]) }), {
            name: 'hyper_append_rows',
            create: false,
        });
        await second.close();

        const reader = await database!.connect();
        expect(toPlainObjects(await reader.query('SELECT value FROM hyper_append_rows ORDER BY value'))).toEqual([
            { value: 1 },
            { value: 2 },
            { value: 3 },
            { value: 4 },
        ]);
        await reader.close();
    });
});
