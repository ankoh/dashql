import * as dashql from '@ankoh/dashql-core';

import { VariantKind } from '../../utils/variant.js';

/// The state of the editor that the script data carries: the buffers, the completion and a pending diff.
/// Plain data without an editor library, the editor modules in ../editor/ produce and read it.

/// A script key
export type DashQLScriptKey = number;
/// A collection of FlatBuffers for a script
export interface DashQLScriptBuffers {
    /// The parsed script
    parsed: dashql.FlatBufferPtr<dashql.buffers.parser.ParsedScript> | null;
    /// The analyzed script
    analyzed: dashql.FlatBufferPtr<dashql.buffers.analyzer.AnalyzedScript> | null;
}

/// A completion status
export enum DashQLCompletionStatus {
    AVAILABLE,
    SELECTED_CANDIDATE,
    SELECTED_CATALOG_OBJECT,
}

/// A pending, staged formatting rewrite shown as an in-place diff.
///
/// The editor already holds the *new* (target) text; `priorText` is the verbatim text that was in
/// the script before the rewrite, restored on reject. `diffBuffer` is the statement-level semantic
/// diff (source = prior, target = new) used to highlight the changed statements and sub-ranges.
/// Whole-suggestion accept/reject: accept keeps the new text, reject restores `priorText`, and any
/// genuine user edit auto-accepts.
export interface DashQLPendingDiff {
    /// The verbatim text before the rewrite (restored on reject)
    priorText: string;
    /// The semantic diff from the prior text (source) to the new text (target)
    diffBuffer: dashql.FlatBufferPtr<dashql.buffers.diff.ScriptDiff>;
}

/// A completion state
export interface DashQLCompletionState {
    /// The status
    status: DashQLCompletionStatus;
    /// Show as a passive inline hint only, without the dropdown list or candidate navigation.
    passiveHint: boolean;
    /// The completion buffer
    buffer: dashql.FlatBufferPtr<dashql.buffers.completion.Completion>;
    /// The currently selected candidate id.
    /// 0 if there are no candidates.
    candidateId: number;
    /// The patches to apply the candidate
    candidatePatch: CompletionPatch[];
    /// The currently selected catalog object id.
    /// 0 if there are no objects.
    catalogObjectId: number;
    /// The patches to apply the catalog object
    catalogObjectPatch: CompletionPatch[];
    /// Override cursor position after applying qualification/function-call patches.
    catalogObjectCursorOffset: number | null;
}

/// A state that is pushed from the processor to the outside
export interface DashQLProcessorUpdateOut {
    /// The key of the currently active script
    scriptKey: DashQLScriptKey;
    /// The currently active editor workbook
    scriptSession?: dashql.DashQLScriptSession | null;
    /// The latest plain editor-workbook snapshot.
    editorUpdate?: dashql.buffers.editor.EditorUpdateT | null;
    /// The previous processed script buffers (if any)
    scriptBuffers: DashQLScriptBuffers | null;
    /// The completion candidate state (if any)
    scriptCompletion: DashQLCompletionState | null;
    /// The pending staged rewrite shown as an in-place diff (if any)
    scriptPendingDiff: DashQLPendingDiff | null;
}

export const PATCH_INSERT_TEXT = Symbol("INSERT_TEXT");
export const PATCH_DELETE_TEXT = Symbol("REMOVE_TEXT");

export enum CompletionPatchTarget {
    Candidate = 1,
    CatalogObject = 2,
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

export interface InsertTextPatch {
    /// The location
    at: number;
    /// The completion text
    text: string;
    /// The text anchor of the hint
    textAnchor: TextAnchor;
}

export interface RemoveTextPatch {
    /// Remove text at a location
    at: number;
    /// Remove `length` characters
    length: number;
}
