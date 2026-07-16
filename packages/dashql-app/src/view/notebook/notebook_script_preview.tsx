import * as React from 'react';
import * as core from '../../core/index.js';
import * as themes from '../editor/themes/index.js';

import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { useAppConfig } from '../../app_config.js';
import type { ScriptData } from '../../notebook/notebook_state.js';
import { useNotebookState } from '../../notebook/notebook_state_registry.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { Logger, stringifyError } from '../../platform/logger/logger.js';
import { CodeMirror } from '../editor/codemirror.js';
import { DashQLScannerDecorationUpdateEffect, DashQLStandaloneScannerDecorationPlugin } from '../editor/dashql_decorations_standalone.js';
import { DashQLDiffDecorationUpdateEffect, DashQLStandaloneDiffDecorationPlugin } from '../editor/dashql_diff_decorations.js';
import type { DashQLPendingDiff } from '../editor/dashql_processor.js';

const LOG_CTX = 'script_preview';
const PREVIEW_INDENTATION_WIDTH = 2;
const PREVIEW_MIN_WIDTH_CHARS = 24;

const SCRIPT_PREVIEW_LAYOUT = EditorView.theme({
    '.cm-scroller': {
        overflow: 'hidden',
    },
});

const SCRIPT_PREVIEW_EXTENSIONS: Extension[] = [
    themes.xcode.xcodeLight,
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    SCRIPT_PREVIEW_LAYOUT,
    DashQLStandaloneScannerDecorationPlugin,
    DashQLStandaloneDiffDecorationPlugin,
];

export interface ScriptPreviewProps {
    className?: string;
    /// The session the script belongs to. Used to reach the core instance for the compact diff.
    sessionId: string;
    scriptData: ScriptData;
    onReady?: (ready: boolean) => void;
}

interface PreviewSnapshot {
    scriptText: string;
    parsed: core.FlatBufferPtr<core.buffers.parser.ParsedScript> | null;
    /// The compact-formatted diff overlay for a staged agent rewrite, or null when none is pending.
    /// Owned by the snapshot: its `diffBuffer` is freed when the snapshot is replaced or unmounts.
    /// This is a *separate* buffer from `scriptData.pendingDiff` (whose offsets index the normal,
    /// unformatted text); the offsets here index the compact preview text shown below.
    diff: DashQLPendingDiff | null;
}

/// Build the compact formatting config used for both the preview text and the compact diff, so the
/// diff's target offsets index the exact string the preview renders.
function compactFormattingConfig(maxWidth: number, debugMode: boolean): core.buffers.formatting.FormattingConfigT {
    return new core.buffers.formatting.FormattingConfigT(
        core.buffers.formatting.FormattingDialect.DUCKDB,
        core.buffers.formatting.FormattingMode.COMPACT,
        maxWidth,
        PREVIEW_INDENTATION_WIDTH,
        debugMode,
    );
}

/// Helper to read a script text
function readScriptText(script: core.DashQLScript, logger: Logger, scriptKey: number, logCtx: string): string | null {
    try {
        return script.toString();
    } catch (e: any) {
        logger.warn('Failed to read script preview text', {
            scriptKey: scriptKey.toString(),
            error: stringifyError(e),
        }, logCtx);
        return null;
    }
}

