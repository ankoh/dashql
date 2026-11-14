import * as React from 'react';

import { AgentClient, AgentConnectionStatus } from './agent_client.js';
import {
    AGENT_WEBSOCKET_PATH,
    type AgentClientWorkbook,
    type AgentServerInfo,
    type AgentWorkbookContext,
    type AgentTurnState,
} from './agent_protocol.js';
import { isDesktopHost } from '../platform/native_globals.js';
import { useLogger } from '../platform/logger/logger_provider.js';
import { DASHQL_AGENT_PORT } from '../globals.js';
import { useAppConfig, useAppReconfigure } from '../config/app_config.js';
import { useConnectionRegistryStore } from '../connections/connection_registry.js';
import { useEmbeddedConnection } from '../connections/embedded_connection.js';
import { useQueryExecutor } from '../connections/query_executor.js';
import { useRouteContext } from '../app/router/router.js';
import { AgentQuestionStore } from './agent_question_store.js';
import { useWorkbookScriptsDispatch, useWorkbookScriptsRegistry, useWorkbookScriptsRegistryReader } from '../workbook/scripts/workbook_scripts_registry.js';
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
    /// The workbooks with agent access, the name is null while a workbook is not loaded
    accessWorkbooks: { id: string; name: string | null }[];
    /// Does a workbook have agent access?
    hasAccess: (workbookId: string) => boolean;
    /// Turn agent access of a workbook on or off
    setAccess: (workbookId: string, enabled: boolean) => void;
    /// Run the harness with a prompt in a workbook, resolves with the turn id
    request: (workbookId: string, prompt: string, listener: AgentTurnListener) => Promise<string>;
    /// Stop a turn of a workbook, or all turns of the workbook without a turn id
    cancel: (workbookId: string, turnId?: string) => Promise<void>;
    /// Forget the harness context of a workbook, the next request starts a new harness session
    reset: (workbookId: string) => Promise<void>;
    /// The harness context of a workbook
    context: (workbookId: string) => Promise<AgentWorkbookContext>;
    /// The configuration and the state of the agent server
    info: () => Promise<AgentServerInfo>;
    /// Stay connected while no workbook has agent access, returns the release
    hold: () => () => void;
    /// The questions that the agent answers in the workbooks
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

const NO_WORKBOOKS: string[] = [];

