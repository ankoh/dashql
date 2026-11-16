import * as dashql from '../../core/index.js';

/// What an editor reports to the workbook scripts: the analysis of a script session after an edit or a move of the
/// cursor, and the staged rewrite. Plain data without an editor library. The completion and the focus stay in the
/// editor of the app.

/// A script key
export type DashQLScriptKey = number;

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

/// An update of a script session by an editor
export interface ScriptSessionUpdate {
    /// The key of the script
    scriptKey: DashQLScriptKey;
    /// The script session that the editor edits
    scriptSession?: dashql.DashQLScriptSessionReader | null;
    /// The latest plain editor-workbook snapshot.
    editorUpdate?: dashql.buffers.editor.EditorUpdateT | null;
    /// The pending staged rewrite shown as an in-place diff (if any)
    scriptPendingDiff: DashQLPendingDiff | null;
}
