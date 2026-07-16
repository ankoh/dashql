import * as dashql from '../../core/index.js';

import { Decoration, DecorationSet, EditorView, gutter, GutterMarker } from '@codemirror/view';
import { EditorState, Extension, Range, StateEffect, StateEffectType, StateField, Text, Transaction } from '@codemirror/state';

import { DashQLPendingDiff, DashQLProcessorPlugin } from './dashql_processor.js';

import './dashql_diff_decorations.css';

/// The sentinel that ScriptDiffOp uses for an absent statement (no source for INSERT, no target
/// for DELETE). Must match the `.fbs` default (0xFFFFFFFF).
const STATEMENT_NONE = 0xffffffff;

const OpCode = dashql.buffers.diff.ScriptDiffOpCode;

/// Whole inserted statement (present in the new text, absent from the prior one)
const InsertStatementDecoration = Decoration.mark({ class: 'cm-dashql-diff-insert' });
/// An updated statement — subtle tint over the whole statement
const UpdateStatementDecoration = Decoration.mark({ class: 'cm-dashql-diff-update' });
/// A statement that only moved (order changed but content equal)
const MoveStatementDecoration = Decoration.mark({ class: 'cm-dashql-diff-move' });
/// A changed sub-range within an updated statement — stronger highlight
const ChangeDecoration = Decoration.mark({ class: 'cm-dashql-diff-change' });

/// A gutter marker for a deleted statement.
///
/// A deletion has no target span (the statement is gone from the new text), so we cannot highlight
/// it in place. Instead we drop a thin marker in the gutter at the nearest surviving boundary.
class DeleteMarker extends GutterMarker {
    toDOM() {
        const span = document.createElement('span');
        span.className = 'dashql-gutter-diff-delete';
        return span;
    }
}

interface DiffDecorationState {
    /// The pending diff this state was built from (identity used to skip rebuilds)
    pendingDiff: DashQLPendingDiff | null;
    /// The in-place highlight decorations
    decorations: DecorationSet;
    /// The `line.from` offsets that carry a "statement deleted here" gutter marker
    deleteLines: Set<number>;
}

/// Build the in-place diff decorations and delete-gutter anchors from a pending diff.
///
/// The editor holds the *new* (target) text, so `target_span` / `target_changes` are text offsets
/// into the current document; no token resolution is needed on the JS side. Deletions have no
/// target span, so we anchor their gutter marker at the end of the most recently seen surviving
/// statement (falling back to the document start).
function buildDiffDecorations(pending: DashQLPendingDiff | null, doc: Text): DiffDecorationState {
    if (pending == null) {
        return { pendingDiff: null, decorations: Decoration.none, deleteLines: new Set() };
    }
    const diff = pending.diffBuffer.read();
    const docLength = doc.length;
    const ranges: Range<Decoration>[] = [];
    const deleteLines = new Set<number>();

    const tmpOp = new dashql.buffers.diff.ScriptDiffOp();
    const tmpSpan = new dashql.buffers.parser.TextSpan();
    const tmpChange = new dashql.buffers.parser.TextSpan();

    // Clamp a span to the current document, dropping empty/inverted ranges. Guards against any
    // transient mismatch between the diff and the editor doc.
    const clamp = (from: number, to: number): [number, number] | null => {
        const f = Math.max(0, Math.min(from, docLength));
        const t = Math.max(f, Math.min(to, docLength));
        return f < t ? [f, t] : null;
    };

    // The end offset of the most recently seen surviving statement — the anchor for the next
    // deletion's gutter marker.
    let lastTargetEnd = 0;

    for (let i = 0; i < diff.opsLength(); ++i) {
        const op = diff.ops(i, tmpOp)!;
        const code = op.code();

        if (code === OpCode.DELETE || op.targetStatement() === STATEMENT_NONE) {
            // A deletion (or any op without a target) drops a gutter marker at the nearest boundary.
            if (code === OpCode.DELETE) {
                const anchor = Math.max(0, Math.min(lastTargetEnd, docLength));
                deleteLines.add(doc.lineAt(anchor).from);
            }
            continue;
        }

        const targetSpan = op.targetSpan(tmpSpan);
        if (targetSpan == null) {
            continue;
        }
        const range = clamp(targetSpan.offset(), targetSpan.offset() + targetSpan.length());
        if (range == null) {
            continue;
        }
        lastTargetEnd = range[1];

        switch (code) {
            case OpCode.INSERT:
                ranges.push(InsertStatementDecoration.range(range[0], range[1]));
                break;
            case OpCode.MOVE:
                ranges.push(MoveStatementDecoration.range(range[0], range[1]));
                break;
            case OpCode.UPDATE: {
                ranges.push(UpdateStatementDecoration.range(range[0], range[1]));
                for (let j = 0; j < op.targetChangesLength(); ++j) {
                    const change = op.targetChanges(j, tmpChange);
                    if (change == null) continue;
                    const cr = clamp(change.offset(), change.offset() + change.length());
                    if (cr == null) continue;
                    ranges.push(ChangeDecoration.range(cr[0], cr[1]));
                }
                break;
            }
            case OpCode.KEEP:
            default:
                // Unchanged statements are not decorated.
                break;
        }
    }

    return {
        pendingDiff: pending,
        // `sort` handles the nested change-within-update ranges and the emit order.
        decorations: Decoration.set(ranges, true),
        deleteLines,
    };
}

