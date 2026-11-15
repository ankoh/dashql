import * as React from 'react';

import { followAgentSession, parseAgentSessionTarget, type AgentSessionTarget } from '@ankoh/dashql-runtime/session/agent_session_client';
import { Store } from '@ankoh/dashql-runtime/store/store';
import { stringifyError } from '@ankoh/dashql-runtime/platform/logger/logger';
import { usePlatformEventListener } from '../platform/events/event_listener_provider.js';
import { useLogger } from '../platform/logger/logger_provider.js';
import { agentSessionOf, type AgentSession, type AgentSessionArgs, type FollowedAgentSession } from './agent_session.js';
import { ComposerMode, newAgentConnectTarget, type ConnectHarness } from './agent_connect.js';

const LOG_CTX = 'agent_session';

/// The key of the session that the tab follows in the storage of the tab, a reload follows it again
const TAB_STORAGE_KEY = 'dashql.agent_session';
/// The key of the mode of the prompt and the harness of the line to connect in the storage of the tab
const TAB_CONNECT_KEY = 'dashql.agent_connect';
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
}

const FOLLOWED_CTX = React.createContext<Store<FollowedAgentSession | null> | null>(null);
const CONNECT_CTX = React.createContext<AgentConnect | null>(null);

/// Follows the session of the latest link to a session, or of the target that the tab picked for the line of the
/// prompt: the server sends its state with every event of the harness. A server that is not there yet or was lost is
/// tried again until it ends the session.
export const AgentSessionProvider: React.FC<React.PropsWithChildren> = (props) => {
    const appEvents = usePlatformEventListener();
    const logger = useLogger();
    const [store] = React.useState(() => new Store<FollowedAgentSession | null>(null));
    const [target, setTarget] = React.useState<AgentSessionTarget | null>(readTabTarget);
    const [connect, setConnect] = React.useState(readTabConnect);
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
    React.useEffect(() => appEvents?.subscribeAgentSessions(follow), [appEvents, follow]);
    // AI waits on a target, the first switch picks one
    React.useEffect(() => {
        if (connect.mode === ComposerMode.Ai && target == null) follow(newAgentConnectTarget());
    }, [connect.mode, target, follow]);
    React.useEffect(() => {
        store.update(null);
        if (target == null) return;
        const controller = new AbortController();
        const { signal } = controller;
        // A session that the page reaches switches the prompt to AI once, the user may switch back to SQL
        let reached = false;
        const onState = (state: FollowedAgentSession['state']) => {
            store.update({ state, connected: true });
            if (!reached) {
                reached = true;
                updateConnect({ mode: ComposerMode.Ai });
            }
        };
        void (async () => {
            while (!signal.aborted) {
                try {
                    await followAgentSession(target, onState, signal);
                } catch (error) {
                    if (signal.aborted) return;
                    logger.debug('Cannot reach the session of the agent', { endpoint: target.endpoint, error: stringifyError(error) }, LOG_CTX);
                }
                store.update(prev => prev == null ? prev : { ...prev, connected: false });
                // The server ends the stream once the harness ended the session
                if (store.current?.state.ended) return;
                await new Promise(resolve => setTimeout(resolve, RECONNECT_DELAY_MS));
            }
        })();
        return () => controller.abort();
    }, [target, store, logger, updateConnect]);
    const connectValue = React.useMemo<AgentConnect>(() => ({
        mode: connect.mode,
        setMode: mode => updateConnect({ mode }),
        harness: connect.harness,
        setHarness: harness => updateConnect({ harness }),
        target,
        renewTarget: () => follow(newAgentConnectTarget()),
    }), [connect, target, updateConnect, follow]);
    return (
        <FOLLOWED_CTX.Provider value={store}>
            <CONNECT_CTX.Provider value={connectValue}>{props.children}</CONNECT_CTX.Provider>
        </FOLLOWED_CTX.Provider>
    );
};

/// How the prompt connects an agent in the terminal, null outside of the provider
export function useAgentConnect(): AgentConnect | null {
    return React.useContext(CONNECT_CTX);
}

const NO_SUBSCRIPTION = () => () => { };

/// The session that the page follows, null without one or before its server answered
export function useFollowedAgentSession(): FollowedAgentSession | null {
    const store = React.useContext(FOLLOWED_CTX);
    return React.useSyncExternalStore(store?.subscribe ?? NO_SUBSCRIPTION, () => store?.current ?? null);
}

/// The session of an agent for the bar of a workbook, null without one. The feed follows the agent to the latest script
/// it touched while it works.
/// The status line of a shell command that runs scripts with `dashql run`, e.g. `DASHQL_TRINO_PASSWORD=… dashql run tpch`
const DASHQL_RUN = /(^|[\s/])dashql run\b/;

export function useAgentSession(args: AgentSessionArgs): AgentSession | null {
    const followed = useFollowedAgentSession();
    const [dismissed, setDismissed] = React.useState<ReadonlySet<number>>(() => new Set());
    const dismiss = React.useCallback((questionId: number) => setDismissed(prev => new Set(prev).add(questionId)), []);
    const session = React.useMemo(
        () => followed == null ? null : agentSessionOf(followed, args.workbookScripts, dismissed, dismiss, args.showScript),
        [followed, args.workbookScripts, dismissed, dismiss, args.showScript],
    );
    const latest = session?.turns[session.turns.length - 1];
    const followedScript = latest?.question.status != null ? latest.scripts[latest.scripts.length - 1] : undefined;
    const version = followed?.state.version;
    const { followScript } = args;
    React.useEffect(() => {
        if (followedScript == null || latest == null) return;
        followScript(followedScript.scriptKey, DASHQL_RUN.test(latest.question.status ?? '') ? 'result' : 'script');
        // Every event of the agent follows it again
    }, [version]);
    return session;
}
