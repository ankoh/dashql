import * as core from '../../core/index.js';

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
import { buildAgentContext, AgentContextContributor } from './agent_context.js';
import { verifyScript } from './agent_verify.js';
import {
    CREATE_NOTEBOOK_ENTRY_WITH_TEXT,
    NotebookState,
    NotebookStateAction,
    ScriptData,
    SET_SCRIPT_TEXT,
} from '../notebook_state.js';
import { resolveSymbolSpan } from '../../core/tokens.js';
import { normalizePageName, scriptDisplayName } from '../notebook_types.js';
import { LoggerLike } from '../../platform/logger/logger.js';
import { createTrace, TraceContext } from '../../platform/logger/trace_context.js';

const LOG_CTX = 'agent_run';

/// How often to emit a heartbeat log while an AI generate call is in flight. The generate calls are
/// the only long-running, silent steps in a run, so without this the Log tab stalls for seconds at a
/// time and looks hung.
const HEARTBEAT_INTERVAL_MS = 3000;

/// The minimal AI client surface the driver needs (so tests can inject a mock).
export interface AgentAIClient {
    generate(prompt: string, signal: AbortSignal): Promise<string>;
}

/// The source clause for the generated VISUALIZE statement.
///
/// The actual transcoding lives in the WASM core (`ParseVegaLiteToVisualize`); we encode the
/// source into the Vega-Lite spec's `data` member (see `visSourceToData`) and let the core
/// derive the `VISUALIZE <source> AS (…)` clause. This keeps a single transcoder.
export type VisSource =
    /// Reference an existing notebook script by `(folder, file)`.
    /// Encoded as `dashql.notebook."<folder>/<file>"`.
    | { kind: 'script-reference'; folderName: string; fileName: string }
    /// Reference a catalog table / relation by (optionally qualified) name.
    | { kind: 'table-reference'; database?: string | null; schema?: string | null; table: string }
    /// Inline SELECT subquery, emitted verbatim inside parentheses.
    | { kind: 'inline-select'; sql: string }
    /// Reuse a source clause extracted verbatim from an existing VISUALIZE statement.
    | { kind: 'raw'; text: string }
    /// No source clause (`VISUALIZE AS (…)`).
    | { kind: 'none' };

/// Encode a VisSource into the `data` member that the WASM transcoder understands.
/// Returns null for `none` (no `data` member is injected).
export function visSourceToData(source: VisSource): Record<string, unknown> | null {
    switch (source.kind) {
        case 'none':
            return null;
        case 'raw':
            return source.text.trim() ? { $raw: source.text.trim() } : null;
        case 'inline-select':
            return source.sql.trim() ? { $sql: source.sql.trim() } : null;
        case 'script-reference':
            return { $ref: ['dashql', 'notebook', `${source.folderName}/${source.fileName}`] };
        case 'table-reference': {
            const ref: string[] = [];
            if (source.database) ref.push(source.database);
            if (source.schema) ref.push(source.schema);
            ref.push(source.table);
            return { $ref: ref };
        }
    }
}

/// The parameters of a single agent run.
export interface AgentRunParams {
    runId: number;
    prompt: string;
    contextScriptKey: number | null;
    intentOverride: AgentIntent | null;
    maxAttempts?: number;
}

