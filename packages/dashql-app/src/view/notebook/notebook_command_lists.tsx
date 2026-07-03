import * as React from 'react';
import * as ActionList from '../foundations/action_list.js';
import { LinkIcon, SparklesFillIcon, SyncIcon } from '@primer/octicons-react';

import { DASHQL_ARCHIVE_FILENAME_EXT } from '../../globals.js';
import { NotebookCommandType, useNotebookCommandDispatch } from '../../notebook/notebook_commands.js';
import type { ModifyNotebook } from '../../notebook/notebook_state_registry.js';
import { getSelectedPageEntries, getSortedFolderNames, NotebookState } from '../../notebook/notebook_state.js';
import { SymbolIcon } from '../foundations/symbol_icon.js';
import { NotebookFileSaveOverlay } from './notebook_file_save_overlay.js';
import { NotebookURLShareOverlay } from './notebook_url_share_overlay.js';
import { ConnectionHealth, ConnectionState } from '../../connection/connection_state.js';
import { useAIClient } from '../../platform/ai_client_provider.js';

export const ConnectionCommandList: React.FC<{
    conn: ConnectionState | null;
    notebook: NotebookState | null;
}> = (props) => {
    const notebookCommand = useNotebookCommandDispatch();

    const isDisconnected = props.conn?.connectionHealth !== ConnectionHealth.ONLINE;
    const DatabaseQueryIcon = SymbolIcon('search_16');
    return (
        <>
            <ActionList.ListItem
                disabled={isDisconnected || !props.conn?.connectorInfo.features.executeQueryAction}
                onClick={() => notebookCommand(NotebookCommandType.ExecuteEditorQuery)}
            >
                <ActionList.Leading>
                    <DatabaseQueryIcon />
                </ActionList.Leading>
                <ActionList.ItemText>
                    Execute Script
                </ActionList.ItemText>
                <ActionList.Trailing>Ctrl + E</ActionList.Trailing>
            </ActionList.ListItem>
            <ActionList.ListItem
                disabled={isDisconnected || !props.conn?.connectorInfo.features.refreshSchemaAction}
                onClick={() => notebookCommand(NotebookCommandType.RefreshCatalog)}
            >
                <ActionList.Leading>
                    <SyncIcon />
                </ActionList.Leading>
                <ActionList.ItemText>
                    Refresh Catalog
                </ActionList.ItemText>
                <ActionList.Trailing>Ctrl + R</ActionList.Trailing>
            </ActionList.ListItem>
        </>
    );
};

export const NotebookCommandList: React.FC<{
    conn: ConnectionState | null;
    notebook: NotebookState | null;
    modifyNotebook: ModifyNotebook | null;
}> = (props) => {
    const [linkSharingIsOpen, openLinkSharing] = React.useState<boolean>(false);
    const [fileSaveIsOpen, openFileSave] = React.useState<boolean>(false);
    const notebookCommand = useNotebookCommandDispatch();
    const aiAvailable = useAIClient() != null;

    const ArrowDownIcon = SymbolIcon('arrow_down_16');
    const ArrowUpIcon = SymbolIcon('arrow_up_16');
    const ArrowLeftIcon = SymbolIcon('arrow_left_16');
    const ArrowRightIcon = SymbolIcon('arrow_right_16');
    const FileZipIcon = SymbolIcon('file_zip_16');

    const folders = props.notebook ? getSortedFolderNames(props.notebook.notebookPages) : [];
    const focusedFolder = props.notebook?.notebookUserFocus.folderName ?? '';
    const folderIndex = folders.indexOf(focusedFolder);
    const entries = props.notebook ? getSelectedPageEntries(props.notebook) : [];
    const focusedFile = props.notebook?.notebookUserFocus.fileName ?? '';
    const fileIndex = entries.findIndex(e => e.fileName === focusedFile);

    return (
        <>
            <ActionList.ListItem
                onClick={() => notebookCommand(NotebookCommandType.ToggleComposeInputMode)}
                disabled={!aiAvailable}
            >
                <ActionList.Leading>
                    <SparklesFillIcon />
                </ActionList.Leading>
                <ActionList.ItemText>
                    Switch Mode
                </ActionList.ItemText>
                <ActionList.Trailing>Ctrl + M</ActionList.Trailing>
            </ActionList.ListItem>
            <ActionList.ListItem
                onClick={() => notebookCommand(NotebookCommandType.SelectPreviousNotebookPage)}
                disabled={folderIndex <= 0}
            >
                <ActionList.Leading>
                    <ArrowLeftIcon />
                </ActionList.Leading>
                <ActionList.ItemText>
                    Previous Page
                </ActionList.ItemText>
                <ActionList.Trailing>Ctrl + H</ActionList.Trailing>
            </ActionList.ListItem>
            <ActionList.ListItem
                onClick={() => notebookCommand(NotebookCommandType.SelectNextNotebookPage)}
                disabled={props.notebook == null || folderIndex < 0 || (folderIndex + 1) >= folders.length}
            >
                <ActionList.Leading>
                    <ArrowRightIcon />
                </ActionList.Leading>
                <ActionList.ItemText>
                    Next Page
                </ActionList.ItemText>
                <ActionList.Trailing>Ctrl + L</ActionList.Trailing>
            </ActionList.ListItem>
            <ActionList.ListItem
                onClick={() => notebookCommand(NotebookCommandType.SelectPreviousNotebookScript)}
                disabled={fileIndex <= 0}
            >
                <ActionList.Leading>
                    <ArrowUpIcon />
                </ActionList.Leading>
                <ActionList.ItemText>
                    Previous Script
                </ActionList.ItemText>
                <ActionList.Trailing>Ctrl + K</ActionList.Trailing>
            </ActionList.ListItem>
            <ActionList.ListItem
                onClick={() => notebookCommand(NotebookCommandType.SelectNextNotebookScript)}
                disabled={props.notebook == null || fileIndex < 0 || (fileIndex + 1) >= entries.length}
            >
                <ActionList.Leading>
                    <ArrowDownIcon />
                </ActionList.Leading>
                <ActionList.ItemText>
                    Next Script
                </ActionList.ItemText>
                <ActionList.Trailing>Ctrl + J</ActionList.Trailing>
            </ActionList.ListItem>
            <ActionList.ListItem onClick={() => openLinkSharing(s => !s)}>
                <ActionList.Leading>
                    <LinkIcon />
                </ActionList.Leading>
                <ActionList.ItemText>
                    Share as URL
                    <NotebookURLShareOverlay isOpen={linkSharingIsOpen} setIsOpen={openLinkSharing} />
                </ActionList.ItemText>
            </ActionList.ListItem>
            <ActionList.ListItem onClick={() => openFileSave(s => !s)}>
                <ActionList.Leading>
                    <FileZipIcon />
                </ActionList.Leading>
                <ActionList.ItemText>
                    Save .{DASHQL_ARCHIVE_FILENAME_EXT}
                    <NotebookFileSaveOverlay
                        isOpen={fileSaveIsOpen}
                        setIsOpen={openFileSave}
                        conn={props.conn}
                        notebook={props.notebook}
                    />
                </ActionList.ItemText>
                <ActionList.Trailing>Ctrl + S</ActionList.Trailing>
            </ActionList.ListItem>
        </>
    );
};
