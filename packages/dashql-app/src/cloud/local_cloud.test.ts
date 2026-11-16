import { describe, expect, it } from 'vitest';

import { HyperDB, HyperDBEngine } from '../platform/hyperdb/hyperdb_wasm.js';
import { getTestHyperDBClient, openTestHyperDBWindow, testDatabasePath } from '../tests/hyperdb_test_client.js';
import { TEST_CONNECTION_ID, testWorkbook } from '@ankoh/dashql-runtime/testing/workbook_test_backend';
import { testWorkbookTables } from './cloud_test_tables.js';
import { publishCloudWorkbook } from './cloud_store.js';
import { createCloudFolder, listCloudEntries } from './cloud_folders.js';
import { cloudDatabaseOf } from './cloud_query.js';
import { dropCloudStore, inspectCloudStore, installCloudStore, type CloudQuery } from './cloud_store_schema.js';
import type { ConnectionParams } from '@ankoh/dashql-runtime/connections/connection_params';

// The local cloud: a connection of the embedded Hyper whose session attaches only the database of the local cloud, as
// "dashql", like a connection to a Hyper server that attaches the database of DashQL. The database outlives the window.

describe('local cloud', () => {
    it('keeps the tables in the database that the cloud connection attaches', () => {
        expect(cloudDatabaseOf({ hyper: { protocol: 'WASM' } } as unknown as ConnectionParams)).toBe('dashql');
        expect(cloudDatabaseOf({ hyper: { protocol: 'V3_HTTP', endpoint: 'http://localhost:7484' } } as unknown as ConnectionParams)).toBe('dashql');
        // Database.com attaches the Hyper Cloud database of its settings as "lakehouse"
        expect(cloudDatabaseOf({ dbcom: { instanceUrl: 'https://example.my.salesforce.com' } } as unknown as ConnectionParams)).toBe('lakehouse');
    });

    it('keeps the published workbooks for the next window', async () => {
        const { client, shared } = await getTestHyperDBClient();
        const attachedDatabases = [{ path: await testDatabasePath(`dashql-local-cloud-${crypto.randomUUID()}.hyper`), alias: 'dashql' }];
        const open = async () => await HyperDB.create(new HyperDBEngine(client), {
            defaultDatabasePath: await testDatabasePath(`dashql-local-cloud-user-${crypto.randomUUID()}.hyper`),
            terminateEngine: false,
        });
        try {
            // The session of the local cloud connection attaches only its database, the store runs its statements on it
            const first = await open();
            const session = await first.connect({ defaultDatabase: null, attachedDatabases });
            const query: CloudQuery = async (sql, signal) => await session.query(sql, signal);
            expect((await inspectCloudStore(query)).state).toBe('missing');
            await installCloudStore(query);
            await createCloudFolder(query, 'Reports', null);
            // Unqualified names resolve against the database of the local cloud, as on a Hyper server with one database
            await session.execute('CREATE TABLE scratch (x integer)');
            expect(Number((await session.query(`SELECT count(*) AS n FROM "dashql"."public"."scratch"`)).get(0)!.n)).toBe(0);
            await session.close();
            await first.terminate();

            // The next window finds the tables and the folder
            const second = await open();
            const again = await second.connect({ defaultDatabase: null, attachedDatabases });
            const queryAgain: CloudQuery = async (sql, signal) => await again.query(sql, signal);
            expect((await inspectCloudStore(queryAgain)).state).toBe('current');
            expect((await listCloudEntries(queryAgain, { folderId: null })).entries.map(entry => entry.kind === 'folder' ? entry.folder.name : null)).toEqual(['Reports']);

            // A reset drops the tables, the installer starts over
            await dropCloudStore(queryAgain);
            expect((await inspectCloudStore(queryAgain)).state).toBe('missing');
            await installCloudStore(queryAgain);
            await again.close();

            // Deleting the local cloud drops its database once its session is closed, a new session starts empty
            await second.dropAttachedDatabase(attachedDatabases[0].path);
            const fresh = await second.connect({ defaultDatabase: null, attachedDatabases });
            expect((await inspectCloudStore(async (sql, signal) => await fresh.query(sql, signal))).state).toBe('missing');
            await fresh.close();
            await second.terminate();
        } finally {
            if (!shared) await client.terminate();
        }
    }, 60_000);

    // The settings of the app keep a redo log, its replay keeps the NULLs of `deleted_at` and the folders and workbooks
    // stay alive, see platform/hyperdb/integration/redo_log.test.ts
    it('keeps the published workbooks across a reload', async () => {
        const attachedDatabases = [{ path: await testDatabasePath(`dashql-local-cloud-${crypto.randomUUID()}.hyper`), alias: 'dashql' }];
        const first = await openTestHyperDBWindow(attachedDatabases);
        const query: CloudQuery = async (sql, signal) => await first.session.query(sql, signal);
        await installCloudStore(query);
        const reports = await createCloudFolder(query, 'Reports', null);
        const tables = testWorkbookTables({
            workbook: testWorkbook({ name: 'Sales', scripts: [{ name: 'a.sql', connectionId: TEST_CONNECTION_ID }] }),
            scripts: { 'a.sql': 'select 1' },
        });
        const sales = await publishCloudWorkbook(query, first.database, tables, { folderId: reports.folderId });
        // A reload: the worker goes away while the session attaches the database
        await first.reload();

        const second = await openTestHyperDBWindow(attachedDatabases);
        try {
            const queryAgain: CloudQuery = async (sql, signal) => await second.session.query(sql, signal);
            expect((await inspectCloudStore(queryAgain)).state).toBe('current');
            const top = await listCloudEntries(queryAgain, { folderId: null });
            expect(top.entries.map(entry => entry.kind === 'folder' ? entry.folder.name : null)).toEqual(['Reports']);
            const inReports = await listCloudEntries(queryAgain, { folderId: reports.folderId });
            expect(inReports.entries.map(entry => entry.kind === 'workbook' ? entry.workbook.versionId : null)).toEqual([sales.versionId]);
        } finally {
            await second.close();
        }
    }, 60_000);
});