export const AgentBridgeProvider: React.FC<React.PropsWithChildren> = (props: React.PropsWithChildren) => {
    const logger = useLogger();
    const config = useAppConfig();
    const reconfigure = useAppReconfigure();
    const route = useRouteContext();
    const [registry] = useWorkbookScriptsRegistry();
    const readRegistry = useWorkbookScriptsRegistryReader();
    const modifyWorkbookScripts = useWorkbookScriptsDispatch();
    const connectionStore = useConnectionRegistryStore();
    const embeddedConnection = useEmbeddedConnection();
    const executeQuery = useQueryExecutor();
    const [status, setStatus] = React.useState(AgentConnectionStatus.Off);
    const supported = !blocksLoopbackWebSockets(globalThis.navigator?.userAgent ?? '', isDesktopHost());

    const accessWorkbooks = config?.settings?.agentWorkbooks ?? NO_WORKBOOKS;
    const port = config?.settings?.agentPort ?? DASHQL_AGENT_PORT;
    const harness = config?.settings?.agentHarness ?? null;
    const model = config?.settings?.agentModel ?? null;
    const effort = config?.settings?.agentEffort ?? null;

    // The listeners of the turns by turn id, and the turn ids of the requests of a workbook
    const turns = React.useRef(new Map<string, AgentTurnListener>());
    const turnsByWorkbook = React.useRef(new Map<string, Set<string>>());
    const [questions] = React.useState(() => new AgentQuestionStore());

    const commandEnv = React.useRef<AgentCommandEnvironment | null>(null);
    commandEnv.current = {
        workbookScripts: workbookId => readRegistry().workbookScriptsMap.get(workbookId) ?? null,
        modifyWorkbookScripts,
        connections: () => connectionStore.current,
        embeddedConnection,
        executeQuery,
        logger,
        onScriptEdited: (workbookId, scriptKey) => {
            for (const turnId of turnsByWorkbook.current.get(workbookId) ?? []) {
                turns.current.get(turnId)?.edited(scriptKey);
            }
        },
        onScriptRun: (workbookId, scriptKey) => {
            for (const turnId of turnsByWorkbook.current.get(workbookId) ?? []) {
                turns.current.get(turnId)?.ran(scriptKey);
            }
        },
    };

    const forgetTurn = React.useCallback((workbookId: string, turnId: string) => {
        turns.current.delete(turnId);
        const workbookTurns = turnsByWorkbook.current.get(workbookId);
        workbookTurns?.delete(turnId);
        if (workbookTurns?.size === 0) turnsByWorkbook.current.delete(workbookId);
    }, []);

    const client = React.useMemo(() => {
        if (!supported) return null;
        return new AgentClient({
            url: `ws://127.0.0.1:${port}${AGENT_WEBSOCKET_PATH}`,
            clientKind: isDesktopHost() ? 'desktop' : 'web',
            logger,
            handleCommand: async params => {
                logger.info('Running an agent command', { workbookId: params.workbook, command: params.command }, LOG_CTX);
                const started = performance.now();
                try {
                    const result = await runAgentCommand(commandEnv.current!, params);
                    logger.info('Ran an agent command', { workbookId: params.workbook, command: params.command, durationMs: String(Math.round(performance.now() - started)) }, LOG_CTX);
                    return result;
                } catch (e: unknown) {
                    logger.warn('An agent command failed', { workbookId: params.workbook, command: params.command, durationMs: String(Math.round(performance.now() - started)), error: e instanceof Error ? e.message : String(e) }, LOG_CTX);
                    throw e;
                }
            },
            onNotification: notification => {
                switch (notification.method) {
                    case 'agent/status': {
                        const p = notification.params;
                        const turn = turns.current.get(p.turnId);
                        if (turn == null) {
                            logger.info('Ignored the status of an unknown agent turn', { workbookId: p.workbook, turnId: p.turnId }, LOG_CTX);
                            break;
                        }
                        turn.status(p.state, p.text);
                        break;
                    }
                    case 'agent/done': {
                        const p = notification.params;
                        const turn = turns.current.get(p.turnId);
                        if (turn == null) {
                            logger.info('Ignored the answer of an unknown agent turn', { workbookId: p.workbook, turnId: p.turnId }, LOG_CTX);
                            break;
                        }
                        forgetTurn(p.workbook, p.turnId);
                        logger.info('The agent finished a request', { workbookId: p.workbook, turnId: p.turnId }, LOG_CTX);
                        turn.done(p.message);
                        break;
                    }
                    case 'agent/failed': {
                        const p = notification.params;
                        const turn = turns.current.get(p.turnId);
                        if (turn == null) {
                            logger.info('Ignored the failure of an unknown agent turn', { workbookId: p.workbook, turnId: p.turnId, error: p.error }, LOG_CTX);
                            break;
                        }
                        forgetTurn(p.workbook, p.turnId);
                        logger.warn('The agent failed a request', { workbookId: p.workbook, turnId: p.turnId, error: p.error, cancelled: String(p.cancelled) }, LOG_CTX);
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
                turnsByWorkbook.current.clear();
            },
        });
    }, [supported, port, logger, forgetTurn]);
    React.useEffect(() => () => client?.dispose(), [client]);

    // Announce the workbooks with agent access and the focused workbook
    const announced = React.useMemo<AgentClientWorkbook[]>(() => {
        const workbooks: AgentClientWorkbook[] = [];
        for (const workbookId of accessWorkbooks) {
            const scripts = registry.workbookScriptsMap.get(workbookId);
            if (scripts != null) workbooks.push({ id: workbookId, name: scripts.name ?? '' });
        }
        return workbooks;
    }, [accessWorkbooks, registry]);
    const announcedKey = JSON.stringify(announced);
    const focused = route.workbookId ?? null;
    React.useEffect(() => {
        client?.setWorkbooks(announced, focused);
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

    const accessWorkbookList = React.useMemo(
        () => accessWorkbooks.map(id => ({ id, name: registry.workbookScriptsMap.get(id)?.name ?? null })),
        [accessWorkbooks, registry],
    );
    const accessWorkbookListKey = JSON.stringify(accessWorkbookList);
    // Keep the identity while the names are unchanged, the registry changes with every edit
    const stableAccessWorkbooks = React.useMemo(() => accessWorkbookList, [accessWorkbookListKey]);

    const hasAccess = React.useCallback((workbookId: string) => accessWorkbooks.includes(workbookId), [accessWorkbooks]);
    const setAccess = React.useCallback((workbookId: string, enabled: boolean) => {
        logger.info(enabled ? 'Turned on agent access' : 'Turned off agent access', { workbookId }, LOG_CTX);
        reconfigure(c => {
            if (c == null) return c;
            const current = c.settings?.agentWorkbooks ?? [];
            const agentWorkbooks = enabled
                ? (current.includes(workbookId) ? current : [...current, workbookId])
                : current.filter(id => id !== workbookId);
            return { ...c, settings: { ...(c.settings ?? {}), agentWorkbooks } };
        });
    }, [reconfigure, logger]);

    // A deleted workbook takes its agent state along: the server stops its turns and removes its folder, its questions
    // and its agent access go. Only a deletion drops a workbook from the registry. A workbook deleted while the agent
    // server is not connected leaves its folder, the server removes the folders of unused workbooks after a while.
    const knownWorkbooks = React.useRef<ReadonlySet<string>>(new Set());
    const latestAccessWorkbooks = React.useRef(accessWorkbooks);
    latestAccessWorkbooks.current = accessWorkbooks;
    React.useEffect(() => {
        const workbooks = new Set(registry.workbookScriptsMap.keys());
        for (const workbookId of knownWorkbooks.current) {
            if (workbooks.has(workbookId)) continue;
            logger.info('Forgetting the agent state of a deleted workbook', { workbookId }, LOG_CTX);
            if (client?.status === AgentConnectionStatus.Connected) {
                client.request('agent/forget', { workbook: workbookId }).catch((e: unknown) => {
                    logger.warn('Forgetting a deleted workbook in the agent server failed', { workbookId, error: e instanceof Error ? e.message : String(e) }, LOG_CTX);
                });
            }
            questions.drop(workbookId);
            if (latestAccessWorkbooks.current.includes(workbookId)) setAccess(workbookId, false);
        }
        knownWorkbooks.current = workbooks;
    }, [registry.workbookScriptsMap, client, questions, setAccess, logger]);

    const request = React.useCallback(async (workbookId: string, prompt: string, listener: AgentTurnListener) => {
        if (client == null) throw new Error('This browser cannot reach the agent server');
        logger.info('Sending a request to the agent', { workbookId: workbookId, harness: harness ?? 'default', model: model ?? 'default', effort: effort ?? 'default', promptLength: String(prompt.length) }, LOG_CTX);
        const params = {
            workbook: workbookId,
            prompt,
            ...(harness != null ? { harness } : {}),
            ...(model != null ? { model } : {}),
            ...(effort != null ? { effort } : {}),
        };
        const result = await client.request('agent/request', params).catch((e: unknown) => {
            logger.warn('The agent server refused a request', { workbookId: workbookId, error: e instanceof Error ? e.message : String(e) }, LOG_CTX);
            throw e;
        });
        turns.current.set(result.turnId, listener);
        const workbookTurns = turnsByWorkbook.current.get(workbookId) ?? new Set();
        workbookTurns.add(result.turnId);
        turnsByWorkbook.current.set(workbookId, workbookTurns);
        logger.info('Sent a request to the agent', { workbookId: workbookId, turnId: result.turnId, harness: result.harness }, LOG_CTX);
        return result.turnId;
    }, [client, harness, model, effort, logger]);
    const cancel = React.useCallback(async (workbookId: string, turnId?: string) => {
        logger.info('Stopping agent turns', { workbookId: workbookId, turnId: turnId ?? 'all' }, LOG_CTX);
        await client?.request('agent/cancel', turnId == null ? { workbook: workbookId } : { workbook: workbookId, turnId });
    }, [client, logger]);
    const reset = React.useCallback(async (workbookId: string) => {
        logger.info('Resetting the agent context', { workbookId: workbookId }, LOG_CTX);
        await client?.request('agent/reset', { workbook: workbookId });
    }, [client, logger]);
    const context = React.useCallback(async (workbookId: string) => {
        if (client == null) throw new Error('This browser cannot reach the agent server');
        return client.request('agent/context', { workbook: workbookId, ...(harness != null ? { harness } : {}) });
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
        accessWorkbooks: stableAccessWorkbooks,
        hasAccess,
        setAccess,
        request,
        cancel,
        reset,
        context,
        info,
        hold,
        questions,
    }), [status, supported, port, setPort, harness, setHarness, model, setModel, effort, setEffort, stableAccessWorkbooks, hasAccess, setAccess, request, cancel, reset, context, info, hold, questions]);

    return <AGENT_BRIDGE_CTX.Provider value={bridge}>{props.children}</AGENT_BRIDGE_CTX.Provider>;
};
