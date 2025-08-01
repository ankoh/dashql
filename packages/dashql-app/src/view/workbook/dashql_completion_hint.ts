import * as dashql from '@ankoh/dashql-core';

import { StateField, StateEffect, Transaction, ChangeSpec } from '@codemirror/state';
import { EditorView, Decoration, DecorationSet, WidgetType, keymap } from '@codemirror/view';

import { DashQLCompletion } from './dashql_completion.js';
import { readColumnIdentifierSnippet } from '../snippet/script_template_snippet.js';

/// A completion content
interface CompletionHint {
    /// The location
    at: number;
    /// The completion text
    text: string;
}

/// A completion hint that hints the autocompletion candidate
interface CandidateCompletion {
    /// The content
    hint: CompletionHint;
};

/// An extended completion hint that shows an extended snippet
interface ExtendedCompletion {
    /// The prefix
    hintPrefix: CompletionHint | null;
    /// The suffix
    hintSuffix: CompletionHint | null;
}

interface CompletionHints {
    /// The candidate completion hint
    candidate: CandidateCompletion;
    /// The extended completion hint
    extended: ExtendedCompletion | null;
}

// Effect to set a simple completion hint
export const SET_COMPLETION_HINTS = StateEffect.define<CompletionHints>();
// Effect to clear a completion hint
export const CLEAR_COMPLETION_HINTS = StateEffect.define<null>();

class CompletionHintWidget extends WidgetType {
    constructor(
        protected text: string,
    ) {
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
    hints: CompletionHints | null;
    decorations: DecorationSet;
}

// State field to manage completion hints
const COMPLETION_HINT_STATE = StateField.define<CompletionHintState>({
    create() {
        return {
            decorations: Decoration.none,
            hints: null
        };
    },
    update(value: CompletionHintState, tr: Transaction) {
        let hints: CompletionHints | null = null;
        let decorations: DecorationSet = Decoration.none;
        let cleared = false;

        // Check if there are completion hint updates
        for (const effect of tr.effects) {
            if (effect.is(SET_COMPLETION_HINTS)) {
                hints = effect.value;

                const candidate = new CompletionHintWidget(hints.candidate.hint.text);
                if (hints.extended != null) {
                    const widgets = [];
                    if (hints.extended.hintPrefix != null) {
                        const prefix = new CompletionHintWidget(hints.extended.hintPrefix.text);
                        widgets.push(Decoration.widget({ widget: prefix, side: -1 }).range(hints.extended.hintPrefix.at));
                    }
                    widgets.push(Decoration.widget({ widget: candidate, side: 1 }).range(hints.candidate.hint.at));
                    if (hints.extended.hintSuffix != null) {
                        const prefix = new CompletionHintWidget(hints.extended.hintSuffix.text);
                        widgets.push(Decoration.widget({ widget: prefix, side: 2 }).range(hints.extended.hintSuffix.at));
                    }
                    decorations = Decoration.set(widgets);
                } else {
                    decorations = Decoration.set([
                        Decoration.widget({ widget: candidate, side: 1 }).range(hints.candidate.hint.at),
                    ]);
                }
            } else if (effect.is(CLEAR_COMPLETION_HINTS)) {
                cleared = true;
            }
        }
        // Hint changed?
        if (hints != null || cleared) {
            return { hints: hints, decorations };
        }

        // Did the do change??
        if (tr.docChanged || tr.newSelection.main.head !== value.hints?.candidate.hint.at) {
            return { hints: null, decorations: Decoration.none };
        }
        return {
            decorations: value.decorations?.map(tr.changes) ?? null,
            hints: value.hints,
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
            if (state.hints) {
                const textChange: ChangeSpec = {
                    from: state.hints.candidate.hint.at,
                    insert: state.hints.candidate.hint.text
                };
                view.dispatch({
                    changes: textChange,
                    selection: { anchor: state.hints.candidate.hint.at + state.hints.candidate.hint.text.length },
                    effects: CLEAR_COMPLETION_HINTS.of(null),
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
            if (state.hints) {
                view.dispatch({
                    effects: CLEAR_COMPLETION_HINTS.of(null)
                });
                return true;
            }
            return false;
        }
    }
];

export function showCompletionHint(candidate: DashQLCompletion) {
    const view = candidate.view;
    if (!view) return;

    const completion = candidate.completion.read();
    if (completion.candidatesLength() <= candidate.candidateId) {
        return;
    }
    const tmpNode = new dashql.buffers.parser.Node();

    // Show inline completion hint.
    const candidateData = completion.candidates(candidate.candidateId)!;
    const candidateText = candidateData.completionText();
    const replaceTextAt = candidateData.replaceTextAt();
    if (candidateText && replaceTextAt && candidate.view) {
        const _cursorPos = candidate.view.state.selection.main.head;
        const replaceFrom = replaceTextAt.offset();
        const replaceTo = replaceFrom + replaceTextAt.length();

        // XXX Wouldn't we rather track it as currentTokenStart or so?
        //     replaceFrom sounds dangerous.

        // Calculate the hint text (part that would be inserted after current cursor)
        const currentText = candidate.view.state.doc.sliceString(replaceFrom, replaceTo);

        if (candidateText.startsWith(currentText)) {
            const hintText = candidateText.slice(currentText.length);
            if (hintText.length > 0) {
                const view = candidate.view!;
                const candidateCompletion: CandidateCompletion = {
                    hint: {
                        at: replaceTo,
                        text: hintText
                    }
                };
                let extended: ExtendedCompletion | null = null;
                if (candidateData.completionTemplatesLength() > 0) {
                    const template = candidateData.completionTemplates(0)!;
                    if (template.snippetsLength() > 0) {
                        const snippet = template.snippets(0)!;
                        const snippetModel = readColumnIdentifierSnippet(snippet, tmpNode);
                        extended = {
                            hintPrefix: {
                                at: replaceFrom,
                                text: snippetModel.textBefore
                            },
                            hintSuffix: {
                                at: replaceTo,
                                text: snippetModel.textAfter
                            }
                        };
                    }
                }
                setTimeout(() => {
                    view.dispatch({
                        effects: SET_COMPLETION_HINTS.of({
                            candidate: candidateCompletion,
                            extended
                        })
                    });
                }, 0);
            }
        }
    }
}

export const DashQLCompletionHint = [
    COMPLETION_HINT_STATE,
    keymap.of(COMPLETION_HINT_KEYMAP)
];
