import * as core from '@ankoh/dashql-core';
import * as React from 'react';
import { act, waitForRender } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppConfigProvider, useAppConfig, useAppReconfigure } from '../config/app_config.js';
import { ConnectionRegistry, useConnectionRegistry } from '../connections/connection_registry.js';
import { EXECUTOR_CTX } from '../connections/query_executor.js';
import { DASHQL_AGENT_PORT } from '../globals.js';
import { type Logger } from '@ankoh/dashql-sdk/platform/logger/logger';
import { LoggerProvider, useLogger } from '../platform/logger/logger_provider.js';
import { TestLogger } from '../platform/logger/test_logger.js';
import { restoreAppState, type RestoredAppState } from '../workbook/persistence/app_state_loader.js';
import { WorkbookScriptsRegistryProvider, useWorkbookScriptsRegistry } from '../workbook/scripts/workbook_scripts_registry.js';
import { WorkbookTestBackend, testWorkbook } from '../storage/workbook_test_backend.js';
import type { ConnectionEntry, WorkbookData } from '@ankoh/dashql-sdk/storage/storage_backend';
import { StorageProvider } from '../storage/storage_provider.js';
import { AgentBridgeProvider, blocksLoopbackWebSockets, useAgentBridge, type AgentBridge, type AgentTurnListener } from './agent_bridge.js';
import { AgentConnectionStatus } from './agent_client.js';
import { AGENT_PROTOCOL_VERSION } from './agent_protocol.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const WORKBOOK_A = '11111111-2222-4333-8444-555555555555';
const WORKBOOK_B = '22222222-3333-4444-8555-666666666666';
const HYPER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const HYPER_PARAMS = { hyper: {} } as WorkbookData['connections'][number]['params'];
const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

interface SentMessage {
    id?: number;
    method?: string;
    params?: any;
    result?: any;
    error?: any;
}

