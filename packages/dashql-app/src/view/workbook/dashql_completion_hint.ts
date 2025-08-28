import * as dashql from '@ankoh/dashql-core';

import { currentCompletions, completionStatus, selectedCompletion } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { EditorView, Decoration, DecorationSet, WidgetType, ViewPlugin, ViewUpdate } from '@codemirror/view';

import { DashQLCompletion } from './dashql_completion.js';
import { readColumnIdentifierSnippet } from '../snippet/script_template_snippet.js';

import * as styles from './dashql_completion_hint.module.css';
import { quoteIfAnyUpper } from '../../utils/format.js';

/// A completion content
interface CompletionHint {
    /// The location
    at: number;
    /// The completion text
    text: string;
}

/// A completion hint that hints the autocompletion candidate
interface CandidateCompletionHint {
    /// The content
    hint: CompletionHint;
};

/// An extended completion hint that shows an extended snippet
interface ExtendedCompletionHint {
    /// The prefix
    hintPrefix: CompletionHint | null;
    /// The suffix
    hintSuffix: CompletionHint | null;
}

interface CompletionHints {
    /// The candidate completion hint
    candidate: CandidateCompletionHint;
    /// The qualifier for the candidate
    candidateQualification: ExtendedCompletionHint | null;
    /// The extended template completion hint
    candidateTemplate: ExtendedCompletionHint | null;
}

function readQualifiedName(co: dashql.buffers.completion.CompletionCandidateObject): string[] {
    const out = [];
    for (let i = 0; i < co.qualifiedNameLength(); ++i) {
        const name = co.qualifiedName(i);
        out.push(name);
    }
    return out;
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
    const targetLocation = candidateData.targetLocation();
    const targetLocationQualified = candidateData.targetLocationQualified();
    if (candidateText === null || targetLocation === null || targetLocationQualified == null) {
        return null;
    }
    const _cursorPos = state.selection.main.head;
    const targetFrom = targetLocation.offset();
    const targetTo = targetFrom + targetLocation.length();
    const qualifiedFrom = targetLocationQualified.offset();
    const qualifiedTo = qualifiedFrom + targetLocationQualified.length();

    // XXX Wouldn't we rather track it as currentTokenStart or so?
    //     replaceFrom sounds dangerous.

    // Calculate the hint text (part that would be inserted after current cursor)
    const currentText = state.doc.sliceString(targetFrom, targetTo);

    if (!candidateText.startsWith(currentText)) {
        return null;
    }
    const hintText = candidateText.slice(currentText.length);
    const candidateCompletion: CandidateCompletionHint = {
        hint: {
            at: targetTo,
            text: hintText
        }
    };

    // Is there a qualified name for the candidate?
    // Skip if we're dot-completing or don't have a qualified target location.
    if (candidateData.catalogObjectsLength() > 0 && !completion.dotCompletion()) {
        const co = candidateData.catalogObjects(0)!;
        let name = readQualifiedName(co);
        // We assume the candidate is the last entry
        if (name.length > 1) {
            name = name.slice(0, name.length - 1);

            // XXX Now create the name qualification hint
            // We still need to take care of dot-completion here.
            // Right now, replaceFrom is NOT including the qualified path.
            // Need to fix
        }
    }

    // Is there a candidate template?
    let candidateTemplate: ExtendedCompletionHint | null = null;
    const tmpNode = new dashql.buffers.parser.Node();
    if (candidateData.completionTemplatesLength() > 0) {
        const template = candidateData.completionTemplates(0)!;
        if (template.snippetsLength() > 0) {
            const snippet = template.snippets(0)!;
            const snippetModel = readColumnIdentifierSnippet(snippet, tmpNode);
            candidateTemplate = {
                hintPrefix: {
                    at: qualifiedFrom,
                    text: snippetModel.textBefore
                },
                hintSuffix: {
                    at: qualifiedTo,
                    text: snippetModel.textAfter
                }
            };
        }
    }

    return {
        candidate: candidateCompletion,
        candidateQualification: null,
        candidateTemplate: candidateTemplate
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
    if (hints.candidateTemplate != null) {
        const widgets = [];
        if (hints.candidateTemplate.hintPrefix != null) {
            const prefix = new CompletionHintWidget(hints.candidateTemplate.hintPrefix.text, true);
            widgets.push(Decoration.widget({ widget: prefix, side: -1 }).range(hints.candidateTemplate.hintPrefix.at));
        }
        widgets.push(Decoration.widget({ widget: candidate, side: 1 }).range(hints.candidate.hint.at));
        if (hints.candidateTemplate.hintSuffix != null) {
            const suffix = new CompletionHintWidget(hints.candidateTemplate.hintSuffix.text, true);
            widgets.push(Decoration.widget({ widget: suffix, side: 2 }).range(hints.candidateTemplate.hintSuffix.at));
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
