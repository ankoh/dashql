import * as dashql from '@ankoh/dashql-core';

import { currentCompletions, completionStatus, selectedCompletion } from '@codemirror/autocomplete';
import { Range, Text } from '@codemirror/state';
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

/// An extended completion hint that shows an extended snippet
interface ExtendedCompletionHint {
    /// The prefix
    hintPrefix: CompletionHint | null;
    /// The suffix
    hintSuffix: CompletionHint | null;
}

interface CompletionHints {
    /// The candidate completion hint
    candidate: ExtendedCompletionHint;
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
export function computeCompletionHints(completionPtr: dashql.FlatBufferPtr<dashql.buffers.completion.Completion>, candidateId: number, text: Text): CompletionHints | null {
    const completion = completionPtr.read();
    if (completion.candidatesLength() <= candidateId) {
        return null;
    }

    // Show inline completion hint.
    const candidateData = completion.candidates(candidateId)!;
    const candidateText = candidateData.completionText();
    const targetLocation = candidateData.targetLocation();
    const targetLocationQualified = candidateData.targetLocationQualified();
    if (candidateText === null || targetLocation === null || targetLocationQualified == null) {
        return null;
    }
    const targetFrom = targetLocation.offset();
    const targetTo = targetFrom + targetLocation.length();
    const qualifiedFrom = targetLocationQualified.offset();
    const qualifiedTo = qualifiedFrom + targetLocationQualified.length();

    // XXX Wouldn't we rather track it as currentTokenStart or so?
    //     replaceFrom sounds dangerous.

    // Calculate the primary hint text.
    // Note that this hint can also consist of prefix and suffix, for example for quoting.
    const currentText = text.sliceString(targetFrom, targetTo);
    const candidateSubstringOffset = candidateText.indexOf(currentText);
    if (candidateSubstringOffset == -1) {
        return null;
    }
    const candidateCompletion: ExtendedCompletionHint = {
        hintPrefix: candidateSubstringOffset == 0 ? null : {
            at: targetFrom,
            text: candidateText.slice(0, candidateSubstringOffset),

        },
        hintSuffix: ((candidateSubstringOffset + currentText.length) == candidateText.length) ? null : {
            at: targetTo,
            text: candidateText.slice(candidateSubstringOffset + currentText.length),
        }
    };

    // Is there a qualified name for the candidate?
    // Skip if we're dot-completing.
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

enum HintType {
    Candidate,
    CandidateQualification,
    CandidateTemplate
}


class CompletionHintWidget extends WidgetType {
    constructor(
        protected text: string,
        protected hintType: HintType
    ) {
        super();
    }
    eq(other: CompletionHintWidget): boolean {
        return this.text === other.text;
    }
    toDOM(): HTMLElement {
        const span = document.createElement('span');
        switch (this.hintType) {
            case HintType.Candidate:
                span.className = styles.completion_hint_primary;
                break;
            case HintType.CandidateTemplate:
                span.className = styles.completion_hint_template;
                break;
        }
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
    const hints = computeCompletionHints(currentCompletion.completion, currentCompletion.candidateId, viewUpdate.state.doc);
    if (hints == null) {
        return Decoration.none;
    }

    // Heelper to add a completion hint widget
    const addHint = (hint: ExtendedCompletionHint, hintType: HintType, widgets: Range<Decoration>[]) => {
        if (hint.hintPrefix != null) {
            const prefix = new CompletionHintWidget(hint.hintPrefix.text, hintType);
            widgets.push(Decoration.widget({ widget: prefix, side: -1 }).range(hint.hintPrefix.at));
        }
        if (hint.hintSuffix != null) {
            const suffix = new CompletionHintWidget(hint.hintSuffix.text, hintType);
            widgets.push(Decoration.widget({ widget: suffix, side: 2 }).range(hint.hintSuffix.at));
        }
    };

    // Add candidate hint
    const decorations: Range<Decoration>[] = [];
    addHint(hints.candidate, HintType.Candidate, decorations);
    if (hints.candidateTemplate) {
        addHint(hints.candidateTemplate, HintType.CandidateTemplate, decorations);
    }

    return Decoration.set(decorations);
};

export const DashQLCompletionHintPlugin = ViewPlugin.fromClass(
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
