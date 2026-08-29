import * as React from 'react';
import * as dashql from '../../../core/index.js';

import { EditorSelection, EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

import type { ScriptData } from '../scripts/notebook_scripts.js';
import { createReadonlyCodeMirrorExtensions } from '../scripts/editor/codemirror.js';
import { DashQLUpdateEffect } from '../scripts/editor/dashql_processor.js';

interface FormatPreviewResources {
    editorState: EditorState;
    text: string;
}

export function projectFormattedText(
    instance: dashql.DashQL,
    text: string,
): dashql.buffers.editor.EditorUpdateT {
    const catalog = instance.createCatalog();
    const session = instance.createScriptSession(catalog);
    try {
        session.replaceText(0n, text);
        return session.ensureAnalysis();
    } finally {
        session.destroy();
        catalog.destroy();
    }
}

export function useScriptFormatPreview(
    editorView: EditorView | null,
    scriptData: ScriptData | null,
): {
    formatPending: boolean;
    format: (mode: dashql.buffers.formatting.FormattingMode) => void;
    acceptFormat: () => void;
    cancelFormat: () => void;
} {
    const resourcesRef = React.useRef<FormatPreviewResources | null>(null);
    const [formatPending, setFormatPending] = React.useState(false);

    const clearPreview = React.useCallback(() => {
        resourcesRef.current = null;
        setFormatPending(false);
    }, []);

    React.useEffect(() => clearPreview, [clearPreview, scriptData?.scriptKey]);

    const format = React.useCallback((mode: dashql.buffers.formatting.FormattingMode) => {
        if (scriptData == null) return;
        let formattedScript: dashql.DashQLScript | null = null;
        try {
            const config = new dashql.buffers.formatting.FormattingConfigT(
                dashql.buffers.formatting.FormattingDialect.HYPER,
                mode,
                80,
                4,
                false,
            );
            formattedScript = scriptData.scriptSession.format(config, null);
            if (editorView == null) return;

            const formattedText = formattedScript.toString();
            if (formattedText === editorView.state.doc.toString()) return;
            const editorUpdate = projectFormattedText(scriptData.scriptSession.ptr.api, formattedText);
            const resources = {
                editorState: editorView.state,
                text: formattedText,
            };
            resourcesRef.current = resources;

            editorView.setState(EditorState.create({
                doc: formattedText,
                extensions: createReadonlyCodeMirrorExtensions(),
            }));
            editorView.contentDOM.blur();
            editorView.dispatch({
                effects: DashQLUpdateEffect.of({
                    scriptKey: scriptData.scriptKey,
                    scriptSession: null,
                    editorUpdate,
                    scriptBuffers: null,
                    scriptCompletion: null,
                    scriptPendingDiff: null,
                    derivedFocus: null,
                    onUpdate: () => { },
                }),
            });
            setFormatPending(true);
        } catch {
            // Formatting is best-effort; diagnostics report unsupported statements separately.
        } finally {
            formattedScript?.ptr.destroy();
        }
    }, [editorView, scriptData]);

    const restoreEditor = React.useCallback((accept: boolean) => {
        const resources = resourcesRef.current;
        if (editorView == null || resources == null) return;
        document.getSelection()?.removeAllRanges();
        editorView.setState(resources.editorState);
        editorView.dispatch(accept ? {
            changes: { from: 0, to: editorView.state.doc.length, insert: resources.text },
            selection: EditorSelection.cursor(0),
        } : {
            selection: EditorSelection.cursor(0),
        });
        clearPreview();
    }, [clearPreview, editorView]);

    const acceptFormat = React.useCallback(() => restoreEditor(true), [restoreEditor]);
    const cancelFormat = React.useCallback(() => restoreEditor(false), [restoreEditor]);
    return { formatPending, format, acceptFormat, cancelFormat };
}
