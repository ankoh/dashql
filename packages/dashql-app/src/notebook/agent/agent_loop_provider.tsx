import * as React from 'react';

import { useAIClient } from '../../platform/ai_client_provider.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import {
    AgentIntent,
    AgentLoopAction,
    AgentLoopState,
    agentLoopIsActive,
    reduceAgentLoop,
} from './agent_loop_state.js';
import { runAgentLoop } from './agent_loop_driver.js';
import { NotebookState } from '../notebook_state.js';
import { ModifyNotebook } from '../notebook_state_registry.js';

const LOG_CTX = 'agent_loop';

/// Arguments to start an agent run for a session.
export interface RunAgentLoopArgs {
    /// The session whose notebook is being edited.
    sessionId: string;
    /// The user's natural-language prompt.
    prompt: string;
    /// The focused script key (context + default in-place target).
    contextScriptKey: number | null;
    /// A manual intent override, or null to auto-classify.
    intentOverride: AgentIntent | null;
    /// The current notebook state (read once at run start).
    notebook: NotebookState;
    /// The notebook dispatch used to apply the result.
    modifyNotebook: ModifyNotebook;
}

export type RunAgentLoop = (args: RunAgentLoopArgs) => void;
export type CancelAgentLoop = (sessionId: string) => void;

interface AgentLoopContextValue {
    states: Map<string, AgentLoopState | null>;
    run: RunAgentLoop;
    cancel: CancelAgentLoop;
}

const AGENT_LOOP_CTX = React.createContext<AgentLoopContextValue | null>(null);

/// Read the observable agent-loop state for a session (null if no run yet / reset).
export function useAgentLoopState(sessionId: string | null): AgentLoopState | null {
    const ctx = React.useContext(AGENT_LOOP_CTX);
    if (ctx == null || sessionId == null) return null;
    return ctx.states.get(sessionId) ?? null;
}

const NOOP_RUN: RunAgentLoop = () => {};
const NOOP_CANCEL: CancelAgentLoop = () => {};

/// Get the agent-run launcher. Returns a no-op when rendered without a provider (e.g. in
/// isolated component tests) so consumers don't need to know about the provider.
export function useRunAgentLoop(): RunAgentLoop {
    return React.useContext(AGENT_LOOP_CTX)?.run ?? NOOP_RUN;
}

/// Get the agent-run canceller. Returns a no-op when rendered without a provider.
export function useCancelAgentLoop(): CancelAgentLoop {
    return React.useContext(AGENT_LOOP_CTX)?.cancel ?? NOOP_CANCEL;
}

/// The map reducer: applies a per-session AgentLoopAction to that session's slot.
type MapAction = { sessionId: string; action: AgentLoopAction };

function reduceMap(prev: Map<string, AgentLoopState | null>, mapAction: MapAction): Map<string, AgentLoopState | null> {
    const next = new Map(prev);
    const cur = prev.get(mapAction.sessionId) ?? null;
    next.set(mapAction.sessionId, reduceAgentLoop(cur, mapAction.action));
    return next;
}

type Props = { children: React.ReactElement };

export const AgentLoopProvider: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const aiClient = useAIClient();
    const [states, dispatchMap] = React.useReducer(reduceMap, new Map<string, AgentLoopState | null>());

    // Mirror the latest states into a ref so the run launcher can read the active run
    // (to abort it) without being re-created on every state change.
    const statesRef = React.useRef(states);
    statesRef.current = states;

    // A monotonically increasing run id across the provider.
    const runIdRef = React.useRef(0);

    const cancel = React.useCallback<CancelAgentLoop>((sessionId) => {
        const cur = statesRef.current.get(sessionId);
        if (cur != null && agentLoopIsActive(cur.phase)) {
            cur.abort.abort();
        }
    }, []);

    const run = React.useCallback<RunAgentLoop>((args) => {
        if (aiClient == null) {
            logger.error('Cannot run agent loop without an AI client', {}, LOG_CTX);
            return;
        }
        // One active run per session: abort any previous one.
        const prev = statesRef.current.get(args.sessionId);
        if (prev != null && agentLoopIsActive(prev.phase)) {
            prev.abort.abort();
        }

        const runId = ++runIdRef.current;
        void runAgentLoop(
            {
                runId,
                prompt: args.prompt,
                contextScriptKey: args.contextScriptKey,
                intentOverride: args.intentOverride,
            },
            {
                aiClient,
                dispatchAgent: (action: AgentLoopAction) => dispatchMap({ sessionId: args.sessionId, action }),
                getNotebook: () => args.notebook,
                modifyNotebook: args.modifyNotebook,
                now: () => Date.now(),
            },
        );
    }, [aiClient, logger]);

    const value = React.useMemo<AgentLoopContextValue>(() => ({ states, run, cancel }), [states, run, cancel]);

    return <AGENT_LOOP_CTX.Provider value={value}>{props.children}</AGENT_LOOP_CTX.Provider>;
};
