import * as React from 'react';
import * as styles from './catalog_schema_view.module.css';

import { EditorView } from '@codemirror/view';

import { motion, AnimatePresence } from 'framer-motion';

import { ButtonVariant, IconButton } from '../foundations/button.js';
import { ConnectionState } from '../../connection/connection_state.js';
import { CodeMirror, createReadonlyCodeMirrorExtensions } from '../editor/codemirror.js';
import { DashQLUpdateEffect, analyzeScript, DashQLScriptBuffers } from '../editor/dashql_processor.js';
import { NotebookScriptName } from './notebook_script_name.js';
import { SymbolIcon } from '../foundations/symbol_icon.js';

import type { Icon } from '@primer/octicons-react';

export interface CatalogSchemaViewProps {
    connection: ConnectionState;
    hideDetails: () => void;
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
                    onUpdate: () => {},
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

    const ScreenNormalIcon: Icon = SymbolIcon('screen_normal_16');
    return (
        <div className={styles.container}>
            <AnimatePresence mode="wait">
                <motion.div
                    key="catalog-schema"
                    className={styles.card}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{
                        duration: 0.1,
                        ease: [0.33, 1, 0.68, 1]
                    }}
                >
                    <div className={styles.card_inner}>
                        <div className={styles.action_bar}>
                            <div className={styles.file_name}>
                                <NotebookScriptName folder=".." file="dashql-schema.sql" />
                            </div>
                            <IconButton
                                className={styles.collapse_button}
                                variant={ButtonVariant.Invisible}
                                onClick={props.hideDetails}
                                aria-label="Collapse"
                            >
                                <ScreenNormalIcon size={16} />
                            </IconButton>
                        </div>
                        <div className={styles.editor}>
                            <CodeMirror ref={setView} extensions={readonlyExtensions} />
                        </div>
                    </div>
                </motion.div>
            </AnimatePresence>
        </div>
    );
};
