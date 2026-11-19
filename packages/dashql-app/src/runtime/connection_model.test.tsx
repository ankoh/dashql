import * as React from 'react';
import { act } from '@akohn/dashql-react/testing/react_act';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as core from '@akohn/dashql';

import type { ConnectionParams } from '@akohn/dashql/platform/connections/connection_params';
import type { Runtime } from '@akohn/dashql/runtime/runtime';
import { createTestConnection } from '@akohn/dashql/runtime/testing/connection_fixtures';
import { WorkbookTestBackend } from '@akohn/dashql/platform/testing/workbook_test_backend';
import { useRuntime } from '@akohn/dashql-react/hooks';
import { useConnectionModel, type ConnectionModel } from '@akohn/dashql-react/models/connection_model';

import { LoggerProvider } from '../platform/logger_provider.js';
import { StorageProvider } from '../storage/storage_provider.js';
import { TestRuntime } from '../tests/test_runtime.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: core.DashQL;
beforeAll(async () => { dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });

const TRINO = { trino: { endpoint: 'https://trino.example' } } as ConnectionParams;

/// A Trino connection of the runtime and its model
function Model(props: { capture: (runtime: Runtime, model: ConnectionModel | null) => void }) {
    const runtime = useRuntime();
    const [connectionId, setConnectionId] = React.useState<string | null>(null);
    React.useEffect(() => {
        void createTestConnection(runtime, { connectionId: 'trino', params: TRINO }).then(state => setConnectionId(state.connectionId));
    }, [runtime]);
    const model = useConnectionModel(connectionId);
    React.useLayoutEffect(() => props.capture(runtime, model));
    return null;
}

describe('the model of a connection', () => {
    it('renames, drafts and removes the connection, each change settles before it resolves', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        let model: ConnectionModel | null = null;
        let runtime!: Runtime;
        try {
            await act(async () => {
                root.render(<LoggerProvider>
                    <StorageProvider backend={new WorkbookTestBackend()}>
                        <TestRuntime core={dql}>
                            <Model capture={(rt, current) => { runtime = rt; model = current; }} />
                        </TestRuntime>
                    </StorageProvider>
                </LoggerProvider>);
            });
            await vi.waitFor(() => expect(model).not.toBeNull());
            const current = () => model!;
            expect(current().connection.connectorType).toBe(core.ConnectorType.TRINO);

            // The store shows a change once the operation resolved, the component renders with it right after
            await act(async () => await current().rename('Warehouse'));
            expect(runtime.store.get('connection', 'trino')?.name).toBe('Warehouse');
            await vi.waitFor(() => expect(current().connection.name).toBe('Warehouse'));

            const draft = { trino: { endpoint: 'https://other.example' } } as ConnectionParams;
            await act(async () => await current().setDraft(draft));
            await vi.waitFor(() => expect(current().connection.paramsDraft).toMatchObject(draft));
            await act(async () => await current().discardDraft());
            await vi.waitFor(() => expect(current().connection.paramsDraft).toBeNull());

            // A connection that no workbook uses goes, its model with it
            let removed = false;
            await act(async () => { removed = await current().remove(); });
            expect(removed).toBe(true);
            await vi.waitFor(() => expect(model).toBeNull());
        } finally {
            act(() => root.unmount());
            container.remove();
        }
    });
});
