import {
    AGENT_ATTEMPT_RESULT,
    AGENT_CANCELLED,
    AGENT_FAILED,
    AGENT_PHASE,
    AGENT_SET_INTENT,
    AGENT_START,
    AGENT_SUCCEEDED,
    AgentIntent,
    AgentRunAction,
    AgentRunPhase,
    DEFAULT_MAX_ATTEMPTS,
} from './agent_run_state.js';
import {
    buildClassifyPrompt,
    buildSqlPrompt,
    buildVisualizePrompt,
} from './agent_prompts.js';
import { AgentHost } from './agent_host.js';
import { LoggerLike } from '../../../platform/logger/logger.js';
import { createTrace, TraceContext } from '../../../platform/logger/trace_context.js';
import * as core from '../../../core/index.js';

const LOG_CTX = 'agent_run';

/// How often to emit a heartbeat log while an AI generate call is in flight. The generate calls are
/// the only long-running, silent steps in a run, so without this the Log tab stalls for seconds at a
/// time and looks hung.
const HEARTBEAT_INTERVAL_MS = 3000;

/// The minimal AI client surface the driver needs (so tests can inject a mock).
export interface AgentAIClient {
    generate(prompt: string, signal: AbortSignal): Promise<string>;
}

/// The parameters of a single agent run.
export interface AgentRunParams {
    runId: number;
    prompt: string;
    contextScriptKey: number | null;
    intentOverride: AgentIntent | null;
    maxAttempts?: number;
}

/// The injectable dependencies of the driver. The provider wires the real ones; tests inject
/// fakes (mock AI client, fake host, fake clock, in-memory dispatch). Everything domain-specific
/// (what to edit, how to verify / transcode / apply) is reached through `host` — see `AgentHost`.
export interface AgentRunDeps {
    aiClient: AgentAIClient;
    /// The surface the run acts on (built per run by the caller; closes over its context).
    host: AgentHost;
    /// Update the observable agent-run state.
    dispatchAgent: (action: AgentRunAction) => void;
    /// The base logger; the driver binds the run's trace to it so progress lands in the trace log.
    /// Optional so isolated tests can omit it.
    logger?: LoggerLike & { withTrace(ctx: TraceContext): LoggerLike };
    /// Monotonic-ish clock for timeline timestamps (injected for testability).
    now: () => number;
}

class AbortError extends Error {
    constructor() {
        super('aborted');
        this.name = 'AbortError';
    }
}

function throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) throw new AbortError();
}

/// A reader-friendly noun for the artifact an intent produces. Used to word the progress log so it
/// says what the agent is actually working on ("Generating a chart …") instead of a bare phase name.
function intentNoun(intent: AgentIntent): string {
    return intent === 'visualize' ? 'chart' : 'SQL query';
}

