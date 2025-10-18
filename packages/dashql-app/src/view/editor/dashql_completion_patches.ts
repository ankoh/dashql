import * as dashql from '@ankoh/dashql-core';

import * as meyers from '../../utils/diff.js';

import { ChangeSpec, Text } from '@codemirror/state';
import { VariantKind } from '../../utils/index.js';
import { DashQLCompletionState } from './dashql_processor.js';
import { readColumnIdentifierSnippet } from '../../view/snippet/script_template_snippet.js';

export const PATCH_INSERT_TEXT = Symbol("INSERT_TEXT");
export const PATCH_DELETE_TEXT = Symbol("REMOVE_TEXT");

export enum CompletionPatchTarget {
    Candidate = 1,
    CatalogObject = 2,
    Template = 3
}

export type CompletionPatchVariant =
    | VariantKind<typeof PATCH_INSERT_TEXT, InsertTextPatch>
    | VariantKind<typeof PATCH_DELETE_TEXT, RemoveTextPatch>;

export type CompletionPatch = CompletionPatchVariant & {
    /// The patch target
    target: CompletionPatchTarget;
};

export enum TextAnchor {
    Right = -1,
    Left = 1,
}

interface InsertTextPatch {
    /// The location
    at: number;
    /// The completion text
    text: string;
    /// The text anchor of the hint
    textAnchor: TextAnchor;
}

interface RemoveTextPatch {
    /// Remove text at a location
    at: number;
    /// Remove `length` characters
    length: number;
}

/// Given two strings, derive the required patches to get from `have` to `want`
function computeDiff(at: number, have: string, want: string, hintType: CompletionPatchTarget, cursor: number): CompletionPatch[] {
    const out: CompletionPatch[] = [];

    // XXX This is a candidate for offloading to WebAssembly
    for (const [haveFrom, haveTo, wantFrom, wantTo] of meyers.diff(have, want)) {
        if (haveFrom != haveTo) {
            out.push({
                target: hintType,
                type: PATCH_DELETE_TEXT,
                value: {
                    at: at + haveFrom,
                    length: haveTo - haveFrom,
                }
            })
        }
        if (wantFrom != wantTo) {
            out.push({
                target: hintType,
                type: PATCH_INSERT_TEXT,
                value: {
                    at: at + haveTo,
                    text: want.substring(wantFrom, wantTo),
                    textAnchor: ((at + haveTo) < cursor) ? TextAnchor.Right : TextAnchor.Left,
                }
            })
        }
    }
    return out;
}

/// Helper to read a qualified name
export function unpackQualifiedObjectName(co: dashql.buffers.completion.CompletionCandidateObject): string[] {
    const out = [];
    for (let i = 0; i < co.qualifiedNameLength(); ++i) {
        const name = co.qualifiedName(i);
        out.push(name);
    }
    return out;
}

function copyLazily(nextState: DashQLCompletionState, prevState: DashQLCompletionState): DashQLCompletionState {
    return nextState === prevState ? { ...prevState } : nextState;
};

export enum UpdatePatchStartingFrom {
    Candidate = 0,
    CatalogObject = 1,
    Template = 2
}

