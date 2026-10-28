import * as React from 'react';

import { AgentClient, AgentConnectionStatus } from '../../platform/agent/agent_client.js';
import {
    AGENT_WEBSOCKET_PATH,
    type AgentClientSession,
    type AgentServerInfo,
    type AgentSessionContext,
    type AgentTurnState,
} from '../../platform/agent/agent_protocol.js';
import { isDesktopHost } from '../../platform/native_globals.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { DASHQL_AGENT_PORT } from '../../globals.js';
import { useAppConfig, useAppReconfigure } from '../config/app_config.js';
import { useConnectionRegistryStore } from '../connections/connection_registry.js';
import { useQueryExecutor } from '../connections/query_executor.js';
import { useRouteContext } from '../router/router.js';
import { useSessionScriptsDispatch, useSessionScriptsRegistry, useSessionScriptsRegistryReader } from '../session/scripts/session_scripts_registry.js';
import { runAgentCommand, type AgentCommandEnvironment } from './agent_commands.js';

const LOG_CTX = 'agent_bridge';

/// Follows a turn that the page started
export interface AgentTurnListener {
    /// The turn is queued or running, with the latest status line
    status: (state: AgentTurnState, text: string) => void;
    /// The agent wrote a script, every time it edits the script
    edited: (scriptKey: number) => void;
    /// The agent runs a script, every time it runs the script
    ran: (scriptKey: number) => void;
    /// The turn finished with the final message of the agent
    done: (message: string) => void;
    /// The turn failed or was stopped
    failed: (error: string, cancelled: boolean) => void;
}

/// The agent bridge of the page
export interface AgentBridge {
    /// The connection to the agent server
    status: AgentConnectionStatus;
    /// Can this browser reach the agent server? Safari blocks ws://127.0.0.1 from https pages.
    supported: boolean;
    /// The port of the agent server
    port: number;
    /// Connect to the agent server on another port, null restores the build's default
    setPort: (port: number | null) => void;
    /// The sessions with agent access, the name is null while a session is not loaded
    accessSessions: { id: string; name: string | null }[];
    /// Does a session have agent access?
    hasAccess: (sessionId: string) => boolean;
    /// Turn agent access of a session on or off
    setAccess: (sessionId: string, enabled: boolean) => void;
    /// Run the harness with a prompt in a session, resolves with the turn id
    request: (sessionId: string, prompt: string, listener: AgentTurnListener) => Promise<string>;
    /// Stop a turn of a session, or all turns of the session without a turn id
    cancel: (sessionId: string, turnId?: string) => Promise<void>;
    /// Forget the harness context of a session, the next request starts a new harness session
    reset: (sessionId: string) => Promise<void>;
    /// The harness context of a session
    context: (sessionId: string) => Promise<AgentSessionContext>;
    /// The configuration and the state of the agent server
    info: () => Promise<AgentServerInfo>;
    /// Pick the harness that runs requests, one of the configured harnesses
    setDefaultHarness: (harness: string) => Promise<void>;
    /// Stay connected while no session has agent access, returns the release
    hold: () => () => void;
}

const AGENT_BRIDGE_CTX = React.createContext<AgentBridge | null>(null);

/// Provides an agent bridge, the provider below or a fake in tests
export const AgentBridgeContext = AGENT_BRIDGE_CTX;

/// The agent bridge, null outside of the provider
export const useAgentBridge = (): AgentBridge | null => React.useContext(AGENT_BRIDGE_CTX);

/// Does the browser block WebSockets to 127.0.0.1 from https pages?
export function blocksLoopbackWebSockets(userAgent: string, desktop: boolean): boolean {
    if (desktop) return false;
    return /Safari\//.test(userAgent) && !/Chrome\/|Chromium\/|CriOS\/|Edg\/|Firefox\/|FxiOS\//.test(userAgent);
}

const NO_SESSIONS: string[] = [];

