import * as dashql from '@ankoh/dashql-core';

import * as meyers from '../../utils/diff.js';

import { Text } from '@codemirror/state';
import { VariantKind } from '../../utils/index.js';
import { DashQLCompletionState, DashQLCompletionStatus } from './dashql_processor.js';
import { readColumnIdentifierSnippet } from '../../view/snippet/script_template_snippet.js';

export const PATCH_INSERT_TEXT = Symbol("INSERT_TEXT");
export const PATCH_DELETE_TEXT = Symbol("REMOVE_TEXT");

export enum PatchTarget {
    Candidate = 1,
    CandidateQualification = 2,
    CandidateTemplate = 3
}

export type PatchVariant =
    | VariantKind<typeof PATCH_INSERT_TEXT, InsertTextPatch>
    | VariantKind<typeof PATCH_DELETE_TEXT, RemoveTextPatch>;

export type Patch = PatchVariant & {
    /// The patch target
    target: PatchTarget;
    /// Should we render the category controls for the user?
    /// We want to hint the user that he can click certain keys to apply a patch.
    controls: boolean;
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

/// Given two strings, derive the hints that needed to get from `have` to `want`
function derivePatches(at: number, have: string, want: string, hintType: PatchTarget, cursor: number): Patch[] {
    const out: Patch[] = [];

    // XXX This is a candidate for offloading to WebAssembly
    for (const [haveFrom, haveTo, wantFrom, wantTo] of meyers.diff(have, want)) {
        if (haveFrom != haveTo) {
            out.push({
                target: hintType,
                controls: false,
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
                controls: false,
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
function readQualifiedName(co: dashql.buffers.completion.CompletionCandidateObject): string[] {
    const out = [];
    for (let i = 0; i < co.qualifiedNameLength(); ++i) {
        const name = co.qualifiedName(i);
        out.push(name);
    }
    return out;
}

export function completeCandidate(completion: DashQLCompletionState, text: Text, cursor: number = 0): Patch[] {
    const buffer = completion.buffer.read();

    let out: Patch[] = [];
    switch (completion.status) {
        case DashQLCompletionStatus.AVAILABLE:
            // Read candidate
            const candidateId = completion.candidateId;
            if (candidateId >= buffer.candidatesLength()) {
                return [];
            }
            const candidate = buffer.candidates(candidateId)!;
            const candidateText = candidate.completionText()!;

            // Read qualified name (if any)
            const targetLoc = candidate.targetLocation();
            const qualifiedLoc = candidate.targetLocationQualified();
            if (targetLoc == null || qualifiedLoc == null) {
                return [];
            }
            const targetFrom = targetLoc.offset();
            const targetTo = targetFrom + targetLoc.length();
            const currentText = text.sliceString(targetFrom, targetTo);
            out = derivePatches(targetFrom, currentText, candidateText, PatchTarget.Candidate, cursor);
            return out;

        default:
            return [];
    }
}

/// Helper to compute patches for qualifying a name (if any)
export function completeQualifiedName(completion: DashQLCompletionState, text: Text, cursor: number = 0): Patch[] {
    // Skip if we're dot-completing
    const buffer = completion.buffer.read();
    if (completion.buffer.read().dotCompletion()) {
        return [];
    }

    let out: Patch[] = [];
    switch (completion.status) {
        case DashQLCompletionStatus.AVAILABLE:
        case DashQLCompletionStatus.SELECTED_CANDIDATE:
            // Read candidate
            const candidateId = completion.candidateId ?? 0;
            if (candidateId >= buffer.candidatesLength()) {
                return [];
            }
            const candidate = buffer.candidates(candidateId)!;

            // Read catalog object
            const catalogObjectId = completion.catalogObjectId ?? 0;
            if (catalogObjectId >= candidate.catalogObjectsLength()) {
                return [];
            }
            const catalogObject = candidate.catalogObjects(catalogObjectId)!;

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
                let hints = derivePatches(qualifiedFrom, have, want, PatchTarget.CandidateQualification, cursor);
                out = hints;
            }

            // Qualification suffix
            let qualSuffix = name.slice(catalogObject.qualifiedNameTargetIdx() + 1);
            if (qualSuffix.length > 0) {
                let have = text.sliceString(targetTo, qualifiedTo);
                let want = "." + qualSuffix.join(".");
                let hints = derivePatches(targetTo, have, want, PatchTarget.CandidateTemplate, cursor);
                out = hints.concat(hints);
            }
            return out;

        default:
            return [];
    }
}

/// Helper to compute patches for qualifying a name (if any)
export function completeTemplate(completion: DashQLCompletionState): Patch[] {
    // Skip if we're dot-completing
    const buffer = completion.buffer.read();
    if (completion.buffer.read().dotCompletion()) {
        return [];
    }

    let out: Patch[] = [];
    switch (completion.status) {
        case DashQLCompletionStatus.AVAILABLE:
        case DashQLCompletionStatus.SELECTED_CANDIDATE:
        case DashQLCompletionStatus.SELECTED_CATALOG_OBJECT:
            // Read candidate
            const candidateId = completion.candidateId;
            if (candidateId >= buffer.candidatesLength()) {
                return [];
            }
            const candidate = buffer.candidates(candidateId)!;

            // Resolve location of qualified name
            const targetLoc = candidate.targetLocation();
            const qualifiedLoc = candidate.targetLocationQualified();
            if (targetLoc == null || qualifiedLoc == null) {
                return [];
            }
            const qualifiedFrom = qualifiedLoc.offset();
            const qualifiedTo = qualifiedFrom + qualifiedLoc.length();

            const tmpNode = new dashql.buffers.parser.Node();
            if (candidate.completionTemplatesLength() > 0) {
                const template = candidate.completionTemplates(0)!;
                if (template.snippetsLength() > 0) {
                    const snippet = template.snippets(0)!;
                    const snippetModel = readColumnIdentifierSnippet(snippet, tmpNode);
                    if (snippetModel.textBefore.length > 0) {
                        out.push({
                            target: PatchTarget.CandidateTemplate,
                            controls: false,
                            type: PATCH_INSERT_TEXT,
                            value: {
                                at: qualifiedFrom,
                                text: snippetModel.textBefore,
                                textAnchor: TextAnchor.Right,
                            }
                        });
                    }
                    if (snippetModel.textAfter.length > 0) {
                        out.push({
                            target: PatchTarget.CandidateTemplate,
                            controls: false,
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
            return out;
        default:
            return [];
    }

}

