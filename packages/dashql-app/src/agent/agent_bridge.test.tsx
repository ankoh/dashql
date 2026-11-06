import * as core from '@ankoh/dashql-core';
import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppConfigProvider, useAppConfig, useAppReconfigure } from '../config/app_config.js';
import { ConnectionRegistry, useConnectionRegistry } from '../connections/connection_registry.js';
import { EXECUTOR_CTX } from '../connections/query_executor.js';
import { DASHQL_AGENT_PORT } from '../globals.js';
import { type Logger } from '../platform/logger/logger.js';
import { LoggerProvider, useLogger } from '../platform/logger/logger_provider.js';
import { TestLogger } from '../platform/logger/test_logger.js';
import { restoreAppState, type RestoredAppState } from '../session/persistence/app_state_loader.js';
import { SessionScriptsRegistryProvider, useSessionScriptsRegistry } from '../session/scripts/session_scripts_registry.js';
import { SessionTestBackend, testSession } from '../storage/session_test_backend.js';
import type { ConnectionEntry, SessionData } from '../storage/storage_backend.js';
import { StorageProvider } from '../storage/storage_provider.js';
import { AgentBridgeProvider, blocksLoopbackWebSockets, useAgentBridge, type AgentBridge, type AgentTurnListener } from './agent_bridge.js';
import { AgentConnectionStatus } from './agent_client.js';
import { AGENT_PROTOCOL_VERSION } from './agent_protocol.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const SESSION_A = '11111111-2222-4333-8444-555555555555';
const SESSION_B = '22222222-3333-4444-8555-666666666666';
const HYPER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const HYPER_PARAMS = { hyper: {} } as SessionData['connections'][number]['params'];
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
    sessions: ReturnType<typeof useSessionScriptsRegistry>[0];
    setSessions: ReturnType<typeof useSessionScriptsRegistry>[1];
}

