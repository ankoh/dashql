import * as React from 'react';
import * as core from '../../../core/index.js';

import { StateEffect } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

import { Logger, stringifyError } from '../../../platform/logger/logger.js';
import type { ScriptData } from '../scripts/notebook_scripts.js';
import { DashQLScannerDecorationUpdateEffect } from '../scripts/editor/dashql_decorations_standalone.js';
import { DashQLDiffDecorationUpdateEffect } from '../scripts/editor/dashql_diff_decorations.js';
import { DashQLStoryUpdateEffect, hasStatementDescriptions } from '../scripts/editor/dashql_story_decorations.js';
import type { DashQLPendingDiff } from '../scripts/editor/dashql_processor.js';

const LOG_CTX = 'script_preview';
const PREVIEW_INDENTATION_WIDTH = 2;

export interface PreviewSnapshot {
    scriptText: string;
    parsed: core.FlatBufferPtr<core.buffers.parser.ParsedScript> | null;
    ownsParsed: boolean;
    /// The compact-formatted diff overlay for a staged agent rewrite, or null when none is pending.
    /// Owned by the snapshot: its `diffBuffer` is freed when the snapshot is replaced or unmounts.
    /// This is a *separate* buffer from `scriptData.pendingDiff` (whose offsets index the normal,
    /// unformatted text); the offsets here index the compact preview text shown below.
    diff: DashQLPendingDiff | null;
}

type PreviewView = Pick<EditorView, 'dispatch'>;
interface AppliedPreview {
    view: PreviewView;
    snapshot: PreviewSnapshot;
}

export function releasePreviewSnapshot(snapshot: PreviewSnapshot, view: PreviewView | null): void {
    // CodeMirror fields and view plugins retain these pointers after dispatch. Detach them before
    // releasing the WASM owners so unmounting virtualized rows cannot read freed memory.
    if (view != null) {
        view.dispatch({
            effects: [
                DashQLScannerDecorationUpdateEffect.of(null),
                DashQLDiffDecorationUpdateEffect.of(null),
                DashQLStoryUpdateEffect.of(null),
            ],
        });
    }
    if (snapshot.ownsParsed) snapshot.parsed?.destroy();
    snapshot.diff?.diffBuffer.destroy();
}

export function releaseAppliedPreviewSnapshot(
    snapshot: PreviewSnapshot,
    applied: AppliedPreview | null,
): AppliedPreview | null {
    // React may replace state again before this snapshot's effect cleanup runs. Detach CodeMirror
    // only when it still retains this snapshot; otherwise cleanup would clear a newer snapshot and
    // leave the editor reading that snapshot's WASM buffer after a subsequent cleanup destroys it.
    const isApplied = applied?.snapshot === snapshot;
    releasePreviewSnapshot(snapshot, isApplied ? applied.view : null);
    return isApplied ? null : applied;
}

/// Description previews retain raw source text because their parser spans index the source directly.
function buildDescriptionPreview(scriptData: ScriptData): PreviewSnapshot | null {
    const text = scriptData.script.toString();
    if (scriptData.scriptAnalysis.buffers.parsed == null) return null;
    // getParsed returns an independently owned serialized buffer. The notebook scripts analysis
    // buffer can be destroyed as soon as the next editor update arrives, so it is unsafe to hand
    // directly to a long-lived CodeMirror scanner extension.
    const parsed = scriptData.script.getParsed();
    if (!hasStatementDescriptions(parsed)) {
        parsed.destroy();
        return null;
    }
    return {
        scriptText: text,
        parsed,
        ownsParsed: true,
        diff: null,
    };
}

function buildUnformattedPreview(scriptData: ScriptData, logger: Logger): PreviewSnapshot {
    const scriptText = readScriptText(scriptData.script, logger, scriptData.scriptKey, LOG_CTX) ?? '';
    try {
        return {
            scriptText,
            parsed: scriptData.script.getParsed(),
            ownsParsed: true,
            diff: null,
        };
    } catch (e: any) {
        logger.warn('Failed to read parsed script for unformatted preview', {
            scriptKey: scriptData.scriptKey.toString(),
            error: stringifyError(e),
        }, LOG_CTX);
        return { scriptText, parsed: null, ownsParsed: false, diff: null };
    }
}

/// Build the compact formatting config used for both the preview text and the compact diff, so the
/// diff's target offsets index the exact string the preview renders.
function compactFormattingConfig(maxWidth: number, debugMode: boolean): core.buffers.formatting.FormattingConfigT {
    return new core.buffers.formatting.FormattingConfigT(
        core.buffers.formatting.FormattingDialect.HYPER,
        core.buffers.formatting.FormattingMode.COMPACT,
        maxWidth,
        PREVIEW_INDENTATION_WIDTH,
        debugMode,
    );
}

