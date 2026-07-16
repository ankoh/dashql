import { VariantKind } from '../utils/variant.js';
import { AgentIntent } from './agent_prompts.js';

export type { AgentIntent };

/// The default number of generate→verify attempts before giving up.
export const DEFAULT_MAX_ATTEMPTS = 3;

/// The phases of an agent run. The loop advances monotonically through these except for the
/// GENERATING↔VERIFYING↔REPAIRING cycle which repeats up to `maxAttempts`.
export enum AgentRunPhase {
    IDLE = 0,
    CLASSIFYING = 1,
    GENERATING = 2,
    VERIFYING = 3,
    REPAIRING = 4,
    APPLYING = 5,
    SUCCEEDED = 6,
    FAILED = 7,
    CANCELLED = 8,
}

/// Is the run in a terminal phase?
export function agentRunIsDone(phase: AgentRunPhase): boolean {
    return phase === AgentRunPhase.SUCCEEDED
        || phase === AgentRunPhase.FAILED
        || phase === AgentRunPhase.CANCELLED;
}

/// Is the run currently active (started, not yet terminal)?
export function agentRunIsActive(phase: AgentRunPhase): boolean {
    return phase !== AgentRunPhase.IDLE && !agentRunIsDone(phase);
}

/// A single recorded transition in the observable timeline. The timestamp is injected by the
/// caller (the driver) so this module stays free of ambient clock access and is trivially
/// testable.
export interface AgentStep {
    /// The phase this step entered.
    phase: AgentRunPhase;
    /// The attempt this step belongs to (1-based; 0 before the generate loop starts).
    attempt: number;
    /// A human-readable message for the UI timeline.
    message: string;
    /// The timestamp (ms since epoch) injected by the caller.
    timestamp: number;
}

/// The observable state of one agent run for one session.
export interface AgentRunState {
    /// A monotonically increasing run id (per provider) identifying this run.
    runId: number;
    /// The trace id of this run's log (mirrors QueryExecutionState.traceId). The feed resolves
    /// the run by its id and reads this to stream the run's "Agent Logs".
    traceId: number;
    /// The current phase.
    phase: AgentRunPhase;
    /// The classified intent (defaults to 'sql' until classification completes).
    intent: AgentIntent;
    /// The user's manual override of the intent, if any.
    intentOverride: AgentIntent | null;
    /// The user's natural-language prompt.
    prompt: string;
    /// The script key whose content is the context (and default in-place target).
    contextScriptKey: number | null;
    /// The current attempt number (1-based once the generate loop starts).
    attempt: number;
    /// The maximum number of attempts.
    maxAttempts: number;
    /// The latest candidate text (SQL or transcoded VISUALIZE DSL).
    candidateText: string | null;
    /// The errors from the latest verification (fed into the next repair prompt).
    lastErrors: string[];
    /// The latest raw Vega-Lite JSON (visualize runs only), for debugging / the UI.
    vegaLiteSpec: string | null;
    /// The observable timeline.
    log: AgentStep[];
    /// The terminal error message, if the run failed.
    error: string | null;
    /// The AbortController for cancelling in-flight LLM calls.
    abort: AbortController;
}

export const AGENT_START = Symbol('AGENT_START');
export const AGENT_SET_INTENT = Symbol('AGENT_SET_INTENT');
export const AGENT_PHASE = Symbol('AGENT_PHASE');
export const AGENT_ATTEMPT_RESULT = Symbol('AGENT_ATTEMPT_RESULT');
export const AGENT_SUCCEEDED = Symbol('AGENT_SUCCEEDED');
export const AGENT_FAILED = Symbol('AGENT_FAILED');
export const AGENT_CANCELLED = Symbol('AGENT_CANCELLED');
export const AGENT_RESET = Symbol('AGENT_RESET');

/// Payload for AGENT_START.
export interface AgentStartPayload {
    runId: number;
    traceId: number;
    prompt: string;
    contextScriptKey: number | null;
    intentOverride: AgentIntent | null;
    maxAttempts: number;
    abort: AbortController;
    timestamp: number;
}

/// Payload for AGENT_PHASE — a phase transition with a timeline message.
export interface AgentPhasePayload {
    phase: AgentRunPhase;
    attempt: number;
    message: string;
    timestamp: number;
}

/// Payload for AGENT_ATTEMPT_RESULT — the outcome of one generate→verify attempt.
export interface AgentAttemptResultPayload {
    attempt: number;
    candidateText: string | null;
    vegaLiteSpec?: string | null;
    errors: string[];
    timestamp: number;
}

export type AgentRunAction =
    | VariantKind<typeof AGENT_START, AgentStartPayload>
    | VariantKind<typeof AGENT_SET_INTENT, { intent: AgentIntent; override: boolean; timestamp: number }>
    | VariantKind<typeof AGENT_PHASE, AgentPhasePayload>
    | VariantKind<typeof AGENT_ATTEMPT_RESULT, AgentAttemptResultPayload>
    | VariantKind<typeof AGENT_SUCCEEDED, { message: string; timestamp: number }>
    // `expected` marks a run that ended by exhausting its attempts — the model just couldn't
    // produce a valid result. That's a normal outcome of a fuzzy loop, logged at WARN. Left
    // false/undefined for an unexpected failure (a thrown exception, a missing notebook, …),
    // which is a real error and logged at ERROR.
    | VariantKind<typeof AGENT_FAILED, { error: string; expected?: boolean; timestamp: number }>
    | VariantKind<typeof AGENT_CANCELLED, { timestamp: number }>
    | VariantKind<typeof AGENT_RESET, null>;

