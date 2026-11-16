import * as dashql from '@ankoh/dashql';

import type { EditorView } from '@codemirror/view';

import type { ScriptData } from '@ankoh/dashql/platform/workbook/scripts/workbook_scripts';
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

export function formatScriptEditor(
    editorView: EditorView | null,
    scriptData: ScriptData | null,
    mode: dashql.buffers.formatting.FormattingMode,
    onFormattedText: (text: string) => void,
    debugMode: boolean = false,
    keywordCase: dashql.buffers.formatting.KeywordCase = dashql.buffers.formatting.KeywordCase.LOWER,
    dialect: dashql.buffers.formatting.FormattingDialect = dashql.buffers.formatting.FormattingDialect.HYPER,
): boolean {
    if (editorView == null || scriptData == null) return false;

    let formattedScript: dashql.DashQLScript | null = null;
    try {
        const maxWidth = measureScriptFormatWidth(editorView);
        formattedScript = scriptData.scriptSession.format(
            createScriptFormatConfig(mode, debugMode, maxWidth, keywordCase, dialect),
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
