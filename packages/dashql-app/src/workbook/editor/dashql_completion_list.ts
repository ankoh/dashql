import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { EditorState } from '@codemirror/state';

import { DashQLCompletionNextCandidateVariantEffect, DashQLCompletionPreviousCandidateVariantEffect, DashQLCompletionState, DashQLCompletionStatus, DashQLProcessorPlugin } from './dashql_processor.js';
import { CandidateListRenderer, collectCandidates, placeBelowOrAbove, type Position } from '../../views/completion_list/completion_list_view.js';


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
    /// Helper to compute a position
    static computePosition(view: EditorView, offset: number): (Position | null) {
        const candidateCoords = view.coordsAtPos(offset);
        if (candidateCoords == null) return null;
        return placeBelowOrAbove(candidateCoords);
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
        if (processor.scriptCompletion?.status !== DashQLCompletionStatus.AVAILABLE
            || processor.scriptCompletion?.passiveHint) {
            if (!this.list.isHidden) {
                view.requestMeasure<(Position | null)>({
                    key: this,
                    read: (_view) => null,
                    write: (_null, _view) => {
                        this.list.hide();
                    }
                });
            }
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

        // Collect all candidates
        const pending = collectCandidates(completionBuffer, selectedCandidate, selectedCatalogObject);

        // Update the container position.
        // Keyed so that a later update (e.g. hiding) supersedes a pending measure.
        // The offset can still outlive the text it points into, the list is hidden then.
        view.requestMeasure<(Position | null)>({
            key: this,
            read: (view) => {
                if (candidateLocOffset > view.state.doc.length) return null;
                return CompletionList.computePosition(view, candidateLocOffset);
            },
            write: (pos: Position | null, _view) => {
                if (pos == null) {
                    this.list.hide();
                    return;
                }
                this.list.show();
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