function Capture(props: { restored: RestoredAppState | null; capture: (api: Api) => void }) {
    const bridge = useAgentBridge()!;
    const logger = useLogger();
    const config = useAppConfig();
    const reconfigure = useAppReconfigure();
    const [sessions, setSessions] = useSessionScriptsRegistry();
    const [, setConnections] = useConnectionRegistry();
    React.useEffect(() => {
        if (props.restored == null) return;
        setConnections(registry => ({
            ...registry,
            connections: props.restored!.connectionStates,
            connectionsByType: props.restored!.connectionStatesByType,
        }));
        setSessions(registry => ({
            ...registry,
            sessionScriptsMap: props.restored!.sessionScripts,
            sessionScriptsByConnection: props.restored!.sessionScriptsByConnection,
        }));
    }, [props.restored, setConnections, setSessions]);
    React.useLayoutEffect(() => {
        props.capture({ bridge, logger, config, reconfigure, sessions, setSessions });
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

    /// The app after the restoration of two sessions with a script each
    async function restoreSessions(): Promise<RestoredAppState> {
        const backend = new SessionTestBackend();
        backend.connections = [{ id: HYPER_ID, params: HYPER_PARAMS } as ConnectionEntry];
        for (const [sessionId, name] of [[SESSION_A, 'Alpha'], [SESSION_B, 'Beta']]) {
            await backend.saveSessionManifest(sessionId, testSession({
                sessionId,
                name,
                connections: [{ connectionId: HYPER_ID, params: HYPER_PARAMS }],
                scripts: [{ name: 'query.sql', connectionId: HYPER_ID }],
            }));
            await backend.saveScript(sessionId, 'query.sql', 'select 1');
        }
        return await restoreAppState(dql, backend, new TestLogger(), () => { });
    }

    async function renderBridge(options: { path?: string; restored?: RestoredAppState | null } = {}) {
        const executor = { execute, cancel: vi.fn(), watchProfile: () => () => { } };
        const restored = options.restored === undefined ? await restoreSessions() : options.restored;
        await act(async () => {
            root!.render(
                <MemoryRouter initialEntries={[options.path ?? '/']}>
                    <LoggerProvider>
                        <AppConfigProvider>
                            <StorageProvider backend={new SessionTestBackend()}>
                                <ConnectionRegistry>
                                    <SessionScriptsRegistryProvider>
                                        <EXECUTOR_CTX.Provider value={executor as never}>
                                            <AgentBridgeProvider>
                                                <Capture restored={restored} capture={next => { api = next; }} />
                                            </AgentBridgeProvider>
                                        </EXECUTOR_CTX.Provider>
                                    </SessionScriptsRegistryProvider>
                                </ConnectionRegistry>
                            </StorageProvider>
                        </AppConfigProvider>
                    </LoggerProvider>
                </MemoryRouter>,
            );
        });
        await vi.waitFor(() => expect(api.config != null).toBe(true));
        if (restored != null) await vi.waitFor(() => expect(api.sessions.sessionScriptsMap.size).toBe(2));
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
    /// Open the socket and take the announced sessions
    async function connect(socket: FakeSocket = lastSocket()) {
        await act(async () => {
            socket.readyState = 1;
            socket.onopen?.({});
        });
        await respond(socket, 'client/sessions');
        await vi.waitFor(() => expect(api.bridge.status).toBe(AgentConnectionStatus.Connected));
    }
    /// Turn on the access of a session and connect
    async function connectWithAccess(sessionId: string = SESSION_A) {
        await act(async () => api.bridge.setAccess(sessionId, true));
        await vi.waitFor(() => expect(sockets().length > 0).toBe(true));
        await connect();
    }
    /// Start a turn and answer its request
    async function startTurn(sessionId: string, turnId: string, listener: AgentTurnListener): Promise<void> {
        let started!: Promise<string>;
        const socket = lastSocket();
        const before = socket.sentWith('agent/request').length;
        await act(async () => { started = api.bridge.request(sessionId, 'do something', listener); });
        await vi.waitFor(() => expect(socket.sentWith('agent/request').length).toBe(before + 1));
        await respond(socket, 'agent/request', { turnId, harness: 'claude' });
        expect(await started).toBe(turnId);
    }
    const notify = (method: string, params: unknown) => act(async () => { lastSocket().receive({ method, params }); });

    describe('the connection', () => {
        it('stays off while no session has agent access', async () => {
            await renderBridge();
            expect(api.bridge.status).toBe(AgentConnectionStatus.Off);
            expect(sockets().length).toBe(0);
            expect(api.bridge.supported).toBe(true);
            expect(api.bridge.port).toBe(DASHQL_AGENT_PORT);
        });

        it('connects once a session has agent access and announces it', async () => {
            await renderBridge();
            await connectWithAccess();
            expect(lastSocket().url).toBe(`ws://127.0.0.1:${DASHQL_AGENT_PORT}/v1/ws`);
            const announcement = lastSocket().sentWith('client/sessions')[0].params;
            expect(announcement.protocol).toBe(AGENT_PROTOCOL_VERSION);
            expect(announcement.client).toBe('web');
            expect(announcement.sessions).toEqual([{ id: SESSION_A, name: 'Alpha' }]);
        });

        it('announces itself as the desktop app there', async () => {
            globalThis.dashqlElectron = { onFlush: () => () => { } } as unknown as DashQLElectronBridge;
            await renderBridge();
            await connectWithAccess();
            expect(lastSocket().sentWith('client/sessions')[0].params.client).toBe('desktop');
        });

        it('announces the focused session of the route, if it has agent access', async () => {
            await renderBridge({ path: `/sessions/${SESSION_A}` });
            await connectWithAccess();
            expect(lastSocket().sentWith('client/sessions')[0].params.focused).toBe(SESSION_A);
        });

        it('does not announce the focused session without agent access', async () => {
            await renderBridge({ path: `/sessions/${SESSION_B}` });
            await connectWithAccess(SESSION_A);
            expect(lastSocket().sentWith('client/sessions')[0].params.focused).toBeNull();
        });

        it('does not announce a session that is not loaded', async () => {
            await renderBridge({ restored: null });
            await act(async () => api.bridge.setAccess(SESSION_A, true));
            expect(sockets().length).toBe(0);
            expect(api.bridge.accessSessions).toEqual([{ id: SESSION_A, name: null }]);
        });

        it('announces sessions again when the access changes', async () => {
            await renderBridge();
            await connectWithAccess(SESSION_A);
            await act(async () => api.bridge.setAccess(SESSION_B, true));
            await vi.waitFor(() => expect(lastSocket().sentWith('client/sessions').length).toBe(2));
            expect(lastSocket().sentWith('client/sessions')[1].params.sessions.map((session: { name: string }) => session.name)).toEqual(['Alpha', 'Beta']);
            expect(sockets().length).toBe(1);
        });

        it('disconnects when the last session loses its agent access', async () => {
            await renderBridge();
            await connectWithAccess();
            await act(async () => api.bridge.setAccess(SESSION_A, false));
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

    describe('agent access', () => {
        it('lists the sessions with their names', async () => {
            await renderBridge();
            await act(async () => api.bridge.setAccess(SESSION_B, true));
            expect(api.bridge.hasAccess(SESSION_B)).toBe(true);
            expect(api.bridge.hasAccess(SESSION_A)).toBe(false);
            expect(api.bridge.accessSessions).toEqual([{ id: SESSION_B, name: 'Beta' }]);
        });

        it('adds a session once', async () => {
            await renderBridge();
            await act(async () => api.bridge.setAccess(SESSION_A, true));
            await act(async () => api.bridge.setAccess(SESSION_A, true));
            expect(api.bridge.accessSessions.length).toBe(1);
        });

        it('keeps the list of sessions while the names are unchanged, the registry changes with every edit', async () => {
            await renderBridge();
            await act(async () => api.bridge.setAccess(SESSION_A, true));
            const list = api.bridge.accessSessions;
            await act(async () => api.setSessions(registry => ({ ...registry })));
            expect(api.bridge.accessSessions).toBe(list);
        });
    });

    describe('the harness', () => {
        it('sends no choices by default, the server has its own', async () => {
            await renderBridge();
            await connectWithAccess();
            await startTurn(SESSION_A, 'turn-1', createListener());
            expect(lastSocket().sentWith('agent/request')[0].params).toEqual({ session: SESSION_A, prompt: 'do something' });
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
            await startTurn(SESSION_A, 'turn-1', createListener());
            expect(lastSocket().sentWith('agent/request')[0].params).toEqual({
                session: SESSION_A, prompt: 'do something', harness: 'claude', model: 'opus', effort: 'high',
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
            await startTurn(SESSION_A, 'turn-1', listener);
            await notify('agent/status', { session: SESSION_A, turnId: 'turn-1', state: 'running', text: 'thinking' });
            expect(listener.status).toHaveBeenCalledWith('running', 'thinking');
            await notify('agent/done', { session: SESSION_A, turnId: 'turn-1', message: 'all done' });
            expect(listener.done).toHaveBeenCalledWith('all done');
            expect(listener.failed).not.toHaveBeenCalled();
        });

        it('reports a failure and whether it was stopped', async () => {
            await renderBridge();
            await connectWithAccess();
            const listener = createListener();
            await startTurn(SESSION_A, 'turn-1', listener);
            await notify('agent/failed', { session: SESSION_A, turnId: 'turn-1', error: 'stopped', cancelled: true });
            expect(listener.failed).toHaveBeenCalledWith('stopped', true);
        });

        it('hears nothing after the turn ended', async () => {
            await renderBridge();
            await connectWithAccess();
            const listener = createListener();
            await startTurn(SESSION_A, 'turn-1', listener);
            await notify('agent/done', { session: SESSION_A, turnId: 'turn-1', message: 'all done' });
            await notify('agent/status', { session: SESSION_A, turnId: 'turn-1', state: 'running', text: 'late' });
            await notify('agent/done', { session: SESSION_A, turnId: 'turn-1', message: 'twice' });
            await notify('agent/failed', { session: SESSION_A, turnId: 'turn-1', error: 'late', cancelled: false });
            expect(listener.status).not.toHaveBeenCalled();
            expect(listener.done).toHaveBeenCalledOnce();
            expect(listener.failed).not.toHaveBeenCalled();
        });

        it('keeps the turns apart', async () => {
            await renderBridge();
            await connectWithAccess();
            const [first, second] = [createListener(), createListener()];
            await startTurn(SESSION_A, 'turn-1', first);
            await startTurn(SESSION_A, 'turn-2', second);
            await notify('agent/done', { session: SESSION_A, turnId: 'turn-2', message: 'second' });
            expect(second.done).toHaveBeenCalledWith('second');
            expect(first.done).not.toHaveBeenCalled();
            await notify('agent/status', { session: SESSION_A, turnId: 'turn-1', state: 'running', text: 'first' });
            expect(first.status).toHaveBeenCalledOnce();
        });

        it('rejects when the server refuses the request', async () => {
            await renderBridge();
            await connectWithAccess();
            const warn = vi.spyOn(api.logger, 'warn');
            let started!: Promise<string>;
            await act(async () => { started = api.bridge.request(SESSION_A, 'do something', createListener()); });
            const failed = expect(started).rejects.toThrow('no harness');
            const request = lastSocket().sentWith('agent/request')[0];
            await act(async () => { lastSocket().receive({ id: request.id, error: { code: 'failed', message: 'no harness' } }); });
            await failed;
            expect(warn).toHaveBeenCalledWith('The agent server refused a request', expect.objectContaining({ error: 'no harness' }), 'agent_bridge');
        });

        it('rejects while the server is not connected', async () => {
            await renderBridge();
            await expect(api.bridge.request(SESSION_A, 'do something', createListener())).rejects.toThrow('not connected');
        });

        it('fails the running turns when the connection is lost', async () => {
            await renderBridge();
            await connectWithAccess();
            const [first, second] = [createListener(), createListener()];
            await startTurn(SESSION_A, 'turn-1', first);
            await startTurn(SESSION_A, 'turn-2', second);
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
            await startTurn(SESSION_A, 'turn-1', listener);
            await act(async () => api.bridge.setPort(48000));
            expect(listener.failed).toHaveBeenCalledOnce();
        });

        it('fails the running turns when the access is turned off', async () => {
            await renderBridge();
            await connectWithAccess();
            const listener = createListener();
            await startTurn(SESSION_A, 'turn-1', listener);
            await act(async () => api.bridge.setAccess(SESSION_A, false));
            expect(listener.failed).toHaveBeenCalledWith('Agent access was turned off', false);
        });
    });

    describe('commands of the agent', () => {
        const command = async (id: number, session: string, name: string, args: unknown) => {
            await act(async () => { lastSocket().receive({ id, method: 'command', params: { session, command: name, args } }); });
            await vi.waitFor(() => expect(lastSocket().sent.some(message => message.id === id)).toBe(true));
            return lastSocket().sent.find(message => message.id === id)!;
        };

        it('reads a session', async () => {
            await renderBridge();
            await connectWithAccess();
            const reply = await command(901, SESSION_A, 'read', { script: 'query' });
            expect(reply.result.text).toBe('select 1');
        });

        it('tells the agent about a session that is not open', async () => {
            await renderBridge();
            await connectWithAccess();
            const warn = vi.spyOn(api.logger, 'warn');
            const reply = await command(902, 'unknown', 'read', { script: 'query' });
            expect(reply.error.code).toBe('not_connected');
            expect(warn).toHaveBeenCalledWith('An agent command failed', expect.objectContaining({ session: 'unknown', command: 'read' }), 'agent_bridge');
        });

        it('tells the turns of the session about an edit, and only those', async () => {
            await renderBridge();
            await connectWithAccess(SESSION_A);
            await act(async () => api.bridge.setAccess(SESSION_B, true));
            const [same, other] = [createListener(), createListener()];
            await startTurn(SESSION_A, 'turn-1', same);
            await startTurn(SESSION_B, 'turn-2', other);

            const reply = await command(903, SESSION_A, 'edit', { script: 'query', text: 'select 2' });
            expect(reply.error).toBeUndefined();
            const session = api.sessions.sessionScriptsMap.get(SESSION_A)!;
            const script = session.scripts[session.scriptRefs['query.sql'].scriptId];
            expect(same.edited).toHaveBeenCalledWith(script.scriptKey);
            expect(other.edited).not.toHaveBeenCalled();
            await vi.waitFor(() => expect(script.scriptSession.getText()).toBe('select 2'));
        });

        it('does not tell a turn that ended about an edit', async () => {
            await renderBridge();
            await connectWithAccess();
            const listener = createListener();
            await startTurn(SESSION_A, 'turn-1', listener);
            await notify('agent/done', { session: SESSION_A, turnId: 'turn-1', message: 'done' });
            await command(904, SESSION_A, 'edit', { script: 'query', text: 'select 3' });
            expect(listener.edited).not.toHaveBeenCalled();
        });
    });

    describe('requests to the server', () => {
        it('stops a turn or all turns of a session', async () => {
            await renderBridge();
            await connectWithAccess();
            let cancelled!: Promise<unknown>;
            await act(async () => { cancelled = Promise.all([api.bridge.cancel(SESSION_A, 'turn-1'), api.bridge.cancel(SESSION_A)]); });
            const requests = lastSocket().sentWith('agent/cancel');
            expect(requests.map(message => message.params)).toEqual([
                { session: SESSION_A, turnId: 'turn-1' },
                { session: SESSION_A },
            ]);
            await act(async () => { for (const { id } of requests) lastSocket().receive({ id, result: {} }); });
            await cancelled;
        });

        it('resets the context of a session', async () => {
            await renderBridge();
            await connectWithAccess();
            let reset!: Promise<void>;
            await act(async () => { reset = api.bridge.reset(SESSION_A); });
            expect(lastSocket().sentWith('agent/reset')[0].params).toEqual({ session: SESSION_A });
            await respond(lastSocket(), 'agent/reset');
            await reset;
        });

        it('asks for the context with the chosen harness', async () => {
            await renderBridge();
            await connectWithAccess();
            let first!: Promise<unknown>;
            await act(async () => { first = api.bridge.context(SESSION_A); });
            await respond(lastSocket(), 'agent/context', { used: 1 });
            expect(await first).toEqual({ used: 1 });
            expect(lastSocket().sentWith('agent/context')[0].params).toEqual({ session: SESSION_A });

            await act(async () => api.bridge.setHarness('claude'));
            await act(async () => { void api.bridge.context(SESSION_A).catch(() => null); });
            expect(lastSocket().sentWith('agent/context')[1].params).toEqual({ session: SESSION_A, harness: 'claude' });
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

    describe('a deleted session', () => {
        const deleteSession = (sessionId: string) => act(async () => {
            api.setSessions(registry => {
                const sessionScriptsMap = new Map(registry.sessionScriptsMap);
                sessionScriptsMap.delete(sessionId);
                return { ...registry, sessionScriptsMap };
            });
        });

        it('takes its agent state along', async () => {
            await renderBridge();
            await connectWithAccess(SESSION_A);
            await act(async () => api.bridge.setAccess(SESSION_B, true));
            const drop = vi.spyOn(api.bridge.questions, 'drop');
            await deleteSession(SESSION_A);
            await vi.waitFor(() => expect(lastSocket().sentWith('agent/forget').map(message => message.params)).toEqual([{ session: SESSION_A }]));
            expect(drop).toHaveBeenCalledWith(SESSION_A);
            await vi.waitFor(() => expect(api.bridge.hasAccess(SESSION_A)).toBe(false));
            expect(api.bridge.hasAccess(SESSION_B)).toBe(true);
        });

        it('leaves the other sessions alone', async () => {
            await renderBridge();
            await connectWithAccess(SESSION_A);
            const drop = vi.spyOn(api.bridge.questions, 'drop');
            await deleteSession(SESSION_B);
            expect(drop.mock.calls).toEqual([[SESSION_B]]);
            expect(api.bridge.hasAccess(SESSION_A)).toBe(true);
            expect(lastSocket().closed).toBe(false);
        });

        it('leaves its folder to the server while nothing is connected', async () => {
            await renderBridge();
            const drop = vi.spyOn(api.bridge.questions, 'drop');
            await deleteSession(SESSION_A);
            expect(drop).toHaveBeenCalledWith(SESSION_A);
            expect(sockets().length).toBe(0);
        });

        it('logs when the server cannot forget it', async () => {
            await renderBridge();
            await connectWithAccess(SESSION_B);
            const warn = vi.spyOn(api.logger, 'warn');
            await deleteSession(SESSION_A);
            await vi.waitFor(() => expect(lastSocket().sentWith('agent/forget').length).toBe(1));
            const request = lastSocket().sentWith('agent/forget')[0];
            await act(async () => { lastSocket().receive({ id: request.id, error: { code: 'failed', message: 'locked' } }); });
            await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(
                'Forgetting a deleted session in the agent server failed',
                { sessionId: SESSION_A, error: 'locked' },
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
            await act(async () => api.bridge.setAccess(SESSION_A, true));
            expect(sockets().length).toBe(0);
            await expect(api.bridge.request(SESSION_A, 'hi', createListener())).rejects.toThrow('This browser cannot reach the agent server');
            await expect(api.bridge.context(SESSION_A)).rejects.toThrow('This browser cannot reach the agent server');
            await expect(api.bridge.info()).rejects.toThrow('This browser cannot reach the agent server');
        });

        it('has nothing to stop or reset', async () => {
            await renderBridge();
            await expect(api.bridge.cancel(SESSION_A)).resolves.toBeUndefined();
            await expect(api.bridge.reset(SESSION_A)).resolves.toBeUndefined();
        });
    });
});