/// Build the diff decoration extensions for a diff source resolved from the editor state.
///
/// The integrated editor reads the pending diff from the `DashQLProcessorPlugin` state field; the
/// standalone (read-only) preview reads it from an effect-backed field (see below). This factory
/// keeps the decoration field and the highlight facet identical for both — only where the
/// `DashQLPendingDiff` comes from differs. Mirrors `createScannerHighlightPlugin` in
/// `dashql_decorations_standalone.ts`.
///
/// `includeDeleteGutter` controls the deletion gutter: the editable editor wants it, but the
/// read-only compact preview leaves it off (a bare `gutter()` forces CodeMirror to render its
/// `.cm-gutters` chrome — a stray right border + padding — even with no markers, which the preview
/// otherwise has no gutter for).
export function createDiffDecorationExtension(
    getPending: (state: EditorState) => DashQLPendingDiff | null,
    includeDeleteGutter: boolean = true,
): Extension {
    /// Decorations for a pending, staged rewrite (agent suggestion) shown as an in-place diff.
    const field: StateField<DiffDecorationState> = StateField.define<DiffDecorationState>({
        create: () => ({ pendingDiff: null, decorations: Decoration.none, deleteLines: new Set() }),
        update: (state: DiffDecorationState, transaction: Transaction) => {
            const pending = getPending(transaction.state);
            // Pending diff unchanged and doc untouched? Keep the previous decorations.
            if (pending === state.pendingDiff && !transaction.docChanged) {
                return state;
            }
            return buildDiffDecorations(pending, transaction.state.doc);
        },
    });

    const decorations = EditorView.decorations.from(field, state => state.decorations);

    if (!includeDeleteGutter) {
        return [field, decorations];
    }

    /// A dedicated gutter that marks lines where statements were deleted by the pending rewrite.
    const diffGutter = gutter({
        lineMarker(view, line) {
            const state = view.state.field(field);
            return state.deleteLines.has(line.from) ? new DeleteMarker() : null;
        },
        lineMarkerChange: (update) => {
            const prev = update.startState.field(field);
            const next = update.state.field(field);
            return prev.deleteLines !== next.deleteLines;
        },
    });

    return [field, decorations, diffGutter];
}

/// Bundle the diff decoration extensions for the integrated (editable) editor — the pending diff
/// comes from the `DashQLProcessorPlugin` state field, kept in sync with the notebook's ScriptData.
export const DashQLDiffDecorationPlugin = createDiffDecorationExtension(
    state => state.field(DashQLProcessorPlugin).scriptPendingDiff,
);

/// Effect used to push a pending diff into a standalone (read-only) editor from outside, e.g. the
/// feed's compact preview which computes its own width-dependent diff. Pass null to clear it.
export const DashQLDiffDecorationUpdateEffect: StateEffectType<DashQLPendingDiff | null> =
    StateEffect.define<DashQLPendingDiff | null>();

/// Holds the pending diff pushed in from outside via `DashQLDiffDecorationUpdateEffect`.
/// The decoration extension reads it back out to overlay the diff on a read-only editor.
const StandalonePendingDiffField: StateField<DashQLPendingDiff | null> =
    StateField.define<DashQLPendingDiff | null>({
        create: () => null,
        update: (pending, transaction: Transaction) => {
            for (const effect of transaction.effects) {
                if (effect.is(DashQLDiffDecorationUpdateEffect)) {
                    pending = effect.value;
                }
            }
            return pending;
        },
    });

/// Bundle the diff decoration extensions for a standalone (read-only) editor. The diff buffer is
/// owned by the pusher (e.g. `ScriptPreview`), not by this field. The delete gutter is omitted here:
/// the compact preview has no other gutter, so the bare gutter chrome would show as a stray border.
export const DashQLStandaloneDiffDecorationPlugin = [
    StandalonePendingDiffField,
    createDiffDecorationExtension(state => state.field(StandalonePendingDiffField), false),
];
