import * as React from 'react';
import { createRoot } from 'react-dom/client';

import * as dashql from '@ankoh/dashql-core';

import { currentCompletions, completionStatus, selectedCompletion } from '@codemirror/autocomplete';
import { Range, Text } from '@codemirror/state';
import { EditorView, Decoration, DecorationSet, WidgetType, ViewPlugin, ViewUpdate } from '@codemirror/view';

import { DashQLCompletion } from './dashql_completion.js';
import { readColumnIdentifierSnippet } from '../snippet/script_template_snippet.js';
import { VariantKind } from '../../utils/index.js';
import * as meyers from '../../utils/diff.js';

import * as symbols from '../../../static/svg/symbols.generated.svg';

import * as styles from './dashql_completion_hint.module.css';

export const HINT_PRIORITY_CANDIDATE = 1;
export const HINT_PRIORITY_CANDIDATE_QUALIFICATION = 10;
export const HINT_PRIORITY_CANDIDATE_TEMPLATE = 100;
export const HINT_PRIORITY_MAX = 10000;

export const HINT_INSERT_TEXT = Symbol("INSERT_TEXT");
export const HINT_DELETE_TEXT = Symbol("REMOVE_TEXT");

enum HintCategory {
    Candidate = 1,
    CandidateQualification = 2,
    CandidateTemplate = 3
}

type PatchHintVariant =
    | VariantKind<typeof HINT_INSERT_TEXT, InsertTextHint>
    | VariantKind<typeof HINT_DELETE_TEXT, RemoveTextHint>;

type PatchHint = PatchHintVariant & {
    category: HintCategory;
    /// Should we render the category controls for the user?
    /// We want to hint the user that he can click certain keys to apply a patch.
    categoryControls: boolean;
};

export enum HintTextAnchor {
    Right = -1,
    Left = 1,
}

enum HintKey {
    EnterKey = 1,
    TabKey = 2
}

interface InsertTextHint {
    /// The location
    at: number;
    /// The completion text
    text: string;
    /// The text anchor of the hint
    textAnchor: HintTextAnchor;
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
function deriveHints(at: number, have: string, want: string, hintType: HintCategory, cursor: number): PatchHint[] {
    const out: PatchHint[] = [];

    // XXX This is a candidate for offloading to WebAssembly
    for (const [haveFrom, haveTo, wantFrom, wantTo] of meyers.diff(have, want)) {
        if (haveFrom != haveTo) {
            out.push({
                category: hintType,
                categoryControls: false,
                type: HINT_DELETE_TEXT,
                value: {
                    at: at + haveFrom,
                    length: haveTo - haveFrom,
                }
            })
        }
        if (wantFrom != wantTo) {
            out.push({
                category: hintType,
                categoryControls: false,
                type: HINT_INSERT_TEXT,
                value: {
                    at: at + haveTo,
                    text: want.substring(wantFrom, wantTo),
                    textAnchor: ((at + haveTo) < cursor) ? HintTextAnchor.Right : HintTextAnchor.Left,
                }
            })
        }
    }
    return out;
}

function selectCategoryControls(hints: PatchHint[], preferFirst: boolean) {
    let firstInsert: number | null = null;
    let firstDelete: number | null = null;
    let lastInsert: number | null = null;
    let lastDelete: number | null = null;

    // Determine the first inserts & deletes
    for (let i = 0; i < hints.length; ++i) {
        const hint = hints[i];
        if (hint.type == HINT_INSERT_TEXT && firstInsert == null) {
            firstInsert = i;
        }
        if (hint.type == HINT_DELETE_TEXT && firstDelete == null) {
            firstDelete = i;
        }
        if (firstInsert != null && firstDelete != null) {
            break;
        }
    }

    // Determine the last inserts & deletes
    for (let i = hints.length - 1; i >= 0; --i) {
        const hint = hints[i];
        if (hint.type == HINT_INSERT_TEXT && lastInsert == null) {
            lastInsert = i;
        }
        if (hint.type == HINT_DELETE_TEXT && lastDelete == null) {
            lastDelete = i;
        }
        if (lastInsert != null && lastDelete != null) {
            break;
        }
    }
    // Select the hint with controls
    let controlsAt = null;
    if (preferFirst) {
        controlsAt = firstInsert != null ? firstInsert : firstDelete;
    } else {
        controlsAt = lastInsert != null ? lastInsert : lastDelete;
    }
    if (controlsAt != null) {
        hints[controlsAt].categoryControls = true;
    }
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
    const candidateHints = deriveHints(targetFrom, currentText, candidateText, HintCategory.Candidate, cursor);

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
            let hints = deriveHints(qualifiedFrom, have, want, HintCategory.CandidateQualification, cursor);
            qualificationHints = hints;
        }

