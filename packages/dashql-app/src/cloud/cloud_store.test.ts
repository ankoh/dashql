import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { exportArrowTableAsParquet } from '@ankoh/dashql-runtime/platform/hyperdb/hyperdb_parquet_export';
import type { HyperDB, HyperDBConnection } from '../platform/hyperdb/hyperdb_wasm.js';
import type { WorkbookBundle } from '@ankoh/dashql-runtime/storage/workbook_bundle';
import { TEST_CONNECTION_ID, testWorkbook } from '@ankoh/dashql-runtime/testing/workbook_test_backend';
import {
    ATTACHMENTS_TABLE,
    CONNECTIONS_TABLE,
    CATALOG_FUNCTION_PARAMS_TABLE,
    CATALOG_TABLES_TABLE,
    newDataTableName,
    SCRIPTS_TABLE,
    WORKBOOK_TABLE,
    workbookBundleToTables,
    workbookTablesToBundle,
    type WorkbookTables,
} from '@ankoh/dashql-runtime/storage/workbook_tables';
import { createTestHyperDB, testDatabasePath } from '../tests/hyperdb_test_client.js';
import { listCloudEntries, type CloudCursor, type CloudSearch } from './cloud_folders.js';
import {
    cleanupCloud,
    CloudPublishTooLargeError,
    CLOUD_MERGED_TABLE_NAMES,
    deleteCloudWorkbook,
    listCloudWorkbookVersions,
    newVersionId,
    publishCloudWorkbook,
    readCloudWorkbook,
    readParquetAsText,
    restoreCloudWorkbook,
    type CloudWorkbook,
    type CloudWorkbookVersion,
} from './cloud_store.js';
import { CLOUD_DATABASE, CLOUD_MIGRATIONS, installCloudStore, type CloudMigration, type CloudQuery } from './cloud_store_schema.js';

let database: HyperDB;
let dispose: () => Promise<void>;
let connection: HyperDBConnection;
/// The cloud: the embedded Hyper with a database attached as the database of DashQL
let query: CloudQuery;
/// The statements that the store sent
let statements: string[];

beforeAll(async () => {
    const test = await createTestHyperDB('dashql-cloud-store');
    database = test.database;
    dispose = test.dispose;
    connection = await database.connect();
    const path = await testDatabasePath(`dashql-cloud-${crypto.randomUUID()}.hyper`);
    await connection.execute(`CREATE DATABASE "${path}"`);
    await connection.execute(`ATTACH DATABASE "${path}" AS "${CLOUD_DATABASE}"`);
}, 60_000);
afterAll(async () => {
    await connection?.close();
    await dispose?.();
});
beforeEach(async () => {
    statements = [];
    query = async (sql, signal) => {
        statements.push(sql);
        return await connection.query(sql, signal);
    };
    await connection.execute(`DROP SCHEMA IF EXISTS "${CLOUD_DATABASE}"."dashql" CASCADE`);
    await installCloudStore(query);
});

/// A Parquet file of a value of many types
async function typesParquet(): Promise<Uint8Array> {
    const table = await connection.query(`SELECT 1::integer AS i, 9007199254740993::bigint AS big, 'it''s \\ "x"'::text AS t, NULL::bigint AS missing,
        1.5::double precision AS d, 'NaN'::double precision AS nan, DATE '2024-02-29' AS day,
        TIMESTAMPTZ '2024-02-29 12:34:56.123456+00' AS ts, TIMESTAMP '2024-02-29 12:34:56.654321' AS local_ts,
        12.345::numeric(10,3) AS num, true AS b, '{"a": [1, 2]}'::json AS j,
        CAST(-32768 AS smallint) AS small, CAST(1.1 AS real) AS r, 'Infinity'::double precision AS inf,
        CAST('12345678901234567890.123456789012345678' AS numeric(38,18)) AS wide, DATE '4713-01-01 BC' AS bc,
        TIME '23:59:59.999999' AS t2, TIMESTAMP '9999-12-31 23:59:59.999999' AS last, E'line\nbreak\ttab 🎉' AS lines,
        CAST('\\x00ff7f' AS bytea) AS raw, ARRAY[1, NULL, 3] AS ints, ARRAY['a', 'b,c', 'd"e', NULL, ''] AS texts,
        ARRAY[1.5::double precision, 'NaN'::double precision] AS doubles, CAST(ARRAY[] AS array(integer)) AS empty`);
    return await exportArrowTableAsParquet(database, table);
}

