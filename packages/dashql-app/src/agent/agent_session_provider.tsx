import * as React from 'react';

import {
    followAgentSession,
    parseAgentSessionTarget,
    postAgentSessionRunEvent,
    writeAgentSessionConnections,
    writeAgentSessionResult,
    type AgentSessionTarget,
} from '@akohn/dashql/platform/session/agent_session_client';
import { AgentSessionProtocolError, type AgentSessionOutdated } from '@akohn/dashql/platform/session/agent_session_protocol';
import type { ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import { useOptionalRuntime } from '@akohn/dashql-react/hooks';
import { Store } from '../utils/store.js';
import { stringifyError } from '@akohn/dashql/platform/logger/logger';
import { useLogger } from '../host/logger_provider.js';
import {
    agentDocumentTitle,
    AgentSessionActivity,
    agentSessionActivity,
    agentSessionOf,
    DASHQL_RUN,
    type AgentSession,
    type AgentSessionArgs,
    type FollowedAgentSession,
} from './agent_session.js';
import { ComposerMode, newAgentConnectTarget, type ConnectHarness } from './agent_connect.js';
import { AgentSessionCopies, agentSessionCopyHost } from './agent_session_copy.js';
import { agentConnections, isAgentConnectionAllowed, type AgentConnectionChoices } from './agent_connections.js';
import { useCloudConnectionIds } from '../connections/cloud_connection.js';
import { useAppFlavor } from '../config/flavor_provider.js';
import { AgentSessionRuns, renderScriptChart, sendCachedResult } from './agent_session_runs.js';
import { useQueryResultCache } from '../storage/query_result_cache_provider.js';

const LOG_CTX = 'agent_session';

/// The key of the session that the tab follows in the storage of the tab, a reload follows it again
const TAB_STORAGE_KEY = 'dashql.agent_session';
/// The key of the mode of the prompt and the harness of the line to connect in the storage of the tab
const TAB_CONNECT_KEY = 'dashql.agent_connect';
/// The key of the workbooks that the tab copied into the session on its target, a reload copies them not again
const TAB_COPIES_KEY = 'dashql.agent_session_copies';
/// The key of the connections that the user unticked for the agent of the session of a target
const TAB_AGENT_CONNECTIONS_KEY = 'dashql.agent_session_connections';
/// The time between the attempts to reach a session that the page lost or waits for
const RECONNECT_DELAY_MS = 2000;

function tabStorage(): Storage | null {
    try {
        return globalThis.sessionStorage ?? null;
    } catch {
        return null;
    }
}

/// The session that the tab followed before a reload
function readTabTarget(): AgentSessionTarget | null {
    try {
        const stored = JSON.parse(tabStorage()?.getItem(TAB_STORAGE_KEY) ?? 'null');
        return parseAgentSessionTarget(stored?.endpoint, stored?.token);
    } catch {
        return null;
    }
}

function writeTabTarget(target: AgentSessionTarget): void {
    try {
        tabStorage()?.setItem(TAB_STORAGE_KEY, JSON.stringify(target));
    } catch {
        // Without storage, a reload forgets the session
    }
}

/// The id of the session that a server sends
function sessionIdOf(state: FollowedAgentSession['state']): string {
    return state.id;
}

/// The workbooks that the tab copied into a session on a target before a reload. A new session on the target gets
/// them again.
function readTabCopies(target: AgentSessionTarget, session: string): Set<string> {
    try {
        const stored = JSON.parse(tabStorage()?.getItem(TAB_COPIES_KEY) ?? 'null');
        if (stored?.endpoint !== target.endpoint || stored?.token !== target.token || (stored?.session ?? '') !== session || !Array.isArray(stored.workbooks)) return new Set();
        return new Set(stored.workbooks.filter((id: unknown) => typeof id === 'string'));
    } catch {
        return new Set();
    }
}

function writeTabCopies(target: AgentSessionTarget, session: string, workbooks: Set<string>): void {
    try {
        tabStorage()?.setItem(TAB_COPIES_KEY, JSON.stringify({ ...target, session, workbooks: [...workbooks] }));
    } catch {
        // Without storage, a reload copies again
    }
}

/// The connections that the user ticked or unticked for the agent of the session of a target before a reload
function readTabChoices(target: AgentSessionTarget | null): AgentConnectionChoices {
    if (target == null) return new Map();
    try {
        const stored = JSON.parse(tabStorage()?.getItem(TAB_AGENT_CONNECTIONS_KEY) ?? 'null');
        if (stored?.endpoint !== target.endpoint || stored?.token !== target.token || typeof stored.choices !== 'object' || stored.choices == null) return new Map();
        return new Map(Object.entries(stored.choices).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'));
    } catch {
        return new Map();
    }
}

function writeTabChoices(target: AgentSessionTarget, choices: AgentConnectionChoices): void {
    try {
        tabStorage()?.setItem(TAB_AGENT_CONNECTIONS_KEY, JSON.stringify({ ...target, choices: Object.fromEntries(choices) }));
    } catch {
        // Without storage, a reload forgets what the user ticked
    }
}

/// The mode of the prompt and the harness of the line, as the tab left them before a reload
function readTabConnect(): { mode: ComposerMode; harness: ConnectHarness } {
    let stored: { mode?: unknown; harness?: unknown } | null = null;
    try {
        stored = JSON.parse(tabStorage()?.getItem(TAB_CONNECT_KEY) ?? 'null');
    } catch {
        // A broken entry is forgotten
    }
    return {
        mode: stored?.mode === ComposerMode.Ai ? ComposerMode.Ai : ComposerMode.Sql,
        harness: stored?.harness === 'codex' ? 'codex' : 'claude',
    };
}

function writeTabConnect(value: { mode: ComposerMode; harness: ConnectHarness }): void {
    try {
        tabStorage()?.setItem(TAB_CONNECT_KEY, JSON.stringify(value));
    } catch {
        // Without storage, a reload forgets the mode
    }
}

/// How the prompt connects an agent in the terminal: the mode of the prompt, and in AI the line that launches a harness
/// with the server of its session on the target that the tab waits on
export interface AgentConnect {
    mode: ComposerMode;
    setMode: (mode: ComposerMode) => void;
    /// The harness of the line
    harness: ConnectHarness;
    setHarness: (harness: ConnectHarness) => void;
    /// The server that the tab follows or waits for, null before the first switch to AI
    target: AgentSessionTarget | null;
    /// Wait on a new port and secret, e.g. when the port is taken
    renewTarget: () => void;
    /// The side that is too old when the server of the target answers with a protocol that the page doesn't speak:
    /// the server, then the command runs an older dashql-cli, or the page. Null while the two speak or before an answer.
    outdated: AgentSessionOutdated | null;
    /// May the agent use a connection? Every connection but a cloud until the user ticks or unticks it
    isConnectionAllowed: (connectionId: string) => boolean;
    /// Allow or forbid a connection for the agent
    toggleConnection: (connectionId: string) => void;
}

/// The workbooks that the page shows, a session gets a copy of each once its server answers
interface ShownWorkbooks {
    show: (workbookId: string) => () => void;
}

const FOLLOWED_CTX = React.createContext<Store<FollowedAgentSession | null> | null>(null);
const SHOWN_CTX = React.createContext<ShownWorkbooks | null>(null);
const CONNECT_CTX = React.createContext<AgentConnect | null>(null);

/// Follows the session of the target that the tab picked for the line of the prompt, `dashql connect`: the server sends
/// its state with every event of the harness, and the runs that `dashql run` asks the tab for. A server that is not
/// there yet or was lost is tried again until it ends the session.
export const AgentSessionProvider: React.FC<React.PropsWithChildren> = (props) => {
    const logger = useLogger();
    const runtime = useOptionalRuntime();
    const resultCache = useQueryResultCache();
    const [store] = React.useState(() => new Store<FollowedAgentSession | null>(null));
    const [target, setTarget] = React.useState<AgentSessionTarget | null>(readTabTarget);
    const [connect, setConnect] = React.useState(readTabConnect);
    // The mode decides who has the workbooks: the agent in AI, the user in SQL. The session stays attached in SQL, the
    // tab only holds the changes of the agent and runs nothing for it.
    const userHasControl = connect.mode !== ComposerMode.Ai;
    const userHasControlRef = React.useRef(userHasControl);
    userHasControlRef.current = userHasControl;
    const follow = React.useCallback((next: AgentSessionTarget) => {
        writeTabTarget(next);
        setTarget(next);
    }, []);
    const updateConnect = React.useCallback((change: Partial<{ mode: ComposerMode; harness: ConnectHarness }>) => {
        setConnect(prev => {
            const next = { ...prev, ...change };
            if (next.mode === prev.mode && next.harness === prev.harness) return prev;
            writeTabConnect(next);
            return next;
        });
    }, []);

    // The workbooks that the page shows and the ones that the server of the session got, per target and session: the
    // line runs again on the same port once a harness ended its session. The changes of the agent in the copies come
    // back into the workbooks.
    const shown = React.useRef(new Map<string, number>());
    const copied = React.useRef<{ target: AgentSessionTarget | null; session: string; workbooks: Set<string>; copies: AgentSessionCopies | null }>({ target: null, session: '', workbooks: new Set(), copies: null });
    const copiesOf = React.useCallback((next: AgentSessionTarget, session: string) => {
        if (copied.current.target !== next || copied.current.session !== session) {
            copied.current.copies?.dispose();
            // The catalogs of the connections that the agent may use go into the copies
            const agentConnectionIds = () => runtime == null ? [] : agentConnections(
                runtime.store.all('connection') as ReadonlyMap<string, ConnectionState>,
                runtime.store.get('connectionList', 'root'),
                connectionId => isConnectionAllowedRef.current(connectionId),
            ).allowed.connections.map(connection => connection.connectionId);
            const copies = runtime == null ? null : new AgentSessionCopies(agentSessionCopyHost(runtime, next, agentConnectionIds), logger);
            void copies?.pause(userHasControlRef.current);
            copied.current = { target: next, session, workbooks: readTabCopies(next, session), copies };
        }
        return copied.current;
    }, [runtime, logger]);
    const copyShown = React.useCallback(() => {
        const followed = store.current;
        if (runtime == null || target == null || followed == null || !followed.connected || followed.state.ended) return;
        const session = sessionIdOf(followed.state);
        const { workbooks, copies } = copiesOf(target, session);
        if (copies == null) return;
        for (const workbookId of shown.current.keys()) {
            if (copies.has(workbookId)) continue;
            // Once per session: a copy again would replace what the agent did in the copy meanwhile, also after a
            // reload. A failed copy waits for the next session.
            if (workbooks.has(workbookId)) {
                copies.adopt(workbookId);
                continue;
            }
            workbooks.add(workbookId);
            writeTabCopies(target, session, workbooks);
            copies.copy(workbookId).catch(error => {
                logger.warn('Cannot copy the workbook into the session', { workbook: workbookId, error: stringifyError(error) }, LOG_CTX);
            });
        }
    }, [runtime, target, store, logger, copiesOf]);
    React.useEffect(() => () => {
        // A provider that mounts again (StrictMode) starts with new copies
        copied.current.copies?.dispose();
        copied.current = { target: null, session: '', workbooks: new Set(), copies: null };
    }, []);
    // The connections of the agent, per target. The session gets them once its server answers and after every change.
    const cloudConnectionIds = useCloudConnectionIds();
    const cloudConnectionIdsRef = React.useRef(cloudConnectionIds);
    cloudConnectionIdsRef.current = cloudConnectionIds;
    const [agentSelection, setAgentSelection] = React.useState(() => ({ target, choices: readTabChoices(target) }));
    const choices = agentSelection.target === target ? agentSelection.choices : readTabChoices(target);
    const isConnectionAllowed = React.useCallback(
        (connectionId: string) => isAgentConnectionAllowed(connectionId, choices, cloudConnectionIds),
        [choices, cloudConnectionIds],
    );
    const isConnectionAllowedRef = React.useRef(isConnectionAllowed);
    isConnectionAllowedRef.current = isConnectionAllowed;
    const toggleConnection = React.useCallback((connectionId: string) => {
        if (target == null) return;
        setAgentSelection(prev => {
            const next = new Map(prev.target === target ? prev.choices : readTabChoices(target));
            next.set(connectionId, !isAgentConnectionAllowed(connectionId, next, cloudConnectionIdsRef.current));
            writeTabChoices(target, next);
            return { target, choices: next };
        });
    }, [target]);
    const sentConnections = React.useRef<{ target: AgentSessionTarget | null; text: string | null }>({ target: null, text: null });
    const sendConnections = React.useCallback(() => {
        const followed = store.current;
        if (runtime == null || target == null || followed == null || !followed.connected || followed.state.ended) return;
        const connections = runtime.store.all('connection') as ReadonlyMap<string, ConnectionState>;
        const { allowed } = agentConnections(connections, runtime.store.get('connectionList', 'root'), isConnectionAllowedRef.current);
        const text = JSON.stringify(allowed);
        if (sentConnections.current.target === target && sentConnections.current.text === text) return;
        sentConnections.current = { target, text };
        writeAgentSessionConnections(target, allowed).catch(error => {
            // The next state tries again
            if (sentConnections.current.text === text) sentConnections.current = { target: null, text: null };
            logger.warn('Cannot tell the session the connections of the agent', { error: stringifyError(error) }, LOG_CTX);
        });
    }, [runtime, target, store, logger]);
    React.useEffect(() => sendConnections(), [isConnectionAllowed, sendConnections]);
    React.useEffect(() => {
        if (runtime == null) return;
        const connections = runtime.store.subscribeKind('connection', sendConnections);
        const list = runtime.store.subscribe('connectionList', 'root', sendConnections);
        return () => {
            connections();
            list();
        };
    }, [runtime, sendConnections]);
    const shownValue = React.useMemo<ShownWorkbooks>(() => ({
        show: workbookId => {
            shown.current.set(workbookId, (shown.current.get(workbookId) ?? 0) + 1);
            copyShown();
            return () => {
                const count = (shown.current.get(workbookId) ?? 1) - 1;
                if (count > 0) shown.current.set(workbookId, count);
                else shown.current.delete(workbookId);
            };
        },
    }), [copyShown]);
    // AI waits on a target, the first switch picks one
    React.useEffect(() => {
        if (connect.mode === ComposerMode.Ai && target == null) follow(newAgentConnectTarget());
    }, [connect.mode, target, follow]);
    const [outdated, setOutdated] = React.useState<AgentSessionOutdated | null>(null);
    React.useEffect(() => {
        store.update(null);
        setOutdated(null);
        if (target == null) return;
        const controller = new AbortController();
        const { signal } = controller;
        // A session that the page reaches switches the prompt to AI once, the user may switch back to SQL
        let reached: string | null = null;
        // The copies of the session that the server runs, a new server on the target runs a new session
        let copies: AgentSessionCopies | null = null;
        // The runs that dashql run asks for, once the changes of the agent are in the workbooks
        const runs = runtime == null ? null : new AgentSessionRuns({
            runtime,
            settled: async () => await copies?.settled(),
            isConnectionAllowed: connectionId => isConnectionAllowedRef.current(connectionId),
            paused: () => userHasControlRef.current,
            send: (runId, event) => postAgentSessionRunEvent(target, runId, event),
            writeResult: key => sendCachedResult(resultCache, key, data => writeAgentSessionResult(target, key, data)),
            renderChart: (workbookId, script, table, size) => renderScriptChart(runtime, workbookId, script, table, size),
        }, logger);
        const onState = (state: FollowedAgentSession['state']) => {
            const session = sessionIdOf(state);
            copies = copiesOf(target, session).copies;
            setOutdated(null);
            store.update({ state, connected: true });
            // The copies never end the stream of the session
            try {
                copyShown();
                sendConnections();
                void copies?.update(state);
                // An ended session takes no edits of the page
                if (state.ended) copies?.dispose();
            } catch (error) {
                logger.warn('Cannot follow the copies of the session', { error: stringifyError(error) }, LOG_CTX);
            }
            if (reached !== session && !state.ended) {
                reached = session;
                updateConnect({ mode: ComposerMode.Ai });
            }
        };
        void (async () => {
            let warned: AgentSessionOutdated | null = null;
            while (!signal.aborted) {
                try {
                    await followAgentSession(target, onState, signal, message => runs?.handle(message));
                } catch (error) {
                    if (signal.aborted) return;
                    if (error instanceof AgentSessionProtocolError) {
                        // The page keeps trying, the user may run the command of a newer dashql-cli on the same port
                        if (warned !== error.outdated) logger.warn('The session of the agent speaks another protocol', { endpoint: target.endpoint, error: error.message }, LOG_CTX);
                        warned = error.outdated;
                        setOutdated(error.outdated);
                    } else {
                        logger.debug('Cannot reach the session of the agent', { endpoint: target.endpoint, error: stringifyError(error) }, LOG_CTX);
                    }
                }
                store.update(prev => prev == null ? prev : { ...prev, connected: false });
                // A server that answers again gets the connections again
                sentConnections.current = { target: null, text: null };
                // The server ends the stream once the harness ended the session. The page keeps trying: the line of
                // the prompt runs the next session on the same port, with either harness.
                await new Promise(resolve => setTimeout(resolve, RECONNECT_DELAY_MS));
            }
        })();
        return () => {
            controller.abort();
            runs?.dispose();
        };
    }, [target, store, logger, runtime, resultCache, updateConnect, copyShown, copiesOf, sendConnections]);
    // The changes of the agent wait while the user has the workbooks, and come in when the agent gets them back
    React.useEffect(() => {
        void copied.current.copies?.pause(userHasControl);
    }, [userHasControl, target]);
    const connectValue = React.useMemo<AgentConnect>(() => ({
        mode: connect.mode,
        setMode: mode => updateConnect({ mode }),
        harness: connect.harness,
        setHarness: harness => updateConnect({ harness }),
        target,
        renewTarget: () => follow(newAgentConnectTarget()),
        outdated,
        isConnectionAllowed,
        toggleConnection,
    }), [connect, target, updateConnect, follow, isConnectionAllowed, toggleConnection, outdated]);
    return (
        <FOLLOWED_CTX.Provider value={store}>
            <SHOWN_CTX.Provider value={shownValue}>
                <CONNECT_CTX.Provider value={connectValue}>
                    <AgentDocumentTitle />
                    {props.children}
                </CONNECT_CTX.Provider>
            </SHOWN_CTX.Provider>
        </FOLLOWED_CTX.Provider>
    );
};

/// Marks the title of the browser tab while the agent of the followed session works or waits for the user
const AgentDocumentTitle: React.FC = () => {
    const followed = useFollowedAgentSession();
    const title = useAppFlavor().displayName;
    const activity = followed == null || !followed.connected ? AgentSessionActivity.Idle : agentSessionActivity(followed.state);
    React.useEffect(() => {
        if (activity === AgentSessionActivity.Idle) return;
        document.title = agentDocumentTitle(title, activity);
        return () => { document.title = title; };
    }, [title, activity]);
    return null;
};

/// How the prompt connects an agent in the terminal, null outside of the provider
export function useAgentConnect(): AgentConnect | null {
    return React.useContext(CONNECT_CTX);
}

/// Does the agent of a session have the workbooks? It does while the prompt is in AI and a session that did not end
/// follows the tab; the editors of the scripts are read-only then, the user switches to SQL to edit them.
export function useAgentHasControl(): boolean {
    const connect = useAgentConnect();
    const followed = useFollowedAgentSession();
    return connect?.mode === ComposerMode.Ai && followed != null && followed.connected && !followed.state.ended;
}

const NO_SUBSCRIPTION = () => () => { };
const NO_TURNS: ReadonlySet<number> = new Set();

/// The session that the page follows, null without one or before its server answered
export function useFollowedAgentSession(): FollowedAgentSession | null {
    const store = React.useContext(FOLLOWED_CTX);
    return React.useSyncExternalStore(store?.subscribe ?? NO_SUBSCRIPTION, () => store?.current ?? null);
}

/// The session of an agent for the bar of a workbook, null without one. The feed follows the agent to the latest script
/// it touched while it works.
export function useAgentSession(args: AgentSessionArgs): AgentSession | null {
    const followed = useFollowedAgentSession();
    // The session gets a copy of the workbook that the page shows
    const shown = React.useContext(SHOWN_CTX);
    const workbookId = args.workbookScripts.workbookId;
    React.useEffect(() => shown?.show(workbookId), [shown, workbookId]);
    // The turns that the user dismissed, of the session that the page follows: a new session counts its turns from 1
    const sessionId = followed == null ? null : followed.state.id;
    const [dismissedOf, setDismissed] = React.useState<{ session: string | null; turns: ReadonlySet<number> }>(() => ({ session: sessionId, turns: new Set() }));
    const dismissed = dismissedOf.session === sessionId ? dismissedOf.turns : NO_TURNS;
    const dismiss = React.useCallback((questionId: number) => setDismissed(prev => ({
        session: sessionId,
        turns: new Set(prev.session === sessionId ? prev.turns : []).add(questionId),
    })), [sessionId]);
    const session = React.useMemo(
        () => followed == null ? null : agentSessionOf(followed, args.workbookScripts, dismissed, dismiss, args.showScript),
        [followed, args.workbookScripts, dismissed, dismiss, args.showScript],
    );
    const latest = session?.turns[session.turns.length - 1];
    const followedScript = latest?.question.status != null ? latest.scripts[latest.scripts.length - 1] : undefined;
    const version = followed?.state.version;
    const followedKey = followedScript?.scriptKey;
    const { followScript } = args;
    const followLatest = React.useEffectEvent(() => {
        if (followedScript == null || latest == null) return;
        followScript(followedScript.scriptKey, DASHQL_RUN.test(latest.question.status ?? '') ? 'result' : 'script');
    });
    // Every event of the agent follows it again, and a new script of the agent once the tab created it: the state that
    // names its file comes before the tab took the file
    React.useEffect(() => followLatest(), [version, followedKey]);
    return session;
}
