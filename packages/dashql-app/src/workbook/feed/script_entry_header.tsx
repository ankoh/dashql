import * as React from 'react';
import type * as dashql from '@ankoh/dashql-core';
import type { EditorView } from '@codemirror/view';

import { useAppConfig } from '../../config/app_config.js';
import { ConnectionHealth, type ConnectionState } from '@ankoh/dashql-runtime/connections/connection_state';
import { ConnectorType } from '@ankoh/dashql-runtime/connections/connector_info';
import { useQueryExecutor, useQueryState } from '../../connections/query_executor.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { useStorageReader } from '../../storage/storage_provider.js';
import { displayPath } from '../../storage/workbook_locator.js';
import { STORAGE_SCRIPTS_FOLDER } from '@ankoh/dashql-runtime/storage/storage_backend';
import { useConnectionLabeler } from '../connection_labels.js';
import { DELETE_SCRIPT, SET_SCRIPT_TEXT, SET_SCRIPT_VIS_SPEC, type ScriptData, type WorkbookScripts } from '@ankoh/dashql-runtime/workbook/scripts/workbook_scripts';
import type { ModifyWorkbookScripts } from '../scripts/workbook_scripts_registry.js';
import { runWorkbookScript } from '../scripts/rerun_query.js';
import { useWorkbookExecution } from '../scripts/workbook_execution_provider.js';
import { renameScript, type RenameDraftReferences } from '../scripts/script_rename.js';
import { formattingDialectForConnector, getKeywordCase, isScriptFormattable } from '@ankoh/dashql-runtime/workbook/scripts/script_format';
import { formatScriptEditor } from '../editor/script_format_editor.js';
import type { ScriptStorage } from '../scripts/script_action_menu.js';
import { scriptConnectionView, usePickScriptConnection } from '../scripts/script_connection_picker.js';
import type { ScriptReferenceReport } from '@ankoh/dashql-runtime/workbook/scripts/script_reference_check';
import { FeedEntryHeader } from './feed_entry_header.js';

export interface ScriptEntryHeaderProps {
    workbookScripts: WorkbookScripts;
    modifyWorkbookScripts: ModifyWorkbookScripts;
    scriptKey: number;
    /// The connections that the scripts run on
    scriptConnections: ReadonlyMap<string, ConnectionState>;
    /// The checked script references of the script
    scriptReferences: ScriptReferenceReport | null;
    /// The function that renames the references in the draft of the composer
    draftRenameRef?: React.RefObject<RenameDraftReferences | null>;
    /// The editor of the script, formatting needs it
    editorView?: EditorView | null;
    /// Delete the script, the workbook deletes it by default
    onDelete?: (script: ScriptData) => void;
    /// Show the snippets button, true by default. The boxes of the dataflow leave it to the editor dialog.
    snippets?: boolean;
    /// Open the script in an editor, an edit button left of the script menu offers it
    onEdit?: () => void;
    className?: string;
}

