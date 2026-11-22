import * as dashql from '@akohn/dashql';

import type { EditorView } from '@codemirror/view';

import type { ScriptData } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { createScriptFormatConfig, DEFAULT_FORMAT_WIDTH, MIN_FORMAT_WIDTH } from '../scripts/script_format.js';

/// Formatting in an editor: the width of the view and the formatted text of a script, see ../scripts/script_format.ts

export function measureScriptFormatWidth(editorView: Pick<EditorView, 'defaultCharacterWidth' | 'scrollDOM'>): number {
    const charWidth = editorView.defaultCharacterWidth;
    const availableWidth = editorView.scrollDOM.clientWidth;
    if (!(charWidth > 0) || !(availableWidth > 0)) {
        return DEFAULT_FORMAT_WIDTH;
    }
    return Math.max(MIN_FORMAT_WIDTH, Math.floor(availableWidth / charWidth));
}

/// Format the script of an editor, at the width of the editor unless a width is given
export function formatScriptEditor(
    editorView: EditorView | null,
    scriptData: { scriptSession: Pick<ScriptData['scriptSession'], 'format'> } | null,
    mode: dashql.buffers.formatting.FormattingMode,
    onFormattedText: (text: string) => void,
    debugMode: boolean = false,
    keywordCase: dashql.buffers.formatting.KeywordCase = dashql.buffers.formatting.KeywordCase.LOWER,
    dialect: dashql.buffers.formatting.FormattingDialect = dashql.buffers.formatting.FormattingDialect.HYPER,
    maxWidth?: number,
): boolean {
    if (editorView == null || scriptData == null) return false;

    let formattedScript: dashql.DashQLScript | null = null;
    try {
        formattedScript = scriptData.scriptSession.format(
            createScriptFormatConfig(mode, debugMode, maxWidth ?? measureScriptFormatWidth(editorView), keywordCase, dialect),
            null,
        );
        const formattedText = formattedScript.toString();
        if (formattedText === editorView.state.doc.toString()) return false;
        onFormattedText(formattedText);
        editorView.focus();
        return true;
    } catch {
        return false;
    } finally {
        formattedScript?.destroy();
    }
}
