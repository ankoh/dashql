import * as React from 'react';
import * as detailStyles from './notebook_script_details.module.css';

import icons from '@ankoh/dashql-svg-symbols';
import { EditorView } from '@codemirror/view';
import { motion, AnimatePresence } from 'framer-motion';

import { ConnectionState } from '../../connection/connection_state.js';
import { CodeMirror, createReadonlyCodeMirrorExtensions } from '../editor/codemirror.js';
import { DashQLUpdateEffect, analyzeScript, DashQLScriptBuffers } from '../editor/dashql_processor.js';
import { NotebookScriptName } from './notebook_script_name.js';
import { VerticalTabs, VerticalTabVariant } from '../foundations/vertical_tabs.js';

enum TabKey {
    Editor = 0,
}

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
    const selectTab = React.useCallback(() => {}, []);

    return (
        <div className={detailStyles.entry_body_container}>
            <AnimatePresence mode="wait">
                <motion.div
                    key="catalog-schema"
                    className={detailStyles.entry_body_card}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{
                        duration: 0.1,
                        ease: [0.33, 1, 0.68, 1]
                    }}
                >
                    <div className={detailStyles.entry_card_container}>
                        <div className={detailStyles.entry_card_action_bar}>
                            <div className={detailStyles.entry_card_file_name}>
                                <NotebookScriptName folder=".." file="dashql-schema.sql" />
                            </div>
                        </div>
                        <VerticalTabs
                            className={detailStyles.entry_card_tabs}
                            variant={VerticalTabVariant.Stacked}
                            selectedTab={TabKey.Editor}
                            selectTab={selectTab}
                            tabProps={{
                                [TabKey.Editor]: {
                                    tabId: TabKey.Editor,
                                    icon: `${icons}#file`,
                                    labelShort: 'Editor',
                                    ariaLabel: 'Schema script',
                                    description: 'Schema script',
                                    disabled: false,
                                },
                            }}
                            tabKeys={[TabKey.Editor]}
                            tabRenderers={{
                                [TabKey.Editor]: () => (
                                    <CodeMirror ref={setView} extensions={readonlyExtensions} />
                                ),
                            }}
                        />
                    </div>
                </motion.div>
            </AnimatePresence>
        </div>
    );
};
