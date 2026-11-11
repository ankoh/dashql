import { describe, expect, it } from 'vitest';

import { HyperDB, HyperDBEngine } from '../platform/hyperdb/hyperdb_wasm.js';
import { getTestHyperDBClient, testDatabasePath } from '../tests/hyperdb_test_client.js';
import { createCloudFolder, listCloudTree } from './cloud_folders.js';
import { cloudDatabaseOf } from './cloud_query.js';
import { dropCloudStore, inspectCloudStore, installCloudStore, type CloudQuery } from './cloud_store_schema.js';
import type { ConnectionParams } from '../connections/connection_params.js';

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
            await createCloudFolder(query, 'Reports');
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
            expect((await listCloudTree(queryAgain)).folders.map(node => node.folder.name)).toEqual(['Reports']);

            // A reset drops the tables, the installer starts over
            await dropCloudStore(queryAgain);
            expect((await inspectCloudStore(queryAgain)).state).toBe('missing');
            await again.close();
            await second.terminate();
        } finally {
            if (!shared) await client.terminate();
        }
    }, 60_000);
});
