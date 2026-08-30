import * as React from 'react';
import * as detailStyles from './script_details.module.css';
import * as styles from './catalog_schema_view.module.css';

import { EditorView } from '@codemirror/view';
import { LockIcon, XIcon } from '../../../ui/foundations/symbol_icon.js';

import { CodeMirror, createReadonlyCodeMirrorExtensions } from '../scripts/editor/codemirror.js';
import { DashQLUpdateEffect, analyzeScript, DashQLScriptBuffers } from '../scripts/editor/dashql_processor.js';
import { ScriptName } from './script_name.js';
import type { DashQLScript } from '../../../core/api.js';
import { ButtonSize, ButtonVariant, IconButton } from '../../../ui/foundations/button.js';

export interface CatalogScriptCardProps {
    script: DashQLScript;
    fileName: string;
    lastFullRefresh: number | null;
    onClose?: () => void;
}

export const CatalogScriptCard: React.FC<CatalogScriptCardProps> = (props) => {
    const [view, setView] = React.useState<EditorView | null>(null);
    const prevTextRef = React.useRef<string>('');
    const prevBuffersRef = React.useRef<DashQLScriptBuffers | null>(null);
    const readonlyExtensions = React.useMemo(() => createReadonlyCodeMirrorExtensions(), []);

    React.useEffect(() => {
        if (view == null) return;
        const text = props.script.toString();
        if (text === prevTextRef.current) return;
        prevTextRef.current = text;

        const buffers = analyzeScript(props.script);
        prevBuffersRef.current?.destroy(prevBuffersRef.current);
        prevBuffersRef.current = buffers;

        // Replace the document text and publish the pre-analyzed buffers in a single
        // transaction. Splitting these into two dispatches forced two full layout passes
        // (and a frame of unstyled text) on large scripts; ScriptEditor and ScriptPreview
        // both apply changes+effects atomically, and this mirrors that.
        view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: text },
            effects: [
                DashQLUpdateEffect.of({
                    scriptKey: props.script.getCatalogEntryId(),
                    scriptSession: null,
                    editorUpdate: null,
                    scriptBuffers: buffers,
                    scriptCompletion: null,
                    scriptPendingDiff: null,
                    derivedFocus: null,
                    onUpdate: () => { },
                }),
            ],
        });
    }, [view, props.lastFullRefresh, props.script]);

    React.useEffect(() => {
        return () => {
            prevBuffersRef.current?.destroy(prevBuffersRef.current);
            prevBuffersRef.current = null;
        };
    }, []);

    return (
        <div key={props.fileName} className={detailStyles.entry_single}>
            <div className={detailStyles.entry_script_card}>
                <div className={detailStyles.entry_card_action_bar}>
                    <div className={detailStyles.entry_card_file_name}>
                        <ScriptName file={props.fileName} icon={<LockIcon size={12} />} />
                    </div>
                    {props.onClose != null && (
                        <IconButton
                            variant={ButtonVariant.Invisible}
                            size={ButtonSize.Small}
                            aria-label="Close catalog"
                            onClick={props.onClose}
                        >
                            <XIcon size={16} />
                        </IconButton>
                    )}
                </div>
                <div className={styles.entry_card_editor}>
                    <CodeMirror ref={setView} extensions={readonlyExtensions} />
                </div>
            </div>
        </div>
    );
};
