import { Range, Text } from '@codemirror/state';
import { EditorView, Decoration, DecorationSet, WidgetType, ViewPlugin, ViewUpdate } from '@codemirror/view';

import { DashQLCompletionState, DashQLProcessorPlugin } from './dashql_processor.js';
import { completeCandidate, completeQualifiedName, completeTemplate, CompletionPatch, PATCH_DELETE_TEXT, PATCH_INSERT_TEXT, CompletionPatchTarget, TextAnchor } from './dashql_completion_patches.js';

import * as symbols from '../../../static/svg/symbols.generated.svg';

import * as styles from './dashql_completion_hint.module.css';

const HINT_PRIORITY_MAX = 10000;

interface CompletionHints {
    /// The candidate completion hint
    candidate: CompletionPatch[];
    /// The qualifier for the candidate
    candidateQualification: CompletionPatch[];
    /// The extended template completion hint
    candidateTemplate: CompletionPatch[];
}

function selectCategoryControls(hints: CompletionPatch[], preferFirst: boolean) {
    let firstInsert: number | null = null;
    let firstDelete: number | null = null;
    let lastInsert: number | null = null;
    let lastDelete: number | null = null;

    // Determine the first inserts & deletes
    for (let i = 0; i < hints.length; ++i) {
        const hint = hints[i];
        if (hint.type == PATCH_INSERT_TEXT && firstInsert == null) {
            firstInsert = i;
        }
        if (hint.type == PATCH_DELETE_TEXT && firstDelete == null) {
            firstDelete = i;
        }
        if (firstInsert != null && firstDelete != null) {
            break;
        }
    }

    // Determine the last inserts & deletes
    for (let i = hints.length - 1; i >= 0; --i) {
        const hint = hints[i];
        if (hint.type == PATCH_INSERT_TEXT && lastInsert == null) {
            lastInsert = i;
        }
        if (hint.type == PATCH_DELETE_TEXT && lastDelete == null) {
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
        hints[controlsAt].controls = true;
    }
}

/// Helper to compute the completion hints given a completion candidate a new editor state
export function computeCompletionHints(completionState: DashQLCompletionState, text: Text): CompletionHints | null {
    const completion = completionState.buffer.read();
    if (completionState.candidateId == null || completion.candidatesLength() <= completionState.candidateId) {
        return null;
    }

    // Show inline completion hint.
    const candidateData = completion.candidates(completionState.candidateId)!;
    const candidateText = candidateData.completionText();
    const targetLocation = candidateData.targetLocation();
    const targetLocationQualified = candidateData.targetLocationQualified();
    if (candidateText === null || targetLocation === null || targetLocationQualified == null) {
        return null;
    }
    const targetFrom = targetLocation.offset();
    const targetTo = targetFrom + targetLocation.length();
    const cursor = targetTo;

    // XXX Wouldn't we rather track it as currentTokenStart or so?
    //     replaceFrom sounds dangerous.

    // Get the patches for the hint
    const candidateHints = completeCandidate(completionState, text, cursor);
    // Get the patches for the qualification
    const qualificationHints = completeQualifiedName(completionState, text, cursor);
    // Get the patches for the template
    const templateHints = completeTemplate(completionState);

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
function getInsertClassNameForCategory(category: CompletionPatchTarget): string {
    return INSERT_CLASSNAMES[category as number - 1];
}
function getDeleteClassNameForCategory(category: CompletionPatchTarget): string {
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

export enum HintKey {
    EnterKey = 1,
    TabKey = 2
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

function determineHintKey(hints: CompletionHints, category: CompletionPatchTarget): [HintKey, number | null] {
    switch (category) {
        case CompletionPatchTarget.Candidate:
            return [HintKey.EnterKey, null];
        case CompletionPatchTarget.Template:
            return [HintKey.TabKey, (hints.candidateQualification.length > 0) ? 2 : null];
        case CompletionPatchTarget.CatalogObject:
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
            case PATCH_INSERT_TEXT:
                a = (l.value.textAnchor as number) * (l.target as number);
                break;
            case PATCH_DELETE_TEXT:
                a = (l.target as number) * HINT_PRIORITY_MAX;
                break;
        }
        switch (r.type) {
            case PATCH_INSERT_TEXT:
                b = (r.value.textAnchor as number) * (r.target as number);
                break;
            case PATCH_DELETE_TEXT:
                b = (r.target as number) * HINT_PRIORITY_MAX
                break;
        }
        return a - b;
    });

    // Create decorations
    const decorations: Range<Decoration>[] = [];
    for (const patch of mergedPatches) {
        switch (patch.type) {
            case PATCH_INSERT_TEXT: {
                const side = (patch.value.textAnchor == TextAnchor.Left ? 1 : -1) * (patch.target as number);

                /// Construct the insert widget
                const insertClassname = getInsertClassNameForCategory(patch.target);
                const insertWidget = new InsertPatchWidget(patch.value.text, insertClassname);
                const insertDeco = Decoration.widget({ widget: insertWidget, side }).range(patch.value.at);
                decorations.push(insertDeco);

                // Insert controls after?
                if (patch.controls) {
                    const [hintKey, hintKeyNumber] = determineHintKey(hints, patch.target);
                    const controlsWidget = new HintKeyWidget(hintKey, hintKeyNumber);
                    const controlDeco = Decoration.widget({ widget: controlsWidget, side }).range(patch.value.at);
                    decorations.push(controlDeco);
                }
                break;
            }
            case PATCH_DELETE_TEXT:


                // Construct the deletion widget
                const deleteClassName = getDeleteClassNameForCategory(patch.target);
                const deleteDeco = Decoration.mark({ class: deleteClassName }).range(patch.value.at, patch.value.at + patch.value.length);
                decorations.push(deleteDeco);

                // Emit controls?
                if (patch.controls) {
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
