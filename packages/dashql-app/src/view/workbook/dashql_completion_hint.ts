import * as dashql from '@ankoh/dashql-core';

import { currentCompletions, completionStatus, selectedCompletion } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { EditorView, Decoration, DecorationSet, WidgetType, ViewPlugin, ViewUpdate } from '@codemirror/view';

import { DashQLCompletion } from './dashql_completion.js';
import { readColumnIdentifierSnippet } from '../snippet/script_template_snippet.js';

import * as styles from './dashql_completion_hint.module.css';

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

/// Helper to compute the completion hints given a completion candidate a new editor state
export function computeCompletionHints(candidate: DashQLCompletion, state: EditorState): CompletionHints | null {
    const completion = candidate.completion.read();
    if (completion.candidatesLength() <= candidate.candidateId) {
        return null;
    }

    // Show inline completion hint.
    const candidateData = completion.candidates(candidate.candidateId)!;
    const candidateText = candidateData.completionText();
    const replaceTextAt = candidateData.replaceTextAt();
    if (candidateText === null || replaceTextAt === null) {
        return null;
    }
    const _cursorPos = state.selection.main.head;
    const replaceFrom = replaceTextAt.offset();
    const replaceTo = replaceFrom + replaceTextAt.length();

    // XXX Wouldn't we rather track it as currentTokenStart or so?
    //     replaceFrom sounds dangerous.

    // Calculate the hint text (part that would be inserted after current cursor)
    const currentText = state.doc.sliceString(replaceFrom, replaceTo);

    if (!candidateText.startsWith(currentText)) {
        return null;
    }
    const hintText = candidateText.slice(currentText.length);
    const candidateCompletion: CandidateCompletion = {
        hint: {
            at: replaceTo,
            text: hintText
        }
    };
    let extended: ExtendedCompletion | null = null;
    const tmpNode = new dashql.buffers.parser.Node();
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
    return {
        candidate: candidateCompletion,
        extended
    };
}


class CompletionHintWidget extends WidgetType {
    constructor(
        protected text: string,
        protected extended: boolean = false
    ) {
        super();
    }
    eq(other: CompletionHintWidget): boolean {
        return this.text === other.text;
    }
    toDOM(): HTMLElement {
        const span = document.createElement('span');
        span.className = this.extended ? styles.completion_hint_extended : styles.completion_hint_simple;
        span.textContent = this.text;
        return span;
    }
    get estimatedHeight(): number {
        return -1; // Use line height
    }
}

function computeCompletionHintDecorations(viewUpdate: ViewUpdate): DecorationSet {
    // Check completion status first
    const status = completionStatus(viewUpdate.state);
    if (status !== "active") {
        return Decoration.none;
    }

    // Get current completions
    const completions = currentCompletions(viewUpdate.state);
    if (!completions || completions.length === 0) {
        return Decoration.none;
    }

    // Find the selected completion
    const currentCompletion = selectedCompletion(viewUpdate.state) as DashQLCompletion;
    if (!currentCompletion) {
        return Decoration.none;
    }

    // Compute the new completion hints
    const hints = computeCompletionHints(currentCompletion, viewUpdate.state);
    if (hints == null) {
        return Decoration.none;
    }

    const candidate = new CompletionHintWidget(hints.candidate.hint.text, false);
    if (hints.extended != null) {
        const widgets = [];
        if (hints.extended.hintPrefix != null) {
            const prefix = new CompletionHintWidget(hints.extended.hintPrefix.text, true);
            widgets.push(Decoration.widget({ widget: prefix, side: -1 }).range(hints.extended.hintPrefix.at));
        }
        widgets.push(Decoration.widget({ widget: candidate, side: 1 }).range(hints.candidate.hint.at));
        if (hints.extended.hintSuffix != null) {
            const suffix = new CompletionHintWidget(hints.extended.hintSuffix.text, true);
            widgets.push(Decoration.widget({ widget: suffix, side: 2 }).range(hints.extended.hintSuffix.at));
        }
        return Decoration.set(widgets);
    } else {
        return Decoration.set([
            Decoration.widget({ widget: candidate, side: 1 }).range(hints.candidate.hint.at),
        ]);
    }
};

export const DashQLCompletionHint = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet;
        constructor(readonly view: EditorView) {
            this.decorations = Decoration.none;
        }
        update(u: ViewUpdate) {
            const next = computeCompletionHintDecorations(u);
            if (next !== this.decorations) {
                this.decorations = next;
            }
        }
    },
    { decorations: v => v.decorations }
);