async function testBundle(): Promise<WorkbookBundle> {
    return {
        workbook: testWorkbook({
            name: "Bob's workbook",
            scripts: [{ name: 'a.sql', connectionId: TEST_CONNECTION_ID }],
            attachments: [{ name: 'types.parquet' }],
        }),
        catalogs: [{ connectionId: TEST_CONNECTION_ID, relations: 'CREATE TABLE db.public.orders (id integer);', functions: 'CREATE FUNCTION scale(value bigint) RETURNS bigint;' }],
        scripts: [{ name: 'a.sql', sql: "select 'it''s'" }],
        data: [{ name: 'types.parquet', bytes: await typesParquet() }],
        results: [{ key: 'k1', bytes: new Blob([await typesParquet() as Uint8Array<ArrayBuffer>]) }],
    };
}

async function testTables(): Promise<WorkbookTables> {
    return workbookBundleToTables(await testBundle());
}

/// Does a table of the schema of DashQL exist?
async function tableExists(tableName: string): Promise<boolean> {
    try {
        await connection.query(`SELECT count(*) FROM "${CLOUD_DATABASE}"."dashql"."${tableName}"`);
        return true;
    } catch {
        return false;
    }
}

/// The data tables that the store created
function createdDataTables(): string[] {
    return statements.flatMap(sql => /^CREATE TABLE "dashql"\."dashql"\."(workbook_(?:attachment|result)_[0-9a-f]{32})"/.exec(sql)?.[1] ?? []);
}

/// Insert a row of the versions table with a row of a script and an attachment with its table
interface TestVersion {
    workbookId: string;
    versionId: string;
    tableName: string;
}

/// Insert a row of the versions table with a row of a script and an attachment with its table
async function insertVersion(state: string, age: string, readyAge: string | null = null): Promise<TestVersion> {
    const version = testVersion();
    const readyAt = readyAge == null ? 'NULL' : `now() - INTERVAL '${readyAge}'`;
    await connection.execute(`INSERT INTO "dashql"."dashql"."workbook_versions" VALUES ('${version.workbookId}', '${version.versionId}', 1, NULL, '{}', `
        + `'${state}', now() - INTERVAL '${age}', ${readyAt}, now() - INTERVAL '${age}', NULL, NULL)`);
    await insertRows(version);
    return version;
}

function testVersion(): TestVersion {
    return { workbookId: crypto.randomUUID(), versionId: newVersionId(), tableName: newDataTableName('workbook_attachment_') };
}

/// Insert a row of a script and an attachment with its table under a version
async function insertRows({ workbookId, versionId, tableName }: TestVersion): Promise<void> {
    const key = `'${workbookId}', '${versionId}'`;
    await connection.execute(`INSERT INTO "dashql"."dashql"."workbook_scripts" VALUES (${key}, 0, 'a.sql', 'c', 'select 1')`);
    await connection.execute(`INSERT INTO "dashql"."dashql"."workbook_attachments" VALUES (${key}, 0, 'a.parquet', '${tableName}')`);
    await connection.execute(`CREATE TABLE "dashql"."dashql"."${tableName}" (x integer)`);
}

/// The workbooks that a listing of the top or a search finds, page by page
async function listWorkbooks(search: CloudSearch | null = null): Promise<CloudWorkbook[]> {
    const workbooks: CloudWorkbook[] = [];
    let after: CloudCursor | null = null;
    do {
        const page = await listCloudEntries(query, { folderId: null, search, after });
        for (const entry of page.entries) if (entry.kind === 'workbook') workbooks.push(entry.workbook);
        after = page.next;
    } while (after != null);
    return workbooks;
}

