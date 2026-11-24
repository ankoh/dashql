import * as React from 'react';

import { agentSessionFile, createAgentSessionState, parseAgentSessionFile, reduceAgentSessionEvent, type AgentSessionEvent, type AgentSessionState } from '@akohn/dashql/platform/session/agent_session_state';
import type { ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import { stringifyError } from '@akohn/dashql/platform/logger/logger';
import { useOptionalRuntime } from '@akohn/dashql-react/hooks';

import { Store } from '../utils/store.js';
import { useLogger } from '../host/logger_provider.js';
import { useAppFlavor } from '../config/flavor_provider.js';
import { useWorkbookResults } from '../storage/workbook_results_provider.js';
import { agentDocumentTitle, agentSessionOf, isAgentWorking, type AgentSession, type AgentSessionArgs } from './agent_session.js';
import { defaultAgentConnectionIds, isAgentConnectionAllowed, type AgentConnectionChoices } from './agent_connections.js';
import { describeAgentCall, EXIT_FAILED, EXIT_OK, runAgentCommand, type AgentCommandHost, type AgentFollowTarget } from './agent_commands.js';
import { buildAgentPrompt } from './agent_prompt.js';
import { collectReferencedScripts } from './agent_script_references.js';

const LOG_CTX = 'agent';
/// How long the page waits after a change of a conversation before it keeps it, the changes of a step come in bursts
const KEEP_DELAY_MS = 300;

/// What the prompt of a workbook takes: SQL that runs, or a question for the agent
export enum ComposerMode {
    Sql = 'sql',
    Ai = 'ai',
}

/// The harnesses that the desktop app runs
export type AgentHarness = DashQLAgentHarness;

/// The harnesses in the order of their switch
export const AGENT_HARNESSES: { id: AgentHarness; label: string }[] = [
    { id: 'claude', label: 'Claude Code' },
    { id: 'codex', label: 'Codex' },
    { id: 'opencode', label: 'opencode' },
];

/// The key of the mode of the prompt and the harness in the storage of the window
const TAB_PROMPT_KEY = 'dashql.agent_prompt';
/// The key of the connections that the user ticked or unticked for the agent
const TAB_AGENT_CONNECTIONS_KEY = 'dashql.agent_connections';

/// The value of a key in the storage of the window, null without storage or with a broken entry
function readTabJson(key: string): unknown {
    try {
        return JSON.parse(globalThis.sessionStorage?.getItem(key) ?? 'null');
    } catch {
        return null;
    }
}

/// Keep a value under a key in the storage of the window, without storage a reload forgets it
function writeTabJson(key: string, value: unknown): void {
    try {
        globalThis.sessionStorage?.setItem(key, JSON.stringify(value));
    } catch {
        // Without storage, a reload forgets the value
    }
}

/// The mode of the prompt and the harness, as the window left them before a reload
function readTabPrompt(): { mode: ComposerMode; harness: AgentHarness } {
    const stored = readTabJson(TAB_PROMPT_KEY) as { mode?: unknown; harness?: unknown } | null;
    const harness = AGENT_HARNESSES.find(h => h.id === stored?.harness)?.id ?? 'claude';
    return { mode: stored?.mode === ComposerMode.Ai ? ComposerMode.Ai : ComposerMode.Sql, harness };
}

/// The connections that the user ticked or unticked for the agent before a reload
function readTabChoices(): AgentConnectionChoices {
    const stored = readTabJson(TAB_AGENT_CONNECTIONS_KEY);
    if (typeof stored !== 'object' || stored == null) return new Map();
    return new Map(Object.entries(stored).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'));
}

/// A question for the agent
export interface AgentQuestionRequest {
    workbookId: string;
    question: string;
    /// The SQL dialect of the connection of the next script
    dialect: string;
    /// The display names of the scripts of the workbook, the question may reference them
    scriptNames: readonly string[];
}

/// The agent of the prompt: the mode of the prompt, the harness and the connections that the agent may use. Only the
/// desktop app runs agents, the web app tells the user to switch to it.
export interface AgentControls {
    /// Does the app run agents? Only the desktop app does.
    available: boolean;
    mode: ComposerMode;
    setMode: (mode: ComposerMode) => void;
    harness: AgentHarness;
    setHarness: (harness: AgentHarness) => void;
    /// The harnesses and whether the machine has them, empty until the desktop app told
    harnesses: { id: AgentHarness; label: string; available: boolean }[];
    /// May the agent use a connection? The connections of the workbooks until the user ticks or unticks one
    isConnectionAllowed: (connectionId: string) => boolean;
    /// Allow or forbid a connection for the agent
    toggleConnection: (connectionId: string) => void;
    /// Ask the agent a question on a workbook
    ask: (request: AgentQuestionRequest) => void;
    /// Stop the question that runs on a workbook
    stop: (workbookId: string) => void;
    /// Start a new conversation on a workbook: stop its question, forget its questions and the sessions of the harnesses
    reset: (workbookId: string) => void;
}

/// The conversations of the workbooks by workbook id
type Conversations = ReadonlyMap<string, AgentSessionState>;

/// What the page shows of a workbook: the feed follows the agent through it
interface ShownWorkbook {
    follow: (scriptKey: number, target: AgentFollowTarget) => void;
}

interface AgentContext {
    controls: AgentControls;
    conversations: Store<Conversations>;
    /// Register the feed of a shown workbook, returns the unregister
    show: (workbookId: string, shown: ShownWorkbook) => () => void;
}

const AGENT_CTX = React.createContext<AgentContext | null>(null);

/// The bridge of the desktop app to its agents, null in the web app
function agentBridge(): DashQLAgentBridge | null {
    return globalThis.dashqlElectron?.agent ?? null;
}

/// Runs the agents of the desktop app: a question goes to a harness of the machine that the main process runs, its
/// events come back into the conversation of the workbook, and the `dashql` commands of the agent come in as calls that
/// the page answers on the live workbook (docs/design/agent_integration.md). The web app has no agents.
export const AgentProvider: React.FC<React.PropsWithChildren<{ bridge?: DashQLAgentBridge | null }>> = (props) => {
    const logger = useLogger();
    const runtime = useOptionalRuntime();
    const results = useWorkbookResults();
    const bridge = props.bridge !== undefined ? props.bridge : agentBridge();
    const [conversations] = React.useState(() => new Store<Conversations>(new Map()));
    const [prompt, setPrompt] = React.useState(readTabPrompt);
    const updatePrompt = React.useCallback((change: Partial<{ mode: ComposerMode; harness: AgentHarness }>) => {
        setPrompt(prev => {
            const next = { ...prev, ...change };
            if (next.mode === prev.mode && next.harness === prev.harness) return prev;
            writeTabJson(TAB_PROMPT_KEY, next);
            return next;
        });
    }, []);
    // The harness of the running question of a workbook, its events belong to it
    const harnessOf = React.useRef(new Map<string, AgentHarness>());
    const reduce = React.useCallback((workbookId: string, event: AgentSessionEvent) => {
        conversations.update(prev => {
            const next = new Map(prev);
            next.set(workbookId, reduceAgentSessionEvent(prev.get(workbookId) ?? createAgentSessionState(), event, Date.now(), harnessOf.current.get(workbookId) ?? prev.get(workbookId)?.harness ?? null));
            return next;
        });
    }, [conversations]);

    // The desktop app keeps the conversation of a workbook in its folder: the page reads it when it first shows the
    // workbook and keeps every change, a reload shows the conversation that the next question resumes
    const loads = React.useRef(new Map<string, Promise<void>>());
    const kept = React.useRef(new Map<string, AgentSessionState>());
    const keepTimers = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());
    const load = React.useCallback((workbookId: string) => {
        if (bridge == null || loads.current.has(workbookId)) return;
        loads.current.set(workbookId, bridge.readConversation(workbookId).then(value => {
            const read = parseAgentSessionFile(value);
            if (read == null || read.turns.length === 0) return;
            kept.current.set(workbookId, read);
            // A question that started before the read keeps the conversation that the page shows
            conversations.update(prev => prev.has(workbookId) ? prev : new Map(prev).set(workbookId, read));
        }).catch(error => logger.warn('Cannot read the conversation of the agent', { workbookId, error: stringifyError(error) }, LOG_CTX)));
    }, [bridge, conversations, logger]);
    React.useEffect(() => {
        if (bridge == null) return;
        const timers = keepTimers.current;
        const keep = (workbookId: string) => {
            timers.delete(workbookId);
            const state = conversations.current.get(workbookId);
            if (state == null || state === kept.current.get(workbookId) || state.turns.length === 0) return;
            kept.current.set(workbookId, state);
            bridge.writeConversation(workbookId, agentSessionFile(state))
                .catch(error => logger.warn('Cannot keep the conversation of the agent', { workbookId, error: stringifyError(error) }, LOG_CTX));
        };
        const off = conversations.subscribe(() => {
            for (const [workbookId, state] of conversations.current) {
                // A conversation is kept once the page read the kept one, it would replace it else
                const read = loads.current.get(workbookId);
                if (read == null || state === kept.current.get(workbookId) || timers.has(workbookId)) continue;
                timers.set(workbookId, setTimeout(() => void read.then(() => keep(workbookId)), KEEP_DELAY_MS));
            }
        });
        return () => {
            off();
            for (const [workbookId, timer] of timers) {
                clearTimeout(timer);
                keep(workbookId);
            }
        };
    }, [bridge, conversations, logger]);

    // The harnesses of the machine
    const [harnesses, setHarnesses] = React.useState<AgentControls['harnesses']>([]);
    React.useEffect(() => {
        if (bridge == null) return;
        let cancelled = false;
        bridge.info().then(info => {
            if (!cancelled) setHarnesses(info.harnesses);
        }).catch(error => logger.warn('Cannot find the harnesses of the agent', { error: stringifyError(error) }, LOG_CTX));
        return () => { cancelled = true; };
    }, [bridge, logger]);

    // The workbooks that the page shows, the feed of each follows the agent
    const shown = React.useRef(new Map<string, ShownWorkbook[]>());

    // The connections that the shown workbooks use, and the embedded Hyper that post-processes the results of remote
    // scripts: the agent gets only these until the user ticks more, every connection would confuse it
    const [defaultConnectionIds, setDefaultConnectionIds] = React.useState<readonly string[]>([]);
    const defaultConnectionIdsRef = React.useRef(defaultConnectionIds);
    defaultConnectionIdsRef.current = defaultConnectionIds;
    const refreshDefaultConnectionsRef = React.useRef<() => void>(() => { });
    refreshDefaultConnectionsRef.current = () => {
        if (runtime == null) return;
        const next = defaultAgentConnectionIds(
            runtime.store.all('connection') as ReadonlyMap<string, ConnectionState>,
            [...shown.current.keys()].map(workbookId => runtime.store.get('workbook', workbookId)?.connectionIds ?? []),
        );
        setDefaultConnectionIds(prev => prev.length === next.length && prev.every((connectionId, i) => connectionId === next[i]) ? prev : next);
    };
    React.useEffect(() => {
        refreshDefaultConnectionsRef.current();
        if (runtime == null) return;
        const refresh = () => refreshDefaultConnectionsRef.current();
        const workbooks = runtime.store.subscribeKind('workbook', refresh);
        // The app adds the embedded Hyper at the end of its setup
        const connections = runtime.store.subscribeKind('connection', refresh);
        return () => {
            workbooks();
            connections();
        };
    }, [runtime]);
    const show = React.useCallback((workbookId: string, entry: ShownWorkbook) => {
        load(workbookId);
        shown.current.set(workbookId, [...(shown.current.get(workbookId) ?? []), entry]);
        refreshDefaultConnectionsRef.current();
        return () => {
            const rest = (shown.current.get(workbookId) ?? []).filter(other => other !== entry);
            if (rest.length > 0) shown.current.set(workbookId, rest);
            else shown.current.delete(workbookId);
            refreshDefaultConnectionsRef.current();
        };
    }, [load]);
    const [choices, setChoices] = React.useState<AgentConnectionChoices>(readTabChoices);
    const isConnectionAllowed = React.useCallback(
        (connectionId: string) => isAgentConnectionAllowed(connectionId, choices, defaultConnectionIds),
        [choices, defaultConnectionIds],
    );
    const isConnectionAllowedRef = React.useRef(isConnectionAllowed);
    isConnectionAllowedRef.current = isConnectionAllowed;
    const toggleConnection = React.useCallback((connectionId: string) => {
        setChoices(prev => {
            const next = new Map(prev);
            next.set(connectionId, !isAgentConnectionAllowed(connectionId, next, defaultConnectionIdsRef.current));
            writeTabJson(TAB_AGENT_CONNECTIONS_KEY, Object.fromEntries(next));
            return next;
        });
    }, []);

    // The events of the turns and the calls of the `dashql` commands of the agents
    React.useEffect(() => {
        if (bridge == null || runtime == null) return;
        const host: AgentCommandHost = {
            runtime,
            results,
            isConnectionAllowed: connectionId => isConnectionAllowedRef.current(connectionId),
            writeFile: (workbookId, kind, name, data) => bridge.writeFile({ workbookId, kind, name, data }),
            onEdited: (workbookId, fileName) => reduce(workbookId, { event: 'Edited', files: [fileName] }),
            onFollow: (workbookId, scriptKey, target) => {
                for (const entry of shown.current.get(workbookId) ?? []) entry.follow(scriptKey, target);
            },
            logger,
        };
        const calls = new Map<number, AbortController>();
        const offEvent = bridge.onEvent(({ workbookId, event }) => {
            reduce(workbookId, event);
            if (event.event === 'Stop') harnessOf.current.delete(workbookId);
        });
        const offCall = bridge.onCall(call => {
            const controller = new AbortController();
            calls.set(call.callId, controller);
            // The call is a step of the turn, the page tells it better than the shell command that ran it
            const step = { status: describeAgentCall(call), toolUseId: `call:${call.callId}` };
            reduce(call.workbookId, { event: 'PreToolUse', ...step });
            let error = '';
            const reply = {
                out: (text: string) => bridge.reply({ callId: call.callId, out: text }),
                err: (text: string) => {
                    error += text;
                    bridge.reply({ callId: call.callId, err: text });
                },
            };
            logger.info('The agent calls a command', { workbookId: call.workbookId, command: call.command }, LOG_CTX);
            runAgentCommand(host, call, reply, controller.signal)
                .catch(error => {
                    reply.err(`error: ${stringifyError(error)}\n`);
                    return EXIT_FAILED;
                })
                .then(exit => {
                    calls.delete(call.callId);
                    const failure = error.trim().split('\n')[0]?.replace(/^error: /, '') || 'failed';
                    reduce(call.workbookId, { event: 'PostToolUse', ...step, ...(exit !== EXIT_OK ? { error: failure } : {}) });
                    bridge.reply({ callId: call.callId, exit });
                });
        });
        const offCancel = bridge.onCallCancel(callId => calls.get(callId)?.abort());
        return () => {
            offEvent();
            offCall();
            offCancel();
            for (const controller of calls.values()) controller.abort();
        };
    }, [bridge, runtime, results, reduce, logger]);

    const ask = React.useCallback((request: AgentQuestionRequest) => {
        const { workbookId, question } = request;
        const harness = prompt.harness;
        if (bridge == null) return;
        harnessOf.current.set(workbookId, harness);
        const agentPrompt = buildAgentPrompt({
            question,
            dialect: request.dialect,
            referencedScripts: collectReferencedScripts(request.scriptNames, question),
        });
        logger.info('Asking the agent', { workbookId, harness }, LOG_CTX);
        bridge.ask({ workbookId, harness, prompt: agentPrompt, question }).catch(error => {
            // The main process told no event of a question that it did not start
            const open = conversations.current.get(workbookId)?.turns.at(-1);
            if (open == null || open.status == null) reduce(workbookId, { event: 'UserPromptSubmit', prompt: question });
            reduce(workbookId, { event: 'Stop', error: error instanceof Error ? error.message : stringifyError(error) });
            harnessOf.current.delete(workbookId);
        });
    }, [bridge, prompt.harness, logger, reduce, conversations]);
    const stop = React.useCallback((workbookId: string) => {
        bridge?.stop(workbookId).catch(error => logger.warn('Cannot stop the agent', { workbookId, error: stringifyError(error) }, LOG_CTX));
    }, [bridge, logger]);
    const reset = React.useCallback((workbookId: string) => {
        if (bridge == null) return;
        const timer = keepTimers.current.get(workbookId);
        if (timer != null) clearTimeout(timer);
        keepTimers.current.delete(workbookId);
        logger.info('Starting a new conversation of the agent', { workbookId }, LOG_CTX);
        // The page forgets the conversation at once, the Stop of a question that ran ends no turn then
        const forget = () => {
            kept.current.delete(workbookId);
            conversations.update(prev => {
                if (!prev.has(workbookId)) return prev;
                const next = new Map(prev);
                next.delete(workbookId);
                return next;
            });
        };
        forget();
        bridge.forget(workbookId)
            .then(forget)
            .catch(error => logger.warn('Cannot forget the conversation of the agent', { workbookId, error: stringifyError(error) }, LOG_CTX));
    }, [bridge, conversations, logger]);

    // A workbook that the user deleted takes its conversations along
    React.useEffect(() => {
        if (bridge == null || runtime == null) return;
        return runtime.store.subscribe('workbookList', 'root', () => {
            const list = runtime.store.get('workbookList', 'root');
            if (list == null) return;
            const ids = new Set(list.workbooks.map(workbook => workbook.workbookId));
            for (const workbookId of conversations.current.keys()) {
                if (ids.has(workbookId)) continue;
                loads.current.delete(workbookId);
                kept.current.delete(workbookId);
                void bridge.forget(workbookId).catch(() => { });
                conversations.update(prev => {
                    const next = new Map(prev);
                    next.delete(workbookId);
                    return next;
                });
            }
        });
    }, [bridge, runtime, conversations]);

    const controls = React.useMemo<AgentControls>(() => ({
        available: bridge != null,
        mode: prompt.mode,
        setMode: mode => updatePrompt({ mode }),
        harness: prompt.harness,
        setHarness: harness => updatePrompt({ harness }),
        harnesses,
        isConnectionAllowed,
        toggleConnection,
        ask,
        stop,
        reset,
    }), [bridge, prompt, updatePrompt, harnesses, isConnectionAllowed, toggleConnection, ask, stop, reset]);
    const value = React.useMemo<AgentContext>(() => ({ controls, conversations, show }), [controls, conversations, show]);
    return (
        <AGENT_CTX.Provider value={value}>
            <AgentDocumentTitle />
            {props.children}
        </AGENT_CTX.Provider>
    );
};

const NO_SUBSCRIPTION = () => () => { };
const NO_CONVERSATIONS: Conversations = new Map();

/// The conversations of the workbooks
function useConversations(): Conversations {
    const store = React.useContext(AGENT_CTX)?.conversations ?? null;
    return React.useSyncExternalStore(store?.subscribe ?? NO_SUBSCRIPTION, () => store?.current ?? NO_CONVERSATIONS);
}

/// Marks the title of the window while an agent works
const AgentDocumentTitle: React.FC = () => {
    const conversations = useConversations();
    const title = useAppFlavor().displayName;
    const working = [...conversations.values()].some(state => isAgentWorking({ turns: state.turns.map(turn => ({ question: turn })) }));
    const marked = working ? agentDocumentTitle(title, { kind: 'thinking' }) : title;
    React.useEffect(() => {
        if (marked === title) return;
        document.title = marked;
        return () => { document.title = title; };
    }, [title, marked]);
    return null;
};

/// The agent of the prompt, null outside of the provider
export function useAgentControls(): AgentControls | null {
    return React.useContext(AGENT_CTX)?.controls ?? null;
}

/// Does the agent work on a workbook? The editors of its scripts are read-only while it does.
export function useAgentHasControl(workbookId: string | null): boolean {
    const conversations = useConversations();
    const state = workbookId == null ? null : conversations.get(workbookId);
    return state != null && state.turns.some(turn => turn.status != null);
}

/// The conversation of the agent on a workbook for its prompt, null before the first question. The commands of the
/// agent follow it in the feed to the scripts that they edit and run.
export function useAgentSession(args: AgentSessionArgs): AgentSession | null {
    const context = React.useContext(AGENT_CTX);
    const conversations = useConversations();
    const workbookId = args.workbookScripts.workbookId;
    const { followScript, showScript } = args;
    // The feed of the workbook follows the agent
    const followRef = React.useRef(followScript);
    followRef.current = followScript;
    React.useEffect(() => context?.show(workbookId, { follow: (scriptKey, target) => followRef.current(scriptKey, target) }), [context, workbookId]);
    const state = conversations.get(workbookId) ?? null;
    const stop = context?.controls.stop;
    const reset = context?.controls.reset;
    const handlers = React.useMemo(() => ({
        onReset: () => reset?.(workbookId),
        onShowScript: showScript,
        onStop: () => stop?.(workbookId),
    }), [workbookId, showScript, stop, reset]);
    return React.useMemo(
        () => state == null || state.turns.length === 0 ? null : agentSessionOf(workbookId, state, args.workbookScripts, handlers),
        [workbookId, state, args.workbookScripts, handlers],
    );
}

