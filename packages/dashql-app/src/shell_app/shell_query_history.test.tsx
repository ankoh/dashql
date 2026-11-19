import * as React from 'react';
import { act } from '@akohn/dashql-react/testing/react_act';
import { createRoot, type Root } from 'react-dom/client';
import * as core from '@akohn/dashql';

import { QueryType, type QueryExecutionState } from '@akohn/dashql/platform/query/query_execution_state';
import { newDefaultHyperWasmConnection } from '@akohn/dashql/platform/connections/connection_params';
import {
    SHELL_CONNECTION_ID,
    SHELL_DATABASE_ID,
    ShellQueryHistoryProvider,
    shellQueryEntries,
    useShellQueries,
} from './shell_query_history.js';
import { useRuntime } from '@akohn/dashql-react/hooks';
import { StandaloneRuntime } from '../host/standalone_runtime.js';
import { runTestQuery } from '../tests/test_connections.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
beforeAll(async () => { await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });

const SHELL_METADATA = {
    queryType: QueryType.USER_PROVIDED,
    title: 'Shell Query',
    description: null,
    issuer: 'DashQL Shell',
    userProvided: true,
};

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

    it('lists the queries of the connection of the shell since the history started, without the catalog queries', async () => {
        let runtime: ReturnType<typeof useRuntime> | null = null;
        let queries: QueryExecutionState[] = [];
        const Probe = () => {
            runtime = useRuntime();
            queries = useShellQueries();
            return null;
        };
        const Seed = (props: { children: React.ReactElement }) => {
            const rt = useRuntime();
            const [seeded] = React.useState(() => {
                rt.createConnection(newDefaultHyperWasmConnection(), SHELL_CONNECTION_ID);
                // A query of an earlier history of the shell
                runTestQuery(rt, SHELL_CONNECTION_ID, 'SELECT 0', SHELL_METADATA, true);
                return true;
            });
            return seeded ? props.children : null;
        };

        await act(async () => root.render(
            <StandaloneRuntime>
                <Seed>
                    <ShellQueryHistoryProvider>
                        <Probe />
                    </ShellQueryHistoryProvider>
                </Seed>
            </StandaloneRuntime>
        ));

        await act(async () => {
            runTestQuery(runtime!, SHELL_CONNECTION_ID, 'SELECT 1', SHELL_METADATA, true);
            runTestQuery(runtime!, SHELL_CONNECTION_ID, 'SELECT * FROM information_schema.tables', { ...SHELL_METADATA, issuer: 'Catalog Update', userProvided: false }, true);
        });

        await vi.waitFor(() => expect(queries).toHaveLength(1));
        const entries = shellQueryEntries(queries);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ connectionId: SHELL_DATABASE_ID, sourceName: 'Hyper', queryId: queries[0].queryId });
        expect(entries[0].query).toMatchObject({ queryText: 'SELECT 1' });
    });
});