/// Build the initial state for a run from its AGENT_START payload.
function startState(payload: AgentStartPayload): AgentRunState {
    return {
        runId: payload.runId,
        traceId: payload.traceId,
        phase: AgentRunPhase.CLASSIFYING,
        intent: payload.intentOverride ?? 'sql',
        intentOverride: payload.intentOverride,
        prompt: payload.prompt,
        contextScriptKey: payload.contextScriptKey,
        attempt: 0,
        maxAttempts: payload.maxAttempts,
        candidateText: null,
        lastErrors: [],
        vegaLiteSpec: null,
        log: [{
            phase: AgentRunPhase.CLASSIFYING,
            attempt: 0,
            message: 'Starting agent run',
            timestamp: payload.timestamp,
        }],
        error: null,
        abort: payload.abort,
    };
}

function appendStep(state: AgentRunState, step: AgentStep): AgentStep[] {
    return [...state.log, step];
}

/// The pure reducer for a single agent run.
export function reduceAgentRun(state: AgentRunState | null, action: AgentRunAction): AgentRunState | null {
    switch (action.type) {
        case AGENT_START:
            return startState(action.value);

        case AGENT_RESET:
            return null;

        default:
            break;
    }

    // All remaining actions require an existing run.
    if (state == null) {
        return state;
    }

    switch (action.type) {
        case AGENT_SET_INTENT:
            return {
                ...state,
                intent: action.value.intent,
                intentOverride: action.value.override ? action.value.intent : state.intentOverride,
                log: appendStep(state, {
                    phase: state.phase,
                    attempt: state.attempt,
                    message: action.value.override
                        ? `Intent overridden to ${action.value.intent}`
                        : `Classified as ${action.value.intent}`,
                    timestamp: action.value.timestamp,
                }),
            };

        case AGENT_PHASE:
            return {
                ...state,
                phase: action.value.phase,
                attempt: action.value.attempt,
                log: appendStep(state, {
                    phase: action.value.phase,
                    attempt: action.value.attempt,
                    message: action.value.message,
                    timestamp: action.value.timestamp,
                }),
            };

        case AGENT_ATTEMPT_RESULT:
            return {
                ...state,
                attempt: action.value.attempt,
                candidateText: action.value.candidateText,
                vegaLiteSpec: action.value.vegaLiteSpec !== undefined ? action.value.vegaLiteSpec : state.vegaLiteSpec,
                lastErrors: action.value.errors,
                log: appendStep(state, {
                    phase: state.phase,
                    attempt: action.value.attempt,
                    message: action.value.errors.length === 0
                        ? `Attempt ${action.value.attempt} verified clean`
                        : `Attempt ${action.value.attempt} had ${action.value.errors.length} error(s)`,
                    timestamp: action.value.timestamp,
                }),
            };

        case AGENT_SUCCEEDED:
            return {
                ...state,
                phase: AgentRunPhase.SUCCEEDED,
                error: null,
                log: appendStep(state, {
                    phase: AgentRunPhase.SUCCEEDED,
                    attempt: state.attempt,
                    message: action.value.message,
                    timestamp: action.value.timestamp,
                }),
            };

        case AGENT_FAILED:
            return {
                ...state,
                phase: AgentRunPhase.FAILED,
                error: action.value.error,
                log: appendStep(state, {
                    phase: AgentRunPhase.FAILED,
                    attempt: state.attempt,
                    message: action.value.error,
                    timestamp: action.value.timestamp,
                }),
            };

        case AGENT_CANCELLED:
            return {
                ...state,
                phase: AgentRunPhase.CANCELLED,
                log: appendStep(state, {
                    phase: AgentRunPhase.CANCELLED,
                    attempt: state.attempt,
                    message: 'Run cancelled',
                    timestamp: action.value.timestamp,
                }),
            };

        default:
            return state;
    }
}

/// A short human-readable label for a phase (for the UI status strip).
export function agentRunPhaseLabel(phase: AgentRunPhase): string {
    switch (phase) {
        case AgentRunPhase.IDLE: return 'Idle';
        case AgentRunPhase.CLASSIFYING: return 'Classifying';
        case AgentRunPhase.GENERATING: return 'Generating';
        case AgentRunPhase.VERIFYING: return 'Verifying';
        case AgentRunPhase.REPAIRING: return 'Repairing';
        case AgentRunPhase.APPLYING: return 'Applying';
        case AgentRunPhase.SUCCEEDED: return 'Done';
        case AgentRunPhase.FAILED: return 'Failed';
        case AgentRunPhase.CANCELLED: return 'Cancelled';
        default: return 'Unknown';
    }
}
