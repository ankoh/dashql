import { EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap, KeyBinding, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { insertTab } from '@codemirror/commands';

import { DashQLCompletionAbortEffect, DashQLCompletionNextCandidateEffect, DashQLCompletionNextCandidateVariantEffect, DashQLCompletionPreviousCandidateEffect, DashQLCompletionPreviousCandidateVariantEffect, DashQLCompletionSelectCandidateEffect, DashQLCompletionSelectCatalogObjectEffect, DashQLCompletionSelectTemplateEffect, DashQLCompletionStatus, DashQLProcessorPlugin } from './dashql_processor.js';
import { applyCompletion, updateCursorWithCompletion } from './dashql_completion_patches.js';

type EventListener = (event: Event) => void;

interface ListenerTarget {
    /// The view
    view: EditorView;
    /// The listener for scroll events
    scrollListener: EventListener;
    /// The listener for mousedown events
    mousedownListener: EventListener;
    /// The listener for blur events
    blurListener: EventListener;
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
        const onMousedown = this.handleMousedownEvent.bind(this);
        const onBlur = this.handleBlurEvent.bind(this);
        this.listenerTarget = {
            view,
            scrollListener: onScroll,
            mousedownListener: onMousedown,
            blurListener: onBlur,
        };
        view.scrollDOM.addEventListener('scroll', onScroll);
        document.addEventListener('mousedown', onMousedown, true);
        view.contentDOM.addEventListener('blur', onBlur);
    }

    private stopListening() {
        if (this.listenerTarget == null) {
            return;
        }
        this.listenerTarget.view.scrollDOM.removeEventListener('scroll', this.listenerTarget.scrollListener);
        document.removeEventListener('mousedown', this.listenerTarget.mousedownListener, true);
        this.listenerTarget.view.contentDOM.removeEventListener('blur', this.listenerTarget.blurListener);
        this.listenerTarget = null;
    }

    private handleMousedownEvent(_event: Event) {
        if (this.listenerTarget == null) {
            return;
        }
        this.listenerTarget.view.dispatch({
            effects: DashQLCompletionAbortEffect.of(null)
        });
    }

    private handleScrollEvent(_event: Event) {
        if (this.listenerTarget == null) {
            return;
        }
        this.listenerTarget.view.dispatch({
            effects: DashQLCompletionAbortEffect.of(null)
        });
    }

    private handleBlurEvent(_event: Event) {
        if (this.listenerTarget == null) {
            return;
        }
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
    // Passive hints are not accepted by Enter — let it insert a newline
    if (processor.scriptCompletion?.passiveHint) {
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
        return insertTab(view);
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
                const cursorOverride = processor.scriptCompletion.templateCursorOffset;
                view.dispatch({
                    changes: applyCompletion(processor.scriptCompletion.templatePatch),
                    effects: DashQLCompletionSelectTemplateEffect.of(null),
                    selection: {
                        anchor: cursorOverride ?? updateCursorWithCompletion(
                            processor.scriptCompletion.templatePatch,
                            view.state.selection.main.anchor
                        )
                    }
                });
                return true;
            }
            return insertTab(view);
        }
        case DashQLCompletionStatus.SELECTED_TEMPLATE: {
            return insertTab(view);
        }
        default:
            break;
    }

    return insertTab(view);
}

function onEsc(view: EditorView) {
    // Has no processor state?
    // Then we just leave the key to CodeMirror.
    const processor = view.state.field(DashQLProcessorPlugin);
    if (processor == null) {
        return false;
    }

    // No completion ongoing?
    if (processor.scriptCompletion?.status != DashQLCompletionStatus.AVAILABLE) {
        return false;
    }

    // Apply the patch
    view.dispatch({
        effects: DashQLCompletionAbortEffect.of(null),
    });
    return true;
}

function onArrowUp(view: EditorView) {
    const processor = view.state.field(DashQLProcessorPlugin);
    if (processor == null) { return false; }
    if (processor.scriptCompletion?.status != DashQLCompletionStatus.AVAILABLE) {
        return false;
    }
    if (processor.scriptCompletion?.passiveHint) { return false; }
    const c = processor.scriptCompletion.buffer.read();
    const candidateCount = c.candidatesLength();
    if (candidateCount > 1) {
        view.dispatch({
            effects: DashQLCompletionPreviousCandidateEffect.of(null),
        });
        return true;
    } else {
        return false;
    }
}

function onArrowDown(view: EditorView) {
    const processor = view.state.field(DashQLProcessorPlugin);
    if (processor == null) { return false; }
    if (processor.scriptCompletion?.status != DashQLCompletionStatus.AVAILABLE) {
        console.log(processor.scriptCompletion?.status);
        return false;
    }
    if (processor.scriptCompletion?.passiveHint) { return false; }
    const c = processor.scriptCompletion.buffer.read();
    const candidateCount = c.candidatesLength();
    if (candidateCount > 1) {
        view.dispatch({
            effects: DashQLCompletionNextCandidateEffect.of(null),
        });
        return true;
    } else {
        return false;
    }
}

function onArrowRight(view: EditorView) {
    const processor = view.state.field(DashQLProcessorPlugin);
    if (processor == null) { return false; }
    if (processor.scriptCompletion?.status != DashQLCompletionStatus.AVAILABLE) {
        console.log(processor.scriptCompletion?.status);
        return false;
    }
    const completion = processor.scriptCompletion.buffer.read();
    const candidate = completion.candidates(processor.scriptCompletion.candidateId);
    const objectCount = candidate?.catalogObjectsLength() ?? 0;
    if (objectCount > 1) {
        view.dispatch({
            effects: DashQLCompletionNextCandidateVariantEffect.of(null),
        });
        return true;
    } else {
        return false;
    }
}

function onArrowLeft(view: EditorView) {
    const processor = view.state.field(DashQLProcessorPlugin);
    if (processor == null) { return false; }
    if (processor.scriptCompletion?.status != DashQLCompletionStatus.AVAILABLE) {
        console.log(processor.scriptCompletion?.status);
        return false;
    }
    const completion = processor.scriptCompletion.buffer.read();
    const candidate = completion.candidates(processor.scriptCompletion.candidateId);
    const objectCount = candidate?.catalogObjectsLength() ?? 0;
    if (objectCount > 1) {
        view.dispatch({
            effects: DashQLCompletionPreviousCandidateVariantEffect.of(null),
        });
        return true;
    } else {
        return false;
    }
}

const KEYBINDINGS: KeyBinding[] = [
    { key: "Enter", run: onEnter },
    { key: "Tab", run: onTab },
    { key: "Escape", run: onEsc },
    { key: "ArrowLeft", run: onArrowLeft },
    { key: "ArrowRight", run: onArrowRight },
    { key: "ArrowDown", run: onArrowDown },
    { key: "ArrowUp", run: onArrowUp },
];
const KEYMAP = Prec.highest(keymap.of(KEYBINDINGS));

const PASSIVE_HINT_ABORT = EditorState.transactionExtender.of((tr) => {
    if (tr.docChanged || !tr.selection) return null;
    const processor = tr.startState.field(DashQLProcessorPlugin);
    if (!processor.scriptCompletion?.passiveHint) return null;
    if (processor.scriptCompletion?.status !== DashQLCompletionStatus.AVAILABLE) return null;
    return { effects: DashQLCompletionAbortEffect.of(null) };
});

export const DashQLCompletionListenerPlugin = [
    Prec.highest(ViewPlugin.fromClass(DashQLCompletionEventListener)),
    Prec.highest(KEYMAP),
    PASSIVE_HINT_ABORT,
];
