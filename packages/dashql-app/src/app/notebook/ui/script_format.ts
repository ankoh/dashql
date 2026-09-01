import * as dashql from '../../../core/index.js';

import type { EditorView } from '@codemirror/view';

import type { ScriptData } from '../scripts/notebook_scripts.js';

const DEFAULT_FORMAT_WIDTH = 80;
const DEFAULT_FORMAT_INDENTATION = 4;
const MIN_FORMAT_WIDTH = 24;

export function createScriptFormatConfig(
    mode: dashql.buffers.formatting.FormattingMode,
    debugMode: boolean = false,
    maxWidth: number = DEFAULT_FORMAT_WIDTH,
): dashql.buffers.formatting.FormattingConfigT {
    return new dashql.buffers.formatting.FormattingConfigT(
        dashql.buffers.formatting.FormattingDialect.HYPER,
        mode,
        maxWidth,
        DEFAULT_FORMAT_INDENTATION,
        debugMode,
    );
}

export function measureScriptFormatWidth(editorView: Pick<EditorView, 'defaultCharacterWidth' | 'scrollDOM'>): number {
    const charWidth = editorView.defaultCharacterWidth;
    const availableWidth = editorView.scrollDOM.clientWidth;
    if (!(charWidth > 0) || !(availableWidth > 0)) {
        return DEFAULT_FORMAT_WIDTH;
    }
    return Math.max(MIN_FORMAT_WIDTH, Math.floor(availableWidth / charWidth));
}

export function isScriptFormattable(scriptData: ScriptData | null): boolean {
    if (scriptData == null) return false;
    try {
        return scriptData.scriptSession.isFullyFormattable(
            createScriptFormatConfig(dashql.buffers.formatting.FormattingMode.PRETTY),
            true,
        );
    } catch {
        return false;
    }
}

export function formatScriptEditor(
    editorView: EditorView | null,
    scriptData: ScriptData | null,
    mode: dashql.buffers.formatting.FormattingMode,
    onFormattedText: (text: string) => void,
    debugMode: boolean = false,
): boolean {
    if (editorView == null || scriptData == null) return false;

    let formattedScript: dashql.DashQLScript | null = null;
    try {
        const maxWidth = measureScriptFormatWidth(editorView);
        formattedScript = scriptData.scriptSession.format(
            createScriptFormatConfig(mode, debugMode, maxWidth),
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
