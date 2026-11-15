import * as dashql from '@ankoh/dashql-core';

import type { ConnectionState } from '../connections/connection_state.js';
import { createTestConnection, type TestConnectionOptions } from './connection_fixtures.js';
import type { OAuthFlow } from '../oauth/oauth_flow.js';
import type { EmbeddedComputeDatabase } from '../platform/database/embedded_database.js';
import type { HttpClient } from '../platform/http/http_client.js';
import type { QueryResultCache } from '../query/query_result_cache.js';
import { createRuntime, type Runtime, type RuntimePlatform } from '../runtime.js';
import { TASK_UPDATE_SCHEDULER } from '../store/store.js';
import type { StorageBackend } from '../storage/storage_backend.js';
import { TestLogger } from './test_logger.js';
import { WorkbookTestBackend } from './workbook_test_backend.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

/// The core of the tests of a file, instantiated once
let core: Promise<dashql.DashQL> | null = null;
export function testCore(): Promise<dashql.DashQL> {
    core ??= DASHQL_PRECOMPILED.then(wasmBinary => dashql.DashQL.create({ wasmBinary }));
    return core;
}

export interface TestRuntimeOptions {
    /// Where the workbooks and connections are kept, in memory by default
    storage?: StorageBackend;
    /// The network, none by default
    http?: HttpClient;
    /// The database of the computations, none by default
    computeDatabase?: EmbeddedComputeDatabase | null;
    /// The cache of query results, none by default
    resultCache?: QueryResultCache | null;
    /// Keep the catalog loader running. It asks connections that come online about their catalogs, the tests of other
    /// services stop it.
    catalogLoader?: boolean;
}

/// A runtime of the platform of the tests: the services of the app without a user interface, in Node and in the
/// browsers alike
export interface TestRuntime extends Runtime {
    logger: TestLogger;
    /// Create a connection in the runtime, with a channel ready and online if the options have one
    addConnection(options: TestConnectionOptions): ConnectionState;
    /// The connection as the runtime holds it now
    connection(connectionId: string): ConnectionState;
}

export async function createTestRuntime(options: TestRuntimeOptions = {}): Promise<TestRuntime> {
    const offline = () => { throw new Error('the test has no network'); };
    const logger = new TestLogger();
    const instance = await testCore();
    const platform: RuntimePlatform = {
        logger,
        storage: options.storage ?? new WorkbookTestBackend(),
        http: options.http ?? ({ fetch: offline } as HttpClient),
        scheduler: TASK_UPDATE_SCHEDULER,
        oauthFlow: { authorizeWithRedirectPage: offline, authorizeWithLoopback: offline } as unknown as OAuthFlow,
        setupCore: async () => instance,
        computeDatabase: options.computeDatabase ?? null,
        resultCache: options.resultCache ?? null,
    };
    const runtime = createRuntime(platform);
    if (!options.catalogLoader) runtime.coreRuntime.runCatalogLoader(false);
    // The runtime of the module has the core of the tests from the start
    runtime.coreRuntime.setCore(instance);
    return Object.assign(runtime, {
        logger,
        addConnection(connection: TestConnectionOptions) {
            return createTestConnection(runtime.coreRuntime, connection);
        },
        connection(connectionId: string) {
            const connection = runtime.coreRuntime.connection(connectionId);
            if (connection == null) throw new Error(`the runtime has no connection ${connectionId}`);
            return connection;
        },
    });
}
