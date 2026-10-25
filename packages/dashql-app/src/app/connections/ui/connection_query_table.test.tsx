import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ComputeQueryExecutionProvider } from '../../../compute/computation_query_execution.js';
import { ComputationRegistry } from '../../../compute/computation_registry.js';
import { ComputationScheduler } from '../../../compute/computation_scheduler.js';
import type { ComputeQueryExecution } from '../../../compute/computation_tasks.js';
import { ComputeConnectionProvider } from '../../../compute/compute_connection_provider.js';
import { EmbeddedDatabaseProvider } from '../../../platform/database/embedded_database_provider.js';
import { HyperDB, HyperDBEngine, type HyperDBClient, type HyperDBConnection } from '../../../platform/hyperdb/hyperdb_wasm.js';
import { LoggerProvider } from '../../../platform/logger/logger_provider.js';
import { getTestHyperDBClient } from '../../../tests/hyperdb_test_client.js';
import { QueryTable } from './connection_query_table.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

/// Run the queries of the computations without tracking them
const execute: ComputeQueryExecution = (_query, run) => run(null);

describe('QueryTable', () => {
    let client: HyperDBClient;
    let sharedClient = false;
    let database: HyperDB | null = null;
    let connection: HyperDBConnection | null = null;
    let nextDatabase = 1;
    let container: HTMLDivElement;
    let root: Root;

    beforeAll(async () => {
        ({ client, shared: sharedClient } = await getTestHyperDBClient());
    }, 60_000);

    beforeEach(async () => {
        database = await HyperDB.create(new HyperDBEngine(client), {
            computeDatabasePath: `/mnt/fs/dashql-query-table-${nextDatabase++}.hyper`,
            defaultDatabasePath: `/mnt/fs/dashql-query-table-${nextDatabase++}.hyper`,
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
                    <ComputeConnectionProvider>
                        <ComputationRegistry>
                            <ComputeQueryExecutionProvider createExecution={() => execute}>
                                <ComputationScheduler />
                                <QueryTable sql={sql} clientContext={null} runQuery={runQuery} />
                            </ComputeQueryExecutionProvider>
                        </ComputationRegistry>
                    </ComputeConnectionProvider>
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
