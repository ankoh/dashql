import * as React from 'react';

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import type { NotebookScripts } from '../../../scripts/notebook_scripts.js';
import { analyzeScript } from '../../editor/dashql_processor.js';
import {
    DashQLScannerDecorationUpdateEffect,
    DashQLStandaloneScannerDecorationPlugin,
} from '../../editor/dashql_decorations_standalone.js';
import * as themes from '../../editor/themes/index.js';

import * as styles from './notebook_shell.module.css';
import { createShellPromptGutter } from './shell_prompt_gutter.js';

interface Props {
    notebookScripts: NotebookScripts;
    sourceText: string;
    prompt: string;
}

export const ShellQueryPreview: React.FC<Props> = (props) => {
    const [node, setNode] = React.useState<HTMLDivElement | null>(null);

    React.useEffect(() => {
        if (node == null) return;

        const script = props.notebookScripts.instance.createScript(props.notebookScripts.connectionCatalog);
        script.replaceText(props.sourceText);
        const buffers = analyzeScript(script);
        const view = new EditorView({
            state: EditorState.create({
                doc: props.sourceText,
                extensions: [
                    themes.xcode.xcodeLightInit({
                        settings: {
                            background: 'transparent',
                            gutterBackground: 'transparent',
                            lineHighlight: 'transparent',
                        },
                    }),
                    EditorState.readOnly.of(true),
                    EditorView.editable.of(false),
                    createShellPromptGutter(props.prompt),
                    DashQLStandaloneScannerDecorationPlugin,
                    EditorView.theme({
                        '&': { backgroundColor: 'transparent' },
                        '.cm-scroller': { overflow: 'visible' },
                        '.cm-content': { minHeight: '0', padding: '0' },
                        '.cm-line': { padding: '0' },
                        '.cm-gutters': { paddingLeft: '0', backgroundColor: 'transparent', border: 'none' },
                        '.cm-cursor, .cm-dropCursor': { display: 'none' },
                        '&.cm-focused': { outline: 'none' },
                    }),
                ],
            }),
            parent: node,
        });
        view.dispatch({
            effects: DashQLScannerDecorationUpdateEffect.of(buffers.parsed),
        });

        return () => {
            view.destroy();
            buffers.destroy(buffers);
            script.destroy();
        };
    }, [node, props.notebookScripts.connectionCatalog, props.notebookScripts.instance, props.sourceText]);

    return (
        <div className={styles.command_editor} ref={setNode} />
    );
};
