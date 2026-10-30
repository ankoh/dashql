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
import { AgentQuestionStore } from '../session/ai/agent_question_store.js';
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
    /// The harness that runs requests, null for the default harness of the agent server
    harness: string | null;
    /// Pick the harness that runs requests among the configured harnesses, null restores the server's default
    setHarness: (harness: string | null) => void;
    /// The model of the harness that runs requests, null for the harness's own default
    model: string | null;
    /// Pick among the models of the harness, null restores the harness's default
    setModel: (model: string | null) => void;
    /// The effort of the harness that runs requests, null for the harness's own default
    effort: string | null;
    /// Pick among the efforts of the harness, null restores the harness's default
    setEffort: (effort: string | null) => void;
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
    /// Stay connected while no session has agent access, returns the release
    hold: () => () => void;
    /// The questions that the agent answers in the sessions
    questions: AgentQuestionStore;
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
    const harness = config?.settings?.agentHarness ?? null;
    const model = config?.settings?.agentModel ?? null;
    const effort = config?.settings?.agentEffort ?? null;

    // The listeners of the turns by turn id, and the turn ids of the requests of a session
    const turns = React.useRef(new Map<string, AgentTurnListener>());
    const turnsBySession = React.useRef(new Map<string, Set<string>>());
    const [questions] = React.useState(() => new AgentQuestionStore());

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
                const started = performance.now();
                try {
                    const result = await runAgentCommand(commandEnv.current!, params);
                    logger.info('Ran an agent command', { session: params.session, command: params.command, durationMs: String(Math.round(performance.now() - started)) }, LOG_CTX);
                    return result;
                } catch (e: unknown) {
                    logger.warn('An agent command failed', { session: params.session, command: params.command, durationMs: String(Math.round(performance.now() - started)), error: e instanceof Error ? e.message : String(e) }, LOG_CTX);
                    throw e;
                }
            },
            onNotification: notification => {
                switch (notification.method) {
                    case 'agent/status': {
                        const p = notification.params;
                        const turn = turns.current.get(p.turnId);
                        if (turn == null) {
                            logger.info('Ignored the status of an unknown agent turn', { session: p.session, turnId: p.turnId }, LOG_CTX);
                            break;
                        }
                        turn.status(p.state, p.text);
                        break;
                    }
                    case 'agent/done': {
                        const p = notification.params;
                        const turn = turns.current.get(p.turnId);
                        if (turn == null) {
                            logger.info('Ignored the answer of an unknown agent turn', { session: p.session, turnId: p.turnId }, LOG_CTX);
                            break;
                        }
                        forgetTurn(p.session, p.turnId);
                        logger.info('The agent finished a request', { session: p.session, turnId: p.turnId }, LOG_CTX);
                        turn.done(p.message);
                        break;
                    }
                    case 'agent/failed': {
                        const p = notification.params;
                        const turn = turns.current.get(p.turnId);
                        if (turn == null) {
                            logger.info('Ignored the failure of an unknown agent turn', { session: p.session, turnId: p.turnId, error: p.error }, LOG_CTX);
                            break;
                        }
                        forgetTurn(p.session, p.turnId);
                        logger.warn('The agent failed a request', { session: p.session, turnId: p.turnId, error: p.error, cancelled: String(p.cancelled) }, LOG_CTX);
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
    const setHarness = React.useCallback((next: string | null) => {
        logger.info('Changed the harness of the agent', { harness: next ?? 'default' }, LOG_CTX);
        reconfigure(c => {
            if (c == null) return c;
            // The models and efforts are the ones of a harness, another harness starts with its defaults
            const settings = { ...(c.settings ?? {}), agentHarness: next ?? undefined };
            if ((c.settings?.agentHarness ?? null) !== next) {
                settings.agentModel = undefined;
                settings.agentEffort = undefined;
            }
            return { ...c, settings };
        });
    }, [reconfigure, logger]);
    const setModel = React.useCallback((next: string | null) => {
        logger.info('Changed the model of the agent', { model: next ?? 'default' }, LOG_CTX);
        reconfigure(c => c == null ? c : { ...c, settings: { ...(c.settings ?? {}), agentModel: next ?? undefined } });
    }, [reconfigure, logger]);
    const setEffort = React.useCallback((next: string | null) => {
        logger.info('Changed the effort of the agent', { effort: next ?? 'default' }, LOG_CTX);
        reconfigure(c => c == null ? c : { ...c, settings: { ...(c.settings ?? {}), agentEffort: next ?? undefined } });
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

    // A deleted session takes its agent state along: the server stops its turns and removes its folder, its questions
    // and its agent access go. Only a deletion drops a session from the registry. A session deleted while the agent
    // server is not connected leaves its folder, the server removes the folders of unused sessions after a while.
    const knownSessions = React.useRef<ReadonlySet<string>>(new Set());
    const latestAccessSessions = React.useRef(accessSessions);
    latestAccessSessions.current = accessSessions;
    React.useEffect(() => {
        const sessions = new Set(registry.sessionScriptsMap.keys());
        for (const sessionId of knownSessions.current) {
            if (sessions.has(sessionId)) continue;
            logger.info('Forgetting the agent state of a deleted session', { sessionId }, LOG_CTX);
            if (client?.status === AgentConnectionStatus.Connected) {
                client.request('agent/forget', { session: sessionId }).catch((e: unknown) => {
                    logger.warn('Forgetting a deleted session in the agent server failed', { sessionId, error: e instanceof Error ? e.message : String(e) }, LOG_CTX);
                });
            }
            questions.drop(sessionId);
            if (latestAccessSessions.current.includes(sessionId)) setAccess(sessionId, false);
        }
        knownSessions.current = sessions;
    }, [registry.sessionScriptsMap, client, questions, setAccess, logger]);

    const request = React.useCallback(async (sessionId: string, prompt: string, listener: AgentTurnListener) => {
        if (client == null) throw new Error('This browser cannot reach the agent server');
        logger.info('Sending a request to the agent', { session: sessionId, harness: harness ?? 'default', model: model ?? 'default', effort: effort ?? 'default', promptLength: String(prompt.length) }, LOG_CTX);
        const params = {
            session: sessionId,
            prompt,
            ...(harness != null ? { harness } : {}),
            ...(model != null ? { model } : {}),
            ...(effort != null ? { effort } : {}),
        };
        const result = await client.request('agent/request', params).catch((e: unknown) => {
            logger.warn('The agent server refused a request', { session: sessionId, error: e instanceof Error ? e.message : String(e) }, LOG_CTX);
            throw e;
        });
        turns.current.set(result.turnId, listener);
        const sessionTurns = turnsBySession.current.get(sessionId) ?? new Set();
        sessionTurns.add(result.turnId);
        turnsBySession.current.set(sessionId, sessionTurns);
        logger.info('Sent a request to the agent', { session: sessionId, turnId: result.turnId, harness: result.harness }, LOG_CTX);
        return result.turnId;
    }, [client, harness, model, effort, logger]);
    const cancel = React.useCallback(async (sessionId: string, turnId?: string) => {
        logger.info('Stopping agent turns', { session: sessionId, turnId: turnId ?? 'all' }, LOG_CTX);
        await client?.request('agent/cancel', turnId == null ? { session: sessionId } : { session: sessionId, turnId });
    }, [client, logger]);
    const reset = React.useCallback(async (sessionId: string) => {
        logger.info('Resetting the agent context', { session: sessionId }, LOG_CTX);
        await client?.request('agent/reset', { session: sessionId });
    }, [client, logger]);
    const context = React.useCallback(async (sessionId: string) => {
        if (client == null) throw new Error('This browser cannot reach the agent server');
        return client.request('agent/context', { session: sessionId, ...(harness != null ? { harness } : {}) });
    }, [client, harness]);

    const info = React.useCallback(async () => {
        if (client == null) throw new Error('This browser cannot reach the agent server');
        return client.request('agent/info', {});
    }, [client]);

    const bridge = React.useMemo<AgentBridge>(() => ({
        status,
        supported,
        port,
        setPort,
        harness,
        setHarness,
        model,
        setModel,
        effort,
        setEffort,
        accessSessions: stableAccessSessions,
        hasAccess,
        setAccess,
        request,
        cancel,
        reset,
        context,
        info,
        hold,
        questions,
    }), [status, supported, port, setPort, harness, setHarness, model, setModel, effort, setEffort, stableAccessSessions, hasAccess, setAccess, request, cancel, reset, context, info, hold, questions]);

    return <AGENT_BRIDGE_CTX.Provider value={bridge}>{props.children}</AGENT_BRIDGE_CTX.Provider>;
};
