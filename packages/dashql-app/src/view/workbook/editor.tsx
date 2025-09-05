import * as React from 'react';
import * as dashql from '@ankoh/dashql-core';
import * as styles from './editor.module.css';

import { EditorView } from '@codemirror/view';
import { ChangeSpec, EditorSelection, StateEffect, EditorState } from '@codemirror/state';

import { CodeMirror, createCodeMirrorExtensions } from './codemirror.js';
import { DashQLProcessorPlugin, DashQLScriptBuffers, DashQLScriptKey, DashQLSyncEffect } from './dashql_processor.js';
import { COMPLETION_CHANGED, COMPLETION_STARTED, COMPLETION_STOPPED, ScriptData, UPDATE_SCRIPT, UPDATE_SCRIPT_ANALYSIS, UPDATE_SCRIPT_CURSOR, WorkbookState } from '../../workbook/workbook_state.js';
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
    if (state.targetScript != null && state.targetScript != scriptData.script) {
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
        state.targetScript == null ||
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
    const updateScript = (scriptKey: DashQLScriptKey, _script: dashql.DashQLScript, buffers: DashQLScriptBuffers, cursor: dashql.FlatBufferPtr<dashql.buffers.cursor.ScriptCursor>) => {
        modifyWorkbook({
            type: UPDATE_SCRIPT_ANALYSIS,
            value: [scriptKey, buffers, cursor],
        });
    };

    // Helper to update a script cursor.
    // Called when the cursor gets updated by the CodeMirror extension.
    // Note that this is also called when the state is set up initially.
    const updateCursor = (scriptKey: DashQLScriptKey, _script: dashql.DashQLScript, cursor: dashql.FlatBufferPtr<dashql.buffers.cursor.ScriptCursor>) => {
        modifyWorkbook({
            type: UPDATE_SCRIPT_CURSOR,
            value: [scriptKey, cursor],
        });
    };
    // Helper to start a completion.
    // Called when the CodeMirror extension opens the completion dropdown.
    const startCompletion = (scriptKey: DashQLScriptKey, _script: dashql.DashQLScript, completion: dashql.FlatBufferPtr<dashql.buffers.completion.Completion>) => {
        modifyWorkbook({
            type: COMPLETION_STARTED,
            value: [scriptKey, completion],
        });
    };
    // Helper to peek a completion candidate
    // Called when the CodeMirror extension changes the selected completion.
    const peekCompletionCandidate = (scriptKey: DashQLScriptKey, _script: dashql.DashQLScript, completion: dashql.FlatBufferPtr<dashql.buffers.completion.Completion>, candidateId: number) => {
        modifyWorkbook({
            type: COMPLETION_CHANGED,
            value: [scriptKey, completion, candidateId],
        });
    };
    // Helper to stop a completion.
    // Called when the CodeMirror extension opens the completion dropdown.
    const stopCompletion = (scriptKey: DashQLScriptKey, _script: dashql.DashQLScript) => {
        modifyWorkbook({
            type: COMPLETION_STOPPED,
            value: scriptKey,
        });
    };


    // Notify the CodeMirror extension
    effects.push(
        DashQLSyncEffect.of({
            config: {
                showCompletionDetails: config?.settings?.showCompletionDetails ?? false,
            },
            scriptRegistry: workbook.scriptRegistry,
            scriptKey: scriptData.scriptKey,
            targetScript: scriptData.script,
            scriptBuffers: scriptData.processed,
            scriptCursor: scriptData.cursor,
            derivedFocus: workbook?.userFocus ?? null,

            onScriptUpdate: updateScript,
            onCursorUpdate: updateCursor,
            onCompletionStart: startCompletion,
            onCompletionPeek: peekCompletionCandidate,
            onCompletionStop: stopCompletion,
        }),
    );
    view.dispatch({ changes, effects, selection: selection ?? undefined });
}
