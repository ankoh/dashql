import type { Logger } from '@akohn/dashql/platform/logger/logger';
import type { SetupProgress } from '../host/embedded_database_provider.js';
import { HyperDB } from '@akohn/dashql/platform/hyperdb/hyperdb_wasm';
import { HyperDB as HyperDBEngine } from 'hyperdb-wasm';
import { testDatabasePath } from './hyperdb_test_client.js';
import { TestLogger } from '@akohn/dashql/platform/testing/test_logger';
import '@akohn/dashql/platform/testing/test_hyperdb';

export interface SharedHyperDBTestPool {
    dispose(): void;
}

export function installSharedHyperDBTestPool(): SharedHyperDBTestPool {
    let nextLease = 1;

    globalThis.__DASHQL_TEST_HYPERDB_FACTORY__ = async (
        _context: string,
        _logger: Logger,
        onSetupProgress?: (progress: SetupProgress) => void,
    ) => {
        const getClient = globalThis.__DASHQL_TEST_HYPERDB_CLIENT__;
        if (!getClient) throw new Error('Shared HyperDB client is not installed');
        const client = await getClient(onSetupProgress);
        return await HyperDB.create(new HyperDBEngine(client), {
            computeDatabasePath: await testDatabasePath(`dashql-test-${nextLease++}.hyper`),
            defaultDatabasePath: await testDatabasePath(`dashql-test-${nextLease++}.hyper`),
            snippetsDatabasePath: await testDatabasePath(`dashql-test-${nextLease++}.hyper`),
            terminateEngine: false,
        });
    };

    // The HyperDBs of the tests of the runtime (@akohn/dashql/platform/testing/test_hyperdb), on the same engine
    globalThis.__DASHQL_TEST_HYPERDB__ = context => globalThis.__DASHQL_TEST_HYPERDB_FACTORY__!(context, new TestLogger());

    return {
        async dispose() {
            delete globalThis.__DASHQL_TEST_HYPERDB_FACTORY__;
            delete globalThis.__DASHQL_TEST_HYPERDB__;
        },
    };
}
