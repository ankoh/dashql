import * as arrow from 'apache-arrow';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ShellFileRegistry } from '../../shell/terminal/shell_files.js';
import { setupWebHyperDB } from './hyperdb_provider_web.js';
import { createTestHyperDBClient, testDatabasePath } from '../../tests/hyperdb_test_client.js';
import { HYPER_INSTANCE_LOGS_DIRECTORY, HYPER_INSTANCES_DIRECTORY } from '@akohn/dashql/platform/hyperdb/hyperdb_opfs_instance';
import { TestLogger } from '@akohn/dashql/platform/testing/test_logger';
import { HyperDB, type HyperDBClient, type HyperDBResult, type HyperDBSettings } from '@akohn/dashql/platform/hyperdb/hyperdb_wasm';
import { HyperDB as HyperDBEngine } from 'hyperdb-wasm';
import { exportArrowTableAsParquet, PARQUET_EXPORT_DIRECTORY } from '@akohn/dashql/platform/hyperdb/hyperdb_parquet_export';
import { createWorkbookResultFiles, RESULT_ROW_COLUMN, resultsMountPath } from '@akohn/dashql/platform/workbook/workbook_result_files';
import { getOPFSRoot } from '@akohn/dashql/platform/opfs_root';
import { AttachmentMounts } from '@akohn/dashql/platform/workbook/attachment_mounts';
import { tableFromArrays, vectorFromArray } from '@akohn/dashql/platform/testing/arrow_fixtures';

function toPlainObjects(table: arrow.Table): Record<string, unknown>[] {
    return table.toArray().map(row => Object.fromEntries(Object.keys(row).map(key => [key, row[key]])));
}