/// Compute a compact-text diff overlay for a pending rewrite.
///
/// The preview renders `compact(newText)`; a diff overlaid on it must therefore be computed between
/// `compact(priorText)` and that same `compact(newText)`. The caller passes the already-formatted,
/// already-analyzed new-text script (`newFormatted`) so the diff target *is* the preview text — no
/// second formatting run, and its parse from `formatPreviewScript`'s `analyze()` is reused as-is.
///
/// Only the prior side is fresh work: the preview only ever formats the *current* text, and the
/// compact form of `priorText` (which was on screen before the rewrite) belonged to a past snapshot
/// that's already been freed — so it must be reformatted here (at the current width, for offset
/// alignment) into a throwaway script/catalog, mirroring `computePendingDiff` in notebook_state.ts.
/// The returned diffBuffer is owned by the caller (stored on the snapshot, freed when
/// superseded/unmounted).
function computeCompactDiff(
    instance: core.DashQL,
    priorText: string,
    newFormatted: core.DashQLScript,
    maxWidth: number,
    debugMode: boolean,
    scriptKey: number,
    logger: Logger,
): DashQLPendingDiff | null {
    let priorCatalog: core.DashQLCatalog | null = null;
    let priorRaw: core.DashQLScript | null = null;
    let priorFormatted: core.DashQLScript | null = null;
    try {
        priorCatalog = instance.createCatalog();
        priorRaw = instance.createScript(priorCatalog);
        priorRaw.insertTextAt(0, priorText);
        priorFormatted = priorRaw.format(compactFormattingConfig(maxWidth, debugMode), null, true);
        // computeDiff walks the parsed AST of both scripts. `newFormatted` was already parsed by the
        // caller's `analyze()`, so only the freshly formatted prior script needs parsing here.
        priorFormatted.parse();
        const diffBuffer = priorFormatted.computeDiff(newFormatted);
        return { priorText, diffBuffer };
    } catch (e: any) {
        logger.warn('Failed to compute compact script preview diff', {
            scriptKey: scriptKey.toString(),
            error: stringifyError(e),
            maxWidth: maxWidth.toString(),
        }, LOG_CTX);
        return null;
    } finally {
        priorFormatted?.destroy();
        priorRaw?.destroy();
        priorCatalog?.destroy();
    }
}

/// Helper to format a preview script (and, when a rewrite is staged, its compact diff overlay).
function formatPreviewScript(
    instance: core.DashQL,
    sourceScript: core.DashQLScript,
    pendingDiff: DashQLPendingDiff | null,
    scriptKey: number,
    maxWidth: number,
    debugMode: boolean,
    logger: Logger,
): PreviewSnapshot | null {
    let formattedScript: core.DashQLScript;
    try {
        formattedScript = sourceScript.format(compactFormattingConfig(maxWidth, debugMode), null, true);
    } catch (e: any) {
        logger.warn('Failed to format script preview, using raw script text', {
            scriptKey: scriptKey.toString(),
            error: stringifyError(e),
            maxWidth: maxWidth.toString(),
        }, LOG_CTX);
        return null;
    }

    try {
        formattedScript.analyze();
        const parsed = formattedScript.getParsed();
        const scriptText = readScriptText(formattedScript, logger, scriptKey, LOG_CTX);
        if (scriptText == null) {
            parsed.destroy();
            return null;
        }
        // Compute the compact diff against the SAME formatted script that produces `scriptText`,
        // so the diff's target offsets align with the rendered preview text.
        const diff = pendingDiff != null
            ? computeCompactDiff(instance, pendingDiff.priorText, formattedScript, maxWidth, debugMode, scriptKey, logger)
            : null;
        return { scriptText, parsed, diff };
    } catch (e: any) {
        logger.warn('Failed to analyze formatted script preview', {
            scriptKey: scriptKey.toString(),
            error: stringifyError(e),
            maxWidth: maxWidth.toString(),
        }, LOG_CTX);
        return null;
    } finally {
        formattedScript.destroy();
    }
}

