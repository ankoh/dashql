import { Prec } from '@codemirror/state';
import { EditorView, keymap, KeyBinding, ViewPlugin, ViewUpdate } from '@codemirror/view';

import { DashQLCompletionAbortEffect, DashQLCompletionSelectCandidateEffect, DashQLCompletionSelectCatalogObjectEffect, DashQLCompletionSelectTemplateEffect, DashQLCompletionStatus, DashQLProcessorPlugin } from './dashql_processor.js';
import { applyCompletion, updateCursorWithCompletion } from './dashql_completion_patches.js';

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
            case DashQLCompletionStatus.SELECTED_CATALOG_OBJECT:
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

    // Apply the patch
    view.dispatch({
        changes: applyCompletion(processor.scriptCompletion.candidatePatch),
        effects: DashQLCompletionSelectCandidateEffect.of(null),
        selection: {
            anchor: updateCursorWithCompletion(
                processor.scriptCompletion.candidatePatch,
                view.state.selection.main.anchor
            )
        }
    });
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

    switch (processor.scriptCompletion?.status) {
        case DashQLCompletionStatus.AVAILABLE: {
            // Try to complete the candidate object
            if (processor.scriptCompletion.candidatePatch.length > 0) {
                view.dispatch({
                    changes: applyCompletion(processor.scriptCompletion.candidatePatch),
                    effects: DashQLCompletionSelectCandidateEffect.of(null),
                    selection: {
                        anchor: updateCursorWithCompletion(
                            processor.scriptCompletion.candidatePatch,
                            view.state.selection.main.anchor
                        )
                    }
                });
                return true;
            }
            // Fall through to next case
        }
        case DashQLCompletionStatus.SELECTED_CANDIDATE: {
            // Try to complete the catalog object
            if (processor.scriptCompletion.catalogObjectPatch.length > 0) {
                view.dispatch({
                    changes: applyCompletion(processor.scriptCompletion.catalogObjectPatch),
                    effects: DashQLCompletionSelectCatalogObjectEffect.of(null),
                    selection: {
                        anchor: updateCursorWithCompletion(
                            processor.scriptCompletion.catalogObjectPatch,
                            view.state.selection.main.anchor
                        )
                    }
                });
                return true;
            }
            // Fall through to next case
        }
        case DashQLCompletionStatus.SELECTED_CATALOG_OBJECT: {
            // Try to complete the template
            if (processor.scriptCompletion.templatePatch.length > 0) {
                view.dispatch({
                    changes: applyCompletion(processor.scriptCompletion.templatePatch),
                    effects: DashQLCompletionSelectTemplateEffect.of(null),
                    selection: {
                        anchor: updateCursorWithCompletion(
                            processor.scriptCompletion.templatePatch,
                            view.state.selection.main.anchor
                        )
                    }
                });
                return true;
            }
            // We couldn't complete anything?
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
