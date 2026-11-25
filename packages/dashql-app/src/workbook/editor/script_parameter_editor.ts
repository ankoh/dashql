import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

import type { ScriptData } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { DashQLCompletionAbortEffect } from './dashql_processor.js';

/// Add a new parameter to the script of an editor at its selection, see `addParam` of the session
/// (docs/design/workbook_inputs.md): a literal there becomes the parameter and its value, otherwise the statement gets
/// an unset `@param` tag. The core picks the name and the text, the editor applies the change like typing, as one step
/// to undo, and selects the new name so that typing renames it. `taken` are names the parameter must not take, the
/// inputs of the workbook. Returns false if the script doesn't parse or the editor shows another text than the session.
export function addParameterInEditor(
    editorView: EditorView | null,
    scriptData: { scriptSession: Pick<ScriptData['scriptSession'], 'addParam' | 'getText'> } | null,
    taken: readonly string[],
): boolean {
    if (editorView == null || scriptData == null) return false;
    // The change is the one from the text of the session
    if (scriptData.scriptSession.getText() !== editorView.state.doc.toString()) return false;
    const selection = editorView.state.selection.main;
    let added;
    try {
        added = scriptData.scriptSession.addParam(selection.from, selection.to, taken);
    } catch {
        return false;
    }
    editorView.dispatch({
        changes: added.change,
        selection: EditorSelection.single(added.nameFrom, added.nameTo),
        effects: DashQLCompletionAbortEffect.of(null),
        scrollIntoView: true,
    });
    editorView.focus();
    return true;
}
