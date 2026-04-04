import * as React from 'react';

import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import type { ScriptData } from '../../notebook/notebook_state.js';
import { CodeMirror } from '../editor/codemirror.js';
import * as themes from '../editor/themes/index.js';
import { DashQLProcessorPlugin, DashQLUpdateEffect, type DashQLScriptBuffers } from '../editor/dashql_processor.js';
import { DashQLScannerDecorationPlugin } from '../editor/dashql_decorations.js';

const SCRIPT_PREVIEW_EXTENSIONS: Extension[] = [
    themes.xcode.xcodeLight,
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    DashQLProcessorPlugin,
    DashQLScannerDecorationPlugin,
];

export interface ScriptPreviewProps {
    className?: string;
    scriptData: ScriptData;
}

export const ScriptPreview: React.FC<ScriptPreviewProps> = ({ className, scriptData }) => {
    const [view, setView] = React.useState<EditorView | null>(null);
    const formatted = scriptData.formattedScript;
    const script = formatted?.script ?? scriptData.script;
    const scriptText = script.toString();
    const scriptBuffers = React.useMemo<DashQLScriptBuffers>(() => ({
        scanned: formatted?.scanned ?? null,
        parsed: formatted?.parsed ?? null,
        analyzed: null,
        destroy: () => { },
    }), [formatted?.scanned, formatted?.parsed]);

    React.useEffect(() => {
        if (view == null) {
            return;
        }
        const state = view.state.field(DashQLProcessorPlugin);
        if (state.script !== script) {
            view.setState(EditorState.create({
                extensions: SCRIPT_PREVIEW_EXTENSIONS,
            }));
        }
        view.dispatch({
            changes: {
                from: 0,
                to: view.state.doc.length,
                insert: scriptText,
            },
            effects: [
                DashQLUpdateEffect.of({
                    config: {},
                    scriptRegistry: null,
                    scriptKey: scriptData.scriptKey,
                    script,
                    scriptBuffers,
                    scriptCursor: null,
                    scriptCompletion: null,
                    derivedFocus: null,
                    onUpdate: () => { },
                }),
            ],
        });
    }, [view, scriptData.scriptKey, script, scriptText, scriptBuffers]);

    return (
        <div className={className}>
            <CodeMirror extensions={SCRIPT_PREVIEW_EXTENSIONS} ref={setView} style={{ height: 'auto' }} />
        </div>
    );
};
