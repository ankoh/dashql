import * as dashql from '@ankoh/dashql-core';

import { StateField, StateEffect } from '@codemirror/state';
import { EditorView, Decoration, DecorationSet, WidgetType, ViewUpdate, ViewPlugin } from '@codemirror/view';

// A completion hint that is shown inline
interface InlineCompletionHint {
    from: number;
    text: string;
    candidate: dashql.buffers.completion.CompletionCandidateT;
};
/// State effect to set the completion hint
export const setCompletionHint = StateEffect.define<InlineCompletionHint | null>();
/// State effect to clear the completion hint
export const clearCompletionHint = StateEffect.define<null>();

/// Widget that renders the completion hint text
class CompletionHintWidget extends WidgetType {
    constructor(private text: string) {
        super();
    }
    eq(other: CompletionHintWidget): boolean {
        return this.text === other.text;
    }
    toDOM(): HTMLElement {
        const span = document.createElement('span');
        span.className = 'cm-completion-hint';
        span.textContent = this.text;
        return span;
    }
    get estimatedHeight(): number {
        return -1; // Use line height
    }
}

// State field to manage completion hints
const completionHintState = StateField.define<{
    decorations: DecorationSet;
    hint: InlineCompletionHint | null;
}>({
    create() {
        return { decorations: Decoration.none, hint: null };
    },
    update(value, tr) {
        let decorations = value.decorations.map(tr.changes);
        let hint = value.hint;

        for (const effect of tr.effects) {
            if (effect.is(setCompletionHint)) {
                hint = effect.value;
                if (hint) {
                    const widget = new CompletionHintWidget(hint.text);
                    decorations = Decoration.set([
                        Decoration.widget({
                            widget,
                            side: 1,
                        }).range(hint.from)
                    ]);
                } else {
                    decorations = Decoration.none;
                }
            } else if (effect.is(clearCompletionHint)) {
                hint = null;
                decorations = Decoration.none;
            }
        }

        return { decorations, hint };
    },
    provide: f => EditorView.decorations.from(f, s => s.decorations)
});

// View plugin to handle completion hint updates
const completionHintPlugin = ViewPlugin.fromClass(
    class {
        constructor(public view: EditorView) { }

        update(update: ViewUpdate) {
            // Clear hints on selection changes or document changes that affect the hint position
            const state = update.state.field(completionHintState);
            if (state.hint) {
                const pos = update.state.selection.main.head;
                const hintStart = state.hint.from;
                const hintEnd = state.hint.from;

                // Clear hint if cursor moved away from hint position or document changed
                if (pos !== hintEnd || update.docChanged) {
                    // Schedule the clear operation to avoid update conflicts
                    setTimeout(() => {
                        if (this.view.state.field(completionHintState).hint) {
                            this.view.dispatch({
                                effects: clearCompletionHint.of(null)
                            });
                        }
                    }, 0);
                    // XXX This plugin should rather react to processor updates
                }
            }
        }
    }
);

export const DashQLCompletionHint = [completionHintState, completionHintPlugin];

// Temporary keymap for completion hints.
// XXX
export const completionHintKeymap = [
    {
        key: 'Tab',
        run: (view: EditorView): boolean => {
            const state = view.state.field(completionHintState);
            if (state.hint) {
                const { from, text } = state.hint;
                view.dispatch({
                    changes: { from, insert: text },
                    effects: clearCompletionHint.of(null),
                    selection: { anchor: from + text.length }
                });
                return true;
            }
            return false;
        }
    },
    {
        key: 'Escape',
        run: (view: EditorView): boolean => {
            const state = view.state.field(completionHintState);
            if (state.hint) {
                view.dispatch({
                    effects: clearCompletionHint.of(null)
                });
                return true;
            }
            return false;
        }
    }
];

/// Helper to show completion hint
export function showCompletionHint(
    view: EditorView,
    from: number,
    text: string,
    candidate: dashql.buffers.completion.CompletionCandidateT
): void {
    // Schedule the hint update to avoid conflicts with ongoing updates
    setTimeout(() => {
        // Check if the view is still valid and the position is still appropriate
        if (view.state.selection.main.head === from) {
            view.dispatch({
                effects: setCompletionHint.of({ from, text, candidate })
            });
        }
    }, 0);
}

/// Helper to clear completion hint
export function clearCompletionHintInView(view: EditorView): void {
    // Schedule the clear operation to avoid update conflicts
    setTimeout(() => {
        if (view.state.field(completionHintState).hint) {
            view.dispatch({
                effects: clearCompletionHint.of(null)
            });
        }
    }, 0);
}
