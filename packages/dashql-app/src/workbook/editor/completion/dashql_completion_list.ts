import { EditorView, type Rect, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { EditorState } from '@codemirror/state';

import { DashQLCompletionNextCandidateVariantEffect, DashQLCompletionPreviousCandidateVariantEffect, DashQLProcessorPlugin } from '../dashql_processor.js';
import { DashQLCompletionState, DashQLCompletionStatus } from './dashql_completion_state.js';
import { CandidateListRenderer, collectCandidates, placeBelowOrAbove, readSyntaxError, type Position } from './completion_list_view.js';


// This file contains a CodeMirror plugin for showing the completion list of completion_list_view.ts.


class CompletionList {
    /// The list renderer
    list: CandidateListRenderer;
    /// The dom that this container is mounted to (if any)
    dom: HTMLElement | null = null;
    /// The rendered completion
    renderedCompletion: DashQLCompletionState | null = null;

    constructor(view: EditorView) {
        this.list = new CandidateListRenderer(
            () => view.dispatch({ effects: DashQLCompletionPreviousCandidateVariantEffect.of(null) }),
            () => view.dispatch({ effects: DashQLCompletionNextCandidateVariantEffect.of(null) }),
        );
    }
    /// Destroy the container
    destroy() {
        this.unmount();
        this.list.destroy();
    }
    /// Unmount a completion list container
    unmount() {
        if (this.dom) {
            this.list.rootElement.remove();
            this.dom = null;
        }
    }
    /// Mount a completion list container
    mount(dom: HTMLElement) {
        if (this.dom == dom) {
            return;
        }
        this.unmount();
        document.body.appendChild(this.list.rootElement);
        this.dom = dom;
    }
    /// The position of the list at the text that a candidate replaces
    static computePosition(view: EditorView, qualifiedOffset: number, targetOffset: number): (Position | null) {
        const anchor = CompletionList.computeAnchor(view, qualifiedOffset, targetOffset);
        if (anchor == null) return null;
        return placeBelowOrAbove(anchor);
    }

    /// The box of the text that a candidate replaces, where it is without the hints of the completion. A hint inserts
    /// text in front of the target, `my_` before `ord` for `my_orders` or the qualification `db0.public.`, and moves
    /// the target to the right, by another width for every candidate. The list keeps its place: it starts at the right
    /// edge of the character before the hints, plus the text of the user between them and the target, `x.` of `x.ta`.
    static computeAnchor(view: EditorView, qualifiedOffset: number, targetOffset: number): Rect | null {
        const target = view.coordsAtPos(targetOffset);
        if (target == null) return null;
        const line = view.state.doc.lineAt(targetOffset);
        const from = Math.max(line.from, Math.min(qualifiedOffset, targetOffset));
        let left: number;
        if (from > line.from) {
            const before = view.coordsForChar(from - 1);
            // Not rendered, or on the visual line before a wrap
            if (before == null || before.bottom <= target.top) return target;
            left = before.right;
        } else {
            const lineElement = CompletionList.lineElementAt(view, line.from);
            if (lineElement == null) return target;
            left = lineElement.getBoundingClientRect().left + parseFloat(getComputedStyle(lineElement).paddingLeft || '0');
        }
        if (from < targetOffset) {
            const first = view.coordsForChar(from);
            const last = view.coordsForChar(targetOffset - 1);
            if (first == null || last == null) return target;
            left += last.right - first.left;
        }
        return { left, right: left, top: target.top, bottom: target.bottom };
    }

    /// The element of the line that holds a position
    static lineElementAt(view: EditorView, offset: number): HTMLElement | null {
        const { node } = view.domAtPos(offset);
        const element = node instanceof HTMLElement ? node : node.parentElement;
        return element?.closest<HTMLElement>('.cm-line') ?? null;
    }

    /// Update the completion list
    update(view: EditorView, state: EditorState) {
        const processor = state.field(DashQLProcessorPlugin);

        // Short-circuit noops
        if (this.renderedCompletion === processor.scriptCompletion) {
            return;
        }
        this.renderedCompletion = processor.scriptCompletion;

        // Hide completion?
        // Also while the list is still hidden: the keyed measure supersedes a pending one that would show it, e.g. of a
        // completion that an Escape ended in the frame it started
        if (processor.scriptCompletion?.status !== DashQLCompletionStatus.AVAILABLE
            || processor.scriptCompletion?.passiveHint) {
            view.requestMeasure<(Position | null)>({
                key: this,
                read: (_view) => null,
                write: (_null, _view) => {
                    this.list.hide();
                }
            });
            return;
        }
        const selectedCandidate = processor.scriptCompletion.candidateId;
        const selectedCatalogObject = processor.scriptCompletion.catalogObjectId ?? null;

        // Invalid candidate?
        const completion = processor.scriptCompletion;
        const completionBuffer = completion.buffer.read();
        if (completion.candidateId >= completionBuffer.candidatesLength()) {
            return;
        }
        // Current candidate
        const candidate = completionBuffer.candidates(completion.candidateId);
        if (candidate == null) {
            return;
        }
        const candidateLoc = candidate.targetLocation()!;
        const candidateLocOffset = candidateLoc.offset();
        const qualifiedLocOffset = candidate.targetLocationQualified()?.offset() ?? candidateLocOffset;

        // Collect all candidates
        const pending = collectCandidates(completionBuffer, selectedCandidate, selectedCatalogObject);
        const syntaxError = readSyntaxError(completionBuffer);

        // Update the container position.
        // Keyed so that a later update (e.g. hiding) supersedes a pending measure.
        // The offset can still outlive the text it points into, the list is hidden then.
        view.requestMeasure<(Position | null)>({
            key: this,
            read: (view) => {
                if (candidateLocOffset > view.state.doc.length) return null;
                return CompletionList.computePosition(view, qualifiedLocOffset, candidateLocOffset);
            },
            write: (pos: Position | null, _view) => {
                if (pos == null) {
                    this.list.hide();
                    return;
                }
                this.list.show();
                this.list.updateSyntaxError(syntaxError);
                this.list.updateCandidates(pending);
                this.list.updatePosition(this.list.fitIntoWindow(pos));
            }
        });
    }
}

export const DashQLCompletionListPlugin = ViewPlugin.fromClass(
    class {
        container: CompletionList;

        constructor(view: EditorView) {
            this.container = new CompletionList(view);
        }
        update(update: ViewUpdate) {
            this.container.mount(update.view.dom);
            this.container.update(update.view, update.state);
        }
        destroy() {
            this.container.destroy();
        }
    }
);