function persistentDatabaseName(prefix: string): string {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '_')}`;
}

async function ignoreCleanupFailure(cleanup: () => Promise<void>): Promise<void> {
    try {
        await cleanup();
    } catch {
        // Preserve the test failure that triggered cleanup.
    }
}

class CountingClient implements HyperDBClient {
    connectCount = 0;
    disconnectCount = 0;

    constructor(private readonly client: HyperDBClient) {}

    ready(): Promise<void> {
        return this.client.ready();
    }

    initialize(settings: HyperDBSettings): Promise<HyperDBResult> {
        return this.client.initialize(settings);
    }

    connect(settings?: Record<string, string>): Promise<HyperDBResult> {
        this.connectCount++;
        return this.client.connect(settings);
    }

    disconnect(connection: number): Promise<HyperDBResult> {
        this.disconnectCount++;
        return this.client.disconnect(connection);
    }


    startQuery(connection: number, sql: string): Promise<HyperDBResult> {
        return this.client.startQuery(connection, sql);
    }

    mount(source: Parameters<HyperDBClient['mount']>[0], path: string, mode: 'read' | 'readwrite'): Promise<HyperDBResult> {
        return this.client.mount(source, path, mode);
    }

    unmount(path: string): Promise<HyperDBResult> {
        return this.client.unmount(path);
    }

    refreshMount(path: string): Promise<HyperDBResult> {
        return this.client.refreshMount(path);
    }

    listMount(path: string): Promise<HyperDBResult> {
        return this.client.listMount(path);
    }

    readMountFile(path: string, file: string): Promise<HyperDBResult> {
        return this.client.readMountFile(path, file);
    }

    pollQuery(query: number): Promise<HyperDBResult> {
        return this.client.pollQuery(query);
    }

    cancelQuery(query: number): Promise<HyperDBResult> {
        return this.client.cancelQuery(query);
    }

    finishQuery(query: number): Promise<HyperDBResult> {
        return this.client.finishQuery(query);
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
    let engineClient: HyperDBClient;
    let database: HyperDB | null = null;
    let nextDatabase = 1;

    beforeAll(async () => {
        engineClient = globalThis.__DASHQL_TEST_HYPERDB_CLIENT__
            ? await globalThis.__DASHQL_TEST_HYPERDB_CLIENT__()
            : await createTestHyperDBClient();
    });

    beforeEach(async () => {
        client = new CountingClient(engineClient);
        database = await HyperDB.create(new HyperDBEngine(client), {
            computeDatabasePath: await testDatabasePath(`dashql-integration-${nextDatabase++}.hyper`),
            defaultDatabasePath: await testDatabasePath(`dashql-integration-${nextDatabase++}.hyper`),
            terminateEngine: false,
        });
    }, 60_000);

    afterEach(async () => {
        await database?.terminate();
        database = null;
    });

    afterAll(async () => {
        if (!globalThis.__DASHQL_TEST_HYPERDB_CLIENT__) await engineClient.terminate();
    });

    it('persists an OPFS database file across wrapper lifecycles', async () => {
        const name = persistentDatabaseName('dashql_persisted');
        const path = await testDatabasePath(`${name}.hyper`);
        const first = await database!.connect();
        let created = false;
        try {
            await first.execute(`CREATE DATABASE ${quoteSqlIdentifier(path)}`);
            created = true;
            await first.execute(`ATTACH DATABASE ${quoteSqlIdentifier(path)} AS saved`);
            await first.execute('CREATE TABLE saved.public.rows(id INTEGER)');
            await first.execute('INSERT INTO saved.public.rows VALUES (42)');
            await first.execute('DETACH DATABASE saved');
            await first.close();
            await database!.terminate();
            database = null;

            database = await HyperDB.create(new HyperDBEngine(engineClient), {
                computeDatabasePath: await testDatabasePath(`dashql-integration-${nextDatabase++}.hyper`),
                defaultDatabasePath: await testDatabasePath(`dashql-integration-${nextDatabase++}.hyper`),
                terminateEngine: false,
            });
            const second = await database.connect();
            try {
                await second.execute(`ATTACH DATABASE ${quoteSqlIdentifier(path)} AS restored`);
                expect(toPlainObjects(await second.query('SELECT id FROM restored.public.rows'))).toEqual([{ id: 42 }]);
                await second.execute('DETACH DATABASE restored');
            } finally {
                await second.close();
            }
        } finally {
            if (created && database != null) {
                const cleanup = await database.connect();
                try {
                    await ignoreCleanupFailure(async () => { await cleanup.execute(`DROP DATABASE ${quoteSqlIdentifier(path)}`); });
                } finally {
                    await cleanup.close();
                }
            }
            await first.close();
        }
    }, 60_000);

    it('queries Hyper through Arrow IPC using the DashQL Arrow runtime', async () => {
        const connection = await database!.connect();
        const result = await connection.query("SELECT 42::INTEGER AS answer, 'hyper'::TEXT AS engine");

        expect(toPlainObjects(result)).toEqual([{ answer: 42, engine: 'hyper' }]);
        expect(await database!.getVersion()).toContain('hyper version');

        await connection.close();
    });

    it('creates and disposes a production OPFS instance', async () => {
        const factory = globalThis.__DASHQL_TEST_HYPERDB_FACTORY__;
        globalThis.__DASHQL_TEST_HYPERDB_FACTORY__ = undefined;
        const listInstances = async () => {
            const instances = await (await getOPFSRoot())
                .getDirectoryHandle(HYPER_INSTANCES_DIRECTORY, { create: true });
            const names: string[] = [];
            for await (const name of instances.keys()) names.push(name);
            return names;
        };
        try {
            const before = new Set(await listInstances());
            const instanceDatabase = await setupWebHyperDB('opfs_instance_test', new TestLogger());
            const created = (await listInstances()).filter(name => !before.has(name));
            expect(created).toHaveLength(1);
            const connection = await instanceDatabase.connect();
            expect(toPlainObjects(await connection.query('SELECT 42::INTEGER AS answer')))
                .toEqual([{ answer: 42 }]);
            // The instance writes its Hyper log into its own folder, and hyper_log() reads it from there.
            const logs = await (await (await (await getOPFSRoot())
                .getDirectoryHandle(HYPER_INSTANCES_DIRECTORY)).getDirectoryHandle(created[0]))
                .getDirectoryHandle(HYPER_INSTANCE_LOGS_DIRECTORY);
            const logFiles: string[] = [];
            for await (const name of logs.keys()) logFiles.push(name);
            expect(logFiles.some(name => /^hyperd_.*\.log$/.test(name))).toBe(true);
            expect(toPlainObjects(await connection.query(`
                SELECT count(*)::INTEGER AS n FROM hyper_log(current_session := true) WHERE k = 'query-end'
            `))[0].n).toBeGreaterThan(0);
            await connection.close();
            await instanceDatabase.terminate();
            expect(await listInstances()).not.toContain(created[0]);
        } finally {
            globalThis.__DASHQL_TEST_HYPERDB_FACTORY__ = factory;
        }
    }, 60_000);

    it('queries a browser Blob through a registered WasmFS path', async () => {
        const connection = await database!.connect();
        const blob = new Blob(['value,name\n1,alpha\n2,beta\n'], { type: 'text/csv' });
        let path: string | null = null;
        try {
            path = await database!.registerExternalFile('values with spaces \u00e9.csv', blob);
            expect(path).toBe('/mnt/external/values_with_spaces__.csv');
            const result = await connection.query(`
                SELECT sum(value) AS total
                FROM external('${path}', format => 'csv', header => true,
                    columns => descriptor(value bigint, name text))
            `);
            expect(toPlainObjects(result)).toEqual([{ total: 3n }]);

            await database!.removeExternalFile(path);
            await expect(connection.query(`SELECT * FROM external('${path}', format => 'csv')`)).rejects.toThrow();
            path = null;
        } finally {
            if (path != null) await ignoreCleanupFailure(() => database!.removeExternalFile(path!));
            await connection.close();
        }
    }, 60_000);

    it('queries a nested OPFS file through a registered browser directory', async () => {
        const connection = await database!.connect();
        const root = await getOPFSRoot();
        const name = `dashql-directory-${crypto.randomUUID()}`;
        const directory = await root.getDirectoryHandle(name, { create: true });
        const nested = await directory.getDirectoryHandle('input', { create: true });
        const file = await nested.getFileHandle('values.csv', { create: true });
        const writer = await file.createWritable();
        await writer.write('value,name\n1,alpha\n2,beta\n');
        await writer.close();
        let path: string | null = null;
        try {
            path = await database!.registerExternalDirectory(directory, `/mnt/external/${name}`, 'read');
            expect(toPlainObjects(await connection.query(`
                SELECT sum(value) AS total
                FROM external('${path}/input/values.csv', format => 'csv', header => true,
                    columns => descriptor(value bigint, name text))
            `))).toEqual([{ total: 3n }]);

            await database!.removeExternalDirectory(path);
            await expect(connection.query(`SELECT * FROM external('${path}/input/values.csv', format => 'csv')`)).rejects.toThrow();
            path = null;
        } finally {
            if (path != null) await ignoreCleanupFailure(() => database!.removeExternalDirectory(path!));
            await ignoreCleanupFailure(() => root.removeEntry(name, { recursive: true }));
            await connection.close();
        }
    }, 60_000);

    it('reads a rewritten file of a registered browser directory after a refresh', async () => {
        const connection = await database!.connect();
        const root = await getOPFSRoot();
        const name = `dashql-directory-${crypto.randomUUID()}`;
        const directory = await root.getDirectoryHandle(name, { create: true });
        const write = async (text: string) => {
            const writer = await (await directory.getFileHandle('values.csv', { create: true })).createWritable();
            await writer.write(text);
            await writer.close();
        };
        const total = async (path: string) => toPlainObjects(await connection.query(`
            SELECT sum(value) AS total
            FROM external('${path}/values.csv', format => 'csv', header => true,
                columns => descriptor(value bigint, name text))
        `));
        await write('value,name\n1,alpha\n2,beta\n');
        let path: string | null = null;
        try {
            path = await database!.registerExternalDirectory(directory, `/mnt/external/${name}`, 'read');
            expect(await total(path)).toEqual([{ total: 3n }]);
            // The database opened the old file, the refresh makes it look the file up again
            await write('value,name\n10,gamma\n20,delta\n30,epsilon\n');
            await database!.refreshExternalDirectory(path);
            expect(await total(path)).toEqual([{ total: 60n }]);
        } finally {
            if (path != null) await ignoreCleanupFailure(() => database!.removeExternalDirectory(path!));
            await ignoreCleanupFailure(() => root.removeEntry(name, { recursive: true }));
            await connection.close();
        }
    }, 60_000);

    it('reads the Parquet attachments of a session through a read-only mount', async () => {
        const connection = await database!.connect();
        const root = await getOPFSRoot();
        const name = `dashql-attachments-${crypto.randomUUID()}`;
        const directory = await root.getDirectoryHandle(name, { create: true });
        const write = async (file: string, values: number[]) => {
            const bytes = await exportArrowTableAsParquet(database!, tableFromArrays({ value: BigInt64Array.from(values.map(BigInt)) }));
            const writer = await (await directory.getFileHandle(file, { create: true })).createWritable();
            await writer.write(bytes as BlobPart);
            await writer.close();
        };
        const total = async (path: string, file: string) => toPlainObjects(await connection.query(`
            SELECT sum(value) AS total FROM external('${path}/${file}', format => 'parquet')
        `));
        await write('a.parquet', [1, 2]);
        let path: string | null = null;
        try {
            path = await database!.registerExternalDirectory(directory, `/mnt/external/attachments/${name}`, 'read');
            expect(await total(path, 'a.parquet')).toEqual([{ total: 3n }]);
            // An overwritten, an added and a removed file are seen after a refresh
            await write('a.parquet', [10, 20, 30]);
            await write('b.parquet', [5]);
            await database!.refreshExternalDirectory(path);
            expect(await total(path, 'a.parquet')).toEqual([{ total: 60n }]);
            expect(await total(path, 'b.parquet')).toEqual([{ total: 5n }]);
            await directory.removeEntry('b.parquet');
            await database!.refreshExternalDirectory(path);
            await expect(total(path, 'b.parquet')).rejects.toThrow();
        } finally {
            if (path != null) await ignoreCleanupFailure(() => database!.removeExternalDirectory(path!));
            await ignoreCleanupFailure(() => root.removeEntry(name, { recursive: true }));
            await connection.close();
        }
    }, 60_000);

    it('reads the columns of a workbook attachment through the mount of the workbook', async () => {
        const root = await getOPFSRoot();
        const workbooks = await root.getDirectoryHandle('workbooks', { create: true });
        const workbookId = crypto.randomUUID();
        const mounts = new AttachmentMounts();
        const write = async (table: arrow.Table) => {
            const bytes = await exportArrowTableAsParquet(database!, table);
            const folder = await (await workbooks.getDirectoryHandle(workbookId, { create: true })).getDirectoryHandle('attachments', { create: true });
            const writer = await (await folder.getFileHandle('sales.parquet', { create: true })).createWritable();
            await writer.write(bytes as BlobPart);
            await writer.close();
        };
        try {
            await write(tableFromArrays({ region: ['eu'], amount: Int32Array.from([1]) }));
            expect(await mounts.readColumns(database!, workbookId, 'sales.parquet')).toEqual(['region', 'amount']);
            // A changed attachment is read again once the mount is marked stale
            await write(tableFromArrays({ id: Int32Array.from([1]) }));
            mounts.changed(workbookId);
            expect(await mounts.readColumns(database!, workbookId, 'sales.parquet')).toEqual(['id']);
        } finally {
            await mounts.unmount(workbookId);
            await ignoreCleanupFailure(() => workbooks.removeEntry(workbookId, { recursive: true }));
        }
    }, 60_000);

    it('refuses to refresh a directory that is not registered', async () => {
        await expect(database!.refreshExternalDirectory('/mnt/external/unknown-directory')).rejects.toThrow('not registered');
    });

    it('exports an Arrow table as Parquet through OPFS', async () => {
        const table = tableFromArrays({
            id: Int32Array.from([1, 2, 3]),
            name: ['alpha', 'beta', 'gamma'],
        });
        const bytes = await exportArrowTableAsParquet(database!, table);
        expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('PAR1');
        expect(new TextDecoder().decode(bytes.subarray(bytes.byteLength - 4))).toBe('PAR1');

        const root = await getOPFSRoot();
        const exports = await root.getDirectoryHandle(PARQUET_EXPORT_DIRECTORY);
        const remaining: string[] = [];
        for await (const name of exports.keys()) remaining.push(name);
        expect(remaining).toEqual([]);

        const connection = await database!.connect();
        let path: string | null = null;
        try {
            path = await database!.registerExternalFile('export.parquet', new Blob([bytes as BlobPart]));
            expect(toPlainObjects(await connection.query(`SELECT id, name FROM external('${path}') ORDER BY id`)))
                .toEqual([{ id: 1, name: 'alpha' }, { id: 2, name: 'beta' }, { id: 3, name: 'gamma' }]);
        } finally {
            if (path != null) await ignoreCleanupFailure(() => database!.removeExternalFile(path!));
            await connection.close();
        }
    }, 60_000);

    /// The results of the workbooks in a folder of its own
    async function testResults() {
        const root = await getOPFSRoot();
        const name = `results-test-${crypto.randomUUID()}`;
        const folder = await root.getDirectoryHandle(name, { create: true });
        const results = createWorkbookResultFiles({ getRoot: async () => folder });
        const files = async () => (await results.files(WORKBOOK)).map(file => file.name).sort();
        return { results, files, cleanup: () => root.removeEntry(name, { recursive: true }) };
    }
    const WORKBOOK = '00000000-0000-4000-8000-0000000000a1';
    const FILE_A = `a.${'a'.repeat(64)}.00000001.parquet`;
    const FILE_B = `b.${'b'.repeat(64)}.00000002.parquet`;

    it('writes the results of a workbook into its folder and reads them back from disk', async () => {
        const table = tableFromArrays({ id: Int32Array.from([1, 2, 3]), name: ['alpha', 'beta', 'gamma'] });
        const { results, files, cleanup } = await testResults();
        try {
            expect(await results.writeTable(database!, WORKBOOK, table, FILE_A)).toBe(3);
            // The file is complete under its name, the temporary file of the write is gone
            expect(await files()).toEqual([FILE_A]);
            expect(toPlainObjects((await results.readTable(database!, WORKBOOK, FILE_A))!)).toEqual(toPlainObjects(table));
            // A file that is gone reads as none
            expect(await results.readTable(database!, WORKBOOK, FILE_B)).toBeNull();
        } finally {
            await cleanup();
        }
    }, 60_000);

    it('forgets removed results while a run reads through the mount', async () => {
        const table = tableFromArrays({ id: Int32Array.from([1]) });
        const { results, cleanup } = await testResults();
        try {
            await results.writeTable(database!, WORKBOOK, table, FILE_A);
            expect(toPlainObjects((await results.readTable(database!, WORKBOOK, FILE_A))!)).toEqual([{ id: 1 }]);
            await results.writeTable(database!, WORKBOOK, tableFromArrays({ id: Int32Array.from([2]) }), FILE_B);
            // A run keeps reading its file through the mount while another one is removed
            const release = await results.pin(WORKBOOK, FILE_B);
            try {
                expect(await results.remove(WORKBOOK, FILE_B)).toBe(false);
                expect(await results.remove(WORKBOOK, FILE_A)).toBe(true);
                await results.mount(database!, WORKBOOK);
                const prefix = resultsMountPath(WORKBOOK);
                const connection = await database!.connect();
                try {
                    await expect(connection.query(`select * from external('${prefix}/${FILE_A}', format => 'parquet')`)).rejects.toThrow();
                    // A scan of the file sees the column of the order of its rows, a read of the results leaves it out
                    expect(toPlainObjects(await connection.query(`select * from external('${prefix}/${FILE_B}', format => 'parquet')`))).toEqual([{ id: 2, [RESULT_ROW_COLUMN]: 1n }]);
                } finally {
                    await connection.close();
                }
            } finally {
                await release();
            }
            // A new file of the script is readable through the refreshed mount
            const second = `a.${'a'.repeat(64)}.00000003.parquet`;
            await results.writeTable(database!, WORKBOOK, table, second);
            expect(toPlainObjects((await results.readTable(database!, WORKBOOK, second))!)).toEqual([{ id: 1 }]);
            // A renamed file is readable under its new name
            const renamed = `c.${'a'.repeat(64)}.00000004.parquet`;
            expect(await results.move(WORKBOOK, second, renamed)).toBe(true);
            expect(toPlainObjects((await results.readTable(database!, WORKBOOK, renamed))!)).toEqual([{ id: 1 }]);
        } finally {
            await cleanup();
        }
    }, 60_000);

    it('queries a shell-mounted file', async () => {
        const connection = await database!.connect();
        const name = `values-${crypto.randomUUID()}.csv`;
        const file = new File(['value,name\n1,alpha\n2,beta\n'], name, { type: 'text/csv' });
        const registry = new ShellFileRegistry(undefined, database!);
        let mounted: string | null = null;
        try {
            mounted = await registry.mountFile(file);
            expect(toPlainObjects(await connection.query(`
                SELECT sum(value) AS total
                FROM external('${mounted}', format => 'csv', header => true,
                    columns => descriptor(value bigint, name text))
            `))).toEqual([{ total: 3n }]);
        } finally {
            if (mounted != null) await ignoreCleanupFailure(async () => { await registry.drop(mounted!); });
            await registry.dispose();
            await connection.close();
        }
    }, 60_000);

    it('exposes function signatures through pg_proc introspection', async () => {
        const connection = await database!.connect({ defaultDatabase: 'hyper' });
        const result = await connection.query(`
            SELECT
                n.nspname AS function_schema,
                p.proname AS function_name,
                pg_catalog.pg_get_function_arguments(p.oid) AS function_arguments,
                pg_catalog.pg_get_function_result(p.oid) AS return_type,
                p.prokind AS function_kind
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE p.prokind IN ('f', 'a', 'w', 'p')
            ORDER BY n.nspname, p.proname
        `);

        expect(result.numRows).toBeGreaterThan(0);
        expect(toPlainObjects(result).find(row => row.function_name === 'abs')).toBeDefined();
        await connection.close();
    });

    it('round-trips Arrow tables through external Arrow stream scans', async () => {
        const connection = await database!.connect();
        const table = new arrow.Table({
            id: vectorFromArray([1, 2, null], new arrow.Int32()),
            big: vectorFromArray([1n, 2n, 3n], new arrow.Int64()),
            label: vectorFromArray(['a', 'b', 'a'], new arrow.Dictionary(new arrow.Utf8(), new arrow.Int32())),
            long: vectorFromArray(['x', null, 'z'], new arrow.LargeUtf8()),
            score: vectorFromArray([1.5, null, 3.5], new arrow.Float64()),
            flag: vectorFromArray([true, false, null], new arrow.Bool()),
            day: vectorFromArray([new Date(Date.UTC(2026, 0, 2)), null, null], new arrow.DateDay()),
            at: vectorFromArray([new Date(Date.UTC(2026, 0, 2, 3, 4, 5)), null, null], new arrow.TimestampMillisecond()),
            tags: vectorFromArray([['p', 'q'], null, []], new arrow.List(new arrow.Field('item', new arrow.Utf8(), true))),
        });

        await connection.insertArrowTable(table, { name: 'round_trip' });
        await connection.insertArrowTable(table.slice(0, 1), { name: 'round_trip', create: false });

        const result = await connection.query(`
            SELECT id, big, label, long, score, flag, day::text AS day, at::text AS at, array_length(tags) AS tags
            FROM round_trip ORDER BY big, id
        `);
        expect(toPlainObjects(result)).toEqual([
            { id: 1, big: 1n, label: 'a', long: 'x', score: 1.5, flag: true, day: '2026-01-02', at: '2026-01-02 03:04:05', tags: 2 },
            { id: 1, big: 1n, label: 'a', long: 'x', score: 1.5, flag: true, day: '2026-01-02', at: '2026-01-02 03:04:05', tags: 2 },
            { id: 2, big: 2n, label: 'b', long: null, score: null, flag: false, day: null, at: null, tags: null },
            { id: null, big: 3n, label: 'a', long: 'z', score: 3.5, flag: null, day: null, at: null, tags: 0 },
        ]);
        await connection.close();
    });

    it('returns a table without columns for successful DDL', async () => {
        const connection = await database!.connect();

        const result = await connection.query('CREATE TABLE foo(a INT)');

        expect(result.numCols).toBe(0);
        expect(toPlainObjects(await connection.query('SELECT * FROM foo'))).toEqual([]);
        await connection.close();
    });

    it('streams large results batch by batch and cancels the rest', async () => {
        const connection = await database!.connect();

        const reader = await connection.queryStream('SELECT s.a FROM generate_series(1, 10000000) s(a)');
        const first = await reader.next();
        expect(first.done).toBe(false);
        expect(first.value!.numRows).toBeLessThan(10_000_000);
        await reader.cancel();

        expect(toPlainObjects(await connection.query('SELECT 1::INTEGER AS one'))).toEqual([{ one: 1 }]);
        await connection.close();
    });

    it('cancels a query that has not produced a result yet', async () => {
        const connection = await database!.connect();
        const abort = new AbortController();

        const query = connection.query('SELECT count(*) FROM generate_series(1, 10000000000) s(a)', abort.signal);
        setTimeout(() => abort.abort(new Error('stop counting')), 50);

        await expect(query).rejects.toThrow('stop counting');
        expect(toPlainObjects(await connection.query('SELECT 1::INTEGER AS one'))).toEqual([{ one: 1 }]);
        await connection.close();
    });

    it('returns the affected rows of executed statements', async () => {
        const connection = await database!.connect();

        expect(await connection.execute('CREATE TABLE executed(a INT)')).toBeNull();
        expect(await connection.execute('INSERT INTO executed VALUES (1), (2), (3)')).toBe(3n);
        expect(await connection.execute('UPDATE executed SET a = a + 1 WHERE a > 1')).toBe(2n);
        expect(await connection.execute('DELETE FROM executed WHERE a = 1')).toBe(1n);
        expect(await connection.execute('DROP TABLE executed')).toBeNull();
        await connection.close();
    });


    it('keeps shared tables visible across pooled connections', async () => {
        const inputName = '__hyper_input';
        const summaryName = '__hyper_summary';
        // The pooled connections of the compute platform of the runtime, one per call
        const withConnection = async <T>(fn: (conn: Awaited<ReturnType<HyperDB['connect']>>) => Promise<T>): Promise<T> => {
            const conn = await database!.connect({ pooled: true });
            try {
                return await fn(conn);
            } finally {
                await conn.close();
            }
        };
        await withConnection(conn => conn.insertArrowTable(tableFromArrays({
            id: new Int32Array([1, 2, 3]),
            label: ['alpha', 'beta', 'gamma'],
        }), { name: inputName, create: true }));
        const input = inputName;
        const read = (tableName: string) => withConnection(conn => conn.query(`SELECT * FROM "${tableName}"`));
        const drop = (tableName: string) => withConnection(conn => conn.execute(`DROP TABLE IF EXISTS "${tableName}"`));

        const [firstRead, secondRead] = await Promise.all([
            read(input),
            read(input),
        ]);
        expect(toPlainObjects(firstRead)).toEqual([
            { id: 1, label: 'alpha' },
            { id: 2, label: 'beta' },
            { id: 3, label: 'gamma' },
        ]);
        expect(toPlainObjects(secondRead)).toEqual(toPlainObjects(firstRead));
        const connectsAfterReads = client.connectCount;

        await withConnection(conn => conn.createTableAs(summaryName, `SELECT COUNT(*)::INTEGER AS row_count FROM "${inputName}"`));
        const summary = summaryName;
        expect(toPlainObjects(await read(summary))).toEqual([{ row_count: 3 }]);
        // Later statements reuse the attached sessions of the parallel reads.
        expect(client.connectCount).toBe(connectsAfterReads);

        await drop(summary);
        await expect(read(summary)).rejects.toThrow();
        await drop(input);
        await expect(read(input)).rejects.toThrow();
    });

    it('appends Arrow batches to a shared table', async () => {
        const first = await database!.connect();
        await first.insertArrowTable(tableFromArrays({ value: new Int32Array([1, 2]) }), {
            name: 'hyper_append_rows',
        });
        await first.close();

        const second = await database!.connect();
        await second.insertArrowTable(tableFromArrays({ value: new Int32Array([3, 4]) }), {
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

function quoteSqlIdentifier(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
}
