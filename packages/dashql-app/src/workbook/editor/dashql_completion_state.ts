import * as dashql from '@ankoh/dashql';

import type { ScriptSessionUpdate } from '@ankoh/dashql/platform/workbook/script_editor_state';
import { VariantKind } from '@ankoh/dashql/platform/utils/variant';

/// The state of a completion in the editor. The editor owns it, the workbook scripts never see it.

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

/// A state that is pushed from the processor to the outside. The workbook scripts take the part of a
/// `ScriptSessionUpdate`, the rest stays in the editor.
export interface DashQLProcessorUpdateOut extends ScriptSessionUpdate {
    /// The previous processed script buffers (if any)
    scriptBuffers: DashQLScriptBuffers | null;
    /// The completion candidate state (if any)
    scriptCompletion: DashQLCompletionState | null;
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
