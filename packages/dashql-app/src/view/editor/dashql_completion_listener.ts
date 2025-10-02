import { Prec } from '@codemirror/state';
import { EditorView, keymap, KeyBinding, ViewPlugin, ViewUpdate } from '@codemirror/view';

import { DashQLCompletionAbortEffect, DashQLCompletionSelectCandidateEffect, DashQLCompletionSelectQualificationEffect, DashQLCompletionSelectTemplateEffect, DashQLCompletionStatus, DashQLProcessorPlugin } from './dashql_processor.js';
import { completeCandidate, completeQualifiedName, completeTemplate } from './dashql_completion_patches.js';

type ScrollListener = (event: Event) => void;

interface ListenerTarget {
    /// The view
    view: EditorView;
    /// The listener for scroll events
    scrollListener: ScrollListener;
};

class DashQLCompletionEventListener {
    /// Listener target
    listenerTarget: ListenerTarget | null = null;

    // Start listening
    private startListening(view: EditorView) {
        if (this.listenerTarget != null) {
            return;
        }
        const onScroll = this.handleScrollEvent.bind(this);
        this.listenerTarget = {
            view,
            scrollListener: onScroll
        };
        view.scrollDOM.addEventListener('scroll', onScroll);
    }

    private stopListening() {
        if (this.listenerTarget == null) {
            return;
        }
        this.listenerTarget.view.scrollDOM.removeEventListener('scroll', this.listenerTarget.scrollListener);
        this.listenerTarget = null;
    }


    private handleScrollEvent(_event: Event) {
        if (this.listenerTarget == null) {
            return;
        }
        // Abort the completion
        this.listenerTarget.view.dispatch({
            effects: DashQLCompletionAbortEffect.of(null)
        });
    }

    update(update: ViewUpdate) {
        const processor = update.view.state.field(DashQLProcessorPlugin);
        switch (processor.scriptCompletion?.status) {
            case DashQLCompletionStatus.AVAILABLE:
            case DashQLCompletionStatus.SELECTED_CANDIDATE:
            case DashQLCompletionStatus.SELECTED_QUALIFICATION:
            case DashQLCompletionStatus.SELECTED_TEMPLATE:
                this.startListening(update.view);
                break;
            default:
                this.stopListening();
                break;
        }
    }

    destroy() {
        this.stopListening();
    }
};

function onEnter(view: EditorView) {
    // Has no processor state?
    // Then we just leave the key to CodeMirror.
    const processor = view.state.field(DashQLProcessorPlugin);
    if (processor == null) {
        return false;
    }

    // `Enter` can only be used to accept the immediate candidate
    if (processor.scriptCompletion?.status != DashQLCompletionStatus.AVAILABLE) {
        return false;
    }

    // Candidate valid?
    const completion = processor.scriptCompletion.buffer.read();
    if (processor.scriptCompletion.candidateId >= completion.candidatesLength()) {
        return false;
    }

    // Try to complete the candidate
    let patches = completeCandidate(processor.scriptCompletion, view.state.doc);
    if (patches.length > 0) {
        view.dispatch({
            effects: DashQLCompletionSelectCandidateEffect.of(processor.scriptCompletion.candidateId)
        });
        return true;
    }
    return true;
}

function onTab(view: EditorView) {
    // Has no processor state?
    // Then we just leave the key to CodeMirror.
    const processor = view.state.field(DashQLProcessorPlugin);
    if (processor == null) {
        return false;
    }
    if (processor.scriptCompletion == null) {
        return false;
    }
    const completionBuffer = processor.scriptCompletion.buffer.read();

    switch (processor.scriptCompletion?.status) {
        case DashQLCompletionStatus.AVAILABLE: {
            // Candidate id invalid?
            if (processor.scriptCompletion.candidateId >= completionBuffer.candidatesLength()) {
                return false;
            }
            // Try to complete the candidate
            let patches = completeCandidate(processor.scriptCompletion, view.state.doc);
            if (patches.length > 0) {
                view.dispatch({
                    effects: DashQLCompletionSelectCandidateEffect.of(processor.scriptCompletion.candidateId)
                });
                return true;
            }
            return false;
        }
        case DashQLCompletionStatus.SELECTED_CANDIDATE: {
            // Candidate id invalid?
            if (processor.scriptCompletion.candidateId >= completionBuffer.candidatesLength()) {
                return false;
            }
            // Catalog object id invalid?
            const ca = completionBuffer.candidates(processor.scriptCompletion.candidateId)!;
            if (processor.scriptCompletion.catalogObjectId >= ca.catalogObjectsLength()) {
                return false;
            }

            // Try to qualify the name
            let patches = completeQualifiedName(processor.scriptCompletion, view.state.doc);
            if (patches.length > 0) {
                view.dispatch({
                    effects: DashQLCompletionSelectQualificationEffect.of(processor.scriptCompletion.catalogObjectId)
                });
                return true;
            }
            // Template id invalid?
            if (processor.scriptCompletion.templateId >= ca.completionTemplatesLength()) {
                return false;
            }
            patches = completeTemplate(processor.scriptCompletion);
            if (patches.length > 0) {
                view.dispatch({
                    effects: DashQLCompletionSelectTemplateEffect.of(processor.scriptCompletion.templateId)
                });
                return true;
            }
            return false;
        }
        case DashQLCompletionStatus.SELECTED_QUALIFICATION: {
            // Candidate id invalid?
            if (processor.scriptCompletion.candidateId >= completionBuffer.candidatesLength()) {
                return false;
            }
            // Catalog object id invalid?
            const ca = completionBuffer.candidates(processor.scriptCompletion.candidateId)!;
            if (processor.scriptCompletion.catalogObjectId >= ca.catalogObjectsLength()) {
                return false;
            }
            // Template id invalid?
            if (processor.scriptCompletion.templateId >= ca.completionTemplatesLength()) {
                return false;
            }
            // Try to complete the template
            const patches = completeTemplate(processor.scriptCompletion);
            if (patches.length > 0) {
                view.dispatch({
                    effects: DashQLCompletionSelectTemplateEffect.of(processor.scriptCompletion.templateId)
                });
                return true;
            }
            return false;
        }
        case DashQLCompletionStatus.SELECTED_TEMPLATE: {
            // Tab has no effect with applied template
            return false;
        }
        default:
            break;
    }

    return false;
}

const KEYBINDINGS: KeyBinding[] = [{ key: "Enter", run: onEnter }, { key: "Tab", run: onTab }];
const KEYMAP = Prec.highest(keymap.of(KEYBINDINGS));

export const DashQLCompletionListenerPlugin = [
    Prec.highest(ViewPlugin.fromClass(DashQLCompletionEventListener)),
    Prec.highest(KEYMAP),
];