/// Clip a string for inclusion in a single log line so a long prompt doesn't blow up the row.
function truncateForLog(text: string, max = 160): string {
    const collapsed = text.replace(/\s+/g, ' ').trim();
    return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

/// Summarize a list of verification errors into one log line: the first error, plus a "(+N more)"
/// tail when there are others, so the reader sees the concrete problem without a wall of text.
function summarizeErrors(errors: string[]): string {
    if (errors.length === 0) return '';
    const first = truncateForLog(errors[0], 200);
    return errors.length > 1 ? `${first} (+${errors.length - 1} more)` : first;
}

/// Enrich a visualize attempt's verification errors with actionable, spec-level hints before they
/// feed the next repair prompt. The parser reports an unsupported mark (the pie/donut → arc trap)
/// as an opaque "unexpected identifier literal" — nothing the model can act on, so it repeats the
/// same mistake every attempt. Diagnosing the raw spec turns that into "use mark 'arc' with theta …"
/// and prepends it so the hint leads. No-op for SQL runs, a missing spec, or a clean spec.
/// Await a long-running promise while emitting a periodic heartbeat log, so the trace log keeps
/// showing signs of life during an otherwise silent AI generate call. The heartbeat is cleared as
/// soon as the promise settles (in a `finally`), so it never outlives the call or leaks a timer.
/// `label` names what we're waiting on ("a response for the SQL query", …).
async function withHeartbeat<T>(
    label: string,
    log: LoggerLike | null,
    work: Promise<T>,
): Promise<T> {
    if (log == null) return work;
    let elapsed = 0;
    const timer = setInterval(() => {
        elapsed += HEARTBEAT_INTERVAL_MS;
        log.info(`Still waiting for ${label} (${Math.round(elapsed / 1000)}s elapsed)`, {}, LOG_CTX);
    }, HEARTBEAT_INTERVAL_MS);
    try {
        return await work;
    } finally {
        clearInterval(timer);
    }
}

/// Run one model call, logging the full exchange into the trace so the run is debuggable: the
/// prompt we sent and the completion we got back. Each lands as a short summary line (just the
/// length) with the full text in the record's `keyValues`, which the Log tab's JSON view and the
/// downloaded log expose untruncated. Without this the only visible artifact of a run is "Attempt N
/// failed" — you never see what was actually sent or returned. `kind` labels the call ("classify" /
/// "generate" / "repair") so an exchange lines up with the phase it belongs to; `heartbeatLabel` is
/// the noun withHeartbeat uses while the call is in flight.
async function loggedGenerate(
    log: LoggerLike | null,
    aiClient: AgentAIClient,
    kind: string,
    prompt: string,
    signal: AbortSignal,
    heartbeatLabel: string,
): Promise<string> {
    log?.info(`Sent the ${kind} prompt to the model (${prompt.length} chars)`, { prompt }, LOG_CTX);
    const completion = await withHeartbeat(heartbeatLabel, log, aiClient.generate(prompt, signal));
    log?.info(
        `Received the model's ${kind} response (${completion.length} chars)`,
        { completion }, LOG_CTX);
    return completion;
}

/// Run the agentic edit loop. Resolves when the run reaches a terminal phase; never rejects
/// (all errors are funneled into AGENT_FAILED / AGENT_CANCELLED dispatches).
export async function startAgentRun(params: AgentRunParams, deps: AgentRunDeps): Promise<void> {
    const maxAttempts = params.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const abort = new AbortController();
    const { host, now } = deps;

    // Start a trace for this run so its progress is observable in the feed's "Agent Logs" view.
    // Each meaningful state transition is mirrored into this trace's log via the dispatch wrapper.
    const trace = createTrace();
    const tracedLog = deps.logger?.withTrace(trace) ?? null;

    // Forward every agent action to the observable state and mirror the meaningful transitions
    // into the run's trace log. Keeping this a single wrapper means every existing dispatch site
    // stays unchanged while its message also reaches the trace log.
    const dispatchAgent = (action: AgentRunAction) => {
        deps.dispatchAgent(action);
        if (tracedLog == null) return;
        switch (action.type) {
            case AGENT_SET_INTENT: {
                const noun = intentNoun(action.value.intent);
                tracedLog.info(
                    action.value.override
                        ? `Using the manually selected intent: writing a ${noun}`
                        : `Classified the request as writing a ${noun}`,
                    {}, LOG_CTX);
                break;
            }
            case AGENT_PHASE:
                tracedLog.info(action.value.message, { attempt: action.value.attempt.toString() }, LOG_CTX);
                break;
            case AGENT_ATTEMPT_RESULT: {
                // Attach the exact candidate that was verified (and the raw Vega-Lite spec, if this
                // was a visualize run) to every attempt record. On failure this is what turns a bare
                // "unexpected ENCODING" into something actionable — the JSON view / downloaded log
                // shows the precise SQL/DSL the error refers to, plus the full untruncated errors.
                const candidateKV: Record<string, string | null | undefined> = {
                    candidate: action.value.candidateText,
                };
                if (action.value.vegaLiteSpec != null) {
                    candidateKV.vegaLiteSpec = action.value.vegaLiteSpec;
                }
                if (action.value.errors.length === 0) {
                    tracedLog.info(
                        `Attempt ${action.value.attempt} passed verification with no errors`,
                        candidateKV, LOG_CTX);
                } else {
                    const count = action.value.errors.length;
                    // INFO, not WARN: a failed attempt is an expected step of the repair loop and the
                    // run may still succeed on a later attempt. Reserve WARN for the terminal expected
                    // failure so logs distinguish retries from outcomes.
                    tracedLog.info(
                        `Attempt ${action.value.attempt} failed verification with ${count} ${count === 1 ? 'error' : 'errors'}: ${summarizeErrors(action.value.errors)}`,
                        { ...candidateKV, errors: action.value.errors.join('; ') }, LOG_CTX);
                }
                break;
            }
            case AGENT_SUCCEEDED:
                tracedLog.info(action.value.message, {}, LOG_CTX);
                break;
            case AGENT_FAILED:
                // A run that simply exhausted its attempts is an expected outcome of a fuzzy loop.
                // WARN does not pop up; ERROR is reserved for real
                // failures like a thrown exception).
                if (action.value.expected) {
                    tracedLog.warn(action.value.error, {}, LOG_CTX);
                } else {
                    tracedLog.error(action.value.error, {}, LOG_CTX);
                }
                break;
            case AGENT_CANCELLED:
                tracedLog.warn('Run cancelled before completion', {}, LOG_CTX);
                break;
            default:
                break;
        }
    };

    // Attach the run to its context (if any) so a UI can resolve the run — and stream its trace —
    // by run id, the same handle-based lookup queries use. This is what surfaces the run in the
    // focused card's Log tab. A run that creates a brand-new entry has no context yet, so its
    // progress only becomes visible once the resulting entry is registered. The host closes over
    // *what* to attach to; the driver only decides whether there is a context to attach to.
    if (params.contextScriptKey != null) {
        host.registerRun?.(params.runId);
    }
    tracedLog?.info(`Starting agent run for prompt: "${truncateForLog(params.prompt)}"`, { prompt: params.prompt }, LOG_CTX);

    dispatchAgent({
        type: AGENT_START,
        value: {
            runId: params.runId,
            traceId: trace.traceId,
            prompt: params.prompt,
            contextScriptKey: params.contextScriptKey,
            intentOverride: params.intentOverride,
            maxAttempts,
            abort,
            timestamp: now(),
        },
    });

    await driveCoreAgentSession(params, deps, abort, tracedLog, dispatchAgent);
}

function coreIntent(intent: AgentIntent | null): core.buffers.agent.AgentIntent {
    if (intent === 'sql') return core.buffers.agent.AgentIntent.SQL;
    if (intent === 'visualize') return core.buffers.agent.AgentIntent.VISUALIZE;
    return core.buffers.agent.AgentIntent.UNKNOWN;
}

function appIntent(intent: core.buffers.agent.AgentIntent): AgentIntent {
    return intent === core.buffers.agent.AgentIntent.VISUALIZE ? 'visualize' : 'sql';
}

function appDisposition(disposition: core.buffers.agent.AgentApplyDisposition): 'create' | 'replace' {
    return disposition === core.buffers.agent.AgentApplyDisposition.REPLACE ? 'replace' : 'create';
}

function phaseMessage(phase: AgentRunPhase, intent: AgentIntent, attempt: number, maxAttempts: number): string {
    const noun = intentNoun(intent);
    switch (phase) {
        case AgentRunPhase.CLASSIFYING:
            return 'Classifying the request';
        case AgentRunPhase.GENERATING:
            return `Generating a ${noun} from your request (attempt ${attempt} of ${maxAttempts})`;
        case AgentRunPhase.VERIFYING:
            return `Verifying the generated ${noun} by parsing and analyzing it against the catalog`;
        case AgentRunPhase.REPAIRING:
            return `Repairing the ${noun} after verification errors (attempt ${attempt} of ${maxAttempts})`;
        case AgentRunPhase.APPLYING:
            return `Applying the ${noun}`;
        default:
            return AgentRunPhase[phase] ?? 'Agent progress';
    }
}

function stringValue(value: string | Uint8Array | null | undefined): string {
    if (typeof value === 'string') return value;
    if (value instanceof Uint8Array) return new TextDecoder().decode(value);
    return '';
}

async function driveCoreAgentSession(
    params: AgentRunParams,
    deps: AgentRunDeps,
    abort: AbortController,
    tracedLog: LoggerLike | null,
    dispatchAgent: (action: AgentRunAction) => void,
): Promise<void> {
    const { host, aiClient, now } = deps;
    const maxAttempts = params.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const session = host.createAgentSession();
    let appliedInPlace = false;
    let terminalEventSeen = false;

    const processEvents = (operation: core.buffers.agent.AgentOperationT) => {
        for (const event of operation.events) {
            if (event.type === core.buffers.agent.AgentEventType.INTENT_SELECTED) {
                dispatchAgent({
                    type: AGENT_SET_INTENT,
                    value: { intent: appIntent(event.intent), override: event.intentOverridden, timestamp: now() },
                });
            } else if (event.type === core.buffers.agent.AgentEventType.PHASE_CHANGED) {
                const phase = event.phase as number as AgentRunPhase;
                // Applying needs notebook-specific wording, emitted after planApply below.
                if (phase === AgentRunPhase.APPLYING) continue;
                dispatchAgent({
                    type: AGENT_PHASE,
                    value: {
                        phase,
                        attempt: event.attempt,
                        message: phaseMessage(phase, appIntent(event.intent), event.attempt, maxAttempts),
                        timestamp: now(),
                    },
                });
            } else if (event.type === core.buffers.agent.AgentEventType.ATTEMPT_FINISHED && event.attemptResult != null) {
                const attempt = event.attemptResult;
                dispatchAgent({
                    type: AGENT_ATTEMPT_RESULT,
                    value: {
                        attempt: attempt.attempt,
                        candidateText: stringValue(attempt.candidateText),
                        vegaLiteSpec: stringValue(attempt.vegaliteSpec) || null,
                        errors: attempt.errors,
                        timestamp: now(),
                    },
                });
            } else if (event.type === core.buffers.agent.AgentEventType.SUCCEEDED) {
                terminalEventSeen = true;
                const intent = appIntent(event.intent);
                const noun = intentNoun(intent);
                dispatchAgent({
                    type: AGENT_SUCCEEDED,
                    value: {
                        message: appliedInPlace
                            ? `Done — updated the focused target with the new ${noun}`
                            : `Done — created a new entry with the ${noun}`,
                        timestamp: now(),
                    },
                });
            } else if (event.type === core.buffers.agent.AgentEventType.FAILED) {
                terminalEventSeen = true;
                dispatchAgent({
                    type: AGENT_FAILED,
                    value: { error: stringValue(event.message), expected: event.expectedFailure, timestamp: now() },
                });
            } else if (event.type === core.buffers.agent.AgentEventType.CANCELLED) {
                terminalEventSeen = true;
                dispatchAgent({ type: AGENT_CANCELLED, value: { timestamp: now() } });
            }
        }
    };

    const completeError = (effectId: bigint, error: unknown) => new core.buffers.agent.AgentEffectCompletionT(
        effectId,
        core.buffers.agent.AgentEffectCompletionStatus.ERROR,
        null,
        null,
        null,
        error instanceof Error ? error.message : String(error),
    );

    try {
        let operation = session.start(new core.buffers.agent.AgentStartRequestT(
            params.prompt,
            coreIntent(params.intentOverride),
            maxAttempts,
            true,
        ));

        while (true) {
            processEvents(operation);
            if (operation.error !== core.buffers.agent.AgentOperationError.NONE) {
                dispatchAgent({
                    type: AGENT_FAILED,
                    value: {
                        error: stringValue(operation.errorMessage) || 'Agent session protocol operation failed',
                        timestamp: now(),
                    },
                });
                break;
            }
            if (operation.effect == null) {
                if (!terminalEventSeen) {
                    dispatchAgent({
                        type: AGENT_FAILED,
                        value: {
                            error: 'Agent session ended without a terminal result',
                            timestamp: now(),
                        },
                    });
                }
                break;
            }
            const effect = operation.effect;
            let completion: core.buffers.agent.AgentEffectCompletionT;
            try {
                if (effect.type === core.buffers.agent.AgentEffectType.RESOLVE_CONTEXT && effect.resolveContext != null) {
                    const intent = appIntent(effect.resolveContext.intent);
                    completion = new core.buffers.agent.AgentEffectCompletionT(
                        effect.id,
                        core.buffers.agent.AgentEffectCompletionStatus.SUCCESS,
                        null,
                        new core.buffers.agent.AgentContextResultT(host.buildContext(intent)),
                    );
                } else if (effect.type === core.buffers.agent.AgentEffectType.MODEL_REQUEST && effect.modelRequest != null) {
                    const request = effect.modelRequest;
                    let prompt: string;
                    if (request.kind === core.buffers.agent.AgentModelRequestKind.CLASSIFY) {
                        prompt = buildClassifyPrompt(stringValue(request.userPrompt));
                    } else {
                        const intent = appIntent(request.intent);
                        const input = {
                            context: stringValue(request.context),
                            userPrompt: stringValue(request.userPrompt),
                            previousCandidate: stringValue(request.previousCandidate) || null,
                            errors: request.errors,
                            editingChart: request.editingChart,
                        };
                        prompt = intent === 'visualize' ? buildVisualizePrompt(input) : buildSqlPrompt(input);
                    }
                    const kind = request.kind === core.buffers.agent.AgentModelRequestKind.CLASSIFY
                        ? 'classify'
                        : request.kind === core.buffers.agent.AgentModelRequestKind.REPAIR ? 'repair' : 'generate';
                    const noun = request.kind === core.buffers.agent.AgentModelRequestKind.CLASSIFY
                        ? 'the model to classify the request'
                        : `the model to ${kind} the ${intentNoun(appIntent(request.intent))}`;
                    const response = await loggedGenerate(tracedLog, aiClient, kind, prompt, abort.signal, noun);
                    throwIfAborted(abort.signal);
                    completion = new core.buffers.agent.AgentEffectCompletionT(
                        effect.id,
                        core.buffers.agent.AgentEffectCompletionStatus.SUCCESS,
                        new core.buffers.agent.AgentModelCompletionT(response),
                    );
                } else if (effect.type === core.buffers.agent.AgentEffectType.APPLY_PROPOSAL && effect.applyProposal?.proposal != null) {
                    const proposal = effect.applyProposal.proposal;
                    const intent = appIntent(proposal.intent);
                    const disposition = appDisposition(proposal.disposition);
                    const inPlace = disposition === 'replace';
                    appliedInPlace = inPlace;
                    dispatchAgent({
                        type: AGENT_PHASE,
                        value: {
                            phase: AgentRunPhase.APPLYING,
                            attempt: operation.snapshot?.attempt ?? 0,
                            message: inPlace
                                ? `Applying the ${intentNoun(intent)} to the focused target`
                                : `Adding a new entry with the generated ${intentNoun(intent)}`,
                            timestamp: now(),
                        },
                    });
                    host.applyProposal(disposition, stringValue(proposal.candidateText));
                    completion = new core.buffers.agent.AgentEffectCompletionT(
                        effect.id,
                        core.buffers.agent.AgentEffectCompletionStatus.SUCCESS,
                        null,
                        null,
                        new core.buffers.agent.AgentApplyResultT(true),
                    );
                } else {
                    throw new Error('Unsupported agent effect');
                }
            } catch (error) {
                if (abort.signal.aborted || (error as any)?.name === 'AbortError') {
                    operation = session.cancel();
                    processEvents(operation);
                    return;
                }
                completion = completeError(effect.id, error);
            }
            operation = session.completeEffect(completion);
        }
    } catch (error) {
        if (abort.signal.aborted || (error as any)?.name === 'AbortError') {
            processEvents(session.cancel());
        } else {
            dispatchAgent({
                type: AGENT_FAILED,
                value: { error: error instanceof Error ? error.message : String(error), timestamp: now() },
            });
        }
    } finally {
        session.destroy();
    }
}