/// The header of a feed entry for a script of a workbook, outside of the feed: in the boxes of the dataflow and in
/// the script editor dialog. The header runs, renames, formats and deletes the script itself.
export const ScriptEntryHeader: React.FC<ScriptEntryHeaderProps> = React.memo((props: ScriptEntryHeaderProps) => {
    const { workbookScripts, modifyWorkbookScripts } = props;
    const workbookId = workbookScripts.workbookId;
    const scriptData = workbookScripts.scripts[props.scriptKey];
    const fileName = scriptData?.fileName ?? 'script.sql';
    const config = useAppConfig();
    const logger = useLogger();
    const executeQuery = useQueryExecutor();
    const storageReader = useStorageReader();
    const workbookExecution = useWorkbookExecution(workbookId);
    const queryState = useQueryState(workbookId, scriptData?.latestQueryId ?? null);

    // The connection of the script, labeled like the feed labels it
    const labeler = useConnectionLabeler();
    const connectionState = scriptData != null ? props.scriptConnections.get(scriptData.connection.connectionId) ?? null : null;
    const connection = React.useMemo(
        () => connectionState == null ? null : scriptConnectionView(connectionState, labeler(connectionState)),
        [connectionState, labeler],
    );
    const online = connectionState?.connectionHealth === ConnectionHealth.ONLINE;
    const pickConnection = usePickScriptConnection(workbookId, modifyWorkbookScripts);

    const scriptDebugMode = config?.settings?.scriptDebugMode ?? false;
    const formattingDebugMode = config?.settings?.formattingDebugMode ?? false;
    const keywordCase = getKeywordCase(config?.settings);
    const connectorType = scriptData?.connection.connectorInfo.connectorType;
    const formattingDialect = formattingDialectForConnector(connectorType);
    const isFormattable = React.useMemo(
        () => isScriptFormattable(scriptData ?? null, formattingDialect),
        [scriptData?.scriptSession, scriptData?.editorUpdate?.textVersion, formattingDialect],
    );
    const editorView = props.editorView ?? null;
    const format = React.useCallback((mode: dashql.buffers.formatting.FormattingMode) => {
        formatScriptEditor(editorView, scriptData ?? null, mode, (text) => {
            modifyWorkbookScripts({ type: SET_SCRIPT_TEXT, value: { scriptKey: props.scriptKey, text, withDiff: true } });
        }, formattingDebugMode, keywordCase, formattingDialect);
    }, [editorView, scriptData, props.scriptKey, modifyWorkbookScripts, formattingDebugMode, keywordCase, formattingDialect]);

    const execute = React.useCallback(() => {
        if (scriptData == null || !online || workbookExecution.runActive) return;
        runWorkbookScript(workbookScripts, scriptData, executeQuery, modifyWorkbookScripts, logger);
    }, [scriptData, online, workbookExecution.runActive, workbookScripts, executeQuery, modifyWorkbookScripts, logger]);
    const rename = React.useCallback((name: string) => {
        void renameScript(workbookScripts, modifyWorkbookScripts, fileName, name, props.draftRenameRef?.current);
    }, [workbookScripts, modifyWorkbookScripts, fileName, props.draftRenameRef]);
    const remove = React.useCallback(() => {
        if (scriptData == null) return;
        if (props.onDelete != null) props.onDelete(scriptData);
        else modifyWorkbookScripts({ type: DELETE_SCRIPT, value: fileName });
    }, [scriptData, props.onDelete, modifyWorkbookScripts, fileName]);
    // A snippet replaces the text of the script, a script with text shows the replacement as a diff to accept or reject
    const applySnippet = React.useCallback((text: string) => {
        const priorText = scriptData?.scriptSession.getText() ?? '';
        modifyWorkbookScripts({ type: SET_SCRIPT_TEXT, value: { scriptKey: props.scriptKey, text, withDiff: priorText.trim().length > 0 } });
    }, [scriptData, props.scriptKey, modifyWorkbookScripts]);
    const setVisSpec = React.useCallback((spec: string) => {
        modifyWorkbookScripts({ type: SET_SCRIPT_VIS_SPEC, value: { scriptKey: props.scriptKey, spec } });
    }, [props.scriptKey, modifyWorkbookScripts]);
    const storage = React.useMemo<ScriptStorage>(() => ({
        fileName,
        resolvePath: () => `${displayPath(workbookId, storageReader.getWorkbookLocation(workbookId))}/${STORAGE_SCRIPTS_FOLDER}/${fileName}`,
        onRename: rename,
    }), [fileName, workbookId, storageReader, rename]);

    return (
        <FeedEntryHeader
            workbookId={workbookId}
            scriptData={scriptData}
            scriptFileName={fileName}
            connection={connection}
            connectorType={connectorType ?? ConnectorType.HYPER}
            queryState={queryState}
            focused
            canExecute={scriptData != null && online}
            scriptDebugMode={scriptDebugMode}
            isFormattable={isFormattable}
            canFormat={editorView != null}
            scriptReferences={props.scriptReferences}
            // There is no composer outside of the feed
            canTarget={false}
            onTarget={NO_TARGET}
            onExecute={execute}
            onPickConnection={connectionId => pickConnection(fileName, connectionId)}
            onRename={rename}
            onDelete={remove}
            onEdit={props.onEdit}
            onFormat={format}
            onApplySnippet={props.snippets === false ? undefined : applySnippet}
            onSetVisSpec={setVisSpec}
            storage={storage}
            className={props.className}
        />
    );
});

const NO_TARGET = () => {};
