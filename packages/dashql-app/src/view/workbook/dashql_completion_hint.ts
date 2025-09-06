import * as dashql from '@ankoh/dashql-core';

import { currentCompletions, completionStatus, selectedCompletion } from '@codemirror/autocomplete';
import { Range, Text } from '@codemirror/state';
import { EditorView, Decoration, DecorationSet, WidgetType, ViewPlugin, ViewUpdate } from '@codemirror/view';

import * as meyers from '../../utils/diff.js';

import { DashQLCompletion } from './dashql_completion.js';
import { readColumnIdentifierSnippet } from '../snippet/script_template_snippet.js';
import { VariantKind } from '../../utils/index.js';

import * as styles from './dashql_completion_hint.module.css';

export const HINT_PRIORITY_CANDIDATE = 1;
export const HINT_PRIORITY_CANDIDATE_QUALIFICATION = 10;
export const HINT_PRIORITY_CANDIDATE_TEMPLATE = 100;

export const HINT_INSERT_TEXT = Symbol("INSERT_TEXT");
export const HINT_DELETE_TEXT = Symbol("REMOVE_TEXT");

type PatchHint =
    | VariantKind<typeof HINT_INSERT_TEXT, InsertTextHint>
    | VariantKind<typeof HINT_DELETE_TEXT, RemoveTextHint>;

export enum HintTextAnchor {
    Left,
    Right,
}

interface InsertTextHint {
    /// The location
    at: number;
    /// The completion text
    text: string;
    /// The text anchor of the hint
    textAnchor: HintTextAnchor;
    /// The the priority in which completion hints at the same position are added.
    /// Lower number is added first.
    renderingPriority: number;
}

interface RemoveTextHint {
    /// Remove text at a location
    at: number;
    /// Remove `length` characters
    length: number;
}

interface CompletionHints {
    /// The candidate completion hint
    candidate: PatchHint[];
    /// The qualifier for the candidate
    candidateQualification: PatchHint[];
    /// The extended template completion hint
    candidateTemplate: PatchHint[];
}

