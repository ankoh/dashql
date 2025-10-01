import { Prec } from '@codemirror/state';
import { EditorView, keymap, KeyBinding, ViewPlugin, ViewUpdate } from '@codemirror/view';

import { DASHQL_COMPLETION_APPLIED_CANDIDATE, DASHQL_COMPLETION_APPLIED_QUALIFIED_CANDIDATE, DASHQL_COMPLETION_APPLIED_TEMPLATE, DASHQL_COMPLETION_AVAILABLE, DashQLCompletionAbortEffect, DashQLCompletionSelectCandidateEffect, DashQLCompletionSelectQualificationEffect, DashQLProcessorPlugin } from './dashql_processor.js';
import { qualifyName, canCompleteTemplate } from './dashql_completion_hint.js';

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

        console.log('Started listening to key and scroll events');
    }

    private stopListening() {
        if (this.listenerTarget == null) {
            return;
        }
        this.listenerTarget.view.scrollDOM.removeEventListener('scroll', this.listenerTarget.scrollListener);
        this.listenerTarget = null;

        console.log('Stopped listening to key and scroll events');
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
        switch (processor.scriptCompletion?.type) {
            case DASHQL_COMPLETION_AVAILABLE:
            case DASHQL_COMPLETION_APPLIED_CANDIDATE:
            case DASHQL_COMPLETION_APPLIED_QUALIFIED_CANDIDATE:
            case DASHQL_COMPLETION_APPLIED_TEMPLATE:
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
    if (processor.scriptCompletion?.type != DASHQL_COMPLETION_AVAILABLE) {
        return false;
    }

    // No candidate id?
    // Then we also prevent the selection
    const completion = processor.scriptCompletion.value;
    if (completion.candidateId == null) {
        return false;
    }

    // Select the candidate
    view.dispatch({
        effects: DashQLCompletionSelectCandidateEffect.of({
            buffer: completion.buffer,
            candidateId: completion.candidateId,
            catalogObjectId: completion.catalogObjectId,
            templateId: completion.templateId
        })
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

    switch (processor.scriptCompletion?.type) {
        case DASHQL_COMPLETION_AVAILABLE: {
            // No candidate id?
            const completion = processor.scriptCompletion.value;
            if (completion.candidateId == null) {
                return false;
            }
            // Select the candidate
            view.dispatch({
                effects: DashQLCompletionSelectCandidateEffect.of({
                    buffer: processor.scriptCompletion.value.buffer,
                    candidateId: completion.candidateId,
                    catalogObjectId: completion.catalogObjectId,
                    templateId: completion.templateId
                })
            });
            return true;
        }
        case DASHQL_COMPLETION_APPLIED_CANDIDATE: {
            // No candidate id?
            const completion = processor.scriptCompletion.value;
            if (completion.catalogObjectId == null) {
                return false;
            }
            // Can qualify the name?
            const patches = qualifyName(processor.scriptCompletion, view.state.doc);
            if (patches.length > 0) {
                view.dispatch({
                    effects: DashQLCompletionSelectQualificationEffect.of({
                        buffer: processor.scriptCompletion.value.buffer,
                        candidateId: completion.candidateId,
                        catalogObjectId: completion.catalogObjectId,
                        templateId: completion.templateId
                    })
                });
                return true;
            }
            // Can complete the template?
            else if (canCompleteTemplate(processor.scriptCompletion, view.state.doc)) {
                view.dispatch({
                    effects: DashQLCompletionSelectQualificationEffect.of({
                        buffer: processor.scriptCompletion.value.buffer,
                        candidateId: completion.candidateId,
                        catalogObjectId: completion.catalogObjectId,
                        templateId: completion.templateId
                    })
                });
                return true;
            }
            return false;
        }
        case DASHQL_COMPLETION_APPLIED_QUALIFIED_CANDIDATE:
            // No candidate id?
            const completion = processor.scriptCompletion.value;
            if (completion.catalogObjectId == null) {
                return false;
            }
            // Can complete the template?
            if (canCompleteTemplate(processor.scriptCompletion, view.state.doc)) {
                view.dispatch({
                    effects: DashQLCompletionSelectQualificationEffect.of({
                        buffer: processor.scriptCompletion.value.buffer,
                        candidateId: completion.candidateId,
                        catalogObjectId: completion.catalogObjectId,
                        templateId: completion.templateId
                    })
                });
                return true;
            }
            return false;
        case DASHQL_COMPLETION_APPLIED_TEMPLATE:
            // Tab has no effect with applied template
            return false;
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