export const AgentBridgeProvider: React.FC<React.PropsWithChildren> = (props: React.PropsWithChildren) => {
    const logger = useLogger();
    const config = useAppConfig();
    const reconfigure = useAppReconfigure();
    const route = useRouteContext();
    const [registry] = useSessionScriptsRegistry();
    const readRegistry = useSessionScriptsRegistryReader();
    const modifySessionScripts = useSessionScriptsDispatch();
    const connectionStore = useConnectionRegistryStore();
    const executeQuery = useQueryExecutor();
    const [status, setStatus] = React.useState(AgentConnectionStatus.Off);
    const supported = !blocksLoopbackWebSockets(globalThis.navigator?.userAgent ?? '', isDesktopHost());

    const accessSessions = config?.settings?.agentSessions ?? NO_SESSIONS;
    const port = config?.settings?.agentPort ?? DASHQL_AGENT_PORT;

    // The listeners of the turns by turn id, and the turn ids of the requests of a session
    const turns = React.useRef(new Map<string, AgentTurnListener>());
    const turnsBySession = React.useRef(new Map<string, Set<string>>());

    const commandEnv = React.useRef<AgentCommandEnvironment | null>(null);
    commandEnv.current = {
        sessionScripts: sessionId => readRegistry().sessionScriptsMap.get(sessionId) ?? null,
        modifySessionScripts,
        connections: () => connectionStore.current,
        executeQuery,
        logger,
        onScriptEdited: (sessionId, scriptKey) => {
            for (const turnId of turnsBySession.current.get(sessionId) ?? []) {
                turns.current.get(turnId)?.edited(scriptKey);
            }
        },
        onScriptRun: (sessionId, scriptKey) => {
            for (const turnId of turnsBySession.current.get(sessionId) ?? []) {
                turns.current.get(turnId)?.ran(scriptKey);
            }
        },
    };

    const forgetTurn = React.useCallback((sessionId: string, turnId: string) => {
        turns.current.delete(turnId);
        const sessionTurns = turnsBySession.current.get(sessionId);
        sessionTurns?.delete(turnId);
        if (sessionTurns?.size === 0) turnsBySession.current.delete(sessionId);
    }, []);

    const client = React.useMemo(() => {
        if (!supported) return null;
        return new AgentClient({
            url: `ws://127.0.0.1:${port}${AGENT_WEBSOCKET_PATH}`,
            clientKind: isDesktopHost() ? 'desktop' : 'web',
            logger,
            handleCommand: async params => {
                logger.info('Running an agent command', { session: params.session, command: params.command }, LOG_CTX);
                return runAgentCommand(commandEnv.current!, params);
            },
            onNotification: notification => {
                switch (notification.method) {
                    case 'agent/status': {
                        const p = notification.params;
                        turns.current.get(p.turnId)?.status(p.state, p.text);
                        break;
                    }
                    case 'agent/done': {
                        const p = notification.params;
                        const turn = turns.current.get(p.turnId);
                        if (turn == null) break;
                        forgetTurn(p.session, p.turnId);
                        logger.info('The agent finished a request', { session: p.session, turnId: p.turnId }, LOG_CTX);
                        turn.done(p.message);
                        break;
                    }
                    case 'agent/failed': {
                        const p = notification.params;
                        const turn = turns.current.get(p.turnId);
                        if (turn == null) break;
                        forgetTurn(p.session, p.turnId);
                        logger.warn('The agent failed a request', { session: p.session, turnId: p.turnId, error: p.error }, LOG_CTX);
                        turn.failed(p.error, p.cancelled);
                        break;
                    }
                }
            },
            onStatus: setStatus,
            // A new connection hears nothing of the turns of the old one, the server may have stopped them
            onDisconnect: reason => {
                for (const [turnId, turn] of [...turns.current]) {
                    logger.warn('Lost an agent turn', { turnId, reason }, LOG_CTX);
                    turn.failed(reason, false);
                }
                turns.current.clear();
                turnsBySession.current.clear();
            },
        });
    }, [supported, port, logger, forgetTurn]);
    React.useEffect(() => () => client?.dispose(), [client]);

    // Announce the sessions with agent access and the focused session
    const announced = React.useMemo<AgentClientSession[]>(() => {
        const sessions: AgentClientSession[] = [];
        for (const sessionId of accessSessions) {
            const scripts = registry.sessionScriptsMap.get(sessionId);
            if (scripts != null) sessions.push({ id: sessionId, name: scripts.name ?? '' });
        }
        return sessions;
    }, [accessSessions, registry]);
    const announcedKey = JSON.stringify(announced);
    const focused = route.sessionId ?? null;
    React.useEffect(() => {
        client?.setSessions(announced, focused);
    }, [client, announcedKey, focused]);

    const [holds, setHolds] = React.useState(0);
    React.useEffect(() => {
        client?.setHeld(holds > 0);
    }, [client, holds]);
    const hold = React.useCallback(() => {
        setHolds(n => n + 1);
        return () => setHolds(n => n - 1);
    }, []);

    const setPort = React.useCallback((next: number | null) => {
        logger.info('Changed the port of the agent server', { port: String(next ?? DASHQL_AGENT_PORT) }, LOG_CTX);
        reconfigure(c => c == null ? c : { ...c, settings: { ...(c.settings ?? {}), agentPort: next ?? undefined } });
    }, [reconfigure, logger]);

    const accessSessionList = React.useMemo(
        () => accessSessions.map(id => ({ id, name: registry.sessionScriptsMap.get(id)?.name ?? null })),
        [accessSessions, registry],
    );
    const accessSessionListKey = JSON.stringify(accessSessionList);
    // Keep the identity while the names are unchanged, the registry changes with every edit
    const stableAccessSessions = React.useMemo(() => accessSessionList, [accessSessionListKey]);

    const hasAccess = React.useCallback((sessionId: string) => accessSessions.includes(sessionId), [accessSessions]);
    const setAccess = React.useCallback((sessionId: string, enabled: boolean) => {
        logger.info(enabled ? 'Turned on agent access' : 'Turned off agent access', { sessionId }, LOG_CTX);
        reconfigure(c => {
            if (c == null) return c;
            const current = c.settings?.agentSessions ?? [];
            const agentSessions = enabled
                ? (current.includes(sessionId) ? current : [...current, sessionId])
                : current.filter(id => id !== sessionId);
            return { ...c, settings: { ...(c.settings ?? {}), agentSessions } };
        });
    }, [reconfigure, logger]);

    const request = React.useCallback(async (sessionId: string, prompt: string, listener: AgentTurnListener) => {
        if (client == null) throw new Error('This browser cannot reach the agent server');
        const result = await client.request('agent/request', { session: sessionId, prompt });
        turns.current.set(result.turnId, listener);
        const sessionTurns = turnsBySession.current.get(sessionId) ?? new Set();
        sessionTurns.add(result.turnId);
        turnsBySession.current.set(sessionId, sessionTurns);
        logger.info('Sent a request to the agent', { session: sessionId, turnId: result.turnId, harness: result.harness }, LOG_CTX);
        return result.turnId;
    }, [client, logger]);
    const cancel = React.useCallback(async (sessionId: string, turnId?: string) => {
        await client?.request('agent/cancel', turnId == null ? { session: sessionId } : { session: sessionId, turnId });
    }, [client]);
    const reset = React.useCallback(async (sessionId: string) => {
        await client?.request('agent/reset', { session: sessionId });
    }, [client]);
    const context = React.useCallback(async (sessionId: string) => {
        if (client == null) throw new Error('This browser cannot reach the agent server');
        return client.request('agent/context', { session: sessionId });
    }, [client]);

    const info = React.useCallback(async () => {
        if (client == null) throw new Error('This browser cannot reach the agent server');
        return client.request('agent/info', {});
    }, [client]);
    const setDefaultHarness = React.useCallback(async (harness: string) => {
        if (client == null) throw new Error('This browser cannot reach the agent server');
        await client.request('agent/configure', { defaultHarness: harness });
        logger.info('Changed the default harness', { harness }, LOG_CTX);
    }, [client, logger]);

    const bridge = React.useMemo<AgentBridge>(() => ({
        status,
        supported,
        port,
        setPort,
        accessSessions: stableAccessSessions,
        hasAccess,
        setAccess,
        request,
        cancel,
        reset,
        context,
        info,
        setDefaultHarness,
        hold,
    }), [status, supported, port, setPort, stableAccessSessions, hasAccess, setAccess, request, cancel, reset, context, info, setDefaultHarness, hold]);

    return <AGENT_BRIDGE_CTX.Provider value={bridge}>{props.children}</AGENT_BRIDGE_CTX.Provider>;
};
