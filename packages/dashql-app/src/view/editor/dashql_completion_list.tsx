import * as dashql from '@ankoh/dashql-core';
;
import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { EditorState } from '@codemirror/state';

import { DASHQL_COMPLETION_AVAILABLE, DashQLProcessorPlugin } from './dashql_processor.js';


// This file contains a CodeMirror plugin for rendering a completion list.
// The rendering itself is virtualized but deliberately does NOT use React.
// We're implementing the view consolidation manually here.
//
// This makes the extension independent and allows separating it as library later.


interface Position {
    /// The top offset
    top: number;
    /// The left offset
    left: number;
}

interface VirtualListView {
    /// Is the list shown?
    visible: boolean;
    /// The list position
    position: Position;
}

interface RenderedListView extends VirtualListView {
    /// The overlay container
    overlayContainer: HTMLDivElement;
    /// The list container
    listContainer: HTMLDivElement;
}

interface VirtualCompletionCandidate {
    /// The candidate text
    candidateLabel: string;
}

interface RenderedCompletionCandidate extends VirtualCompletionCandidate {
    /// The entry element
    entryElement: HTMLDivElement;
    /// The name element
    nameElement: HTMLSpanElement;
}

class CompletionList {
    /// The dom that this container is mounted to (if any)
    dom: HTMLElement | null = null;
    /// The rendered list shown
    renderedList: RenderedListView;
    /// The rendered candidates
    renderedCandidates: RenderedCompletionCandidate[] = [];
    /// The pending list shown
    pendingList: VirtualListView;
    /// The pending candidates
    pendingCandidates: VirtualCompletionCandidate[] = [];

    constructor() {
        const overlayContainer = document.createElement('div');
        const listContainer = document.createElement('div');
        this.renderedList = {
            visible: false,
            position: { top: -1, left: -1 },
            overlayContainer,
            listContainer
        };
        this.pendingList = {
            visible: false,
            position: { top: -1, left: -1 },
        };
        overlayContainer.appendChild(listContainer);
        this.pendingCandidates = [];
        this.renderedCandidates = [];

        overlayContainer.style.display = 'none';
        overlayContainer.style.position = 'absolute';
        overlayContainer.style.width = '50px';
        overlayContainer.style.height = '50px';
        overlayContainer.style.backgroundColor = 'red';
        overlayContainer.style.border = '1px solid darkred';
        overlayContainer.style.zIndex = '1000';
        overlayContainer.style.pointerEvents = 'none';
        overlayContainer.style.borderRadius = '4px';
    }

    /// Unmount a completion list container
    unmount() {
        if (this.dom) {
            this.dom.removeChild(this.renderedList.overlayContainer);
            this.dom = null;
        }
    }
    /// Destroy the container
    destroy() {
        this.unmount();
        this.renderedList.overlayContainer.remove();
    }
    /// Mount a completion list container
    mount(dom: HTMLElement) {
        if (this.dom == dom) {
            return;
        }
        this.unmount();
        dom.appendChild(this.renderedList.overlayContainer);
        this.dom = dom;
    }
    /// Helper to compute a position
    static computePosition(view: EditorView, offset: number): (Position | null) {
        const candidateCoords = view.coordsAtPos(offset);
        if (candidateCoords == null) return null;

        // Get the editor's DOM rect for proper positioning
        const editorRect = view.dom.getBoundingClientRect();
        const viewportRect = view.scrollDOM.getBoundingClientRect();

        // Calculate position relative to the editor container
        let left = candidateCoords.left - editorRect.left;
        let top = candidateCoords.bottom - editorRect.top + 5; // 5px below cursor

        // Ensure the box stays within the viewport bounds
        const boxWidth = 50;
        const boxHeight = 50;

        // Adjust horizontal position if it would overflow
        if (left + boxWidth > viewportRect.width) {
            left = candidateCoords.left - editorRect.left - boxWidth; // Position to the left of cursor
        }

        // Adjust vertical position if it would overflow
        if (top + boxHeight > viewportRect.height) {
            top = candidateCoords.top - editorRect.top - boxHeight - 5; // Position above cursor
        }

        // Ensure we don't go negative
        left = Math.max(0, left);
        top = Math.max(0, top);

        return { left, top };
    }