function logUnformattableNode(
    script: core.DashQLScript,
    nodeId: number,
    scriptKey: number,
    logger: Logger,
): void {
    let nodeType: string | undefined;
    let attributeKey: string | undefined;
    let parsed: core.FlatBufferPtr<core.buffers.parser.ParsedScript> | null = null;
    try {
        parsed = script.getParsed();
        const node = parsed.read().nodes(nodeId);
        if (node != null) {
            nodeType = core.buffers.parser.NodeType[node.nodeType()];
            attributeKey = core.buffers.parser.AttributeKey[node.attributeKey()];
        }
    } catch {
        // The node id remains useful if the parsed buffer cannot be read.
    } finally {
        parsed?.destroy();
    }
    logger.warn('Script preview is not formattable', {
        scriptKey: scriptKey.toString(),
        nodeId: nodeId.toString(),
        nodeType,
        attributeKey,
    }, LOG_CTX);
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
/// alignment) into a throwaway script/catalog, mirroring `computePendingDiff` in notebook_scripts.ts.
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
        if (priorRaw.getUnformattableNodes(compactFormattingConfig(maxWidth, debugMode), true).length > 0) return null;
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
    const formattingConfig = compactFormattingConfig(maxWidth, debugMode);
    let formattedScript: core.DashQLScript;
    try {
        const unformattableNodes = sourceScript.getUnformattableNodes(formattingConfig, true);
        if (unformattableNodes.length > 0) {
            logUnformattableNode(sourceScript, unformattableNodes[0], scriptKey, logger);
            return null;
        }
        formattedScript = sourceScript.format(formattingConfig, null, false);
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
        return { scriptText, parsed, ownsParsed: true, diff };
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

interface PreviewSnapshotOptions {
    instance: core.DashQL | null;
    scriptData: ScriptData;
    showStoryControls: boolean;
    initialTextHint: string;
    maxWidthChars: number | null;
    formattingDebugMode: boolean;
    logger: Logger;
    onReady?: (ready: boolean) => void;
    onFormattedText?: (scriptText: string) => void;
    onFormattingStatus?: (formattable: boolean) => void;
}

export function usePreviewSnapshot({
    instance,
    scriptData,
    showStoryControls,
    initialTextHint,
    maxWidthChars,
    formattingDebugMode,
    logger,
    onReady,
    onFormattedText,
    onFormattingStatus,
}: PreviewSnapshotOptions): {
    previewSnapshot: PreviewSnapshot;
    descriptionPreview: PreviewSnapshot | null;
} {
    const [previewSnapshot, setPreviewSnapshot] = React.useState<PreviewSnapshot>(() => ({
        scriptText: initialTextHint,
        parsed: null,
        ownsParsed: false,
        diff: null,
    }));
    const pendingDiff = scriptData.pendingDiff;
    const descriptionPreview = React.useMemo(
        () => showStoryControls && pendingDiff == null ? buildDescriptionPreview(scriptData) : null,
        [pendingDiff, scriptData, scriptData.scriptAnalysis.buffers, showStoryControls],
    );

    React.useEffect(() => {
        // Story previews retain raw source offsets and do not need width-dependent formatting.
        if (descriptionPreview != null) {
            setPreviewSnapshot(descriptionPreview);
            onFormattedText?.(descriptionPreview.scriptText);
            onFormattingStatus?.(true);
            return;
        }
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
        if (nextFormatted != null) {
            onFormattedText?.(nextFormatted.scriptText);
        }
        if (nextFormatted != null) {
            setPreviewSnapshot(nextFormatted);
            onFormattingStatus?.(true);
            return;
        }

        const unformattedPreview = buildUnformattedPreview(scriptData, logger);
        setPreviewSnapshot(unformattedPreview);
        onFormattedText?.(unformattedPreview.scriptText);
        onFormattingStatus?.(false);
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
        onFormattedText,
        onFormattingStatus,
        descriptionPreview,
    ]);

    return { previewSnapshot, descriptionPreview };
}

export function useApplyPreviewSnapshot(
    view: EditorView | null,
    previewSnapshot: PreviewSnapshot,
    descriptionPreview: PreviewSnapshot | null,
    onReady?: (ready: boolean) => void,
): void {
    const appliedPreviewRef = React.useRef<AppliedPreview | null>(null);
    const appliedDescriptionRef = React.useRef<{
        view: EditorView;
        parsed: core.FlatBufferPtr<core.buffers.parser.ParsedScript> | null;
    } | null>(null);

    // Clean up the parsed script and the compact diff buffer when the snapshot is replaced or the
    // component unmounts. The compact diff buffer is owned here (distinct from scriptData.pendingDiff,
    // which the notebook scripts state owns and frees on accept/reject).
    React.useLayoutEffect(() => {
        return () => {
            appliedPreviewRef.current = releaseAppliedPreviewSnapshot(previewSnapshot, appliedPreviewRef.current);
        };
    }, [previewSnapshot]);

    React.useEffect(() => {
        if (view == null) {
            return;
        }
        const effects: StateEffect<any>[] = [
            DashQLScannerDecorationUpdateEffect.of(previewSnapshot.parsed),
            DashQLDiffDecorationUpdateEffect.of(previewSnapshot.diff),
        ];
        // Width changes refresh the preview snapshot, but they must not reset a statement the user
        // already expanded. Only replace story decorations when the parsed source model changes.
        const descriptionParsed = descriptionPreview?.parsed ?? null;
        const appliedDescription = appliedDescriptionRef.current;
        if (appliedDescription?.view !== view || appliedDescription.parsed !== descriptionParsed) {
            effects.push(DashQLStoryUpdateEffect.of(descriptionParsed));
            appliedDescriptionRef.current = { view, parsed: descriptionParsed };
        }
        view.dispatch({
            changes: {
                from: 0,
                to: view.state.doc.length,
                insert: previewSnapshot.scriptText,
            },
            effects,
        });
        appliedPreviewRef.current = { view, snapshot: previewSnapshot };
        // The preview is ready only after the formatted document has reached CodeMirror. Reporting
        // readiness when the snapshot is merely queued lets a remounted virtual row collapse to its
        // empty-editor height for one frame.
        onReady?.(true);
    }, [onReady, previewSnapshot, view]);
}
