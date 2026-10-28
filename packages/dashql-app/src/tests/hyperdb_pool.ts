import type { Logger } from '../platform/logger/logger.js';
import type { SetupProgress } from '../platform/database/embedded_database_provider.js';
import { HyperDB, HyperDBEngine } from '../platform/hyperdb/hyperdb_wasm.js';
import { testDatabasePath } from './hyperdb_test_client.js';

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

    return {
        async dispose() {
            delete globalThis.__DASHQL_TEST_HYPERDB_FACTORY__;
        },
    };
}
