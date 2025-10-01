import * as dashql from '@ankoh/dashql-core';

import { Range, Text } from '@codemirror/state';
import { EditorView, Decoration, DecorationSet, WidgetType, ViewPlugin, ViewUpdate } from '@codemirror/view';

import { DASHQL_COMPLETION_APPLIED_CANDIDATE, DASHQL_COMPLETION_APPLIED_QUALIFIED_CANDIDATE, DASHQL_COMPLETION_AVAILABLE, DashQLCompletionState, DashQLProcessorPlugin } from './dashql_processor.js';
import { readColumnIdentifierSnippet } from '../snippet/script_template_snippet.js';
import { VariantKind } from '../../utils/index.js';
import * as meyers from '../../utils/diff.js';

import * as symbols from '../../../static/svg/symbols.generated.svg';

import * as styles from './dashql_completion_hint.module.css';

const HINT_PRIORITY_MAX = 10000;

export const HINT_INSERT_TEXT = Symbol("INSERT_TEXT");
export const HINT_DELETE_TEXT = Symbol("REMOVE_TEXT");

export enum PatchTarget {
    Candidate = 1,
    CandidateQualification = 2,
    CandidateTemplate = 3
}

type PatchVariant =
    | VariantKind<typeof HINT_INSERT_TEXT, InsertTextHint>
    | VariantKind<typeof HINT_DELETE_TEXT, RemoveTextHint>;

type Patch = PatchVariant & {
    /// The patch target
    target: PatchTarget;
    /// Should we render the category controls for the user?
    /// We want to hint the user that he can click certain keys to apply a patch.
    categoryControls: boolean;
};

export enum HintTextAnchor {
    Right = -1,
    Left = 1,
}

export enum HintKey {
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
    candidate: Patch[];
    /// The qualifier for the candidate
    candidateQualification: Patch[];
    /// The extended template completion hint
    candidateTemplate: Patch[];
}

