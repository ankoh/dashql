import { AgentHost, AgentApplyPlan } from '../agent/agent_host.js';
import { AgentIntent } from '../agent/agent_prompts.js';
import { verifyScript, VerifyResult } from '../agent/agent_verify.js';
import {
    buildAgentContext,
    AgentContextContributor,
    OutputColumnResolver,
} from './script_agent_context.js';
import {
    CREATE_SCRIPT_WITH_TEXT,
    compileQuery,
    NotebookScripts,
    NotebookScriptsAction,
    REGISTER_AGENT_RUN,
    ScriptData,
    SET_SCRIPT_TEXT,
} from './notebook_scripts.js';
import { scriptDisplayName } from './script_types.js';
import type { LoggerLike } from '../platform/logger/logger.js';

/// The source clause for the generated VISUALIZE statement.
///
/// The actual transcoding lives in the WASM core (`ParseVegaLiteToVisualize`); we encode the
/// source into the Vega-Lite spec's `data` member (see `visSourceToData`) and let the core
/// derive the `<query> |> VISUALIZE USING vegalite (…)` clause. This keeps a single transcoder.
export type VisSource =
    /// Inline query, emitted verbatim before the visualization pipe.
    { kind: 'inline-select'; sql: string }
    /// Reuse a query source extracted verbatim from an existing visualization pipeline.
    | { kind: 'raw'; text: string };

/// Encode a VisSource into the `data` member that the WASM transcoder understands.
export function visSourceToData(source: VisSource): Record<string, unknown> {
    switch (source.kind) {
        case 'raw':
            return { $raw: source.text.trim() };
        case 'inline-select':
            return { $sql: source.sql.trim() };
    }
}

/// Everything an agent run needs to read and write notebook scripts.
export interface NotebookScriptsAgentHostParams {
    /// The notebook scripts state (read once at run start).
    notebookScripts: NotebookScripts;
    /// The focused script key: the context + default in-place target (null if nothing focused).
    contextScriptKey: number | null;
    /// Apply a result and register the run against the notebook scripts.
    modifyNotebookScripts: (action: NotebookScriptsAction) => void;
    /// Resolve a script's last-execution output columns (for the visualize context). Optional so
    /// callers without connection state in scope can omit it.
    resolveOutputColumns?: OutputColumnResolver;
    /// Optional context-contributor override (defaults to the standard chain).
    contributors?: AgentContextContributor[];
    /// Logger used for executable-query translation diagnostics.
    logger?: LoggerLike;
}

/// Build an `AgentHost` backed by notebook scripts. This is the notebook's adapter over the generic
/// agent run driver: it closes over the focused script and notebook scripts dispatch so the driver's
/// methods stay domain-free. All notebook knowledge (context contributors, VISUALIZE source
/// resolution + transcode, apply-action selection, run registration) lives here.
export function createNotebookScriptsAgentHost(params: NotebookScriptsAgentHostParams): AgentHost {
    const { notebookScripts, contextScriptKey, modifyNotebookScripts, resolveOutputColumns, contributors, logger } = params;
    // Resolve the focused script once — every method reasons about the same context.
    const contextScriptData: ScriptData | null = contextScriptKey != null
        ? notebookScripts.scripts[contextScriptKey] ?? null
        : null;
    return {
        buildContext(intent: AgentIntent): string {
            return buildAgentContext(
                { notebookScripts, contextScriptData, intent, resolveOutputColumns, logger },
                contributors,
            );
        },

        isEditingChart(): boolean {
            return focusedIsVisualize(contextScriptData);
        },

        transcodeVegaLite(rawSpecJson: string): string {
            // Parsed as a loose record: we only re-serialize it for the WASM transcoder, which does
            // the real work, so the strict TopLevelSpec type adds no safety and its narrow `data`
            // union rejects our `$ref`/`$sql` source records. Throws on malformed JSON, which the
            // driver treats as a verifiable error and repairs.
            const spec = JSON.parse(rawSpecJson) as Record<string, unknown>;
            // Inject the resolved source as the spec's `data` member; the WASM transcoder turns it
            // into the `<query> |> VISUALIZE USING vegalite (…)` clause. The model is told not to emit `data`, but
            // overwrite it defensively so our source always wins.
            const source = determineVisSource(notebookScripts, contextScriptData);
            if (source == null) throw new Error('A query source is required to create a visualization');
            spec.data = visSourceToData(source);
            return notebookScripts.instance.parseVegaLiteToVisualize(JSON.stringify(spec));
        },

        verify(candidateText: string): VerifyResult {
            return verifyScript(notebookScripts.instance, notebookScripts.connectionCatalog, candidateText);
        },

        planApply(intent: AgentIntent, candidateText: string): AgentApplyPlan {
            const action = chooseApplyAction(intent, contextScriptData, candidateText);
            const inPlace = action.type === SET_SCRIPT_TEXT;
            const targetName = contextScriptData != null ? scriptDisplayName(contextScriptData.fileName) : null;
            return {
                inPlace,
                targetName,
                commit: () => modifyNotebookScripts(action),
            };
        },

        registerRun(runId: number): void {
            // A run with no context script has nothing to attach to (the guard also lives in the
            // driver, but keep it here too so the host is correct in isolation).
            if (contextScriptKey == null) return;
            modifyNotebookScripts({ type: REGISTER_AGENT_RUN, value: [contextScriptKey, runId] });
        },
    };
}

/// Is the focused script a VISUALIZE statement? Derived from the cached annotation.
function focusedIsVisualize(contextScriptData: ScriptData | null): boolean {
    return contextScriptData?.annotations.visualizeQuery != null;
}

/// Choose the notebookScripts action that applies the verified candidate.
///
/// | intent    | focused                | action                          |
/// |-----------|------------------------|---------------------------------|
/// | sql       | any focused script     | SET_SCRIPT_TEXT in place         |
/// | sql       | none focused           | CREATE_SCRIPT_WITH_TEXT  |
/// | visualize | focused is VISUALIZE   | SET_SCRIPT_TEXT in place         |
/// | visualize | focused is SQL / none  | CREATE_SCRIPT_WITH_TEXT  |
export function chooseApplyAction(
    intent: AgentIntent,
    contextScriptData: ScriptData | null,
    text: string,
): NotebookScriptsAction {
    if (intent === 'sql') {
        if (contextScriptData != null) {
            // In-place rewrite of an existing script: stage it as a diff (withDiff) so the editor
            // shows an accept/reject overlay instead of silently replacing the text.
            return { type: SET_SCRIPT_TEXT, value: { scriptKey: contextScriptData.scriptKey, text, withDiff: true } };
        }
        return { type: CREATE_SCRIPT_WITH_TEXT, value: { text } };
    }
    // visualize
    if (focusedIsVisualize(contextScriptData)) {
        return { type: SET_SCRIPT_TEXT, value: { scriptKey: contextScriptData!.scriptKey, text, withDiff: true } };
    }
    return { type: CREATE_SCRIPT_WITH_TEXT, value: { text } };
}

/// Determine the VISUALIZE source clause for a visualize run.
///
/// - If the focused script is already a VISUALIZE statement, reuse its resolved source so an
///   in-place edit keeps pointing at the same data.
/// - Otherwise (focused is a SQL script) reference that script by its SQL script path.
/// - If nothing usable is focused, fall back to no source (the verify pass will flag it).
export function determineVisSource(notebookScripts: NotebookScripts, contextScriptData: ScriptData | null): VisSource | null {
    if (contextScriptData == null) {
        return null;
    }
    const sql = compileQuery(notebookScripts, contextScriptData).trim();
    return sql ? { kind: 'inline-select', sql } : null;
}
