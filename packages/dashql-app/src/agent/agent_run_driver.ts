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
    extractJsonObject,
    extractSql,
    parseIntent,
} from './agent_prompts.js';
import { AgentHost } from './agent_host.js';
import { LoggerLike } from '../platform/logger/logger.js';
import { createTrace, TraceContext } from '../platform/logger/trace_context.js';

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
    const signal = abort.signal;
    const { aiClient, host, now } = deps;

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
                    // INFO, not WARN: a failed attempt is an expected step of the repair loop (the
                    // run may still succeed on a later attempt). WARN surfaces as an overlay toast in
                    // the app, which is too noisy for a normal mid-loop retry — the terminal outcome
                    // (AGENT_FAILED) is what warrants attention, and it logs at error level.
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
                // A run that simply exhausted its attempts is an expected outcome of a fuzzy loop —
                // WARN, not ERROR (ERROR pops up as an overlay toast in the app, reserved for real
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

    try {
        // The host is constructed from a live context by the caller (the feed only starts a run
        // over a real notebook), so there is no "missing subject" guard here — a broken host is an
        // unexpected failure and funnels through the catch below like any other thrown error.

        // --- Classify -------------------------------------------------------
        let intent: AgentIntent;
        if (params.intentOverride != null) {
            intent = params.intentOverride;
            dispatchAgent({ type: AGENT_SET_INTENT, value: { intent, override: true, timestamp: now() } });
        } else {
            const classification = await loggedGenerate(
                tracedLog,
                aiClient,
                'classify',
                buildClassifyPrompt(params.prompt),
                signal,
                'the model to classify the request',
            );
            throwIfAborted(signal);
            intent = parseIntent(classification);
            dispatchAgent({ type: AGENT_SET_INTENT, value: { intent, override: false, timestamp: now() } });
        }

        const context = host.buildContext(intent);

        // --- Generate → verify (→ repair) loop ------------------------------
        let candidateText: string | null = null;
        let errors: string[] = [];
        let previousCandidate: string | null = null;
        let succeeded = false;
        let finalAttempt = 0;

        const noun = intentNoun(intent);
        for (let attempt = 1; attempt <= maxAttempts; ++attempt) {
            finalAttempt = attempt;
            const repairing = attempt > 1;
            dispatchAgent({
                type: AGENT_PHASE,
                value: {
                    phase: repairing ? AgentRunPhase.REPAIRING : AgentRunPhase.GENERATING,
                    attempt,
                    message: repairing
                        ? `Repairing the ${noun} after verification errors (attempt ${attempt} of ${maxAttempts})`
                        : `Generating a ${noun} from your request (attempt ${attempt} of ${maxAttempts})`,
                    timestamp: now(),
                },
            });

            // Build + send the generation prompt. A visualize run over a focused VISUALIZE script is
            // an EDIT (the context carries the current chart), so the prompt reframes from generate
            // to modify — see buildVisualizePrompt / visualizeTaskFraming.
            const prompt: string = intent === 'visualize'
                ? buildVisualizePrompt({
                    context,
                    userPrompt: params.prompt,
                    previousCandidate,
                    errors,
                    editingChart: host.isEditingChart(),
                })
                : buildSqlPrompt({ context, userPrompt: params.prompt, previousCandidate, errors });
            const completion: string = await loggedGenerate(
                tracedLog,
                aiClient,
                repairing ? 'repair' : 'generate',
                prompt,
                signal,
                `the model to ${repairing ? 'repair' : 'generate'} the ${noun}`,
            );
            throwIfAborted(signal);

            // Turn the completion into candidate DSL/SQL. For visualize we hand the raw spec JSON
            // to the host, which resolves + injects the data source and transcodes it into the
            // target DSL (throwing on a malformed spec). We keep the extracted JSON (`vegaLiteRaw`)
            // for the attempt record and as the fallback candidate when transcoding throws.
            let vegaLiteRaw: string | null = null;
            try {
                if (intent === 'visualize') {
                    vegaLiteRaw = extractJsonObject(completion);
                    candidateText = host.transcodeVegaLite(vegaLiteRaw);
                } else {
                    candidateText = extractSql(completion);
                }
            } catch (e: any) {
                // Parsing / transcoding failed — treat as a verifiable error and repair.
                candidateText = vegaLiteRaw ?? completion;
                errors = [e?.message ? String(e.message) : String(e)];
                previousCandidate = candidateText;
                dispatchAgent({
                    type: AGENT_ATTEMPT_RESULT,
                    value: { attempt, candidateText, vegaLiteSpec: vegaLiteRaw, errors, timestamp: now() },
                });
                continue;
            }

            // Verify against the parser + analyzer.
            dispatchAgent({
                type: AGENT_PHASE,
                value: {
                    phase: AgentRunPhase.VERIFYING,
                    attempt,
                    message: `Verifying the generated ${noun} by parsing and analyzing it against the catalog`,
                    timestamp: now(),
                },
            });
            // An empty candidate would parse "clean" but apply nothing — reject it so the
            // loop repairs instead of silently succeeding with no output.
            if (candidateText.trim().length === 0) {
                errors = ['The model returned an empty result.'];
                previousCandidate = candidateText;
                dispatchAgent({
                    type: AGENT_ATTEMPT_RESULT,
                    value: { attempt, candidateText, vegaLiteSpec: vegaLiteRaw, errors, timestamp: now() },
                });
                continue;
            }

            const verdict = host.verify(candidateText);
            throwIfAborted(signal);

            const verifyErrors = [...verdict.parserErrors, ...verdict.analyzerErrors];
            // For visualize, also require that a VisualizationSpec was produced.
            if (verdict.ok && intent === 'visualize' && verdict.visualizationSpecs === 0) {
                verifyErrors.push('The statement did not resolve into a visualization. Check the source and channels.');
            }

            errors = verifyErrors;
            previousCandidate = candidateText;
            dispatchAgent({
                type: AGENT_ATTEMPT_RESULT,
                value: { attempt, candidateText, vegaLiteSpec: vegaLiteRaw, errors, timestamp: now() },
            });

            if (errors.length === 0) {
                succeeded = true;
                break;
            }
        }

        if (!succeeded || candidateText == null) {
            dispatchAgent({
                type: AGENT_FAILED,
                value: {
                    // Expected: the loop ran to completion, the model just couldn't converge on a
                    // valid result. Logged at WARN rather than ERROR (see the dispatch wrapper).
                    expected: true,
                    error: errors.length > 0
                        ? `Gave up after ${maxAttempts} attempts — the generated ${noun} still had errors: ${summarizeErrors(errors)}`
                        : `Gave up after ${maxAttempts} attempts without producing a valid ${noun}`,
                    timestamp: now(),
                },
            });
            return;
        }

        // --- Apply ----------------------------------------------------------
        // The host decides how the candidate lands (in-place edit vs. new entry) and returns a
        // staged plan; the driver logs what it's about to do, then commits.
        const plan = host.planApply(intent, candidateText);
        const { inPlace, targetName } = plan;
        dispatchAgent({
            type: AGENT_PHASE,
            value: {
                phase: AgentRunPhase.APPLYING,
                attempt: finalAttempt,
                message: inPlace
                    ? `Applying the ${noun} to ${targetName ? `"${targetName}"` : 'the focused target'}`
                    : `Adding a new entry with the generated ${noun}`,
                timestamp: now(),
            },
        });

        plan.commit();

        dispatchAgent({
            type: AGENT_SUCCEEDED,
            value: {
                message: inPlace
                    ? `Done — updated ${targetName ? `"${targetName}"` : 'the focused target'} with the new ${noun}`
                    : `Done — created a new entry with the ${noun}`,
                timestamp: now(),
            },
        });
    } catch (e: any) {
        if (signal.aborted || e?.name === 'AbortError') {
            dispatchAgent({ type: AGENT_CANCELLED, value: { timestamp: now() } });
        } else {
            dispatchAgent({ type: AGENT_FAILED, value: { error: e?.message ? String(e.message) : String(e), timestamp: now() } });
        }
    }
}
