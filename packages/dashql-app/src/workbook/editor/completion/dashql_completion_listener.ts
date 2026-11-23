import { EditorState, Prec, StateEffectType } from '@codemirror/state';
import { EditorView, keymap, KeyBinding, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { insertTab } from '@codemirror/commands';

import { DashQLCompletionAbortEffect, DashQLCompletionNextCandidateEffect, DashQLCompletionNextCandidateVariantEffect, DashQLCompletionPreviousCandidateEffect, DashQLCompletionPreviousCandidateVariantEffect, DashQLCompletionSelectCandidateEffect, DashQLCompletionSelectCatalogObjectEffect, DashQLProcessorPlugin, hasEmptyCompletionTarget } from '../dashql_processor.js';
import { DashQLCompletionStatus } from './dashql_completion_state.js';
import { applyCompletion, shouldAutoQualifyNonDefaultTable, updateCursorWithCompletion } from './dashql_completion_patches.js';

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
        if (_event.target instanceof Element && _event.target.closest('[data-dashql-completion-list]')) {
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
                const candidate = processor.scriptCompletion.buffer.read().candidates(
                    processor.scriptCompletion.candidateId,
                );
                const catalogObject = candidate?.catalogObjects(processor.scriptCompletion.catalogObjectId);
                const applyQualification = catalogObject != null
                    && shouldAutoQualifyNonDefaultTable(catalogObject)
                    && processor.scriptCompletion.catalogObjectPatch.length > 0;
                const patches = applyQualification
                    ? [...processor.scriptCompletion.candidatePatch, ...processor.scriptCompletion.catalogObjectPatch]
                    : processor.scriptCompletion.candidatePatch;
                const target = candidate?.targetLocation();
                const cursorOverride = target == null || candidate == null
                    ? null
                    : target.offset() + (candidate.completionCursorOffset() ?? candidate.completionText()!.length);
                view.dispatch({
                    changes: applyCompletion(patches),
                    effects: applyQualification
                        ? DashQLCompletionSelectCatalogObjectEffect.of(null)
                        : DashQLCompletionSelectCandidateEffect.of(null),
                    selection: {
                        anchor: applyQualification
                            ? updateCursorWithCompletion(patches, view.state.selection.main.anchor)
                            : cursorOverride ?? updateCursorWithCompletion(
                            patches,
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
                const cursorOverride = processor.scriptCompletion.catalogObjectCursorOffset;
                view.dispatch({
                    changes: applyCompletion(processor.scriptCompletion.catalogObjectPatch),
                    effects: DashQLCompletionSelectCatalogObjectEffect.of(null),
                    selection: {
                        anchor: cursorOverride ?? updateCursorWithCompletion(
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

/// Step through the candidates of an available completion, or through the catalog objects of its candidate. Leaves the
/// key to CodeMirror if there is nothing to step to.
function stepCompletion(effect: StateEffectType<null>, variants: boolean) {
    return (view: EditorView) => {
        const completion = view.state.field(DashQLProcessorPlugin).scriptCompletion;
        if (completion?.status != DashQLCompletionStatus.AVAILABLE) {
            return false;
        }
        const buffer = completion.buffer.read();
        let count: number;
        if (variants) {
            count = buffer.candidates(completion.candidateId)?.catalogObjectsLength() ?? 0;
        } else if (completion.passiveHint) {
            // A passive hint has no list to step through
            return false;
        } else {
            count = buffer.candidatesLength();
        }
        if (count <= 1) {
            return false;
        }
        view.dispatch({ effects: effect.of(null) });
        return true;
    };
}

const KEYBINDINGS: KeyBinding[] = [
    { key: "Tab", run: onTab },
    { key: "Escape", run: onEsc },
    { key: "ArrowLeft", run: stepCompletion(DashQLCompletionPreviousCandidateVariantEffect, true) },
    { key: "ArrowRight", run: stepCompletion(DashQLCompletionNextCandidateVariantEffect, true) },
    { key: "ArrowDown", run: stepCompletion(DashQLCompletionNextCandidateEffect, false) },
    { key: "ArrowUp", run: stepCompletion(DashQLCompletionPreviousCandidateEffect, false) },
];
const KEYMAP = Prec.highest(keymap.of(KEYBINDINGS));

// Moving the cursor away from an empty target leaves nothing for the completion to stand on
const EMPTY_TARGET_ABORT = EditorState.transactionExtender.of((tr) => {
    if (tr.docChanged || !tr.selection) return null;
    const completion = tr.startState.field(DashQLProcessorPlugin).scriptCompletion;
    if (completion?.status !== DashQLCompletionStatus.AVAILABLE) return null;
    if (!hasEmptyCompletionTarget(completion.buffer.read())) return null;
    return { effects: DashQLCompletionAbortEffect.of(null) };
});

export const DashQLCompletionListenerPlugin = [
    Prec.highest(ViewPlugin.fromClass(DashQLCompletionEventListener)),
    Prec.highest(KEYMAP),
    EMPTY_TARGET_ABORT,
];