        // Qualification suffix
        let qualSuffix = name.slice(co.qualifiedNameTargetIdx() + 1);
        if (qualSuffix.length > 0) {
            let have = text.sliceString(targetTo, qualifiedTo);
            let want = "." + qualSuffix.join(".");
            let hints = deriveHints(targetTo, have, want, HintCategory.CandidateTemplate, cursor);
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
                    category: HintCategory.CandidateTemplate,
                    categoryControls: false,
                    type: HINT_INSERT_TEXT,
                    value: {
                        at: qualifiedFrom,
                        text: snippetModel.textBefore,
                        textAnchor: HintTextAnchor.Right,
                    }
                });
            }
            if (snippetModel.textAfter.length > 0) {
                templateHints.push({
                    category: HintCategory.CandidateTemplate,
                    categoryControls: false,
                    type: HINT_INSERT_TEXT,
                    value: {
                        at: qualifiedTo,
                        text: snippetModel.textAfter,
                        textAnchor: HintTextAnchor.Left,
                    }
                });
            }
        }
    }

    // Select hints with controls
    selectCategoryControls(candidateHints, false);
    selectCategoryControls(qualificationHints, true);
    selectCategoryControls(templateHints, false);

    return {
        candidate: candidateHints,
        candidateQualification: qualificationHints,
        candidateTemplate: templateHints,
    };
}

const INSERT_CLASSNAMES = [
    styles.hint_candidate_insert,
    styles.hint_qualification_insert,
    styles.hint_template_insert,
];
const DELETE_CLASSNAMES = [
    styles.hint_candidate_delete,
    styles.hint_qualification_delete,
    styles.hint_template_delete,
];
function getInsertClassNameForCategory(category: HintCategory): string {
    return INSERT_CLASSNAMES[category as number - 1];
}
function getDeleteClassNameForCategory(category: HintCategory): string {
    return DELETE_CLASSNAMES[category as number - 1];
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

class HintKeyWidget extends WidgetType {
    constructor(
        protected k: HintKey,
        protected n: number | null,
    ) {
        super();
    }
    eq(other: HintKeyWidget): boolean {
        return this.k == other.k && this.n == other.n;
    }
    toDOM(): HTMLElement {
        const span = document.createElement('span');
        const root = createRoot(span);
        root.render(
            <span className={styles.hint_ctrl_overlap_container} >
                {this.n != null && (
                    <span className={styles.hint_ctrl_label}>
                        {this.n}
                    </span>
                )}
                <svg width="10px" height="10px">
                    <use xlinkHref={this.k == HintKey.TabKey ? `${symbols}#keyboard_tab_24` : `${symbols}#keyboard_tab_24`} />
                </svg>
            </span>
        );

        span.className = styles.hint_ctrl_container;
        return span;
    }
    get estimatedHeight(): number {
        return -1; // Use line height
    }
}

function determineHintKey(hints: CompletionHints, category: HintCategory): [HintKey, number | null] {
    switch (category) {
        case HintCategory.Candidate:
            return [HintKey.EnterKey, null];
        case HintCategory.CandidateTemplate:
            return [HintKey.TabKey, (hints.candidateQualification.length > 0) ? 2 : null];
        case HintCategory.CandidateQualification:
            return [HintKey.EnterKey, (hints.candidateTemplate.length > 0) ? 1 : null];
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

    // Merge all hints.
    // Codemirror requires Decorations to be ordered by `at` & `side`
    const mergedPatches = [
        ...hints.candidate,
        ...hints.candidateTemplate,
        ...hints.candidateQualification
    ];
    mergedPatches.sort((l, r) => {
        let a = l.value.at;
        let b = r.value.at;
        if (a != b) {
            return a - b;
        }
        switch (l.type) {
            case HINT_INSERT_TEXT:
                a = (l.value.textAnchor as number) * (l.category as number);
                break;
            case HINT_DELETE_TEXT:
                a = (l.category as number) * HINT_PRIORITY_MAX;
                break;
        }
        switch (r.type) {
            case HINT_INSERT_TEXT:
                b = (r.value.textAnchor as number) * (r.category as number);
                break;
            case HINT_DELETE_TEXT:
                b = (r.category as number) * HINT_PRIORITY_MAX
                break;
        }
        return a - b;
    });

    // Create decorations
    const decorations: Range<Decoration>[] = [];
    for (const patch of mergedPatches) {
        switch (patch.type) {
            case HINT_INSERT_TEXT: {
                const side = (patch.value.textAnchor == HintTextAnchor.Left ? 1 : -1) * (patch.category as number);

                /// Construct the insert widget
                const insertClassname = getInsertClassNameForCategory(patch.category);
                const insertWidget = new InsertPatchWidget(patch.value.text, insertClassname);
                const insertDeco = Decoration.widget({ widget: insertWidget, side }).range(patch.value.at);
                decorations.push(insertDeco);

                // Insert controls after?
                if (patch.categoryControls) {
                    const [hintKey, hintKeyNumber] = determineHintKey(hints, patch.category);
                    const controlsWidget = new HintKeyWidget(hintKey, hintKeyNumber);
                    const controlDeco = Decoration.widget({ widget: controlsWidget, side }).range(patch.value.at);
                    decorations.push(controlDeco);
                }
                break;
            }
            case HINT_DELETE_TEXT:


                // Construct the deletion widget
                const deleteClassName = getDeleteClassNameForCategory(patch.category);
                const deleteDeco = Decoration.mark({ class: deleteClassName }).range(patch.value.at, patch.value.at + patch.value.length);
                decorations.push(deleteDeco);

                // Emit controls?
                if (patch.categoryControls) {
                    const [hintKey, hintKeyNumber] = determineHintKey(hints, patch.category);
                    const controlsWidget = new HintKeyWidget(hintKey, hintKeyNumber);
                    const controlDeco = Decoration.widget({ widget: controlsWidget }).range(patch.value.at);
                    decorations.push(controlDeco);
                }
                break;
        }
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