/// Given two strings, derive the hints that needed to get from `have` to `want`
function deriveHints(at: number, have: string, want: string, hintType: PatchTarget, cursor: number): Patch[] {
    const out: Patch[] = [];

    // XXX This is a candidate for offloading to WebAssembly
    for (const [haveFrom, haveTo, wantFrom, wantTo] of meyers.diff(have, want)) {
        if (haveFrom != haveTo) {
            out.push({
                target: hintType,
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
                target: hintType,
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

function selectCategoryControls(hints: Patch[], preferFirst: boolean) {
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


/// Helper to read a qualified name
function readQualifiedName(co: dashql.buffers.completion.CompletionCandidateObject): string[] {
    const out = [];
    for (let i = 0; i < co.qualifiedNameLength(); ++i) {
        const name = co.qualifiedName(i);
        out.push(name);
    }
    return out;
}

/// Helper to compute patches for qualifying a name (if any)
export function qualifyName(completion: DashQLCompletionState, text: Text, cursor: number = 0): Patch[] {
    let hints: Patch[] = [];
    switch (completion.type) {
        case DASHQL_COMPLETION_AVAILABLE:
        case DASHQL_COMPLETION_APPLIED_CANDIDATE:
            if (completion.value.candidateId == null || completion.value.catalogObjectId == null) {
                return [];
            }
            // Read candidate
            const buffer = completion.value.buffer.read();
            const candidate = buffer.candidates(completion.value.candidateId)!;

            // Skip if we're dot-completing
            if (completion.value.buffer.read().dotCompletion()) {
                return [];
            }
            const catalogObject = candidate.catalogObjects(completion.value.catalogObjectId)!;

            // Read qualified name (if any)
            const targetLoc = candidate.targetLocation();
            const qualifiedLoc = candidate.targetLocationQualified();
            if (targetLoc == null || qualifiedLoc == null) {
                return [];
            }
            const targetFrom = targetLoc.offset();
            const targetTo = targetFrom + targetLoc.length();
            const qualifiedFrom = qualifiedLoc.offset();
            const qualifiedTo = qualifiedFrom + qualifiedLoc.length();
            let name = readQualifiedName(catalogObject);

            // Qualification prefix
            let qualPrefix = name.slice(0, catalogObject.qualifiedNameTargetIdx());
            if (qualPrefix.length > 0) {
                let have = text.sliceString(qualifiedFrom, targetFrom);
                let want = qualPrefix.join(".") + ".";
                let hints = deriveHints(qualifiedFrom, have, want, PatchTarget.CandidateQualification, cursor);
                hints = hints;
            }

            // Qualification suffix
            let qualSuffix = name.slice(catalogObject.qualifiedNameTargetIdx() + 1);
            if (qualSuffix.length > 0) {
                let have = text.sliceString(targetTo, qualifiedTo);
                let want = "." + qualSuffix.join(".");
                let hints = deriveHints(targetTo, have, want, PatchTarget.CandidateTemplate, cursor);
                hints = hints.concat(hints);
            }
            return hints;

        default:
            return [];
    }
}

/// Helper to determine if we can complete a template.
/// We keep this logic here since this has to stay in sync with `computeCompletionHints`.
export function canCompleteTemplate(state: DashQLCompletionState, text: Text): boolean {
    switch (state.type) {
        case DASHQL_COMPLETION_AVAILABLE:
        case DASHQL_COMPLETION_APPLIED_CANDIDATE:
        case DASHQL_COMPLETION_APPLIED_QUALIFIED_CANDIDATE:
            if (state.value.candidateId == null || state.value.catalogObjectId == null || state.value.templateId == null) {
                return false;
            }
            return true;
        default:
            return false;
    }
}

/// Helper to compute the completion hints given a completion candidate a new editor state
export function computeCompletionHints(completionState: DashQLCompletionState, text: Text): CompletionHints | null {
    const completion = completionState.value.buffer.read();
    if (completionState.value.candidateId == null || completion.candidatesLength() <= completionState.value.candidateId) {
        return null;
    }

    // Show inline completion hint.
    const candidateData = completion.candidates(completionState.value.candidateId)!;
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
    const cursor = targetTo;

    // XXX Wouldn't we rather track it as currentTokenStart or so?
    //     replaceFrom sounds dangerous.

    let candidateHints: Patch[] = [];
    let qualificationHints: Patch[] = [];
    let templateHints: Patch[] = [];

    // Calculate the primary hint text.
    // Note that this hint can also consist of prefix and suffix, for example for quoting.
    const hintCandidate = completionState.type == DASHQL_COMPLETION_AVAILABLE;
    if (hintCandidate) {
        const currentText = text.sliceString(targetFrom, targetTo);
        candidateHints = deriveHints(targetFrom, currentText, candidateText, PatchTarget.Candidate, cursor);
    }

    // Is there a qualified name for the candidate?
    // Skip if we're dot-completing.
    qualificationHints = qualifyName(completionState, text, cursor);

    // Is there a candidate template?
    const hintTemplate = hintCandidate
        || completionState.type == DASHQL_COMPLETION_APPLIED_CANDIDATE
        || completionState.type == DASHQL_COMPLETION_APPLIED_QUALIFIED_CANDIDATE;
    if (hintTemplate) {
        const tmpNode = new dashql.buffers.parser.Node();
        if (candidateData.completionTemplatesLength() > 0) {
            const template = candidateData.completionTemplates(0)!;
            if (template.snippetsLength() > 0) {
                const snippet = template.snippets(0)!;
                const snippetModel = readColumnIdentifierSnippet(snippet, tmpNode);
                if (snippetModel.textBefore.length > 0) {
                    templateHints.push({
                        target: PatchTarget.CandidateTemplate,
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
                        target: PatchTarget.CandidateTemplate,
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
function getInsertClassNameForCategory(category: PatchTarget): string {
    return INSERT_CLASSNAMES[category as number - 1];
}
function getDeleteClassNameForCategory(category: PatchTarget): string {
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

        // Create the inner span with hint_ctrl_overlap_container class
        const innerSpan = document.createElement('span');
        innerSpan.className = styles.hint_ctrl_overlap_container;

        // Create the label for the counter (if we have one)
        if (this.n != null) {
            const labelSpan = document.createElement('span');
            labelSpan.className = styles.hint_ctrl_label;
            labelSpan.textContent = String(this.n);
            innerSpan.appendChild(labelSpan);
        }

        // Create the SVG element
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '10px');
        svg.setAttribute('height', '10px');
        const svgSymbol = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        svgSymbol.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href',
            this.k == HintKey.TabKey ? `${symbols}#keyboard_tab_24` : `${symbols}#keyboard_tab_24`);
        svg.appendChild(svgSymbol);

        innerSpan.appendChild(svg);
        span.appendChild(innerSpan);

        span.className = styles.hint_ctrl_container;
        return span;
    }
    get estimatedHeight(): number {
        return -1; // Use line height
    }
}

function determineHintKey(hints: CompletionHints, category: PatchTarget): [HintKey, number | null] {
    switch (category) {
        case PatchTarget.Candidate:
            return [HintKey.EnterKey, null];
        case PatchTarget.CandidateTemplate:
            return [HintKey.TabKey, (hints.candidateQualification.length > 0) ? 2 : null];
        case PatchTarget.CandidateQualification:
            return [HintKey.EnterKey, (hints.candidateTemplate.length > 0) ? 1 : null];
    }
}


function computeCompletionHintDecorations(viewUpdate: ViewUpdate): DecorationSet {
    const processor = viewUpdate.state.field(DashQLProcessorPlugin);

    // Find the selected completion
    if (processor.scriptCompletion == null || processor.scriptCursor == null) {
        return Decoration.none;
    }

    // Compute the new completion hints
    const hints = computeCompletionHints(processor.scriptCompletion, viewUpdate.state.doc);
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
                a = (l.value.textAnchor as number) * (l.target as number);
                break;
            case HINT_DELETE_TEXT:
                a = (l.target as number) * HINT_PRIORITY_MAX;
                break;
        }
        switch (r.type) {
            case HINT_INSERT_TEXT:
                b = (r.value.textAnchor as number) * (r.target as number);
                break;
            case HINT_DELETE_TEXT:
                b = (r.target as number) * HINT_PRIORITY_MAX
                break;
        }
        return a - b;
    });

    // Create decorations
    const decorations: Range<Decoration>[] = [];
    for (const patch of mergedPatches) {
        switch (patch.type) {
            case HINT_INSERT_TEXT: {
                const side = (patch.value.textAnchor == HintTextAnchor.Left ? 1 : -1) * (patch.target as number);

                /// Construct the insert widget
                const insertClassname = getInsertClassNameForCategory(patch.target);
                const insertWidget = new InsertPatchWidget(patch.value.text, insertClassname);
                const insertDeco = Decoration.widget({ widget: insertWidget, side }).range(patch.value.at);
                decorations.push(insertDeco);

                // Insert controls after?
                if (patch.categoryControls) {
                    const [hintKey, hintKeyNumber] = determineHintKey(hints, patch.target);
                    const controlsWidget = new HintKeyWidget(hintKey, hintKeyNumber);
                    const controlDeco = Decoration.widget({ widget: controlsWidget, side }).range(patch.value.at);
                    decorations.push(controlDeco);
                }
                break;
            }
            case HINT_DELETE_TEXT:


                // Construct the deletion widget
                const deleteClassName = getDeleteClassNameForCategory(patch.target);
                const deleteDeco = Decoration.mark({ class: deleteClassName }).range(patch.value.at, patch.value.at + patch.value.length);
                decorations.push(deleteDeco);

                // Emit controls?
                if (patch.categoryControls) {
                    const [hintKey, hintKeyNumber] = determineHintKey(hints, patch.target);
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
