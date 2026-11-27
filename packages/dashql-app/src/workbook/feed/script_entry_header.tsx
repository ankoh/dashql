import * as React from 'react';
import type { EditorView } from '@codemirror/view';

import { useAppConfig } from '../../config/app_config.js';
import type { ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import { useStorageReader } from '../../storage/storage_provider.js';
import { useConnectionLabeler } from '../connections/connection_labels.js';
import type { ModifyWorkbookScripts, ScriptData, WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { deleteScript, useScriptSelection } from '../scripts/script_selection.js';
import { useLiveScriptReader } from '../scripts/script_creation.js';
import { useScriptModel } from '@akohn/dashql-react/models/script_model';
import { renameScript, type RenameDraftReferences } from '../scripts/script_rename.js';
import { getKeywordCase } from '../scripts/script_format.js';
import { scriptConnectionView, usePickScriptConnection } from '../scripts/script_connection_picker.js';
import type { ScriptReferenceReport } from '@akohn/dashql/platform/workbook/script_reference_check';
import { FeedEntryHeader, type FeedEntryHeaderDisplay } from './feed_entry_header.js';

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
/// the script editor dialog. The model of the script runs, stops and rewrites it like in the feed, this header renames,
/// deletes and moves the script to another connection.
export const ScriptEntryHeader: React.FC<ScriptEntryHeaderProps> = React.memo((props: ScriptEntryHeaderProps) => {
    const { workbookScripts, modifyWorkbookScripts } = props;
    const workbookId = workbookScripts.workbookId;
    const model = useScriptModel(workbookId, props.scriptKey);
    const fileName = model?.script.fileName ?? 'script.sql';
    const config = useAppConfig();
    const storageReader = useStorageReader();

    // The connection of the script, labeled like the feed labels it
    const labeler = useConnectionLabeler();
    const connectionState = model != null ? props.scriptConnections.get(model.script.connectionId) ?? null : null;
    const connection = React.useMemo(
        () => connectionState == null ? null : scriptConnectionView(connectionState, labeler(connectionState)),
        [connectionState, labeler],
    );
    // The connection picker is memoized, its command keeps its identity with the script
    const pickScriptConnection = usePickScriptConnection(modifyWorkbookScripts);
    const pickConnection = React.useCallback((connectionId: string) => pickScriptConnection(fileName, connectionId), [pickScriptConnection, fileName]);

    const scriptDebugMode = config?.settings?.scriptDebugMode ?? false;
    const formattingDebugMode = config?.settings?.formattingDebugMode ?? false;
    const keywordCase = getKeywordCase(config?.settings);
    const display: FeedEntryHeaderDisplay = {
        // There is no composer outside of the feed
        focused: true, canTarget: false, scriptDebugMode, formattingDebugMode, keywordCase, references: props.scriptReferences,
    };

    const readScript = useLiveScriptReader();
    const selection = useScriptSelection();

    if (model == null) return null;
    const rename = (name: string) => {
        renameScript(workbookScripts, modifyWorkbookScripts, fileName, name, props.draftRenameRef?.current, key => readScript(key)?.fileName ?? null);
    };
    const remove = () => {
        if (props.onDelete != null) props.onDelete(model.script);
        else deleteScript(selection, workbookScripts, modifyWorkbookScripts, fileName);
    };
    return (
        <FeedEntryHeader
            model={model}
            connection={connection}
            display={display}
            editorView={props.editorView ?? null}
            storageReader={storageReader}
            onTarget={NO_TARGET}
            onPickConnection={pickConnection}
            onRename={rename}
            onDelete={remove}
            onEdit={props.onEdit}
            snippets={props.snippets}
            className={props.className}
        />
    );
});

const NO_TARGET = () => {};