/// The injectable dependencies of the driver. The provider wires the real ones; tests
/// inject fakes (mock AI client, fake clock, in-memory dispatch).
export interface AgentRunDeps {
    aiClient: AgentAIClient;
    /// Update the observable agent-run state.
    dispatchAgent: (action: AgentRunAction) => void;
    /// Read the current notebook state (called lazily so the driver sees fresh state).
    getNotebook: () => NotebookState | null;
    /// Apply a result to the notebook.
    modifyNotebook: (action: NotebookStateAction) => void;
    /// Record the agent run's id on a script so the feed can resolve the run (and its trace) the
    /// same way it resolves a query by its latestQueryId. Optional so isolated tests can omit it.
    registerAgentRun?: (scriptKey: number, runId: number) => void;
    /// The base logger; the driver binds the run's trace to it so progress lands in the trace log.
    /// Optional so isolated tests can omit it.
    logger?: LoggerLike & { withTrace(ctx: TraceContext): LoggerLike };
    /// Monotonic-ish clock for timeline timestamps (injected for testability).
    now: () => number;
    /// Optional context-contributor override (defaults to the standard chain).
    contributors?: AgentContextContributor[];
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

/// Run the agentic edit loop. Resolves when the run reaches a terminal phase; never rejects
/// (all errors are funneled into AGENT_FAILED / AGENT_CANCELLED dispatches).
export async function startAgentRun(params: AgentRunParams, deps: AgentRunDeps): Promise<void> {
    const maxAttempts = params.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const abort = new AbortController();
    const signal = abort.signal;
    const { aiClient, now } = deps;

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
            case AGENT_ATTEMPT_RESULT:
                if (action.value.errors.length === 0) {
                    tracedLog.info(
                        `Attempt ${action.value.attempt} passed verification with no errors`,
                        {}, LOG_CTX);
                } else {
                    const count = action.value.errors.length;
                    tracedLog.warn(
                        `Attempt ${action.value.attempt} failed verification with ${count} ${count === 1 ? 'error' : 'errors'}: ${summarizeErrors(action.value.errors)}`,
                        { errors: action.value.errors.join('; ') }, LOG_CTX);
                }
                break;
            case AGENT_SUCCEEDED:
                tracedLog.info(action.value.message, {}, LOG_CTX);
                break;
            case AGENT_FAILED:
                tracedLog.error(action.value.error, {}, LOG_CTX);
                break;
            case AGENT_CANCELLED:
                tracedLog.warn('Run cancelled before completion', {}, LOG_CTX);
                break;
            default:
                break;
        }
    };

    // Attach the run to the context script (if any) so the feed entry can resolve it (and stream
    // its trace) by run id — the same handle-based lookup queries use. This is what surfaces the
    // run in the focused card's Log tab. A run that creates a brand-new entry has no context script
    // yet, so its progress only becomes visible once the resulting entry is registered.
    if (params.contextScriptKey != null) {
        deps.registerAgentRun?.(params.contextScriptKey, params.runId);
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
        const notebook = deps.getNotebook();
        if (notebook == null) {
            throw new Error('No active notebook');
        }
        const contextScriptData = params.contextScriptKey != null
            ? notebook.scripts[params.contextScriptKey] ?? null
            : null;

        // --- Classify -------------------------------------------------------
        let intent: AgentIntent;
        if (params.intentOverride != null) {
            intent = params.intentOverride;
            dispatchAgent({ type: AGENT_SET_INTENT, value: { intent, override: true, timestamp: now() } });
        } else {
            const classification = await withHeartbeat<string>(
                'the model to classify the request',
                tracedLog,
                aiClient.generate(buildClassifyPrompt(params.prompt), signal),
            );
            throwIfAborted(signal);
            intent = parseIntent(classification);
            dispatchAgent({ type: AGENT_SET_INTENT, value: { intent, override: false, timestamp: now() } });
        }

        // Determine the VISUALIZE source up-front (visualize runs only).
        const visSource = intent === 'visualize'
            ? determineVisSource(notebook, contextScriptData)
            : null;

        const context = buildAgentContext(
            { notebook, contextScriptData, intent },
            deps.contributors,
        );

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

            // Build + send the generation prompt.
            const prompt: string = intent === 'visualize'
                ? buildVisualizePrompt({ context, userPrompt: params.prompt, previousCandidate, errors })
                : buildSqlPrompt({ context, userPrompt: params.prompt, previousCandidate, errors });
            const completion: string = await withHeartbeat(
                `the model to ${repairing ? 'repair' : 'generate'} the ${noun}`,
                tracedLog,
                aiClient.generate(prompt, signal),
            );
            throwIfAborted(signal);

            // Turn the completion into candidate DSL/SQL.
            let vegaLiteRaw: string | null = null;
            try {
                if (intent === 'visualize') {
                    vegaLiteRaw = extractJsonObject(completion);
                    // Parsed as a loose record: we only re-serialize it for the WASM transcoder,
                    // which does the real work, so the strict TopLevelSpec type adds no safety and
                    // its narrow `data` union rejects our `$ref`/`$sql` source records.
                    const spec = JSON.parse(vegaLiteRaw) as Record<string, unknown>;
                    // Inject our resolved source as the spec's `data` member; the WASM transcoder
                    // turns it into the `VISUALIZE <source> AS (…)` clause. The model is told not
                    // to emit `data`, but overwrite it defensively so our source always wins.
                    const data = visSourceToData(visSource ?? { kind: 'none' });
                    if (data != null) {
                        spec.data = data;
                    } else {
                        delete spec.data;
                    }
                    candidateText = notebook.instance.parseVegaLiteToVisualize(JSON.stringify(spec));
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

            const verdict = verifyScript(notebook.instance, notebook.connectionCatalog, candidateText);
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
                    error: errors.length > 0
                        ? `Gave up after ${maxAttempts} attempts — the generated ${noun} still had errors: ${summarizeErrors(errors)}`
                        : `Gave up after ${maxAttempts} attempts without producing a valid ${noun}`,
                    timestamp: now(),
                },
            });
            return;
        }

        // --- Apply ----------------------------------------------------------
        const applyAction = chooseApplyAction(intent, contextScriptData, candidateText);
        const targetName = contextScriptData != null ? scriptDisplayName(contextScriptData.fileName) : null;
        const inPlace = applyAction.type === SET_SCRIPT_TEXT;
        dispatchAgent({
            type: AGENT_PHASE,
            value: {
                phase: AgentRunPhase.APPLYING,
                attempt: finalAttempt,
                message: inPlace
                    ? `Applying the ${noun} to ${targetName ? `"${targetName}"` : 'the focused script'}`
                    : `Adding a new notebook entry with the generated ${noun}`,
                timestamp: now(),
            },
        });

        deps.modifyNotebook(applyAction);

        dispatchAgent({
            type: AGENT_SUCCEEDED,
            value: {
                message: inPlace
                    ? `Done — updated ${targetName ? `"${targetName}"` : 'the focused script'} with the new ${noun}`
                    : `Done — created a new notebook entry with the ${noun}`,
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

/// Is the focused script a VISUALIZE statement? Derived from the cached annotation.
function focusedIsVisualize(contextScriptData: ScriptData | null): boolean {
    return contextScriptData?.annotations.visualizeQuery != null;
}

/// Choose the notebook action that applies the verified candidate.
///
/// | intent    | focused                | action                          |
/// |-----------|------------------------|---------------------------------|
/// | sql       | any focused script     | SET_SCRIPT_TEXT in place         |
/// | sql       | none focused           | CREATE_NOTEBOOK_ENTRY_WITH_TEXT  |
/// | visualize | focused is VISUALIZE   | SET_SCRIPT_TEXT in place         |
/// | visualize | focused is SQL / none  | CREATE_NOTEBOOK_ENTRY_WITH_TEXT  |
export function chooseApplyAction(
    intent: AgentIntent,
    contextScriptData: ScriptData | null,
    text: string,
): NotebookStateAction {
    if (intent === 'sql') {
        if (contextScriptData != null) {
            return { type: SET_SCRIPT_TEXT, value: { scriptKey: contextScriptData.scriptKey, text } };
        }
        return { type: CREATE_NOTEBOOK_ENTRY_WITH_TEXT, value: { text } };
    }
    // visualize
    if (focusedIsVisualize(contextScriptData)) {
        return { type: SET_SCRIPT_TEXT, value: { scriptKey: contextScriptData!.scriptKey, text } };
    }
    return { type: CREATE_NOTEBOOK_ENTRY_WITH_TEXT, value: { text } };
}

/// Determine the VISUALIZE source clause for a visualize run.
///
/// - If the focused script is already a VISUALIZE statement, reuse its resolved source so an
///   in-place edit keeps pointing at the same data.
/// - Otherwise (focused is a SQL script) reference that script by its notebook path.
/// - If nothing usable is focused, fall back to no source (the verify pass will flag it).
export function determineVisSource(notebook: NotebookState, contextScriptData: ScriptData | null): VisSource {
    if (contextScriptData == null) {
        return { kind: 'none' };
    }
    if (focusedIsVisualize(contextScriptData)) {
        const reused = extractVisSourceFromScript(contextScriptData);
        if (reused != null) return reused;
    }
    // Reference the focused SQL script by its notebook path. Use the clean display names (folder
    // without its ordering prefix, file without prefix and ".sql") so the encoded reference matches
    // how the script is registered in the catalog (dashql.notebook."<clean folder>/<clean file>").
    if (contextScriptData.folderName && contextScriptData.fileName) {
        return {
            kind: 'script-reference',
            folderName: normalizePageName(contextScriptData.folderName),
            fileName: scriptDisplayName(contextScriptData.fileName),
        };
    }
    return { kind: 'none' };
}

/// Extract the source clause of the focused script's first VISUALIZE statement as a VisSource,
/// mirroring the source switch in `resolveVisualizeQuery`.
function extractVisSourceFromScript(scriptData: ScriptData): VisSource | null {
    const analyzedPtr = scriptData.scriptAnalysis.buffers.analyzed;
    const parsedPtr = scriptData.scriptAnalysis.buffers.parsed;
    if (!analyzedPtr || !parsedPtr) return null;

    const analyzed = analyzedPtr.read();
    if (analyzed.visualizationSpecsLength() === 0) return null;
    const tmpSpec = new core.buffers.analyzer.VisualizationSpec();
    const spec = analyzed.visualizationSpecs(0, tmpSpec);
    if (!spec) return null;

    switch (spec.sourceKind()) {
        case core.buffers.analyzer.VisSourceKind.SCRIPT_REFERENCE: {
            const tmpName = new core.buffers.analyzer.QualifiedTableName();
            const qname = spec.sourceQualifiedName(tmpName);
            const path = qname?.tableName() ?? null;
            if (path) {
                const slash = path.indexOf('/');
                if (slash > 0 && slash < path.length - 1) {
                    return {
                        kind: 'script-reference',
                        folderName: path.substring(0, slash),
                        fileName: path.substring(slash + 1),
                    };
                }
            }
            return null;
        }
        case core.buffers.analyzer.VisSourceKind.TABLE_REFERENCE: {
            const tmpName = new core.buffers.analyzer.QualifiedTableName();
            const qname = spec.sourceQualifiedName(tmpName);
            const tbl = qname?.tableName();
            if (!tbl) return null;
            return {
                kind: 'table-reference',
                database: qname?.databaseName() ?? null,
                schema: qname?.schemaName() ?? null,
                table: tbl,
            };
        }
        case core.buffers.analyzer.VisSourceKind.INLINE_SELECT: {
            const nodeId = spec.sourceInlineSelectAstNodeId();
            const parsed = parsedPtr.read();
            const tokens = parsed.tokens();
            const node = parsed.nodes(nodeId);
            const span = node?.symbolSpan() ?? null;
            if (tokens && span) {
                const ts = resolveSymbolSpan(tokens, span);
                const scriptText = scriptData.script.toString();
                const inner = scriptText.substr(ts.offset + 1, Math.max(ts.length - 2, 0)).trim();
                if (inner) return { kind: 'inline-select', sql: inner };
            }
            return null;
        }
        default:
            return null;
    }
}