export const ScriptPreview: React.FC<ScriptPreviewProps> = ({ className, sessionId, scriptData, onReady }) => {
    const config = useAppConfig();
    const logger = useLogger();
    // Reach the core instance (mirrors ScriptEditor) so a staged rewrite can be diffed against its
    // compact-formatted prior text. The preview only reads state; it never dispatches actions here.
    const [notebook] = useNotebookState(sessionId);
    const instance = notebook?.instance ?? null;
    const [view, setView] = React.useState<EditorView | null>(null);
    const [maxWidthChars, setMaxWidthChars] = React.useState<number | null>(null);
    const [previewSnapshot, setPreviewSnapshot] = React.useState<PreviewSnapshot>(() => ({
        scriptText: '',
        parsed: null,
        diff: null,
    }));
    const formattingDebugMode = config?.settings?.formattingDebugMode ?? false;
    const pendingDiff = scriptData.pendingDiff;

    // Track the number of characters that can fit in the preview editor
    React.useLayoutEffect(() => {
        if (view == null) {
            return;
        }
        let hasMeasured = false;
        const measure = () => {
            const charWidth = view.defaultCharacterWidth;
            const availableWidth = view.scrollDOM.clientWidth;
            if (!(charWidth > 0) || !(availableWidth > 0)) {
                return;
            }
            const nextMaxWidthChars = Math.max(PREVIEW_MIN_WIDTH_CHARS, Math.floor(availableWidth / charWidth));
            setMaxWidthChars(prev => prev === nextMaxWidthChars ? prev : nextMaxWidthChars);
            hasMeasured = true;
        };
        // Don't measure immediately - wait for layout to stabilize
        const resizeObserver = new ResizeObserver(measure);
        resizeObserver.observe(view.scrollDOM);
        // Fallback: measure after a frame if ResizeObserver hasn't fired
        const timeout = setTimeout(() => {
            if (!hasMeasured) {
                measure();
            }
        }, 16);
        return () => {
            resizeObserver.disconnect();
            clearTimeout(timeout);
        };
    }, [view]);

    // Update the preview snapshot when the script, editor dimensions, or staged rewrite change
    React.useEffect(() => {
        // Don't format until we have measured the actual width and the core instance is available.
        if (maxWidthChars == null || instance == null) {
            return;
        }
        const nextFormatted = formatPreviewScript(
            instance,
            scriptData.script,
            pendingDiff,
            scriptData.scriptKey,
            maxWidthChars,
            formattingDebugMode,
            logger,
        );
        setPreviewSnapshot(nextFormatted ?? {
            scriptText: '',
            parsed: null,
            diff: null,
        });
        // Mark as ready after first format attempt (success or failure)
        onReady?.(true);
    }, [
        instance,
        formattingDebugMode,
        logger,
        maxWidthChars,
        scriptData.script,
        scriptData.scriptKey,
        // Re-analysis produces a fresh `buffers` object even when `script` is mutated in place
        // (e.g. the agent's SET_SCRIPT_TEXT calls `script.replaceText()`, keeping the same JS
        // reference). Depend on it so the preview reformats when the underlying text changes.
        scriptData.scriptAnalysis.buffers,
        // A staged rewrite appearing/clearing must recompute the compact diff overlay. Width
        // changes recompute too (via maxWidthChars) since compact offsets shift with the layout.
        pendingDiff,
        onReady,
    ]);

    // Clean up the parsed script and the compact diff buffer when the snapshot is replaced or the
    // component unmounts. The compact diff buffer is owned here (distinct from scriptData.pendingDiff,
    // which the notebook state owns and frees on accept/reject).
    React.useEffect(() => {
        return () => {
            previewSnapshot.parsed?.destroy();
            previewSnapshot.diff?.diffBuffer.destroy();
        };
    }, [previewSnapshot]);

    React.useEffect(() => {
        if (view == null) {
            return;
        }
        view.dispatch({
            changes: {
                from: 0,
                to: view.state.doc.length,
                insert: previewSnapshot.scriptText,
            },
            effects: [
                DashQLScannerDecorationUpdateEffect.of(previewSnapshot.parsed),
                DashQLDiffDecorationUpdateEffect.of(previewSnapshot.diff),
            ],
        });
    }, [previewSnapshot, view]);

    return (
        <div className={className}>
            <CodeMirror extensions={SCRIPT_PREVIEW_EXTENSIONS} ref={setView} style={{ height: 'auto' }} />
        </div>
    );
};
