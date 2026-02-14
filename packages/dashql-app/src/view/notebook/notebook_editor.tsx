import * as React from 'react';
import * as styles from './notebook_editor.module.css';

import { EditorView } from '@codemirror/view';
import { ChangeSpec, EditorSelection, StateEffect, EditorState } from '@codemirror/state';

import { CodeMirror, createCodeMirrorExtensions } from '../editor/codemirror.js';
import { DashQLProcessorPlugin, DashQLProcessorUpdateOut, DashQLUpdateEffect } from '../editor/dashql_processor.js';
import { getSelectedEntry, ScriptData, ANALYZE_OUTDATED_SCRIPT, UPDATE_FROM_PROCESSOR, NotebookState } from '../../notebook/notebook_state.js';
import { AppConfig, useAppConfig } from '../../app_config.js';
import { useLogger } from '../../platform/logger_provider.js';
import { useConnectionState } from '../../connection/connection_registry.js';
import { refreshCatalogOnce } from '../../connection/catalog_loader.js';
import { ModifyNotebook, useNotebookState } from '../../notebook/notebook_state_registry.js';
import { Logger } from '../../platform/logger.js';

const LOG_CTX = "notebook_editor";

interface Props {
    className?: string;
    notebookId: number;
    setView?: (view: EditorView) => void;
}

export const ScriptEditor: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const config = useAppConfig();
    const [notebook, modifyNotebook] = useNotebookState(props.notebookId);
    const [connState, _modifyConn] = useConnectionState(notebook?.connectionId ?? null);

    const notebookEntry = notebook != null ? getSelectedEntry(notebook) : null;
    const notebookEntryScriptData = notebookEntry != null && notebook != null ? notebook.scripts[notebookEntry.scriptId] : null;

    // Effect to refresh the connection catalog for the active script
    // if it hasn't been refreshed yet.
    refreshCatalogOnce(connState);

    // Update outdated scripts that are displayed in the editor
    React.useEffect(() => {
        if (notebookEntryScriptData?.outdatedAnalysis) {
            modifyNotebook({
                type: ANALYZE_OUTDATED_SCRIPT,
                value: notebookEntryScriptData.scriptKey
            });
        }
    }, [notebookEntryScriptData]);

    // Track the current CodeMirror view
    const [view, setView] = React.useState<EditorView | null>(null);
    // Effect to update the editor script whenever the script changes
    React.useEffect(() => {
        // Setup pending?
        if (config == null || view == null || notebookEntryScriptData == null) {
            return;
        }
        // Update the editor
        updateEditor(view, notebook!, notebookEntryScriptData, modifyNotebook, logger, config);

    }, [
        config,
        view,
        notebookEntryScriptData?.script,
        notebookEntryScriptData?.processed,
        notebook?.userFocus,
        notebook?.connectionCatalog,
    ]);
    // Update the view, if asked
    React.useEffect(() => {
        if (props.setView && view != null) {
            props.setView(view);
        }
    }, [view, props.setView])

    return (
        <div className={styles.editor}>
            <CodeMirror ref={setView} />
        </div>
    );
};


function updateEditor(view: EditorView, notebook: NotebookState, scriptData: ScriptData, modifyNotebook: ModifyNotebook, logger: Logger, _config: AppConfig) {
    const state = view.state.field(DashQLProcessorPlugin);
    const changes: ChangeSpec[] = [];
    const effects: StateEffect<any>[] = [];

    // Script does not belong here?
    // Create a new editor state and update the view.
    // XXX Here's the place where we would restore a previous state, if one exists.
    if (state.script != null && state.script != scriptData.script) {
        // When that happens we have to reset the editor state.
        // It means that someone gave us a new notebook script that requires a state update
        const extensions = createCodeMirrorExtensions();
        const newState = EditorState.create({ extensions });
        view.setState(newState);
    }

    // Initial setup or unexpected script buffers?
    // Then we reset everything to make sure the script is ok.
    // XXX We could track a version counter to make sure we're referencing the same content.
    if (
        state.script == null ||
        state.scriptBuffers !== scriptData.processed
    ) {
        logger.info("replace editor script", {}, LOG_CTX);
        changes.push({
            from: 0,
            to: view.state.doc.length,
            insert: scriptData.script?.toString(),
        });
    }

    // Did the cursor change?
    let selection: EditorSelection | null = null;
    if (state.scriptCursor !== scriptData.cursor) {
        selection = EditorSelection.create([EditorSelection.cursor(scriptData.cursor?.read().textOffset() ?? 0)]);
    }

    // XXX Detect invalid selections

    // Helper to update a script.
    // Called when the script gets updated by the CodeMirror extension.
    // Note that this is also called when the state is set up initially.
    const updateScript = (update: DashQLProcessorUpdateOut) => {
        modifyNotebook({
            type: UPDATE_FROM_PROCESSOR,
            value: update,
        });
    };


    // Notify the CodeMirror extension
    effects.push(
        DashQLUpdateEffect.of({
            config: {
            },

            scriptRegistry: notebook.scriptRegistry,
            scriptKey: scriptData.scriptKey,
            script: scriptData.script,
            scriptBuffers: scriptData.processed,
            scriptCursor: scriptData.cursor,
            scriptCompletion: scriptData.completion,

            derivedFocus: notebook?.userFocus ?? null,

            onUpdate: updateScript,
        }),
    );
    view.dispatch({ changes, effects, selection: selection ?? undefined });
}
