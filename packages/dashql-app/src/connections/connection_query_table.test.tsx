import * as React from 'react';
import { act } from '@akohn/dashql-react/testing/react_act';
import { createRoot, type Root } from 'react-dom/client';
import * as dashql from '@akohn/dashql';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { EmbeddedDatabaseProvider } from '../host/embedded_database_provider.js';
import { HyperDB, type HyperDBClient, type HyperDBConnection } from '@akohn/dashql/platform/hyperdb/hyperdb_wasm';
import { HyperDB as HyperDBEngine } from 'hyperdb-wasm';
import { LoggerProvider } from '../host/logger_provider.js';
import { getTestHyperDBClient, testDatabasePath } from '../tests/hyperdb_test_client.js';
import { QueryTable } from './connection_query_table.js';
import { StandaloneRuntime } from '../host/standalone_runtime.js';
import { useRuntime } from '@akohn/dashql-react/hooks';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

/// Set up the compute database of the runtime right away like the app does, the table waits until it is ready
function PrepareComputeDatabase() {
    const runtime = useRuntime();
    React.useEffect(() => runtime.computeDatabase.prepare(), [runtime]);
    return null;
}

describe('QueryTable', () => {
    let client: HyperDBClient;
    let sharedClient = false;
    let database: HyperDB | null = null;
    let connection: HyperDBConnection | null = null;
    let nextDatabase = 1;
    let container: HTMLDivElement;
    let root: Root;

    beforeAll(async () => {
        // The runtime of the table is created with the core
        await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
        ({ client, shared: sharedClient } = await getTestHyperDBClient());
    }, 60_000);

    beforeEach(async () => {
        database = await HyperDB.create(new HyperDBEngine(client), {
            computeDatabasePath: await testDatabasePath(`dashql-query-table-${nextDatabase++}.hyper`),
            defaultDatabasePath: await testDatabasePath(`dashql-query-table-${nextDatabase++}.hyper`),
            terminateEngine: false,
        });
        connection = await database.connect();
        container = document.createElement('div');
        container.style.width = '800px';
        container.style.height = '400px';
        document.body.appendChild(container);
        root = createRoot(container);
    }, 60_000);

    afterEach(async () => {
        act(() => root.unmount());
        container.remove();
        await connection?.close().catch(() => {});
        connection = null;
        // The unmounted table still drops the tables of its computation, termination closes these connections
        await database?.terminate();
        database = null;
    });

    afterAll(async () => {
        if (!sharedClient) await client?.terminate();
    });

    /// Render the table of a query, the compute database is the database of the test
    function render(sql: string): void {
        const computeDatabase = database!;
        const runQuery = (text: string) => connection!.query(text);
        act(() => root.render(
            <LoggerProvider>
                <EmbeddedDatabaseProvider setupDatabase={async () => computeDatabase}>
                    <StandaloneRuntime>
                        <PrepareComputeDatabase />
                        <QueryTable sql={sql} clientContext={null} runQuery={runQuery} />
                    </StandaloneRuntime>
                </EmbeddedDatabaseProvider>
            </LoggerProvider>,
        ));
    }

    it('replaces the result with the one of a changed query with a time of day', async () => {
        render(`SELECT 'select 1' AS query, 3::integer AS queries`);
        await vi.waitFor(() => expect(container.textContent).toContain('queries'), { timeout: 10_000 });
        render(`SELECT TIME '12:34:56' AS time, 'ok' AS status, 'select 1' AS query`);
        await vi.waitFor(() => expect(container.textContent).toContain('status'), { timeout: 10_000 });
    }, 30_000);
});
