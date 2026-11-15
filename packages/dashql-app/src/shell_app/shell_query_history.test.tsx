import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import * as core from '@ankoh/dashql-core';

import { QueryExecutionStatus, QueryType, type QueryExecutionState } from '@ankoh/dashql-runtime/query/query_execution_state';
import { executeTrackedQuery } from '@ankoh/dashql-runtime/query/tracked_query_execution';
import {
    SHELL_DATABASE_ID,
    ShellQueryHistoryProvider,
    shellQueryEntries,
    useShellQueries,
    useShellQueryHistory,
} from './shell_query_history.js';
import { StandaloneCoreRuntime, useCoreRuntime } from '../runtime/runtime_hooks.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
beforeAll(async () => { await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });

describe('ShellQueryHistoryProvider', () => {
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

    it('lists the queries of the shell as entries of the query history', async () => {
        let history: ReturnType<typeof useShellQueryHistory> | null = null;
        let runtime: ReturnType<typeof useCoreRuntime> | null = null;
        let queries: QueryExecutionState[] = [];
        const Probe = () => {
            history = useShellQueryHistory();
            runtime = useCoreRuntime();
            queries = useShellQueries();
            return null;
        };

        act(() => root.render(
            <StandaloneCoreRuntime>
                <ShellQueryHistoryProvider>
                    <Probe />
                </ShellQueryHistoryProvider>
            </StandaloneCoreRuntime>
        ));

        // The history waits for the core of the shell
        await act(async () => { await runtime!.ready(); });
        await act(async () => {
            await executeTrackedQuery({
                query: 'SELECT 1',
                metadata: {
                    queryType: QueryType.USER_PROVIDED,
                    title: 'Shell Query',
                    description: null,
                    issuer: 'DashQL Shell',
                    userProvided: true,
                },
                tracker: history!,
                execute: async () => null,
            });
        });

        await vi.waitFor(() => expect(queries).toHaveLength(1));
        const entries = shellQueryEntries(queries);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ connectionId: SHELL_DATABASE_ID, sourceName: 'Hyper', queryId: queries[0].queryId });
        expect(entries[0].query).toMatchObject({
            queryText: 'SELECT 1',
            status: QueryExecutionStatus.SUCCEEDED,
        });
    });
});