/// Given two strings, derive the hints that needed to get from `have` to `want`
function deriveHints(at: number, have: string, want: string, priority: number, cursor: number): PatchHint[] {
    const out: PatchHint[] = [];

    for (const [haveFrom, haveTo, wantFrom, wantTo] of meyers.diff(have, want)) {
        if (haveFrom != haveTo) {
            out.push({
                type: HINT_DELETE_TEXT,
                value: {
                    at: at + haveFrom,
                    length: haveTo - haveFrom,
                }
            })
        }
        if (wantFrom != wantTo) {
            out.push({
                type: HINT_INSERT_TEXT,
                value: {
                    at: at + haveTo,
                    text: want.substring(wantFrom, wantTo),
                    textAnchor: ((at + haveTo) < cursor) ? HintTextAnchor.Right : HintTextAnchor.Left,
                    renderingPriority: priority,
                }
            })
        }
    }

    return out;
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
        console.log({ candidateText, targetLocation, targetLocationQualified });
        return null;
    }
    const targetFrom = targetLocation.offset();
    const targetTo = targetFrom + targetLocation.length();
    const qualifiedFrom = targetLocationQualified.offset();
    const qualifiedTo = qualifiedFrom + targetLocationQualified.length();
    const cursor = targetTo;

    // XXX Wouldn't we rather track it as currentTokenStart or so?
    //     replaceFrom sounds dangerous.

    // Calculate the primary hint text.
    // Note that this hint can also consist of prefix and suffix, for example for quoting.
    const currentText = text.sliceString(targetFrom, targetTo);
    const candidateHints = deriveHints(targetFrom, currentText, candidateText, HINT_PRIORITY_CANDIDATE, cursor);

    // Is there a qualified name for the candidate?
    // Skip if we're dot-completing.
    let qualificationHints: PatchHint[] = [];
    if (candidateData.catalogObjectsLength() > 0 && !completion.dotCompletion()) {
        const co = candidateData.catalogObjects(0)!;
        let name = readQualifiedName(co);

        // Qualification prefix
        let qualPrefix = name.slice(0, co.qualifiedNameTargetIdx());
        if (qualPrefix.length > 0) {
            let have = text.sliceString(qualifiedFrom, targetFrom);
            let want = qualPrefix.join(".") + ".";
            let hints = deriveHints(qualifiedFrom, have, want, HINT_PRIORITY_CANDIDATE_QUALIFICATION, cursor);
            qualificationHints = hints;
        }

        // Qualification suffix
        let qualSuffix = name.slice(co.qualifiedNameTargetIdx() + 1);
        if (qualSuffix.length > 0) {
            let have = text.sliceString(targetTo, qualifiedTo);
            let want = "." + qualSuffix.join(".");
            let hints = deriveHints(targetTo, have, want, HINT_PRIORITY_CANDIDATE_QUALIFICATION, cursor);
            qualificationHints = qualificationHints.concat(hints);
        }
    }

    // Is there a candidate template?
    let templateHints: PatchHint[] = [];
    const tmpNode = new dashql.buffers.parser.Node();
    if (candidateData.completionTemplatesLength() > 0) {
        const template = candidateData.completionTemplates(0)!;
        if (template.snippetsLength() > 0) {
            const snippet = template.snippets(0)!;
            const snippetModel = readColumnIdentifierSnippet(snippet, tmpNode);
            if (snippetModel.textBefore.length > 0) {
                templateHints.push({
                    type: HINT_INSERT_TEXT,
                    value: {
                        at: qualifiedFrom,
                        text: snippetModel.textBefore,
                        textAnchor: HintTextAnchor.Right,
                        renderingPriority: HINT_PRIORITY_CANDIDATE_TEMPLATE,
                    }
                });
            }
            if (snippetModel.textAfter.length > 0) {
                templateHints.push({
                    type: HINT_INSERT_TEXT,
                    value: {
                        at: qualifiedTo,
                        text: snippetModel.textAfter,
                        textAnchor: HintTextAnchor.Left,
                        renderingPriority: HINT_PRIORITY_CANDIDATE_TEMPLATE,
                    }
                });
            }
        }
    }

    return {
        candidate: candidateHints,
        candidateQualification: qualificationHints,
        candidateTemplate: templateHints,
    };
}

enum HintType {
    Candidate,
    CandidateQualification,
    CandidateTemplate
}


class InsertPatchWidget extends WidgetType {
    constructor(
        protected text: string,
        protected className: string
    ) {
        super();
    }
    eq(other: InsertPatchWidget): boolean {
        return this.text === other.text;
    }
    toDOM(): HTMLElement {
        const span = document.createElement('span');
        span.className = this.className;
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

    // Helper to add a completion hint widget
    const addPatch = (patch: PatchHint, hintType: HintType, decorations: Range<Decoration>[]) => {
        switch (patch.type) {
            case HINT_INSERT_TEXT: {
                let className = "";
                switch (hintType) {
                    case HintType.Candidate:
                        className = styles.completion_hint_primary;
                        break;
                    case HintType.CandidateTemplate:
                        className = styles.completion_hint_template;
                        break;
                }
                const widget = new InsertPatchWidget(patch.value.text, className);
                let side = patch.value.textAnchor == HintTextAnchor.Left ? 0 : -10000;
                side += patch.value.renderingPriority;
                decorations.push(Decoration.widget({ widget, side }).range(patch.value.at));
                break;
            }
            case HINT_DELETE_TEXT:
                break;
        }
    };

    // Add candidate hint
    const decorations: Range<Decoration>[] = [];
    for (const patch of hints.candidate) {
        addPatch(patch, HintType.Candidate, decorations);
    }
    for (const patch of hints.candidateQualification) {
        addPatch(patch, HintType.CandidateQualification, decorations);
    }
    for (const patch of hints.candidateTemplate) {
        addPatch(patch, HintType.CandidateTemplate, decorations);
    }
    decorations.sort((l, r) => {
        return l.from - r.from;
    })
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
