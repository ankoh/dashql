import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { HyperDB, HyperDBConnection } from '../platform/hyperdb/hyperdb_wasm.js';
import { TEST_CONNECTION_ID, testWorkbook } from '@ankoh/dashql-sdk/testing/workbook_test_backend';
import { WORKBOOK_TABLE, workbookBundleToTables, type CatalogParser, type WorkbookTables } from '@ankoh/dashql-sdk/storage/workbook_tables';
import { createTestHyperDB, testDatabasePath } from '../tests/hyperdb_test_client.js';
import {
    createCloudFolder,
    deleteCloudFolder,
    listCloudEntries,
    moveCloudFolder,
    moveCloudWorkbook,
    readCloudFolderPath,
    renameCloudFolder,
    type CloudCursor,
    type CloudEntry,
    type CloudListRequest,
} from './cloud_folders.js';
import { cleanupCloud, deleteCloudWorkbook, publishCloudWorkbook, readCloudStats, type CloudWorkbookVersion } from './cloud_store.js';
import { CLOUD_DATABASE, installCloudStore, type CloudQuery } from './cloud_store_schema.js';

let database: HyperDB;
let dispose: () => Promise<void>;
let connection: HyperDBConnection;
let query: CloudQuery;

beforeAll(async () => {
    const test = await createTestHyperDB('dashql-cloud-folders');
    database = test.database;
    dispose = test.dispose;
    connection = await database.connect();
    const path = await testDatabasePath(`dashql-cloud-folders-${crypto.randomUUID()}.hyper`);
    await connection.execute(`CREATE DATABASE "${path}"`);
    await connection.execute(`ATTACH DATABASE "${path}" AS "${CLOUD_DATABASE}"`);
}, 60_000);
afterAll(async () => {
    await connection?.close();
    await dispose?.();
});
beforeEach(async () => {
    query = async (sql, signal) => await connection.query(sql, signal);
    await connection.execute(`DROP SCHEMA IF EXISTS "${CLOUD_DATABASE}"."dashql" CASCADE`);
    await installCloudStore(query);
});

const parse: CatalogParser = () => ({ tables: [], functions: [] });

function tablesNamed(name: string, sql = 'select 1'): WorkbookTables {
    const tables = workbookBundleToTables({ workbook: testWorkbook({ name, scripts: [{ name: 'a.sql', connectionId: TEST_CONNECTION_ID }] }), scripts: [{ name: 'a.sql', sql }], catalogs: [] }, parse);
    expect(tables[WORKBOOK_TABLE][0].name).toBe(name);
    return tables;
}

async function publish(name: string, folderId?: string, sql?: string): Promise<CloudWorkbookVersion> {
    return await publishCloudWorkbook(query, database, tablesNamed(name, sql), { folderId });
}

/// The entries of a listing, page by page, with the sizes of the pages
async function listAll(request: Omit<CloudListRequest, 'after'>): Promise<{ entries: CloudEntry[]; pages: number[] }> {
    const entries: CloudEntry[] = [];
    const pages: number[] = [];
    let after: CloudCursor | null = null;
    do {
        const page = await listCloudEntries(query, { ...request, after });
        entries.push(...page.entries);
        pages.push(page.entries.length);
        after = page.next;
        expect(pages.length).toBeLessThan(100);
    } while (after != null);
    return { entries, pages };
}

/// The names of entries, folders with a slash
function names(entries: readonly CloudEntry[]): string[] {
    return entries.map(entry => entry.kind === 'folder' ? `${entry.folder.name}/` : entry.workbook.name ?? '');
}

/// The names of the entries of a folder, the top without one
async function namesIn(folderId: string | null): Promise<string[]> {
    return names((await listAll({ folderId })).entries);
}

async function folderEntry(folderId: string | null, name: string): Promise<Extract<CloudEntry, { kind: 'folder' }>> {
    const entry = (await listAll({ folderId })).entries.find(entry => entry.kind === 'folder' && entry.folder.name === name);
    expect(entry).toBeDefined();
    return entry as Extract<CloudEntry, { kind: 'folder' }>;
}

async function count(sql: string): Promise<number> {
    return Number((await connection.query(sql)).get(0)!.n);
}