class FakeSocket {
    static created: FakeSocket[] = [];
    readyState = 0;
    sent: SentMessage[] = [];
    closed = false;
    onopen: ((event: unknown) => void) | null = null;
    onclose: ((event: unknown) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    constructor(readonly url: string) { FakeSocket.created.push(this); }
    send(data: string) { this.sent.push(JSON.parse(data)); }
    close() { this.closed = true; this.readyState = 3; }
    sentWith(method: string) { return this.sent.filter(message => message.method === method); }
    receive(message: unknown) { this.onmessage?.({ data: JSON.stringify(message) }); }
}

interface Api {
    bridge: AgentBridge;
    logger: Logger;
    config: ReturnType<typeof useAppConfig>;
    reconfigure: ReturnType<typeof useAppReconfigure>;
    workbooks: ReturnType<typeof useWorkbookScriptsRegistry>[0];
    setWorkbooks: ReturnType<typeof useWorkbookScriptsRegistry>[1];
    navigate: ReturnType<typeof useNavigate>;
    pathname: string;
}

function Capture(props: { restored: RestoredAppState | null; capture: (api: Api) => void }) {
    const bridge = useAgentBridge()!;
    const logger = useLogger();
    const config = useAppConfig();
    const reconfigure = useAppReconfigure();
    const [workbooks, setWorkbooks] = useWorkbookScriptsRegistry();
    const [, setConnections] = useConnectionRegistry();
    const navigate = useNavigate();
    const location = useLocation();
    React.useEffect(() => {
        if (props.restored == null) return;
        setConnections(registry => ({
            ...registry,
            connections: props.restored!.connectionStates,
            connectionsByType: props.restored!.connectionStatesByType,
        }));
        setWorkbooks(registry => ({
            ...registry,
            workbookScriptsMap: props.restored!.workbookScripts,
            workbookScriptsByConnection: props.restored!.workbookScriptsByConnection,
        }));
    }, [props.restored, setConnections, setWorkbooks]);
    React.useLayoutEffect(() => {
        props.capture({ bridge, logger, config, reconfigure, workbooks, setWorkbooks, navigate, pathname: location.pathname });
    });
    return null;
}

function createListener() {
    return {
        status: vi.fn<AgentTurnListener['status']>(),
        edited: vi.fn<AgentTurnListener['edited']>(),
        ran: vi.fn<AgentTurnListener['ran']>(),
        done: vi.fn<AgentTurnListener['done']>(),
        failed: vi.fn<AgentTurnListener['failed']>(),
    };
}

describe('blocksLoopbackWebSockets', () => {
    it('blocks Safari only, which refuses ws://127.0.0.1 from https pages', () => {
        expect(blocksLoopbackWebSockets(SAFARI, false)).toBe(true);
        for (const userAgent of [
            'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0',
            'Mozilla/5.0 (Macintosh; rv:130.0) Gecko/20100101 Firefox/130.0',
            'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 CriOS/130.0 Safari/604.1',
            'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 FxiOS/130.0 Safari/604.1',
            '',
        ]) {
            expect(blocksLoopbackWebSockets(userAgent, false)).toBe(false);
        }
    });

    it('does not block the desktop app, its WebKit has no such rule', () => {
        expect(blocksLoopbackWebSockets(SAFARI, true)).toBe(false);
    });
});

describe('AgentBridgeProvider', () => {
    let dql: core.DashQL;
    let container: HTMLDivElement;
    let root: Root | null;
    let api: Api;
    let execute: ReturnType<typeof vi.fn>;
    const OriginalWebSocket = globalThis.WebSocket;

    beforeAll(async () => { dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });

    beforeEach(() => {
        FakeSocket.created = [];
        vi.stubGlobal('WebSocket', FakeSocket);
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        execute = vi.fn();
    });
    afterEach(() => {
        if (root != null) act(() => root!.unmount());
        container.remove();
        vi.stubGlobal('WebSocket', OriginalWebSocket);
        delete globalThis.dashqlElectron;
        delete (navigator as unknown as { userAgent?: string }).userAgent;
        dql.resetUnsafe();
    });

    /// The app after the restoration of two workbooks with a script each
    async function restoreWorkbooks(): Promise<RestoredAppState> {
        const backend = new WorkbookTestBackend();
        backend.connections = [{ id: HYPER_ID, params: HYPER_PARAMS } as ConnectionEntry];
        for (const [workbookId, name] of [[WORKBOOK_A, 'Alpha'], [WORKBOOK_B, 'Beta']]) {
            await backend.saveWorkbookManifest(workbookId, testWorkbook({
                workbookId,
                name,
                connections: [{ connectionId: HYPER_ID, params: HYPER_PARAMS }],
                scripts: [{ name: 'query.sql', connectionId: HYPER_ID }],
            }));
            await backend.saveScript(workbookId, 'query.sql', 'select 1');
        }
        return await restoreAppState(dql, backend, new TestLogger(), () => { });
    }

    async function renderBridge(options: { path?: string; restored?: RestoredAppState | null } = {}) {
        const executor = { execute, cancel: vi.fn(), watchProfile: () => () => { } };
        const restored = options.restored === undefined ? await restoreWorkbooks() : options.restored;
        await act(async () => {
            root!.render(
                <MemoryRouter initialEntries={[options.path ?? '/']}>
                    <LoggerProvider>
                        <AppConfigProvider>
                            <StorageProvider backend={new WorkbookTestBackend()}>
                                <ConnectionRegistry>
                                    <WorkbookScriptsRegistryProvider>
                                        <EXECUTOR_CTX.Provider value={executor as never}>
                                            <AgentBridgeProvider>
                                                <Capture restored={restored} capture={next => { api = next; }} />
                                            </AgentBridgeProvider>
                                        </EXECUTOR_CTX.Provider>
                                    </WorkbookScriptsRegistryProvider>
                                </ConnectionRegistry>
                            </StorageProvider>
                        </AppConfigProvider>
                    </LoggerProvider>
                </MemoryRouter>,
            );
        });
        await vi.waitFor(() => expect(api.config != null).toBe(true));
        if (restored != null) await vi.waitFor(() => expect(api.workbooks.workbookScriptsMap.size).toBe(2));
    }

    const sockets = () => FakeSocket.created;
    const lastSocket = () => FakeSocket.created[FakeSocket.created.length - 1];

    /// Answer the last request of a method, like the agent server
    async function respond(socket: FakeSocket, method: string, result: unknown = {}) {
        const requests = socket.sentWith(method);
        const request = requests[requests.length - 1];
        if (request == null) throw new Error(`No request ${method}`);
        await act(async () => { socket.receive({ id: request.id, result }); });
    }
    /// Open the socket and take the announced workbooks
    async function connect(socket: FakeSocket = lastSocket()) {
        await act(async () => {
            socket.readyState = 1;
            socket.onopen?.({});
        });
        await respond(socket, 'client/workbooks');
        await vi.waitFor(() => expect(api.bridge.status).toBe(AgentConnectionStatus.Connected));
    }
    /// Show a workbook, the router renders the new location in a transition
    async function show(workbookId: string | null) {
        const pathname = workbookId == null ? '/' : `/workbooks/${workbookId}`;
        await act(async () => { api.navigate(pathname); });
        await waitForRender(() => expect(api.pathname).toBe(pathname));
    }
    /// Show a workbook, turn on the agent and connect
    async function connectWithAccess(workbookId: string = WORKBOOK_A) {
        await show(workbookId);
        await act(async () => api.bridge.setEnabled(true));
        await vi.waitFor(() => expect(sockets().length > 0).toBe(true));
        await connect();
    }
    /// Start a turn and answer its request
    async function startTurn(workbookId: string, turnId: string, listener: AgentTurnListener): Promise<void> {
        let started!: Promise<string>;
        const socket = lastSocket();
        const before = socket.sentWith('agent/request').length;
        await act(async () => { started = api.bridge.request(workbookId, 'do something', listener); });
        await vi.waitFor(() => expect(socket.sentWith('agent/request').length).toBe(before + 1));
        await respond(socket, 'agent/request', { turnId, harness: 'claude' });
        expect(await started).toBe(turnId);
    }
    const notify = (method: string, params: unknown) => act(async () => { lastSocket().receive({ method, params }); });

    describe('the connection', () => {
        it('stays off while the agent is off', async () => {
            await renderBridge();
            expect(api.bridge.status).toBe(AgentConnectionStatus.Off);
            expect(sockets().length).toBe(0);
            expect(api.bridge.supported).toBe(true);
            expect(api.bridge.port).toBe(DASHQL_AGENT_PORT);
        });

        it('connects once the agent is on and announces the visible workbook', async () => {
            await renderBridge();
            await connectWithAccess();
            expect(lastSocket().url).toBe(`ws://127.0.0.1:${DASHQL_AGENT_PORT}/v1/ws`);
            const announcement = lastSocket().sentWith('client/workbooks')[0].params;
            expect(announcement.protocol).toBe(AGENT_PROTOCOL_VERSION);
            expect(announcement.client).toBe('web');
            expect(announcement.workbooks).toEqual([{ id: WORKBOOK_A, name: 'Alpha' }]);
            expect(announcement.focused).toBe(WORKBOOK_A);
            expect(api.bridge.enabled).toBe(true);
            expect(api.bridge.hasAccess(WORKBOOK_A)).toBe(true);
            expect(api.bridge.hasAccess(WORKBOOK_B)).toBe(false);
        });

        it('announces itself as the desktop app there', async () => {
            globalThis.dashqlElectron = { onFlush: () => () => { } } as unknown as DashQLElectronBridge;
            await renderBridge();
            await connectWithAccess();
            expect(lastSocket().sentWith('client/workbooks')[0].params.client).toBe('desktop');
        });

        it('announces only the visible workbook, another one once the user switches', async () => {
            await renderBridge();
            await connectWithAccess(WORKBOOK_A);
            await show(WORKBOOK_B);
            await vi.waitFor(() => expect(lastSocket().sentWith('client/workbooks').length).toBe(2));
            const announcement = lastSocket().sentWith('client/workbooks')[1].params;
            expect(announcement.workbooks).toEqual([{ id: WORKBOOK_B, name: 'Beta' }]);
            expect(announcement.focused).toBe(WORKBOOK_B);
            expect(api.bridge.hasAccess(WORKBOOK_A)).toBe(false);
            expect(api.bridge.hasAccess(WORKBOOK_B)).toBe(true);
            expect(sockets().length).toBe(1);
        });

        it('stays connected without a workbook while the agent is on', async () => {
            await renderBridge();
            await connectWithAccess(WORKBOOK_A);
            await show(null);
            await vi.waitFor(() => expect(lastSocket().sentWith('client/workbooks').length).toBe(2));
            expect(lastSocket().sentWith('client/workbooks')[1].params).toMatchObject({ workbooks: [], focused: null });
            expect(lastSocket().closed).toBe(false);
        });

        it('does not announce a workbook that is not loaded', async () => {
            await renderBridge({ restored: null, path: `/workbooks/${WORKBOOK_A}` });
            await act(async () => api.bridge.setEnabled(true));
            await vi.waitFor(() => expect(sockets().length).toBe(1));
            await act(async () => { lastSocket().readyState = 1; lastSocket().onopen?.({}); });
            expect(lastSocket().sentWith('client/workbooks')[0].params).toMatchObject({ workbooks: [], focused: null });
        });

        it('keeps the setting in the app config', async () => {
            await renderBridge();
            await act(async () => api.bridge.setEnabled(true));
            expect(api.config?.settings?.agentEnabled).toBe(true);
            await act(async () => api.bridge.setEnabled(false));
            expect(api.config?.settings?.agentEnabled).toBeUndefined();
        });

        it('disconnects when the agent is turned off', async () => {
            await renderBridge();
            await connectWithAccess();
            await act(async () => api.bridge.setEnabled(false));
            expect(lastSocket().closed).toBe(true);
            await vi.waitFor(() => expect(api.bridge.status).toBe(AgentConnectionStatus.Off));
        });

        it('stays connected while something holds the connection', async () => {
            await renderBridge();
            let release!: () => void;
            await act(async () => { release = api.bridge.hold(); });
            await vi.waitFor(() => expect(sockets().length).toBe(1));
            await connect();
            await act(async () => release());
            expect(lastSocket().closed).toBe(true);
        });

        it('connects to another port, null restores the default', async () => {
            await renderBridge();
            await connectWithAccess();
            const first = lastSocket();
            await act(async () => api.bridge.setPort(48000));
            expect(api.bridge.port).toBe(48000);
            expect(first.closed).toBe(true);
            await vi.waitFor(() => expect(lastSocket().url).toBe('ws://127.0.0.1:48000/v1/ws'));
            await act(async () => api.bridge.setPort(null));
            expect(api.bridge.port).toBe(DASHQL_AGENT_PORT);
        });

        it('closes the connection when it unmounts', async () => {
            await renderBridge();
            await connectWithAccess();
            act(() => root!.unmount());
            root = null;
            expect(lastSocket().closed).toBe(true);
        });
    });

    describe('the harness', () => {
        it('sends no choices by default, the server has its own', async () => {
            await renderBridge();
            await connectWithAccess();
            await startTurn(WORKBOOK_A, 'turn-1', createListener());
            expect(lastSocket().sentWith('agent/request')[0].params).toEqual({ workbook: WORKBOOK_A, prompt: 'do something' });
        });

        it('sends the chosen harness, model and effort', async () => {
            await renderBridge();
            await connectWithAccess();
            await act(async () => {
                api.bridge.setHarness('claude');
                api.bridge.setModel('opus');
                api.bridge.setEffort('high');
            });
            expect([api.bridge.harness, api.bridge.model, api.bridge.effort]).toEqual(['claude', 'opus', 'high']);
            await startTurn(WORKBOOK_A, 'turn-1', createListener());
            expect(lastSocket().sentWith('agent/request')[0].params).toEqual({
                workbook: WORKBOOK_A, prompt: 'do something', harness: 'claude', model: 'opus', effort: 'high',
            });
        });

        it('forgets the model and the effort with another harness, they belong to a harness', async () => {
            await renderBridge();
            await act(async () => {
                api.bridge.setHarness('claude');
                api.bridge.setModel('opus');
                api.bridge.setEffort('high');
            });
            await act(async () => api.bridge.setHarness('claude'));
            expect(api.bridge.model).toBe('opus');
            await act(async () => api.bridge.setHarness('codex'));
            expect([api.bridge.harness, api.bridge.model, api.bridge.effort]).toEqual(['codex', null, null]);
            await act(async () => api.bridge.setHarness(null));
            expect(api.bridge.harness).toBeNull();
        });

        it('restores the defaults with null', async () => {
            await renderBridge();
            await act(async () => { api.bridge.setModel('opus'); api.bridge.setEffort('high'); });
            await act(async () => { api.bridge.setModel(null); api.bridge.setEffort(null); });
            expect([api.bridge.model, api.bridge.effort]).toEqual([null, null]);
        });
    });

    describe('a turn', () => {
        it('follows the status until the answer', async () => {
            await renderBridge();
            await connectWithAccess();
            const listener = createListener();
            await startTurn(WORKBOOK_A, 'turn-1', listener);
            await notify('agent/status', { workbook: WORKBOOK_A, turnId: 'turn-1', state: 'running', text: 'thinking' });
            expect(listener.status).toHaveBeenCalledWith('running', 'thinking');
            await notify('agent/done', { workbook: WORKBOOK_A, turnId: 'turn-1', message: 'all done' });
            expect(listener.done).toHaveBeenCalledWith('all done');
            expect(listener.failed).not.toHaveBeenCalled();
        });

        it('reports a failure and whether it was stopped', async () => {
            await renderBridge();
            await connectWithAccess();
            const listener = createListener();
            await startTurn(WORKBOOK_A, 'turn-1', listener);
            await notify('agent/failed', { workbook: WORKBOOK_A, turnId: 'turn-1', error: 'stopped', cancelled: true });
            expect(listener.failed).toHaveBeenCalledWith('stopped', true);
        });

        it('hears nothing after the turn ended', async () => {
            await renderBridge();
            await connectWithAccess();
            const listener = createListener();
            await startTurn(WORKBOOK_A, 'turn-1', listener);
            await notify('agent/done', { workbook: WORKBOOK_A, turnId: 'turn-1', message: 'all done' });
            await notify('agent/status', { workbook: WORKBOOK_A, turnId: 'turn-1', state: 'running', text: 'late' });
            await notify('agent/done', { workbook: WORKBOOK_A, turnId: 'turn-1', message: 'twice' });
            await notify('agent/failed', { workbook: WORKBOOK_A, turnId: 'turn-1', error: 'late', cancelled: false });
            expect(listener.status).not.toHaveBeenCalled();
            expect(listener.done).toHaveBeenCalledOnce();
            expect(listener.failed).not.toHaveBeenCalled();
        });

        it('keeps the turns apart', async () => {
            await renderBridge();
            await connectWithAccess();
            const [first, second] = [createListener(), createListener()];
            await startTurn(WORKBOOK_A, 'turn-1', first);
            await startTurn(WORKBOOK_A, 'turn-2', second);
            await notify('agent/done', { workbook: WORKBOOK_A, turnId: 'turn-2', message: 'second' });
            expect(second.done).toHaveBeenCalledWith('second');
            expect(first.done).not.toHaveBeenCalled();
            await notify('agent/status', { workbook: WORKBOOK_A, turnId: 'turn-1', state: 'running', text: 'first' });
            expect(first.status).toHaveBeenCalledOnce();
        });

        it('rejects when the server refuses the request', async () => {
            await renderBridge();
            await connectWithAccess();
            const warn = vi.spyOn(api.logger, 'warn');
            let started!: Promise<string>;
            await act(async () => { started = api.bridge.request(WORKBOOK_A, 'do something', createListener()); });
            const failed = expect(started).rejects.toThrow('no harness');
            const request = lastSocket().sentWith('agent/request')[0];
            await act(async () => { lastSocket().receive({ id: request.id, error: { code: 'failed', message: 'no harness' } }); });
            await failed;
            expect(warn).toHaveBeenCalledWith('The agent server refused a request', expect.objectContaining({ error: 'no harness' }), 'agent_bridge');
        });

        it('rejects while the server is not connected', async () => {
            await renderBridge();
            await expect(api.bridge.request(WORKBOOK_A, 'do something', createListener())).rejects.toThrow('not connected');
        });

        it('fails the running turns when the connection is lost', async () => {
            await renderBridge();
            await connectWithAccess();
            const [first, second] = [createListener(), createListener()];
            await startTurn(WORKBOOK_A, 'turn-1', first);
            await startTurn(WORKBOOK_A, 'turn-2', second);
            await act(async () => { lastSocket().readyState = 3; lastSocket().onclose?.({ code: 1006 }); });
            expect(first.failed).toHaveBeenCalledWith('The agent server disconnected', false);
            expect(second.failed).toHaveBeenCalledWith('The agent server disconnected', false);
            // The turns are gone, a later connection hears nothing of them
            await vi.waitFor(() => expect(api.bridge.status).toBe(AgentConnectionStatus.Connecting));
        });

        it('fails the running turns when the port changes, the new server knows nothing of them', async () => {
            await renderBridge();
            await connectWithAccess();
            const listener = createListener();
            await startTurn(WORKBOOK_A, 'turn-1', listener);
            await act(async () => api.bridge.setPort(48000));
            expect(listener.failed).toHaveBeenCalledOnce();
        });

        it('stops the running turns when the agent is turned off', async () => {
            await renderBridge();
            await connectWithAccess();
            const listener = createListener();
            await startTurn(WORKBOOK_A, 'turn-1', listener);
            await act(async () => api.bridge.setEnabled(false));
            expect(listener.failed).toHaveBeenCalledExactlyOnceWith('Agent access was turned off', false);
            expect(lastSocket().sentWith('agent/cancel').map(message => message.params)).toEqual([{ workbook: WORKBOOK_A }]);
        });

        it('stops the running turns of a workbook that the user leaves', async () => {
            await renderBridge();
            await connectWithAccess(WORKBOOK_A);
            const listener = createListener();
            await startTurn(WORKBOOK_A, 'turn-1', listener);
            await show(WORKBOOK_B);
            expect(listener.failed).toHaveBeenCalledExactlyOnceWith('The agent stopped when you left the workbook', false);
            expect(lastSocket().sentWith('agent/cancel').map(message => message.params)).toEqual([{ workbook: WORKBOOK_A }]);
            // The turn is gone, a late answer finds nothing
            await notify('agent/done', { workbook: WORKBOOK_A, turnId: 'turn-1', message: 'late' });
            expect(listener.done).not.toHaveBeenCalled();
            expect(lastSocket().closed).toBe(false);
        });
    });

    describe('commands of the agent', () => {
        const command = async (id: number, workbook: string, name: string, args: unknown) => {
            await act(async () => { lastSocket().receive({ id, method: 'command', params: { workbook, command: name, args } }); });
            await vi.waitFor(() => expect(lastSocket().sent.some(message => message.id === id)).toBe(true));
            return lastSocket().sent.find(message => message.id === id)!;
        };

        it('reads a workbook', async () => {
            await renderBridge();
            await connectWithAccess();
            const reply = await command(901, WORKBOOK_A, 'read', { script: 'query' });
            expect(reply.result.text).toBe('select 1');
        });

        it('tells the agent about a workbook that is not open', async () => {
            await renderBridge();
            await connectWithAccess();
            const warn = vi.spyOn(api.logger, 'warn');
            const reply = await command(902, 'unknown', 'read', { script: 'query' });
            expect(reply.error.code).toBe('not_connected');
            expect(warn).toHaveBeenCalledWith('An agent command failed', expect.objectContaining({ workbookId: 'unknown', command: 'read' }), 'agent_bridge');
        });

        it('tells the turns of the workbook about an edit', async () => {
            await renderBridge();
            await connectWithAccess(WORKBOOK_A);
            const same = createListener();
            await startTurn(WORKBOOK_A, 'turn-1', same);

            const reply = await command(903, WORKBOOK_A, 'edit', { script: 'query', text: 'select 2' });
            expect(reply.error).toBeUndefined();
            const workbook = api.workbooks.workbookScriptsMap.get(WORKBOOK_A)!;
            const script = workbook.scripts[workbook.scriptRefs['query.sql'].scriptId];
            expect(same.edited).toHaveBeenCalledWith(script.scriptKey);
            await vi.waitFor(() => expect(script.scriptSession.getText()).toBe('select 2'));
        });

        it('does not tell a turn that ended about an edit', async () => {
            await renderBridge();
            await connectWithAccess();
            const listener = createListener();
            await startTurn(WORKBOOK_A, 'turn-1', listener);
            await notify('agent/done', { workbook: WORKBOOK_A, turnId: 'turn-1', message: 'done' });
            await command(904, WORKBOOK_A, 'edit', { script: 'query', text: 'select 3' });
            expect(listener.edited).not.toHaveBeenCalled();
        });
    });

    describe('requests to the server', () => {
        it('stops a turn or all turns of a workbook', async () => {
            await renderBridge();
            await connectWithAccess();
            let cancelled!: Promise<unknown>;
            await act(async () => { cancelled = Promise.all([api.bridge.cancel(WORKBOOK_A, 'turn-1'), api.bridge.cancel(WORKBOOK_A)]); });
            const requests = lastSocket().sentWith('agent/cancel');
            expect(requests.map(message => message.params)).toEqual([
                { workbook: WORKBOOK_A, turnId: 'turn-1' },
                { workbook: WORKBOOK_A },
            ]);
            await act(async () => { for (const { id } of requests) lastSocket().receive({ id, result: {} }); });
            await cancelled;
        });

        it('resets the context of a workbook', async () => {
            await renderBridge();
            await connectWithAccess();
            let reset!: Promise<void>;
            await act(async () => { reset = api.bridge.reset(WORKBOOK_A); });
            expect(lastSocket().sentWith('agent/reset')[0].params).toEqual({ workbook: WORKBOOK_A });
            await respond(lastSocket(), 'agent/reset');
            await reset;
        });

        it('asks for the context with the chosen harness', async () => {
            await renderBridge();
            await connectWithAccess();
            let first!: Promise<unknown>;
            await act(async () => { first = api.bridge.context(WORKBOOK_A); });
            await respond(lastSocket(), 'agent/context', { used: 1 });
            expect(await first).toEqual({ used: 1 });
            expect(lastSocket().sentWith('agent/context')[0].params).toEqual({ workbook: WORKBOOK_A });

            await act(async () => api.bridge.setHarness('claude'));
            await act(async () => { void api.bridge.context(WORKBOOK_A).catch(() => null); });
            expect(lastSocket().sentWith('agent/context')[1].params).toEqual({ workbook: WORKBOOK_A, harness: 'claude' });
        });

        it('asks for the info of the server', async () => {
            await renderBridge();
            await connectWithAccess();
            let info!: Promise<unknown>;
            await act(async () => { info = api.bridge.info(); });
            await respond(lastSocket(), 'agent/info', { version: '1' });
            expect(await info).toEqual({ version: '1' });
        });
    });

    describe('a deleted workbook', () => {
        const deleteWorkbook = (workbookId: string) => act(async () => {
            api.setWorkbooks(registry => {
                const workbookScriptsMap = new Map(registry.workbookScriptsMap);
                workbookScriptsMap.delete(workbookId);
                return { ...registry, workbookScriptsMap };
            });
        });

        it('takes its agent state along', async () => {
            await renderBridge();
            await connectWithAccess(WORKBOOK_A);
            const drop = vi.spyOn(api.bridge.questions, 'drop');
            await deleteWorkbook(WORKBOOK_A);
            await vi.waitFor(() => expect(lastSocket().sentWith('agent/forget').map(message => message.params)).toEqual([{ workbook: WORKBOOK_A }]));
            expect(drop).toHaveBeenCalledWith(WORKBOOK_A);
            // The workbook is gone from the announcement
            await vi.waitFor(() => expect(lastSocket().sentWith('client/workbooks').slice(-1)[0].params.workbooks).toEqual([]));
        });

        it('leaves the other workbooks alone', async () => {
            await renderBridge();
            await connectWithAccess(WORKBOOK_A);
            const drop = vi.spyOn(api.bridge.questions, 'drop');
            await deleteWorkbook(WORKBOOK_B);
            expect(drop.mock.calls).toEqual([[WORKBOOK_B]]);
            expect(api.bridge.hasAccess(WORKBOOK_A)).toBe(true);
            expect(lastSocket().closed).toBe(false);
        });

        it('leaves its folder to the server while nothing is connected', async () => {
            await renderBridge();
            const drop = vi.spyOn(api.bridge.questions, 'drop');
            await deleteWorkbook(WORKBOOK_A);
            expect(drop).toHaveBeenCalledWith(WORKBOOK_A);
            expect(sockets().length).toBe(0);
        });

        it('logs when the server cannot forget it', async () => {
            await renderBridge();
            await connectWithAccess(WORKBOOK_B);
            const warn = vi.spyOn(api.logger, 'warn');
            await deleteWorkbook(WORKBOOK_A);
            await vi.waitFor(() => expect(lastSocket().sentWith('agent/forget').length).toBe(1));
            const request = lastSocket().sentWith('agent/forget')[0];
            await act(async () => { lastSocket().receive({ id: request.id, error: { code: 'failed', message: 'locked' } }); });
            await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(
                'Forgetting a deleted workbook in the agent server failed',
                { workbookId: WORKBOOK_A, error: 'locked' },
                'agent_bridge',
            ));
        });
    });

    describe('a browser that cannot reach the server', () => {
        beforeEach(() => {
            Object.defineProperty(navigator, 'userAgent', { value: SAFARI, configurable: true });
        });

        it('never connects and says why', async () => {
            await renderBridge();
            expect(api.bridge.supported).toBe(false);
            await act(async () => api.bridge.setEnabled(true));
            expect(sockets().length).toBe(0);
            await expect(api.bridge.request(WORKBOOK_A, 'hi', createListener())).rejects.toThrow('This browser cannot reach the agent server');
            await expect(api.bridge.context(WORKBOOK_A)).rejects.toThrow('This browser cannot reach the agent server');
            await expect(api.bridge.info()).rejects.toThrow('This browser cannot reach the agent server');
        });

        it('has nothing to stop or reset', async () => {
            await renderBridge();
            await expect(api.bridge.cancel(WORKBOOK_A)).resolves.toBeUndefined();
            await expect(api.bridge.reset(WORKBOOK_A)).resolves.toBeUndefined();
        });
    });
});