export function computePatches(prevState: DashQLCompletionState, text: Text, cursor: number = 0, updateFrom: UpdatePatchStartingFrom = UpdatePatchStartingFrom.Candidate): DashQLCompletionState {
    const buffer = prevState.buffer.read();
    let nextState = prevState;

    /// Invalid candidate id?
    const candidateId = prevState.candidateId;
    if (candidateId >= buffer.candidatesLength()) {
        return nextState;
    }
    const candidate = buffer.candidates(candidateId)!;

    // Read locations since (every patch will need them)
    const targetLoc = candidate.targetLocation();
    const qualifiedLoc = candidate.targetLocationQualified();
    if (targetLoc == null || qualifiedLoc == null) {
        return nextState;
    }
    const targetFrom = targetLoc.offset();
    const targetTo = targetFrom + targetLoc.length();
    const qualifiedFrom = qualifiedLoc.offset();
    const qualifiedTo = qualifiedFrom + qualifiedLoc.length();

    // Update candidate patch?
    if (updateFrom <= UpdatePatchStartingFrom.Candidate) {
        nextState = copyLazily(nextState, prevState);
        nextState.candidatePatch = [];
        nextState.catalogObjectPatch = [];
        nextState.templatePatch = [];

        const candidateText = candidate.completionText()!;
        const currentText = text.sliceString(targetFrom, targetTo);
        nextState.candidatePatch = computeDiff(targetFrom, currentText, candidateText, CompletionPatchTarget.Candidate, cursor);
    }

    // Read catalog object
    const catalogObjectId = prevState.catalogObjectId;
    if (catalogObjectId >= candidate.catalogObjectsLength()) {
        return nextState;
    }
    const catalogObject = candidate.catalogObjects(catalogObjectId)!;

    // Update catalog object patch?
    if (updateFrom <= UpdatePatchStartingFrom.CatalogObject) {
        nextState = copyLazily(nextState, prevState);
        nextState.catalogObjectPatch = [];
        nextState.templatePatch = [];

        // Qualification prefix
        let name = unpackQualifiedObjectName(catalogObject);
        let qualPrefix = name.slice(0, catalogObject.qualifiedNameTargetIdx());
        if (qualPrefix.length > 0) {
            let have = text.sliceString(qualifiedFrom, targetFrom);
            let want = qualPrefix.join(".") + ".";
            let patch = computeDiff(qualifiedFrom, have, want, CompletionPatchTarget.CatalogObject, cursor);
            nextState.catalogObjectPatch = patch;
        }

        // Qualification suffix
        let qualSuffix = name.slice(catalogObject.qualifiedNameTargetIdx() + 1);
        if (qualSuffix.length > 0) {
            let have = text.sliceString(targetTo, qualifiedTo);
            let want = "." + qualSuffix.join(".");
            let patch = computeDiff(targetTo, have, want, CompletionPatchTarget.CatalogObject, cursor);
            nextState.catalogObjectPatch = nextState.catalogObjectPatch.concat(patch);
        }
    }

    const templateId = prevState.templateId;
    if (templateId >= catalogObject.scriptTemplatesLength()) {
        return nextState;
    }
    const template = catalogObject.scriptTemplates(templateId)!;

    // Update template patch?
    if (updateFrom <= UpdatePatchStartingFrom.Template) {
        nextState = copyLazily(nextState, prevState);
        nextState.templatePatch = [];

        const tmpNode = new dashql.buffers.parser.Node();
        if (template.snippetsLength() > 0) {
            const snippet = template.snippets(0)!;
            const snippetModel = readColumnIdentifierSnippet(snippet, tmpNode);
            if (snippetModel.textBefore.length > 0) {
                nextState.templatePatch.push({
                    target: CompletionPatchTarget.Template,
                    type: PATCH_INSERT_TEXT,
                    value: {
                        at: qualifiedFrom,
                        text: snippetModel.textBefore,
                        textAnchor: TextAnchor.Right,
                    }
                });
            }
            if (snippetModel.textAfter.length > 0) {
                nextState.templatePatch.push({
                    target: CompletionPatchTarget.Template,
                    type: PATCH_INSERT_TEXT,
                    value: {
                        at: qualifiedTo,
                        text: snippetModel.textAfter,
                        textAnchor: TextAnchor.Left,
                    }
                });
            }
        }
    }
    return nextState;
}

export function updateCursorWithCompletion(patch: CompletionPatch[], cursorAt: number): number {
    let out = cursorAt;
    for (const p of patch) {
        switch (p.type) {
            case PATCH_DELETE_TEXT:
                if (p.value.at < cursorAt) {
                    const to = Math.min(p.value.at + p.value.length, cursorAt);
                    const deleteBeforeCursor = to - p.value.at;
                    out -= deleteBeforeCursor;
                }
                break;
            case PATCH_INSERT_TEXT:
                if (p.value.at <= cursorAt) {
                    out += p.value.text.length;
                }
                break;
        }
    }
    return out;
}

export function applyCompletion(patch: CompletionPatch[]): ChangeSpec {
    const out: ChangeSpec[] = [];
    for (const p of patch) {
        switch (p.type) {
            case PATCH_DELETE_TEXT:
                out.push({
                    from: p.value.at,
                    to: p.value.at + p.value.length,
                });
                break;
            case PATCH_INSERT_TEXT:
                out.push({
                    from: p.value.at,
                    insert: p.value.text
                });
                break;
        }
    }
    return out;
}
