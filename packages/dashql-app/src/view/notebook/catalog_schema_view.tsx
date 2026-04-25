import * as React from 'react';
import * as detailStyles from './notebook_script_details.module.css';
import * as styles from './catalog_schema_view.module.css';

import { EditorView } from '@codemirror/view';
import { motion, AnimatePresence } from 'framer-motion';

import { LockIcon } from '@primer/octicons-react';

import { ConnectionState } from '../../connection/connection_state.js';
import { CodeMirror, createReadonlyCodeMirrorExtensions } from '../editor/codemirror.js';
import { DashQLUpdateEffect, analyzeScript, DashQLScriptBuffers } from '../editor/dashql_processor.js';
import { NotebookScriptName } from './notebook_script_name.js';

export interface CatalogSchemaViewProps {
    connection: ConnectionState;
}

export const CatalogSchemaView: React.FC<CatalogSchemaViewProps> = (props) => {
    const [view, setView] = React.useState<EditorView | null>(null);
    const prevTextRef = React.useRef<string>('');
    const prevBuffersRef = React.useRef<DashQLScriptBuffers | null>(null);

    const catalogScript = props.connection.catalogScript;
    const lastFullRefresh = props.connection.catalogUpdates.lastFullRefresh;

    // Update editor content and decorations when the catalog script changes
    React.useEffect(() => {
        if (view == null) return;
        const text = catalogScript.toString();
        if (text === prevTextRef.current) return;
        prevTextRef.current = text;

        // Replace the document text
        view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: text },
        });

        // Analyze the script and push buffers for decorations
        const buffers = analyzeScript(catalogScript);
        prevBuffersRef.current?.destroy(prevBuffersRef.current);
        prevBuffersRef.current = buffers;

        view.dispatch({
            effects: [
                DashQLUpdateEffect.of({
                    config: {},
                    scriptRegistry: null,
                    scriptKey: catalogScript.getCatalogEntryId(),
                    script: catalogScript,
                    scriptBuffers: buffers,
                    scriptCursor: null,
                    scriptCompletion: null,
                    derivedFocus: null,
                    onUpdate: () => { },
                }),
            ],
        });
    }, [view, lastFullRefresh, catalogScript]);

    // Cleanup buffers on unmount
    React.useEffect(() => {
        return () => {
            prevBuffersRef.current?.destroy(prevBuffersRef.current);
            prevBuffersRef.current = null;
        };
    }, []);

    const readonlyExtensions = React.useMemo(() => createReadonlyCodeMirrorExtensions(), []);

    return (
        <div className={detailStyles.entry_body_container}>
            <div
                key="catalog-schema"
                className={detailStyles.entry_body_card}
            >
                <div className={detailStyles.entry_card_container}>
                    <div className={detailStyles.entry_card_action_bar}>
                        <div className={detailStyles.entry_card_file_name}>
                            <NotebookScriptName folder=".." file="dashql-schema.sql" icon={<LockIcon size={12} />} />
                        </div>
                    </div>
                    <div className={styles.entry_card_editor}>
                        <CodeMirror ref={setView} extensions={readonlyExtensions} />
                    </div>
                </div>
            </div>
        </div>
    );
};
