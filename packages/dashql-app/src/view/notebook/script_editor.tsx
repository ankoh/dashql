import * as React from 'react';
import * as styles from './script_editor.module.css';

import { EditorView } from '@codemirror/view';
import { ChangeSpec, EditorSelection, StateEffect, EditorState } from '@codemirror/state';

import { CodeMirror, createCodeMirrorExtensions } from '../editor/codemirror.js';
import { DashQLProcessorPlugin, DashQLProcessorUpdateOut, DashQLUpdateEffect } from '../editor/dashql_processor.js';
import { ScriptData, ANALYZE_OUTDATED_SCRIPT, UPDATE_FROM_PROCESSOR, NotebookState } from '../../notebook/notebook_state.js';
import { AppConfig, useAppConfig } from '../../app_config.js';
import { useLogger } from '../../platform/logger_provider.js';
import { useConnectionState } from '../../connection/connection_registry.js';
import { refreshCatalogOnce } from '../../connection/catalog_loader.js';
import { ModifyNotebook, useNotebookState } from '../../notebook/notebook_state_registry.js';
import { Logger } from '../../platform/logger.js';

const LOG_CTX = "notebook_editor";

export interface ScriptEditorProps {
    notebookId: number;
    scriptKey: number;
    className?: string;
    autoHeight?: boolean;
    setView?: (view: EditorView) => void;
}

export const ScriptEditor: React.FC<ScriptEditorProps> = (props) => {
    const logger = useLogger();
    const config = useAppConfig();
    const [notebook, modifyNotebook] = useNotebookState(props.notebookId);
    const [connState, _modifyConn] = useConnectionState(notebook?.connectionId ?? null);

    const scriptData = notebook?.scripts[props.scriptKey] ?? null;

    // Effect to refresh the connection catalog for the active script
    // if it hasn't been refreshed yet.
    refreshCatalogOnce(connState);

    // Update outdated scripts that are displayed in the editor
    React.useEffect(() => {
        if (scriptData?.scriptAnalysis.outdated) {
            modifyNotebook({ type: ANALYZE_OUTDATED_SCRIPT, value: scriptData.scriptKey });
        }
    }, [scriptData]);

    // Track the current CodeMirror view
    const [view, setViewState] = React.useState<EditorView | null>(null);
    // Effect to update the editor script whenever the script changes
    React.useEffect(() => {
        if (config == null || view == null || scriptData == null || notebook == null) return;
        updateEditor(view, notebook, scriptData, modifyNotebook, logger, config);
    }, [
        config,
        view,
        scriptData?.script,
        scriptData?.scriptAnalysis.buffers,
        notebook?.semanticUserFocus,
        notebook?.connectionCatalog,
    ]);
    // Forward the view ref, if requested
    React.useEffect(() => {
        if (props.setView && view != null) {
            props.setView(view);
        }
    }, [view, props.setView]);

    const containerClass = [
        props.autoHeight ? styles.uncommitted_editor : styles.editor,
        props.className,
    ].filter(Boolean).join(' ');

    return (
        <div className={containerClass}>
            <CodeMirror ref={setViewState} style={props.autoHeight ? { height: 'auto' } : undefined} />
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
    if (state.script != scriptData.script) {
        // When that happens we have to reset the editor state.
        // It means that someone gave us a new notebook script that requires a state update
        const extensions = createCodeMirrorExtensions();
        const newState = EditorState.create({ extensions });
        view.setState(newState);
    }

    // Initial setup or unexpected script buffers?
    // Then we reset everything to make sure the script is ok.
    // XXX We could track a version counter to make sure we're referencing the same content.
    if (state.scriptBuffers !== scriptData.scriptAnalysis.buffers) {
        logger.info("replace editor script", {}, LOG_CTX);
        changes.push({
            from: 0,
            to: view.state.doc.length,
            insert: scriptData.script.toString(),
        });
    }

    // Did the cursor change?
    let selection: EditorSelection | null = null;
    if (state.scriptCursor !== scriptData.cursor) {
        const nextCursorOffset = scriptData.cursor?.read().textOffset();
        if (nextCursorOffset != null) {
            const clampedOffset = Math.max(0, Math.min(nextCursorOffset, view.state.doc.length));
            selection = EditorSelection.create([EditorSelection.cursor(clampedOffset)]);
        }
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
            scriptBuffers: scriptData.scriptAnalysis.buffers,
            scriptCursor: scriptData.cursor,
            scriptCompletion: scriptData.completion,

            derivedFocus: notebook?.semanticUserFocus ?? null,

            onUpdate: updateScript,
        }),
    );
    view.dispatch({ changes, effects, selection: selection ?? undefined });
}