describe('cloud folders', () => {
    it('creates, renames, moves and deletes nested folders', async () => {
        const reports = await createCloudFolder(query, ' Reports ', null, { createdBy: 'bob' });
        expect(reports).toMatchObject({ name: 'Reports', parentId: null, createdBy: 'bob', deletedAt: null });
        const monthly = await createCloudFolder(query, 'Monthly', reports.folderId);
        expect(monthly.parentId).toBe(reports.folderId);
        const q1 = await createCloudFolder(query, 'Q1', monthly.folderId);
        // Names differ among the folders of a parent only
        await expect(createCloudFolder(query, 'monthly', reports.folderId)).rejects.toThrow('A folder monthly exists already');
        const topMonthly = await createCloudFolder(query, 'Monthly', null);
        await expect(createCloudFolder(query, '  ', null)).rejects.toThrow('A folder needs a name');
        await expect(createCloudFolder(query, 'X', crypto.randomUUID())).rejects.toThrow('The cloud holds no folder');
        expect((await readCloudFolderPath(query, q1.folderId)).map(folder => folder.name)).toEqual(['Reports', 'Monthly', 'Q1']);

        const sales = await publish('Sales', monthly.folderId);
        expect(await namesIn(null)).toEqual(['Monthly/', 'Reports/']);
        expect(await namesIn(reports.folderId)).toEqual(['Monthly/']);
        expect(await namesIn(monthly.folderId)).toEqual(['Q1/', 'Sales']);
        expect(await folderEntry(reports.folderId, 'Monthly')).toMatchObject({ folder: { folderId: monthly.folderId, parentId: reports.folderId }, folders: 1, workbooks: 1 });
        expect(await folderEntry(null, 'Reports')).toMatchObject({ folders: 1, workbooks: 0 });
        const salesEntry = (await listAll({ folderId: monthly.folderId })).entries[1];
        expect(salesEntry).toEqual({ kind: 'workbook', workbook: { ...sales, folderId: monthly.folderId }, folderName: 'Monthly' });

        await renameCloudFolder(query, q1.folderId, 'q2');
        const q3 = await createCloudFolder(query, 'Q3', monthly.folderId);
        await expect(renameCloudFolder(query, q3.folderId, 'Q2')).rejects.toThrow('A folder Q2 exists already');
        await renameCloudFolder(query, q3.folderId, 'Monthly');
        await expect(renameCloudFolder(query, crypto.randomUUID(), 'Y')).rejects.toThrow('The cloud holds no folder');

        // No folder moves into itself or one of its folders
        await expect(moveCloudFolder(query, reports.folderId, q1.folderId)).rejects.toThrow("can't move into itself or one of its folders");
        await expect(moveCloudFolder(query, reports.folderId, reports.folderId)).rejects.toThrow("can't move into itself");
        await expect(moveCloudFolder(query, monthly.folderId, null)).rejects.toThrow('A folder Monthly exists already');
        await expect(moveCloudFolder(query, q1.folderId, crypto.randomUUID())).rejects.toThrow('The cloud holds no folder');
        await moveCloudFolder(query, q1.folderId, null);
        expect((await readCloudFolderPath(query, q1.folderId)).map(folder => folder.name)).toEqual(['q2']);
        await moveCloudFolder(query, q1.folderId, topMonthly.folderId);
        expect(await namesIn(topMonthly.folderId)).toEqual(['q2/']);

        // Deleting a folder moves its folders and workbooks to its parent
        await deleteCloudFolder(query, monthly.folderId);
        expect(await namesIn(reports.folderId)).toEqual(['Monthly/', 'Sales']);
        expect((await listAll({ folderId: reports.folderId })).entries[1]).toMatchObject({ workbook: { folderId: reports.folderId }, folderName: 'Reports' });
        expect(await namesIn(monthly.folderId)).toEqual([]);
        await expect(readCloudFolderPath(query, monthly.folderId)).rejects.toThrow('The cloud holds no folder');
        await deleteCloudFolder(query, monthly.folderId);
        // The folder that moved up takes its name with it
        await expect(createCloudFolder(query, 'monthly', reports.folderId)).rejects.toThrow('exists already');

        await moveCloudWorkbook(query, sales.workbookId, null);
        expect(await namesIn(null)).toEqual(['Monthly/', 'Reports/', 'Sales']);
        await expect(moveCloudWorkbook(query, sales.workbookId, monthly.folderId)).rejects.toThrow('The cloud holds no folder');
        await expect(moveCloudWorkbook(query, crypto.randomUUID(), null)).rejects.toThrow('The cloud holds no workbook');
        await moveCloudWorkbook(query, sales.workbookId, q3.folderId);
        await deleteCloudWorkbook(query, sales.workbookId);
        await expect(moveCloudWorkbook(query, sales.workbookId, null)).rejects.toThrow('The cloud holds no workbook');
        expect(await namesIn(q3.folderId)).toEqual([]);

        // A cleanup removes the deleted folder
        expect((await cleanupCloud(query, { purgeAfterSeconds: 0 })).folders).toEqual([monthly.folderId]);
        expect(await count(`SELECT count(*) AS n FROM "dashql"."dashql"."workbook_folders" WHERE folder_id = '${monthly.folderId}'`)).toBe(0);
    });

    it('shows the folders and workbooks of deleted and missing folders at the top', async () => {
        const reports = await createCloudFolder(query, 'Reports', null);
        const inner = await createCloudFolder(query, 'Inner', reports.folderId);
        const sales = await publish('Sales', reports.folderId);
        const lost = await publish('Lost');
        // What a client that deleted a folder left behind when it lost its connection, or a folder that a race removed
        await connection.execute(`UPDATE "dashql"."dashql"."workbook_folders" SET deleted_at = now() WHERE folder_id = '${reports.folderId}'`);
        const missing = crypto.randomUUID();
        await connection.execute(`UPDATE "dashql"."dashql"."workbooks" SET folder_id = '${missing}' WHERE workbook_id = '${lost.workbookId}'`);
        const orphan = crypto.randomUUID();
        await connection.execute(`INSERT INTO "dashql"."dashql"."workbook_folders" (folder_id, parent_id, name, created_at, created_by, updated_at, deleted_at) `
            + `VALUES ('${orphan}', '${missing}', 'Orphan', now(), NULL, now(), NULL)`);

        const top = (await listAll({ folderId: null })).entries;
        expect(names(top)).toEqual(['Inner/', 'Orphan/', 'Lost', 'Sales']);
        expect(top.map(entry => entry.kind === 'folder' ? entry.folder.parentId : entry.folderName)).toEqual([null, null, null, null]);
        expect(top.map(entry => entry.kind === 'workbook' ? entry.workbook.folderId : null)).toEqual([null, null, missing, reports.folderId]);
        expect(await namesIn(reports.folderId)).toEqual([]);
        expect((await readCloudFolderPath(query, inner.folderId)).map(folder => folder.name)).toEqual(['Inner']);
        // The names at the top count the folders that show there
        await expect(createCloudFolder(query, 'inner', null)).rejects.toThrow('exists already');
        await moveCloudWorkbook(query, sales.workbookId, inner.folderId);

        // A cleanup moves what names a folder that it removes to the top
        expect((await cleanupCloud(query, { purgeAfterSeconds: 0 })).folders).toEqual([reports.folderId]);
        expect(await count(`SELECT count(*) AS n FROM "dashql"."dashql"."workbook_folders" WHERE parent_id IS NOT NULL`)).toBe(1);
        expect(await namesIn(null)).toEqual(['Inner/', 'Orphan/', 'Lost']);
    });

    it('moves the folders of a loop to the top in a cleanup', async () => {
        const a = await createCloudFolder(query, 'A', null);
        const b = await createCloudFolder(query, 'B', null);
        const c = await createCloudFolder(query, 'C', b.folderId);
        const d = await createCloudFolder(query, 'D', null);
        // Two clients that moved A into B and B into A at the same time
        let moved = false;
        const racing: CloudQuery = async (sql, signal) => {
            if (!moved && sql.startsWith('UPDATE') && sql.includes('SET parent_id')) {
                moved = true;
                await moveCloudFolder(query, b.folderId, a.folderId);
            }
            return await query(sql, signal);
        };
        await moveCloudFolder(racing, a.folderId, b.folderId);
        expect(moved).toBe(true);
        expect(await namesIn(null)).toEqual(['D/']);
        expect((await readCloudFolderPath(query, c.folderId)).map(folder => folder.name)).toEqual(['A', 'B', 'C']);
        await expect(moveCloudFolder(query, d.folderId, c.folderId)).resolves.toBeUndefined();
        await expect(moveCloudFolder(query, a.folderId, c.folderId)).rejects.toThrow("can't move into itself");

        const cleanup = await cleanupCloud(query);
        expect(cleanup.rerooted.sort()).toEqual([a.folderId, b.folderId].sort());
        expect(cleanup.folders).toEqual([]);
        expect(await namesIn(null)).toEqual(['A/', 'B/']);
        expect(await namesIn(b.folderId)).toEqual(['C/']);
        expect(await namesIn(c.folderId)).toEqual(['D/']);
        expect((await cleanupCloud(query)).rerooted).toEqual([]);
    });

    it('lists pages of the folders first, then the workbooks, sorted by name ignoring case', async () => {
        const folderNames = ['delta', 'Alpha', 'charlie', 'Bravo', 'echo', 'Foxtrot', 'golf'];
        const folders = [];
        for (const name of folderNames) folders.push(await createCloudFolder(query, name, null));
        // Two clients that created folders of the same name at the same time
        const twin = crypto.randomUUID();
        await connection.execute(`INSERT INTO "dashql"."dashql"."workbook_folders" (folder_id, parent_id, name, created_at, created_by, updated_at, deleted_at) `
            + `VALUES ('${twin}', NULL, 'ALPHA', now(), NULL, now(), NULL)`);
        const workbooks = [];
        for (const name of ['Report', 'zeta', 'report', 'Apple', 'Report', 'banana']) workbooks.push(await publish(name));
        await publish('Hidden', folders[0].folderId);
        await deleteCloudFolder(query, folders[4].folderId);

        const alpha = [folders[1].folderId, twin].sort();
        const reports = workbooks.filter(workbook => workbook.name!.toLowerCase() === 'report').map(workbook => workbook.workbookId).sort();
        const expected = [
            ...alpha.map(id => `folder ${id}`), `folder ${folders[3].folderId}`, `folder ${folders[2].folderId}`, `folder ${folders[0].folderId}`,
            `folder ${folders[5].folderId}`, `folder ${folders[6].folderId}`,
            `workbook ${workbooks[3].workbookId}`, `workbook ${workbooks[5].workbookId}`, ...reports.map(id => `workbook ${id}`),
            `workbook ${workbooks[1].workbookId}`,
        ];
        const ids = (entries: CloudEntry[]) => entries.map(entry => entry.kind === 'folder' ? `folder ${entry.folder.folderId}` : `workbook ${entry.workbook.workbookId}`);
        for (const limit of [1, 2, 3, 5, 7, 11, 12, 100]) {
            const { entries, pages } = await listAll({ folderId: null, limit });
            expect(ids(entries)).toEqual(expected);
            const full = Math.floor(expected.length / limit);
            const rest = expected.length % limit;
            expect(pages).toEqual([...Array(full).fill(limit), ...(rest > 0 || full === 0 ? [rest] : [])]);
        }
        // A page that ends with the last folder continues with the workbooks
        const first = await listCloudEntries(query, { folderId: null, limit: 7 });
        expect(first.next).toMatchObject({ kind: 'folder', id: folders[6].folderId, name: 'golf' });
        const second = await listCloudEntries(query, { folderId: null, after: first.next, limit: 2 });
        expect(ids(second.entries)).toEqual(expected.slice(7, 9));
        expect(second.next).toMatchObject({ kind: 'workbook', name: 'banana' });
        expect(await folderEntry(null, 'delta')).toMatchObject({ folders: 0, workbooks: 1 });
        await expect(listCloudEntries(query, { folderId: null, limit: 0 })).rejects.toThrow('Not the size of a page');
        await expect(listCloudEntries(query, { folderId: null, after: { kind: 'folder', name: 'x', id: "x' OR true" } })).rejects.toThrow('Not the id of a folder');
    });

    it('searches the workbooks of the whole cloud by their names and scripts, page by page', async () => {
        const reports = await createCloudFolder(query, 'Reports', null);
        const monthly = await createCloudFolder(query, 'Monthly', reports.folderId);
        const sales = await publish('Sales Q3', monthly.folderId, 'select * from Orders');
        const costs = await publish('Costs', undefined, "select 'it''s'");
        const orders = await publish('Orders by region', reports.folderId);
        const deleted = await publish('Deleted orders');
        await deleteCloudWorkbook(query, deleted.workbookId);
        await publish('Unrelated');

        const search = async (text: string, limit?: number) => (await listAll({ folderId: monthly.folderId, search: { text }, limit })).entries;
        const found = await search(' ORDERS ', 1);
        expect(found).toEqual([
            { kind: 'workbook', workbook: { ...orders, folderId: reports.folderId }, folderName: 'Reports' },
            { kind: 'workbook', workbook: { ...sales, folderId: monthly.folderId }, folderName: 'Monthly' },
        ]);
        expect(names(await search('q3'))).toEqual(['Sales Q3']);
        expect(names(await search("'IT''s'"))).toEqual(['Costs']);
        expect((await search('%')).length).toBe(0);
        expect((await search('o', 2)).map(entry => entry.kind === 'workbook' ? entry.workbook.workbookId : null))
            .toEqual([costs.workbookId, orders.workbookId, sales.workbookId]);
        // A blank search lists the folder
        expect(names(await search('  '))).toEqual(['Sales Q3']);
        // Only the latest version counts
        await publishCloudWorkbook(query, database, tablesNamed('Sales Q3'), { workbookId: sales.workbookId });
        expect(names(await search('orders'))).toEqual(['Orders by region']);
        expect((await search('q3'))[0]).toMatchObject({ workbook: { version: 2 } });
    });

    it('lists a workbook with two rows once, in the folder of the row created first', async () => {
        const reports = await createCloudFolder(query, 'Reports', null);
        const archive = await createCloudFolder(query, 'Archive', null);
        const sales = await publish('Sales', reports.folderId);
        // Two clients that published the first version at the same time wrote two rows
        await connection.execute(`INSERT INTO "dashql"."dashql"."workbooks" VALUES ('${sales.workbookId}', '${archive.folderId}', now() + INTERVAL '1 second', NULL, now(), NULL)`);
        expect(await namesIn(reports.folderId)).toEqual(['Sales']);
        expect(await namesIn(archive.folderId)).toEqual([]);
        expect(await namesIn(null)).toEqual(['Archive/', 'Reports/']);
        expect(names((await listAll({ folderId: null, search: { text: 'sales' } })).entries)).toEqual(['Sales']);
        expect(await readCloudStats(query)).toMatchObject({ workbooks: 1, versions: 1 });
        await connection.execute(`INSERT INTO "dashql"."dashql"."workbooks" VALUES ('${sales.workbookId}', NULL, now() - INTERVAL '1 hour', NULL, now(), NULL)`);
        expect(await namesIn(reports.folderId)).toEqual([]);
        expect(await namesIn(null)).toEqual(['Archive/', 'Reports/', 'Sales']);
        // A move moves every row
        await moveCloudWorkbook(query, sales.workbookId, archive.folderId);
        expect(await namesIn(archive.folderId)).toEqual(['Sales']);
    });

    it('counts the workbooks, folders and versions', async () => {
        expect(await readCloudStats(query)).toEqual({ workbooks: 0, folders: 0, versions: 0, lastPublishedAt: null });
        const reports = await createCloudFolder(query, 'Reports', null);
        await createCloudFolder(query, 'Monthly', reports.folderId);
        const gone = await createCloudFolder(query, 'Gone', null);
        await deleteCloudFolder(query, gone.folderId);
        const sales = await publish('Sales', reports.folderId);
        const update = await publishCloudWorkbook(query, database, tablesNamed('Sales'), { workbookId: sales.workbookId });
        const deleted = await publish('Deleted');
        await deleteCloudWorkbook(query, deleted.workbookId);
        // An upload that runs counts once it is ready
        await connection.execute(`INSERT INTO "dashql"."dashql"."workbook_versions" VALUES ('${crypto.randomUUID()}', '${crypto.randomUUID()}', 1, 'x', '{}', 'uploading', now(), NULL, now(), NULL, NULL)`);
        expect(await readCloudStats(query)).toEqual({ workbooks: 1, folders: 2, versions: 2, lastPublishedAt: update.readyAt });
    });

    it('lists nothing in a cloud without the tables of DashQL', async () => {
        await connection.execute(`DROP SCHEMA "${CLOUD_DATABASE}"."dashql" CASCADE`);
        expect(await listCloudEntries(query, { folderId: null })).toEqual({ entries: [], next: null });
        expect(await listCloudEntries(query, { folderId: null, search: { text: 'x' } })).toEqual({ entries: [], next: null });
        expect(await readCloudStats(query)).toEqual({ workbooks: 0, folders: 0, versions: 0, lastPublishedAt: null });
        await expect(readCloudFolderPath(query, crypto.randomUUID())).rejects.toThrow('The cloud holds no folder');
    });
});