    /// Collect the candidates
    collectCandidates(completion: dashql.buffers.completion.Completion) {
        const out: VirtualCompletionCandidate[] = [];
        const tmpCandidate = new dashql.buffers.completion.CompletionCandidate();
        for (let i = 0; i < completion.candidatesLength(); ++i) {
            const candidate = completion.candidates(i, tmpCandidate)!;
            out.push({
                candidateLabel: candidate.displayText()!
            });
        }
        this.pendingCandidates = out;
    }

    /// Consolidate the candidate list
    consolidateRenderedCandidates() {
        const pendingCandidates = this.pendingCandidates;
        this.pendingCandidates = [];
        // Consolidate shared
        const n = Math.min(pendingCandidates.length, this.renderedCandidates.length);
        for (let i = 0; i < n; ++i) {
            const pending = pendingCandidates[i];
            const rendered: RenderedCompletionCandidate = this.renderedCandidates[i];
            if (pending.candidateLabel == rendered.candidateLabel) {
                continue;
            }
            rendered.nameElement.textContent = pending.candidateLabel;
            rendered.candidateLabel = pending.candidateLabel;
        }
        // Delete excess rendered
        const dead = this.renderedCandidates.splice(n, this.renderedCandidates.length - n);
        for (let i = 0; i < dead.length; ++i) {
            this.renderedList.listContainer.removeChild(dead[i].entryElement);
            dead[i].entryElement.remove();
        }
        // Create new rendered
        for (let i = n; i < pendingCandidates.length; ++i) {
            const pending = pendingCandidates[i];
            const containerElement = document.createElement('div');
            const nameElement = document.createElement('span');
            nameElement.textContent = pending.candidateLabel;
            containerElement.appendChild(nameElement);
            this.renderedList.listContainer.appendChild(containerElement);
            this.renderedCandidates.push({
                ...pending,
                entryElement: containerElement,
                nameElement,
            });
        }
        // List visibility
        if (this.renderedList.visible != this.pendingList.visible) {
            this.renderedList.visible = this.pendingList.visible;
            if (this.renderedList.visible) {
                this.renderedList.overlayContainer.style.display = 'block';
            } else {
                this.renderedList.overlayContainer.style.display = 'none';
            }
        }
        // List position
        if (this.renderedList.position.top != this.pendingList.position.top || this.renderedList.position.left != this.pendingList.position.left) {
            this.renderedList.position.top = this.pendingList.position.top;
            this.renderedList.position.left = this.pendingList.position.left;
            this.renderedList.overlayContainer.style.top = `${this.renderedList.position.top}px`;
            this.renderedList.overlayContainer.style.left = `${this.renderedList.position.left}px`;
        }
    }

    /// Update the completion list
    update(view: EditorView, state: EditorState) {
        const processor = state.field(DashQLProcessorPlugin);

        // Hide completion?
        if (processor.scriptCompletion?.type !== DASHQL_COMPLETION_AVAILABLE) {
            if (this.pendingList.visible) {
                view.requestMeasure<(Position | null)>({
                    read: (_view) => null,
                    write: (_null, _view) => {
                        this.pendingList.visible = false;
                        this.consolidateRenderedCandidates();
                    }
                });
            }
            return;
        }

        // Read completion
        const completion = processor.scriptCompletion.value ?? null;
        if (completion == null || completion.candidateId == null) {
            return;
        }

        // Read completion candidate
        const completionBuffer = completion.buffer.read();
        this.collectCandidates(completionBuffer);

        // Current candidate
        const candidate = completionBuffer.candidates(completion.candidateId);
        if (candidate == null) {
            return;
        }
        const candidateLoc = candidate.targetLocation()!;
        const candidateLocOffset = candidateLoc.offset();

        // Update the container position
        view.requestMeasure<(Position | null)>({
            read: (view) => {
                const pos = CompletionList.computePosition(view, candidateLocOffset);
                if (pos != null) {
                    this.pendingList.visible = true;
                    this.pendingList.position = pos;
                } else {
                    this.pendingList.visible = false;
                }
                return null;
            },
            write: (_n, _view) => {
                this.consolidateRenderedCandidates();
            }
        });
    }
}

export const DashQLCompletionListPlugin = ViewPlugin.fromClass(
    class {
        container: CompletionList;

        constructor(_view: EditorView) {
            this.container = new CompletionList();
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
