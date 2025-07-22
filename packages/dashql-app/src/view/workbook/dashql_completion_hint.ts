import * as dashql from '@ankoh/dashql-core';

import { StateField, StateEffect, Transaction } from '@codemirror/state';
import { EditorView, Decoration, DecorationSet, WidgetType, keymap } from '@codemirror/view';

// A completion hint that is shown inline
interface InlineCompletionHint {
    from: number;
    text: string;
    candidate: dashql.buffers.completion.CompletionCandidateT;
};

// Effect to set a completion hint
export const SET_COMPLETION_HINT = StateEffect.define<InlineCompletionHint | null>();
// Effect to clear a completion hint
export const CLEAR_COMPLETION_HINT = StateEffect.define<null>();

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

interface CompletionHintState {
    hint: InlineCompletionHint | null;
    decorations: DecorationSet;
}

// State field to manage completion hints
const COMPLETION_HINT_STATE = StateField.define<CompletionHintState>({
    create() {
        return { decorations: Decoration.none, hint: null };
    },
    update(value: CompletionHintState, tr: Transaction) {
        let hint: InlineCompletionHint | null = null;
        let decorations: DecorationSet = Decoration.none;
        let cleared = false;

        // Check if there are completion hint updates
        for (const effect of tr.effects) {
            if (effect.is(SET_COMPLETION_HINT)) {
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
            } else if (effect.is(CLEAR_COMPLETION_HINT)) {
                cleared = true;
            }
        }
        // Hint changed?
        if (hint != null || cleared) {
            return { hint, decorations };
        }

        // Did the do change??
        if (tr.docChanged || tr.newSelection.main.head !== value.hint?.from) {
            return { hint: null, decorations: Decoration.none };
        }
        return {
            decorations: value.decorations?.map(tr.changes) ?? null,
            hint: value.hint,
        };
    },
    provide: f => EditorView.decorations.from(f, s => s.decorations ?? Decoration.none)
});

// Keymap for completion hints
export const COMPLETION_HINT_KEYMAP = [
    {
        key: 'Tab',
        run: (view: EditorView): boolean => {
            const state = view.state.field(COMPLETION_HINT_STATE);
            if (state.hint) {
                const { from, text } = state.hint;
                view.dispatch({
                    changes: { from, insert: text },
                    effects: CLEAR_COMPLETION_HINT.of(null),
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
            const state = view.state.field(COMPLETION_HINT_STATE);
            if (state.hint) {
                view.dispatch({
                    effects: CLEAR_COMPLETION_HINT.of(null)
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
                effects: SET_COMPLETION_HINT.of({ from, text, candidate })
            });
        }
    }, 0);
}

/// Helper to clear completion hint
export function clearCompletionHintInView(view: EditorView): void {
    // Schedule the clear operation to avoid update conflicts
    setTimeout(() => {
        if (view.state.field(COMPLETION_HINT_STATE).hint) {
            view.dispatch({
                effects: CLEAR_COMPLETION_HINT.of(null)
            });
        }
    }, 0);
}

export const DashQLCompletionHint = [
    COMPLETION_HINT_STATE,
    keymap.of(COMPLETION_HINT_KEYMAP)
];
