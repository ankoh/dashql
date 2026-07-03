import * as React from 'react';

import { useAIClient } from '../../platform/ai_client_provider.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import {
    AGENT_START,
    AgentIntent,
    AgentRunAction,
    AgentRunState,
    agentRunIsActive,
    reduceAgentRun,
} from './agent_run_state.js';
import { startAgentRun } from './agent_run_driver.js';
import { NotebookState, REGISTER_AGENT_RUN } from '../notebook_state.js';
import { ModifyNotebook } from '../notebook_state_registry.js';

const LOG_CTX = 'agent_run';

/// Arguments to start an agent run for a session.
export interface StartAgentRunArgs {
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

export type StartAgentRun = (args: StartAgentRunArgs) => void;
export type CancelAgentRun = (sessionId: string) => void;

interface AgentRunContextValue {
    /// All runs keyed by their global run id (active + finished), mirroring the query registry.
    runs: Map<number, AgentRunState>;
    /// The latest run id per session, used to resolve the session's current/last run.
    latestRunBySession: Map<string, number>;
    run: StartAgentRun;
    cancel: CancelAgentRun;
}

const AGENT_RUN_CTX = React.createContext<AgentRunContextValue | null>(null);

/// Resolve an agent run by its id (null if unknown). Mirrors useQueryState: the notebook stores
/// a run-id handle (ScriptData.latestAgentRunId) and this resolves it to the full run state.
export function useAgentRunState(runId: number | null): AgentRunState | null {
    const ctx = React.useContext(AGENT_RUN_CTX);
    if (ctx == null || runId == null) return null;
    return ctx.runs.get(runId) ?? null;
}

/// Read the latest agent-run state for a session (null if no run yet / reset). Backed by the
/// per-session index over the run registry; used by the compose bar to toggle send↔stop.
export function useLatestAgentRunState(sessionId: string | null): AgentRunState | null {
    const ctx = React.useContext(AGENT_RUN_CTX);
    if (ctx == null || sessionId == null) return null;
    const runId = ctx.latestRunBySession.get(sessionId);
    return runId != null ? ctx.runs.get(runId) ?? null : null;
}

const NOOP_RUN: StartAgentRun = () => {};
const NOOP_CANCEL: CancelAgentRun = () => {};

/// Get the agent-run launcher. Returns a no-op when rendered without a provider (e.g. in
/// isolated component tests) so consumers don't need to know about the provider.
export function useStartAgentRun(): StartAgentRun {
    return React.useContext(AGENT_RUN_CTX)?.run ?? NOOP_RUN;
}

/// Get the agent-run canceller. Returns a no-op when rendered without a provider.
export function useCancelAgentRun(): CancelAgentRun {
    return React.useContext(AGENT_RUN_CTX)?.cancel ?? NOOP_CANCEL;
}

/// The registry state: all runs keyed by run id, plus a per-session index of the latest run.
interface RegistryState {
    runs: Map<number, AgentRunState>;
    latestRunBySession: Map<string, number>;
}

/// The registry reducer: routes an AgentRunAction to its run's slot (by run id) and maintains
/// the per-session index. Mirrors how the connection registry keys queries by query id.
type RegistryAction = { sessionId: string; runId: number; action: AgentRunAction };

function reduceRegistry(prev: RegistryState, mapAction: RegistryAction): RegistryState {
    const { sessionId, runId, action } = mapAction;
    const cur = prev.runs.get(runId) ?? null;
    const nextState = reduceAgentRun(cur, action);

    const runs = new Map(prev.runs);
    if (nextState == null) {
        runs.delete(runId);
    } else {
        runs.set(runId, nextState);
    }

    // Point the session at this run when it starts (AGENT_START); other actions leave the index
    // untouched so the session keeps resolving its most-recently-started run.
    let latestRunBySession = prev.latestRunBySession;
    if (action.type === AGENT_START) {
        latestRunBySession = new Map(prev.latestRunBySession);
        latestRunBySession.set(sessionId, runId);
    }

    return { runs, latestRunBySession };
}

const INITIAL_REGISTRY: RegistryState = {
    runs: new Map<number, AgentRunState>(),
    latestRunBySession: new Map<string, number>(),
};

type Props = { children: React.ReactElement };

export const AgentRunProvider: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const aiClient = useAIClient();
    const [registry, dispatchRegistry] = React.useReducer(reduceRegistry, INITIAL_REGISTRY);

    // Mirror the latest registry into a ref so the run launcher can read the session's active run
    // (to abort it) without being re-created on every state change.
    const registryRef = React.useRef(registry);
    registryRef.current = registry;

    // A monotonically increasing run id across the provider.
    const runIdRef = React.useRef(0);

    // Resolve the session's latest run state from the ref (for abort-previous / cancel).
    const latestRunForSession = React.useCallback((sessionId: string): AgentRunState | null => {
        const runId = registryRef.current.latestRunBySession.get(sessionId);
        return runId != null ? registryRef.current.runs.get(runId) ?? null : null;
    }, []);

    const cancel = React.useCallback<CancelAgentRun>((sessionId) => {
        const cur = latestRunForSession(sessionId);
        if (cur != null && agentRunIsActive(cur.phase)) {
            cur.abort.abort();
        }
    }, [latestRunForSession]);

    const run = React.useCallback<StartAgentRun>((args) => {
        if (aiClient == null) {
            logger.error('Cannot start agent run without an AI client', {}, LOG_CTX);
            return;
        }
        // One active run per session: abort any previous one.
        const prev = latestRunForSession(args.sessionId);
        if (prev != null && agentRunIsActive(prev.phase)) {
            prev.abort.abort();
        }

        const runId = ++runIdRef.current;
        void startAgentRun(
            {
                runId,
                prompt: args.prompt,
                contextScriptKey: args.contextScriptKey,
                intentOverride: args.intentOverride,
            },
            {
                aiClient,
                dispatchAgent: (action: AgentRunAction) => dispatchRegistry({ sessionId: args.sessionId, runId, action }),
                getNotebook: () => args.notebook,
                modifyNotebook: args.modifyNotebook,
                registerAgentRun: (scriptKey, id) => args.modifyNotebook({ type: REGISTER_AGENT_RUN, value: [scriptKey, id] }),
                logger,
                now: () => Date.now(),
            },
        );
    }, [aiClient, logger, latestRunForSession]);

    const value = React.useMemo<AgentRunContextValue>(
        () => ({ runs: registry.runs, latestRunBySession: registry.latestRunBySession, run, cancel }),
        [registry, run, cancel],
    );

    return <AGENT_RUN_CTX.Provider value={value}>{props.children}</AGENT_RUN_CTX.Provider>;
};
