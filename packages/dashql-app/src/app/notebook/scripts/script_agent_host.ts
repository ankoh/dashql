import * as core from '../../../core/index.js';
import { AgentHost, AgentApplyDisposition } from '../agent/agent_host.js';
import { AgentIntent } from '../agent/agent_prompts.js';
import {
    buildAgentContext,
    AgentContextContributor,
    OutputColumnResolver,
} from './script_agent_context.js';
import {
    CREATE_SCRIPT_WITH_TEXT,
    NotebookScripts,
    NotebookScriptsAction,
    REGISTER_AGENT_RUN,
    ScriptData,
    SET_SCRIPT_TEXT,
} from './notebook_scripts.js';
import type { LoggerLike } from '../../../platform/logger/logger.js';

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
        createAgentSession() {
            return notebookScripts.instance.createAgentSession(
                notebookScripts.connectionCatalog,
                contextScriptData?.scriptSession ?? null,
                new core.buffers.formatting.FormattingConfigT(
                    core.buffers.formatting.FormattingDialect.HYPER,
                    core.buffers.formatting.FormattingMode.PRETTY,
                    120,
                    2,
                    false,
                ),
            );
        },

        buildContext(intent: AgentIntent): string {
            return buildAgentContext(
                { notebookScripts, contextScriptData, intent, resolveOutputColumns, logger },
                contributors,
            );
        },

        applyProposal(disposition: AgentApplyDisposition, candidateText: string): void {
            if (disposition === 'replace' && contextScriptData == null) {
                throw new Error('Cannot replace a missing focused target');
            }
            const action: NotebookScriptsAction = disposition === 'replace'
                ? {
                    type: SET_SCRIPT_TEXT,
                    value: { scriptKey: contextScriptData!.scriptKey, text: candidateText, withDiff: true },
                }
                : { type: CREATE_SCRIPT_WITH_TEXT, value: { text: candidateText } };
            modifyNotebookScripts(action);
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
