import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { HyperDB, HyperDBConnection } from '../platform/hyperdb/hyperdb_wasm.js';
import { TEST_CONNECTION_ID, testWorkbook } from '../storage/workbook_test_backend.js';
import { WORKBOOK_TABLE, workbookBundleToTables, type CatalogParser, type WorkbookTables } from '../storage/workbook_tables.js';
import { createTestHyperDB, testDatabasePath } from '../tests/hyperdb_test_client.js';
import {
    buildCloudTree,
    createCloudFolder,
    deleteCloudFolder,
    listCloudTree,
    moveCloudWorkbook,
    renameCloudFolder,
    type CloudFolder,
    type CloudTree,
} from './cloud_folders.js';
import { cleanupCloud, publishCloudWorkbook, type CloudWorkbook } from './cloud_store.js';
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

function tablesNamed(name: string): WorkbookTables {
    const tables = workbookBundleToTables({ workbook: testWorkbook({ name, scripts: [{ name: 'a.sql', connectionId: TEST_CONNECTION_ID }] }), scripts: [{ name: 'a.sql', sql: 'select 1' }], catalogs: [] }, parse);
    expect(tables[WORKBOOK_TABLE][0].name).toBe(name);
    return tables;
}

/// The names in a tree, folders with their workbooks
function names(tree: CloudTree): unknown {
    return {
        folders: tree.folders.map(node => [node.folder.name, node.workbooks.map(workbook => workbook.name)]),
        workbooks: tree.workbooks.map(workbook => workbook.name),
    };
}

function folder(folderId: string, name: string, deleted = false): CloudFolder {
    return { folderId, name, createdBy: null, createdAt: 0, updatedAt: 0, deletedAt: deleted ? 1 : null };
}

function workbook(workbookId: string, name: string, folderId: string | null): CloudWorkbook {
    return {
        workbookId, versionId: workbookId, version: 1, state: 'ready', name, publishedBy: null, appVersion: null, formatVersion: 1,
        createdAt: 0, readyAt: 0, updatedAt: 0, folderId,
    };
}

describe('cloud folders', () => {
    it('builds a tree sorted by name, the workbooks of deleted and unknown folders at the top', () => {
        const tree = buildCloudTree(
            [folder('f2', 'folder 10'), folder('f1', 'Folder 9'), folder('f3', 'gone', true), folder('f4', 'folder 9')],
            [workbook('w1', 'b', 'f1'), workbook('w2', 'a', 'f1'), workbook('w3', 'c', 'f3'), workbook('w4', 'd', 'unknown'), workbook('w5', 'A', null)],
        );
        // Two folders of the same name show side by side
        expect(names(tree)).toEqual({ folders: [['Folder 9', ['a', 'b']], ['folder 9', []], ['folder 10', []]], workbooks: ['A', 'c', 'd'] });
    });

    it('publishes into a folder, moves workbooks and renames and deletes folders', async () => {
        const reports = await createCloudFolder(query, ' Reports ', { createdBy: 'bob' });
        expect(reports).toMatchObject({ name: 'Reports', createdBy: 'bob', deletedAt: null });
        const archive = await createCloudFolder(query, 'Archive');
        await expect(createCloudFolder(query, 'reports')).rejects.toThrow('A folder reports exists already');
        await expect(createCloudFolder(query, '  ')).rejects.toThrow('A folder needs a name');

        const sales = await publishCloudWorkbook(query, database, tablesNamed('Sales'), { folderId: reports.folderId });
        const costs = await publishCloudWorkbook(query, database, tablesNamed('Costs'));
        await expect(publishCloudWorkbook(query, database, tablesNamed('X'), { folderId: crypto.randomUUID() })).rejects.toThrow('The cloud holds no folder');
        expect(names(await listCloudTree(query))).toEqual({ folders: [['Archive', []], ['Reports', ['Sales']]], workbooks: ['Costs'] });

        // An update stays in the folder
        await publishCloudWorkbook(query, database, tablesNamed('Sales'), { workbookId: sales.workbookId, folderId: archive.folderId });
        await moveCloudWorkbook(query, costs.workbookId, reports.folderId);
        expect(names(await listCloudTree(query))).toEqual({ folders: [['Archive', []], ['Reports', ['Costs', 'Sales']]], workbooks: [] });

        await renameCloudFolder(query, reports.folderId, 'Monthly');
        await expect(renameCloudFolder(query, archive.folderId, 'MONTHLY')).rejects.toThrow('exists already');
        await renameCloudFolder(query, archive.folderId, 'archive');
        await moveCloudWorkbook(query, sales.workbookId, archive.folderId);
        expect(names(await listCloudTree(query))).toEqual({ folders: [['archive', ['Sales']], ['Monthly', ['Costs']]], workbooks: [] });

        await deleteCloudFolder(query, reports.folderId);
        expect(names(await listCloudTree(query))).toEqual({ folders: [['archive', ['Sales']]], workbooks: ['Costs'] });
        await expect(moveCloudWorkbook(query, costs.workbookId, reports.folderId)).rejects.toThrow('The cloud holds no folder');
        await expect(moveCloudWorkbook(query, crypto.randomUUID(), null)).rejects.toThrow('The cloud holds no workbook');
        // A deleted folder takes its name no more
        await createCloudFolder(query, 'Monthly');

        // A cleanup removes the deleted folder, its workbooks stay at the top
        expect((await cleanupCloud(query, { purgeAfterSeconds: 0 })).folders).toEqual([reports.folderId]);
        expect(names(await listCloudTree(query))).toEqual({ folders: [['archive', ['Sales']], ['Monthly', []]], workbooks: ['Costs'] });
        const row = await connection.query(`SELECT count(*) AS n FROM "dashql"."dashql"."workbooks" WHERE folder_id IS NULL`);
        expect(Number(row.get(0)!.n)).toBe(1);
    });

    it('lists nothing in a cloud without the tables of DashQL', async () => {
        await connection.execute(`DROP SCHEMA "${CLOUD_DATABASE}"."dashql" CASCADE`);
        expect(await listCloudTree(query)).toEqual({ folders: [], workbooks: [] });
    });
});
