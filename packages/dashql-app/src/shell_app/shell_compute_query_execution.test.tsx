import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import * as core from '@ankoh/dashql';

import { useCreateComputeQueryExecution } from '../compute/compute_query_execution.js';
import { QueryExecutionStatus, QueryType, type QueryExecutionState } from '@ankoh/dashql/platform/query/query_execution_state';
import { ShellComputeQueryExecutionProvider } from './shell_compute_query_execution.js';
import { ShellQueryHistoryProvider, useShellQueries } from './shell_query_history.js';
import { StandaloneRuntime, useRuntime } from '../runtime/runtime_hooks.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
beforeAll(async () => { await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });

describe('ShellComputeQueryExecutionProvider', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('tracks aggregation queries in the shell query history', async () => {
        let createExecution: ReturnType<typeof useCreateComputeQueryExecution> = null;
        let runtime: ReturnType<typeof useRuntime> | null = null;
        let queries: QueryExecutionState[] = [];
        const Probe = () => {
            createExecution = useCreateComputeQueryExecution();
            runtime = useRuntime();
            queries = useShellQueries();
            return null;
        };

        act(() => root.render(
            <StandaloneRuntime>
                <ShellQueryHistoryProvider>
                    <ShellComputeQueryExecutionProvider>
                        <Probe />
                    </ShellComputeQueryExecutionProvider>
                </ShellQueryHistoryProvider>
            </StandaloneRuntime>,
        ));

        // The history waits for the core of the shell
        await act(async () => { await runtime!.ready(); });
        const task = { tableId: 1, title: 'Table aggregation' };
        await act(async () => {
            await createExecution!(task)('SELECT count(*) FROM input', async () => 42);
        });

        await vi.waitFor(() => expect(queries).toHaveLength(1));
        expect(queries).toMatchObject([{
            queryText: 'SELECT count(*) FROM input',
            queryMetadata: {
                queryType: QueryType.INTERNAL_SQLFRAME,
                title: 'Table aggregation',
                issuer: 'SQLFrame',
            },
            status: QueryExecutionStatus.SUCCEEDED,
        }]);
    });
});
