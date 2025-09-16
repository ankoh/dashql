import * as React from 'react';
import * as styles from './editor.module.css';

import { EditorView } from '@codemirror/view';
import { ChangeSpec, EditorSelection, StateEffect, EditorState } from '@codemirror/state';

import { CodeMirror, createCodeMirrorExtensions } from './codemirror.js';
import { DashQLCompletionState, DashQLProcessorPlugin, DashQLProcessorUpdateOut, DashQLUpdateEffect } from './dashql_processor.js';
import { ScriptData, UPDATE_SCRIPT, UPDATE_FROM_PROCESSOR, WorkbookState } from '../../workbook/workbook_state.js';
import { AppConfig, useAppConfig } from '../../app_config.js';
import { useLogger } from '../../platform/logger_provider.js';
import { useConnectionState } from '../../connection/connection_registry.js';
import { refreshCatalogOnce } from '../../connection/catalog_loader.js';
import { ModifyWorkbook, useWorkbookState } from '../../workbook/workbook_state_registry.js';
import { Logger } from '../../platform/logger.js';

interface Props {
    className?: string;
    workbookId: number;
    setView?: (view: EditorView) => void;
}

export const ScriptEditor: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const config = useAppConfig();
    const [workbook, modifyWorkbook] = useWorkbookState(props.workbookId);
    const [connState, _modifyConn] = useConnectionState(workbook?.connectionId ?? null);

    // The current index in the workbook
    const workbookEntryIdx = workbook?.selectedWorkbookEntry ?? 0;
    const workbookEntry = (workbookEntryIdx < (workbook?.workbookEntries.length ?? 0))
        ? workbook!.workbookEntries[workbookEntryIdx]
        : null;
    const workbookEntryScriptData = workbookEntry != null ? workbook!.scripts[workbookEntry.scriptKey] : null;

    // Effect to refresh the connection catalog for the active script
    // if it hasn't been refreshed yet.
    refreshCatalogOnce(connState);

    // Update outdated scripts that are displayed in the editor
    React.useEffect(() => {
        if (workbookEntryScriptData?.outdatedAnalysis) {
            modifyWorkbook({
                type: UPDATE_SCRIPT,
                value: workbookEntryScriptData.scriptKey
            });
        }
    }, [workbookEntryScriptData]);

    // Track the current CodeMirror view
    const [view, setView] = React.useState<EditorView | null>(null);
    // Effect to update the editor script whenever the script changes
    React.useEffect(() => {
        // Setup pending?
        if (config == null || view == null || workbookEntryScriptData == null) {
            return;
        }
        // Update the editor
        updateEditor(view, workbook!, workbookEntryScriptData, modifyWorkbook, logger, config);

    }, [
        config,
        view,
        workbookEntryScriptData,
        workbook?.connectionCatalog,
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


function updateEditor(view: EditorView, workbook: WorkbookState, scriptData: ScriptData, modifyWorkbook: ModifyWorkbook, logger: Logger, config: AppConfig) {
    const state = view.state.field(DashQLProcessorPlugin);
    const changes: ChangeSpec[] = [];
    const effects: StateEffect<any>[] = [];

    // Script does not belong here?
    // Create a new editor state and update the view.
    // XXX Here's the place where we would restore a previous state, if one exists.
    if (state.script != null && state.script != scriptData.script) {
        // When that happens we have to reset the editor state.
        // It means that someone gave us a new workbook script that requires a state update
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
        logger.info("replace editor script", {}, "editor");
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

    // Helper to update a script.
    // Called when the script gets updated by the CodeMirror extension.
    // Note that this is also called when the state is set up initially.
    const updateScript = (update: DashQLProcessorUpdateOut) => {
        modifyWorkbook({
            type: UPDATE_FROM_PROCESSOR,
            value: update,
        });
    };


    // Notify the CodeMirror extension
    effects.push(
        DashQLUpdateEffect.of({
            config: {
                showCompletionDetails: config?.settings?.showCompletionDetails ?? false,
            },

            scriptRegistry: workbook.scriptRegistry,
            scriptKey: scriptData.scriptKey,
            script: scriptData.script,
            scriptBuffers: scriptData.processed,
            scriptCursor: scriptData.cursor,
            scriptCompletion: scriptData.completion,
            scriptCompletionCandidate: scriptData.completionCandidate,
            scriptCompletionState: DashQLCompletionState.None,

            derivedFocus: workbook?.userFocus ?? null,

            onUpdate: updateScript,
        }),
    );
    view.dispatch({ changes, effects, selection: selection ?? undefined });
}
