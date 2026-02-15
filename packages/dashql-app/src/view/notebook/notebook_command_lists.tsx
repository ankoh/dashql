import * as React from 'react';
import * as ActionList from '../foundations/action_list.js';
import * as styles from './notebook_page.module.css';
import { LinkIcon, PaperAirplaneIcon, SyncIcon } from '@primer/octicons-react';

import { DASHQL_ARCHIVE_FILENAME_EXT } from '../../globals.js';
import { NotebookCommandType, useNotebookCommandDispatch } from '../../notebook/notebook_commands.js';
import type { ModifyNotebook } from '../../notebook/notebook_state_registry.js';
import { getSelectedPageEntries, NotebookState } from '../../notebook/notebook_state.js';
import { SymbolIcon } from '../foundations/symbol_icon.js';
import { NotebookFileSaveOverlay } from './notebook_file_save_overlay.js';
import { NotebookURLShareOverlay } from './notebook_url_share_overlay.js';
import { ConnectionState } from '../../connection/connection_state.js';

export const ConnectionCommandList: React.FC<{
    conn: ConnectionState | null;
    notebook: NotebookState | null;
}> = (props) => {
    const notebookCommand = useNotebookCommandDispatch();

    const DatabaseIcon = SymbolIcon('database_16');
    return (
        <>
            <ActionList.ListItem
                disabled={!props.conn?.connectorInfo.features.executeQueryAction}
                onClick={() => notebookCommand(NotebookCommandType.EditNotebookConnection)}
            >
                <ActionList.Leading>
                    <DatabaseIcon />
                </ActionList.Leading>
                <ActionList.ItemText>
                    Edit Connection
                </ActionList.ItemText>
                <ActionList.Trailing>Ctrl + L</ActionList.Trailing>
            </ActionList.ListItem>
            <ActionList.ListItem
                disabled={!props.conn?.connectorInfo.features.executeQueryAction}
                onClick={() => notebookCommand(NotebookCommandType.ExecuteEditorQuery)}
            >
                <ActionList.Leading>
                    <PaperAirplaneIcon />
                </ActionList.Leading>
                <ActionList.ItemText>
                    Execute Query
                </ActionList.ItemText>
                <ActionList.Trailing>Ctrl + E</ActionList.Trailing>
            </ActionList.ListItem>
            <ActionList.ListItem
                disabled={!props.conn?.connectorInfo.features.refreshSchemaAction}
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

    const ArrowDownIcon = SymbolIcon('arrow_down_16');
    const ArrowUpIcon = SymbolIcon('arrow_up_16');
    const FileZipIcon = SymbolIcon('file_zip_16');
    const TrashIcon = SymbolIcon('trash_16');
    return (
        <>
            <ActionList.ListItem
                onClick={() => notebookCommand(NotebookCommandType.SelectPreviousNotebookScript)}
                disabled={(props.notebook?.selectedEntryInPage ?? 0) === 0}
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
                disabled={props.notebook == null || ((props.notebook.selectedEntryInPage + 1) >= getSelectedPageEntries(props.notebook).length)}
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
                <ActionList.Trailing>Ctrl + U</ActionList.Trailing>
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
            <ActionList.ListItem
                className={styles.body_action_danger}
                onClick={() => notebookCommand(NotebookCommandType.DeleteNotebook)}
            >
                <ActionList.Leading>
                    <TrashIcon />
                </ActionList.Leading>
                <ActionList.ItemText>
                    Delete Notebook
                </ActionList.ItemText>
            </ActionList.ListItem>
        </>
    );
};
