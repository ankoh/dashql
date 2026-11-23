import * as React from 'react';
import { act } from '@akohn/dashql-react/testing/react_act';
import { createTestRoot } from '@akohn/dashql-react/testing/react_root';
import { useRuntime } from '@akohn/dashql-react/hooks';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as core from '@akohn/dashql';

import type { Runtime } from '@akohn/dashql/runtime/runtime';
import type { ConnectionParams } from '@akohn/dashql/platform/connections/connection_params';
import { WorkbookTestBackend } from '@akohn/dashql/platform/testing/workbook_test_backend';
import { LoggerProvider } from '../../host/logger_provider.js';
import { StorageProvider } from '../../storage/storage_provider.js';
import { TestRuntime } from '../../tests/test_runtime.js';
import { addTestConnection } from '../../tests/test_connections.js';
import { WorkbookShellsPage } from './workbook_shells_page.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
beforeAll(async () => { await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });

const WORKBOOK_ID = '00000000-0000-4000-8000-000000000201';
const hyperServer = (endpoint: string) => ({ hyper: { protocol: 'V3_HTTP', endpoint } }) as ConnectionParams;

describe('WorkbookShellsPage', () => {
    let root: ReturnType<typeof createTestRoot>;
    let runtime: Runtime;
    let connectionId: string | null;
    let shellMounts: string[];
    const onPickConnection = vi.fn((next: string) => { connectionId = next; });

    function Capture() {
        runtime = useRuntime();
        return null;
    }

    /// The shell of a connection, without a session
    function Shell(props: { connectionId: string; active: boolean }) {
        const mounted = React.useEffectEvent(() => { shellMounts.push(props.connectionId); });
        React.useEffect(() => mounted(), []);
        return <div data-testid="shell" data-connection-id={props.connectionId} data-active={props.active} />;
    }

    const render = (page: boolean = true) => root.render(
        <LoggerProvider>
            <StorageProvider backend={new WorkbookTestBackend()}>
                <TestRuntime>
                    <Capture />
                    {page ? (
                        <WorkbookShellsPage
                            workbookId={WORKBOOK_ID}
                            workbookName="Workbook"
                            connectionId={connectionId}
                            onPickConnection={onPickConnection}
                            shell={props => <Shell connectionId={props.connectionId} active={props.active} />}
                        />
                    ) : <></>}
                </TestRuntime>
            </StorageProvider>
        </LoggerProvider>,
    );
    const shells = () => [...root.container.querySelectorAll('[data-testid="shell"]')].map(shell => ({
        connectionId: shell.getAttribute('data-connection-id'),
        active: shell.getAttribute('data-active') === 'true',
    }));
    const trigger = () => root.container.querySelector('[data-testid="shell-connection-picker"]') as HTMLButtonElement;
    const pick = (next: string) => {
        act(() => trigger().click());
        act(() => (document.querySelector(`[data-connection="${next}"]`) as HTMLButtonElement).click());
        render();
    };

    beforeEach(async () => {
        shellMounts = [];
        connectionId = 'main';
        onPickConnection.mockClear();
        root = createTestRoot();
        render(false);
        // The workbook runs a script on each connection, the list numbers the connections of a connector
        await act(async () => {
            await addTestConnection(runtime, { connectionId: 'main', params: hyperServer('http://main') });
            await addTestConnection(runtime, { connectionId: 'attached', params: hyperServer('http://attached') });
            runtime.createWorkbook('main', 'Workbook', false, undefined, WORKBOOK_ID);
            runtime.dispatch({ workbook: WORKBOOK_ID }, { kind: 'createScript', value: { text: 'select 1', base: '1', connectionId: 'main' } });
            runtime.dispatch({ workbook: WORKBOOK_ID }, { kind: 'createScript', value: { text: 'select 2', base: '2', connectionId: 'attached' } });
            runtime.flush();
        });
    });
    afterEach(() => {
        root.unmount();
    });

    it('names the connection of the visible shell', () => {
        render();
        expect(trigger().textContent).toContain('#1');
        expect(shells()).toEqual([{ connectionId: 'main', active: true }]);
    });

    it('keeps the shells of other connections hidden while switching', () => {
        render();
        pick('attached');
        expect(onPickConnection).toHaveBeenCalledWith('attached');
        expect(shells()).toEqual([
            { connectionId: 'main', active: false },
            { connectionId: 'attached', active: true },
        ]);
        expect(trigger().textContent).toContain('#2');

        pick('main');
        expect(shells()).toEqual([
            { connectionId: 'main', active: true },
            { connectionId: 'attached', active: false },
        ]);
        expect(shellMounts).toEqual(['main', 'attached']);
    });

    it('closes the shell of a deleted connection', () => {
        render();
        pick('attached');
        // The workbook lets go of the connection, then it is deleted
        act(() => {
            runtime.dispatch({ workbook: WORKBOOK_ID }, { kind: 'deleteScript', value: { fileName: '2.sql' } });
            runtime.dispatch({ connection: 'attached' }, { kind: 'deleteConnection' });
            runtime.flush();
        });
        expect(runtime.connection('attached') ?? null).toBeNull();
        connectionId = 'main';
        render();
        expect(shells()).toEqual([{ connectionId: 'main', active: true }]);
    });
});