async function searchWorkbooks(text: string): Promise<CloudWorkbook[]> {
    return await listWorkbooks({ text });
}

/// The rows of the versions table and the merged tables
async function rowCount(): Promise<number> {
    let count = 0;
    for (const tableName of ['workbooks', 'workbook_versions', ...CLOUD_MERGED_TABLE_NAMES]) {
        count += Number((await connection.query(`SELECT count(*) AS n FROM "dashql"."dashql"."${tableName}"`)).get(0)!.n);
    }
    return count;
}

describe('cloud store', () => {
    it('reads the tables that the installer created', async () => {
        expect(await listWorkbooks()).toEqual([]);
    });

    it('keeps publishing to tables that a newer client migrated', async () => {
        const newer = [...CLOUD_MIGRATIONS, { description: 'Add a note to scripts', columns: { workbook_scripts: [{ name: 'note', type: 'text', nullable: true }] } }];
        await installCloudStore(query, { migrations: newer });
        const published = await publishCloudWorkbook(query, database, await testTables());
        const { tables } = await readCloudWorkbook(query, database, published.workbookId);
        expect(tables[SCRIPTS_TABLE][0].text).toBe("select 'it''s'");
        expect((await connection.query(`SELECT note FROM "dashql"."dashql"."workbook_scripts"`)).get(0)!.note).toBeNull();
    });

    it('reads tables that lack the columns of migrations that no writer ran yet', async () => {
        // The tables of an older client whose connections had no name yet
        const first = CLOUD_MIGRATIONS[0].tables!;
        const older: CloudMigration = {
            description: 'Without names of connections',
            tables: { ...first, workbook_connections: first.workbook_connections.filter(column => column.name !== 'name') },
        };
        const newer = [older, { description: 'Add names of connections', columns: { workbook_connections: [{ name: 'name', type: 'text', nullable: true }] } }];
        await connection.execute(`DROP SCHEMA "${CLOUD_DATABASE}"."dashql" CASCADE`);
        await installCloudStore(query, { migrations: [older] });
        const [workbookId, versionId] = [crypto.randomUUID(), crypto.randomUUID()];
        await connection.execute(`INSERT INTO "dashql"."dashql"."workbook_versions" VALUES ('${workbookId}', '${versionId}', 11, 'old', '{}', 'ready', now(), now(), now(), NULL, NULL)`);
        await connection.execute(`INSERT INTO "dashql"."dashql"."workbook_connections" VALUES ('${workbookId}', '${versionId}', 0, 'c', '{}')`);
        statements = [];
        const { tables } = await readCloudWorkbook(query, database, workbookId, { migrations: newer });
        expect(tables[CONNECTIONS_TABLE]).toEqual([{ position: 0, connection_id: 'c', name: null, params: '{}' }]);
        expect(statements.every(sql => sql.startsWith('SELECT'))).toBe(true);
    });

    it('lists nothing in a cloud without the tables of DashQL', async () => {
        await connection.execute(`DROP SCHEMA "${CLOUD_DATABASE}"."dashql" CASCADE`);
        statements = [];
        expect(await listWorkbooks()).toEqual([]);
        await expect(readCloudWorkbook(query, database, crypto.randomUUID())).rejects.toThrow('The cloud holds no workbook');
        await expect(publishCloudWorkbook(query, database, await testTables())).rejects.toThrow('DashQL is not installed in the cloud connection');
        expect(statements.every(sql => sql.startsWith('SELECT'))).toBe(true);
    });

    it('takes only UUIDs as ids', async () => {
        await expect(listCloudWorkbookVersions(query, 'w')).rejects.toThrow('Not the id of a workbook: w');
        await expect(publishCloudWorkbook(query, database, await testTables(), { workbookId: crypto.randomUUID().toUpperCase() })).rejects.toThrow('Not the id of a workbook');
        await expect(readCloudWorkbook(query, database, crypto.randomUUID(), { versionId: 'v' })).rejects.toThrow('Not the id of a version: v');
        await expect(deleteCloudWorkbook(query, "x' OR true")).rejects.toThrow('Not the id of a workbook');
    });

    it('refuses to read a version of a newer format', async () => {
        const published = await publishCloudWorkbook(query, database, await testTables());
        await connection.execute(`UPDATE "dashql"."dashql"."workbook_versions" SET format_version = 1000`);
        expect((await listWorkbooks())[0].formatVersion).toBe(1000);
        await expect(readCloudWorkbook(query, database, published.workbookId)).rejects.toThrow('published by a newer DashQL');
    });

    it('publishes a workbook as rows of the merged tables under a fresh id and reads it back', async () => {
        const tables = await testTables();
        const published = await publishCloudWorkbook(query, database, tables, { maxStatementLength: 256, publishedBy: 'bob@example.com', appVersion: '1.2.3' });
        expect(published.state).toBe('ready');
        expect(published.publishedBy).toBe('bob@example.com');
        expect(published.appVersion).toBe('1.2.3');
        expect(published.version).toBe(1);
        expect(published.readyAt).not.toBeNull();
        expect(published.name).toBe("Bob's workbook");
        expect(published.workbookId).not.toBe(tables[WORKBOOK_TABLE][0].workbook_id);
        expect(published.versionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        expect(await listWorkbooks()).toEqual([{ ...published, folderId: null }]);
        // The workbook row comes first, then the version row, which turns ready last. A data table is named by a row
        // before it is created.
        const inserts = statements.filter(sql => sql.startsWith('INSERT'));
        expect(inserts[0]).toMatch(/^INSERT INTO "dashql"."dashql"."workbooks"/);
        expect(inserts[1]).toMatch(/^INSERT INTO "dashql"."dashql"."workbook_versions"/);
        const dataTables = createdDataTables();
        expect(dataTables).toHaveLength(2);
        for (const tableName of dataTables) {
            expect(statements.findIndex(sql => sql.startsWith('INSERT INTO "dashql"."dashql"."') && sql.includes(`'${tableName}'`)))
                .toBeLessThan(statements.findIndex(sql => sql.startsWith(`CREATE TABLE "dashql"."dashql"."${tableName}"`)));
        }
        expect(dataTables).not.toContain(tables[ATTACHMENTS_TABLE][0].table_name);
        const ready = statements.findIndex(sql => sql.startsWith('UPDATE') && sql.includes("'ready'"));
        expect(statements.slice(ready + 1).every(sql => sql.startsWith('SELECT') || sql.startsWith('WITH'))).toBe(true);

        const { version, tables: read } = await readCloudWorkbook(query, database, published.workbookId);
        expect(version).toEqual(published);
        expect(read[WORKBOOK_TABLE][0].workbook_id).toBe(published.workbookId);
        expect(read[CATALOG_TABLES_TABLE]).toEqual(tables[CATALOG_TABLES_TABLE]);
        expect(read[CATALOG_FUNCTION_PARAMS_TABLE]).toEqual(tables[CATALOG_FUNCTION_PARAMS_TABLE]);
        const bundle = await workbookTablesToBundle(read);
        const expected = await testBundle();
        expect(bundle.workbook).toEqual({ ...expected.workbook, workbookId: published.workbookId });
        expect(bundle.scripts).toEqual(expected.scripts);
        expect(bundle.results!.map(result => result.key)).toEqual(['k1']);

        // The data tables hold the values of the Parquet files
        const original = await readParquetAsText(database, new Blob([expected.data![0].bytes as Uint8Array<ArrayBuffer>]));
        const attachment = await readParquetAsText(database, new Blob([bundle.data![0].bytes as Uint8Array<ArrayBuffer>]));
        const result = await readParquetAsText(database, bundle.results![0].bytes);
        expect(attachment).toEqual(original);
        expect(result).toEqual(original);
        expect(original.rows[0]).toContain("it's \\ \"x\"");
        expect(original.rows[0]).toContain(null);
    });

    it('keeps the publishes of new workbooks apart', async () => {
        const first = await publishCloudWorkbook(query, database, await testTables());
        const second = await publishCloudWorkbook(query, database, await testTables());
        expect(first.workbookId).not.toBe(second.workbookId);
        expect((await listWorkbooks()).map(row => row.workbookId).sort()).toEqual([first.workbookId, second.workbookId].sort());
    });

    it('updates a workbook with a new version and keeps the earlier ones readable', async () => {
        const first = await publishCloudWorkbook(query, database, await testTables());
        const updated = await testTables();
        updated[SCRIPTS_TABLE][0].text = 'select 2';
        const second = await publishCloudWorkbook(query, database, updated, { workbookId: first.workbookId });
        expect(second.workbookId).toBe(first.workbookId);
        expect(second.version).toBe(2);
        expect(second.versionId).not.toBe(first.versionId);
        expect(await listWorkbooks()).toEqual([{ ...second, folderId: null }]);
        expect(await listCloudWorkbookVersions(query, first.workbookId)).toEqual([second, first]);

        const latest = await readCloudWorkbook(query, database, first.workbookId);
        expect(latest.version).toEqual(second);
        expect(latest.tables[SCRIPTS_TABLE][0].text).toBe('select 2');
        expect(latest.tables[WORKBOOK_TABLE][0].workbook_id).toBe(first.workbookId);
        const earlier = await readCloudWorkbook(query, database, first.workbookId, { versionId: first.versionId });
        expect(earlier.version).toEqual(first);
        expect(earlier.tables[SCRIPTS_TABLE][0].text).toBe("select 'it''s'");
        await expect(readCloudWorkbook(query, database, first.workbookId, { versionId: newVersionId() })).rejects.toThrow('no version');
    });

    it('makes the publish that turns ready last the current version, the other stays a version', async () => {
        const first = await publishCloudWorkbook(query, database, await testTables());
        let other: Promise<CloudWorkbookVersion> | null = null;
        // Another client publishes a version while this one is about to turn ready
        const racing: CloudQuery = async (sql, signal) => {
            if (other == null && sql.startsWith('UPDATE') && sql.includes("'ready'")) {
                other = publishCloudWorkbook(query, database, await testTables(), { workbookId: first.workbookId });
                await other;
            }
            return await query(sql, signal);
        };
        const mine = await publishCloudWorkbook(racing, database, await testTables(), { workbookId: first.workbookId });
        const theirs = await other!;
        expect([first.version, theirs.version, mine.version]).toEqual([1, 2, 3]);
        expect(await listWorkbooks()).toEqual([{ ...mine, folderId: null }]);
        expect(await listCloudWorkbookVersions(query, first.workbookId)).toEqual([mine, theirs, first]);
    });

    it('removes what a failed publish wrote', async () => {
        const failing: CloudQuery = async (sql, signal) => {
            if (sql.startsWith('INSERT INTO "dashql"."dashql"."workbook_result_')) throw new Error('lost connection');
            return await query(sql, signal);
        };
        await expect(publishCloudWorkbook(failing, database, await testTables())).rejects.toThrow('lost connection');
        const dataTables = createdDataTables();
        expect(dataTables).toHaveLength(2);
        for (const tableName of dataTables) expect(await tableExists(tableName)).toBe(false);
        expect(await rowCount()).toBe(0);
    });

    it('removes what a publish wrote after a cleanup took its version away', async () => {
        const first = await publishCloudWorkbook(query, database, await testTables());
        const cleaning: CloudQuery = async (sql, signal) => {
            if (sql.startsWith('UPDATE') && sql.includes("'ready'")) {
                await connection.execute(`UPDATE "dashql"."dashql"."workbook_versions" SET state = 'deleting' WHERE state = 'uploading'`);
                await cleanupCloud(query);
            }
            return await query(sql, signal);
        };
        statements = [];
        await expect(publishCloudWorkbook(cleaning, database, await testTables(), { workbookId: first.workbookId })).rejects.toThrow('did not complete');
        for (const tableName of createdDataTables()) expect(await tableExists(tableName)).toBe(false);
        expect(await listCloudWorkbookVersions(query, first.workbookId)).toEqual([first]);
        expect((await readCloudWorkbook(query, database, first.workbookId)).tables[SCRIPTS_TABLE]).toHaveLength(1);
    });

    it('keeps a data table that another version names', async () => {
        const first = await publishCloudWorkbook(query, database, await testTables());
        const second = await publishCloudWorkbook(query, database, await testTables());
        // The second version shares the attachment table of the first one, as a client that shares tables would
        const [shared] = (await connection.query(`SELECT table_name FROM "dashql"."dashql"."workbook_attachments" `
            + `WHERE version_id = '${first.versionId}'`)).toArray().map(row => String(row.table_name));
        await connection.execute(`UPDATE "dashql"."dashql"."workbook_attachments" SET table_name = '${shared}' WHERE version_id = '${second.versionId}'`);
        await deleteCloudWorkbook(query, first.workbookId);
        await cleanupCloud(query, { purgeAfterSeconds: 0 });
        expect(await tableExists(shared)).toBe(true);
        const { tables } = await readCloudWorkbook(query, database, second.workbookId);
        expect(tables.data.has(shared)).toBe(true);
        await deleteCloudWorkbook(query, second.workbookId);
        await cleanupCloud(query, { purgeAfterSeconds: 0 });
        expect(await tableExists(shared)).toBe(false);
        expect(await rowCount()).toBe(0);
    });

    it('refuses data larger than a publish takes', async () => {
        const tables = await testTables();
        statements = [];
        await expect(publishCloudWorkbook(query, database, tables, { maxDataBytes: 1024 })).rejects.toThrow(CloudPublishTooLargeError);
        expect(statements).toEqual([]);

        // A Parquet file that is small but holds much text is refused while it is published, and dropped
        const many = await connection.query(`SELECT repeat('x', 100) AS t FROM generate_series(1, 10000)`);
        const small = new Blob([await exportArrowTableAsParquet(database, many) as Uint8Array<ArrayBuffer>]);
        expect(small.size).toBeLessThan(100_000);
        const attachment = tables[ATTACHMENTS_TABLE][0].table_name;
        tables.data.set(attachment, { bytes: small });
        await expect(publishCloudWorkbook(query, database, tables, { maxDataBytes: 200_000 })).rejects.toThrow('too large to publish');
        for (const tableName of createdDataTables()) expect(await tableExists(tableName)).toBe(false);
        expect(await rowCount()).toBe(0);
    });

    it('names an attachment that the embedded Hyper cannot read', async () => {
        const tables = await testTables();
        tables.data.set(tables[ATTACHMENTS_TABLE][0].table_name, { bytes: new Blob(['not parquet']) });
        await expect(publishCloudWorkbook(query, database, tables)).rejects.toThrow("Can't publish the attachment types.parquet");
        expect(await rowCount()).toBe(0);
    });

    it('hides a deleted workbook until it is restored or a cleanup removes it with all its versions', async () => {
        const first = await publishCloudWorkbook(query, database, await testTables());
        const second = await publishCloudWorkbook(query, database, await testTables(), { workbookId: first.workbookId });
        const rows = await rowCount();
        await deleteCloudWorkbook(query, first.workbookId);
        expect(await listWorkbooks()).toEqual([]);
        expect(await listCloudWorkbookVersions(query, first.workbookId)).toEqual([]);
        await expect(readCloudWorkbook(query, database, first.workbookId, { versionId: first.versionId })).rejects.toThrow('The cloud holds no version');
        await expect(publishCloudWorkbook(query, database, await testTables(), { workbookId: first.workbookId })).rejects.toThrow('was deleted');
        // Deleting marks a row, nothing else is removed
        expect(await rowCount()).toBe(rows);
        await deleteCloudWorkbook(query, first.workbookId);

        await restoreCloudWorkbook(query, first.workbookId);
        expect(await listWorkbooks()).toEqual([{ ...second, folderId: null }]);

        await deleteCloudWorkbook(query, first.workbookId);
        expect((await cleanupCloud(query)).workbooks).toEqual([]);
        const removed = await cleanupCloud(query, { purgeAfterSeconds: 0 });
        expect(removed.workbooks).toEqual([first.workbookId]);
        expect(removed.versions.map(version => version.versionId).sort()).toEqual([first.versionId, second.versionId].sort());
        for (const tableName of createdDataTables()) expect(await tableExists(tableName)).toBe(false);
        expect(await rowCount()).toBe(0);
    });

    it('finds workbooks by the names and the scripts of their latest versions', async () => {
        const sales = await testTables();
        sales[WORKBOOK_TABLE][0].name = 'Sales Q3';
        sales[SCRIPTS_TABLE][0].text = 'select * from Orders';
        const first = await publishCloudWorkbook(query, database, sales);
        const other = await publishCloudWorkbook(query, database, await testTables());
        expect((await searchWorkbooks('q3')).map(workbook => workbook.workbookId)).toEqual([first.workbookId]);
        expect((await searchWorkbooks('ORDERS')).map(workbook => workbook.workbookId)).toEqual([first.workbookId]);
        expect((await searchWorkbooks("'IT''s'")).map(workbook => workbook.workbookId)).toEqual([other.workbookId]);
        expect(await searchWorkbooks('%')).toEqual([]);
        expect(await searchWorkbooks(' ')).toHaveLength(2);
        // Only the latest version counts
        const renamed = await testTables();
        await publishCloudWorkbook(query, database, renamed, { workbookId: first.workbookId });
        expect(await searchWorkbooks('orders')).toEqual([]);
    });

    it('cleans up abandoned uploads, unfinished deletes and rows without a version, leaves young uploads alone', async () => {
        const abandoned = await insertVersion('uploading', '2 hours');
        const young = await insertVersion('uploading', '1 second');
        const deleting = await insertVersion('deleting', '1 second');
        const ready = await insertVersion('ready', '1 minute', '30 seconds');
        // Rows of a version without a row, and rows of a version of the same workbook as a ready version
        const orphan = testVersion();
        await insertRows(orphan);
        const sibling = { ...testVersion(), workbookId: ready.workbookId };
        await insertRows(sibling);
        // A row that names a table of something else never drops it
        const other = testVersion();
        await connection.execute(`INSERT INTO "dashql"."dashql"."workbook_versions" VALUES ('${other.workbookId}', '${other.versionId}', 1, NULL, '{}', 'deleting', now(), NULL, now(), NULL, NULL)`);
        await connection.execute(`INSERT INTO "dashql"."dashql"."workbook_attachments" VALUES ('${other.workbookId}', '${other.versionId}', 0, 'a.parquet', 'workbook_versions')`);

        // The row of a workbook whose first publish never got to its version
        const empty = crypto.randomUUID();
        await connection.execute(`INSERT INTO "dashql"."dashql"."workbooks" VALUES ('${empty}', NULL, now() - INTERVAL '2 hours', NULL, now(), NULL)`);
        await connection.execute(`INSERT INTO "dashql"."dashql"."workbooks" VALUES ('${young.workbookId}', NULL, now() - INTERVAL '2 hours', NULL, now(), NULL)`);

        const cleanup = await cleanupCloud(query);
        expect(cleanup.workbooks).toEqual([empty]);
        const removed = cleanup.versions;
        const versionIds = (versions: ReadonlyArray<{ versionId: string }>) => versions.map(version => version.versionId).sort();
        expect(versionIds(removed)).toEqual(versionIds([abandoned, deleting, orphan, sibling, other]));
        for (const { tableName } of [abandoned, deleting, orphan, sibling]) expect(await tableExists(tableName)).toBe(false);
        for (const { tableName } of [young, ready]) expect(await tableExists(tableName)).toBe(true);
        expect(await tableExists('workbook_versions')).toBe(true);
        expect(await rowCount()).toBe(2 * 3 + 1);
        expect((await listWorkbooks()).map(row => row.versionId)).toEqual([ready.versionId]);
    });

    it('rejects tables that do not hold one workbook', async () => {
        const tables = await testTables();
        statements = [];
        await expect(publishCloudWorkbook(query, database, { ...tables, [WORKBOOK_TABLE]: [] })).rejects.toThrow('Expected one workbook, found 0');
        expect(statements).toEqual([]);
    });
});
