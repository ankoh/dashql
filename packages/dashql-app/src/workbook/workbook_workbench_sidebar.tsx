import * as React from 'react';
import symbols from '@akohn/dashql-svg-symbols';
import {
    type CollisionDetection,
    DndContext,
    type Modifier,
    type DragEndEvent,
    type DragMoveEvent,
    KeyboardSensor,
    PointerSensor,
    closestCenter,
    pointerWithin,
    useDroppable,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import {
    SortableContext,
    type SortingStrategy,
    sortableKeyboardCoordinates,
    useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { useConnectionList, useConnections, useDispatch, useRuntime, useWorkbooks, useConnectionViews } from '@akohn/dashql-react/hooks';
import { AnchorAlignment, AnchorSide } from '@akohn/dashql-react/dom/anchored_position';
import { AnchoredOverlay } from '@akohn/dashql-react/components/anchored_overlay';
import * as ActionList from '@akohn/dashql-react/components/action_list';
import { ButtonSize, ButtonVariant, IconButton } from '@akohn/dashql-react/components/button';
import {
    AlertIcon,
    ChevronDownIcon,
    ChevronRightIcon,
    CopyIcon,
    FileIcon,
    FileDirectoryIcon,
    FileDirectoryPlusIcon,
    LinkIcon,
    PencilIcon,
    PlusIcon,
    StackIcon,
    StackPlusIcon,
    TrashIcon,
    SymbolIcon,
    UnlinkIcon,
    UploadIcon,
    PaperAirplaneIcon,
} from '@akohn/dashql-react/components/symbol_icon';
import { classNames } from '@akohn/dashql-react/dom/classnames';
import { OPEN_WORKBOOK, SELECT_WORKBOOK, useRouteContext, useRouterNavigate } from '../app/router.js';
import { WorkbookSetupStatus } from '../app/loading/workbook_setup_status.js';
import { findWorkbookQueries, type ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import {
    newConnectionFromParams,
    createAttachedConnectionParamsForConnector,
} from '@akohn/dashql/platform/connections/connection_params';
import { useNewWorkbookConnection } from '../connections/embedded_connection_hooks.js';
import { useCloudConnectionIds, useSetCloudConnection } from '../connections/cloud_connection.js';
import { CloudsFolder } from '../cloud/cloud_sidebar.js';
import { useClouds } from '../cloud/cloud_state.js';
import { useCloudWorkbooks } from '../cloud/cloud_workbooks.js';
import { ATTACHABLE_CONNECTORS } from '../connections/attached_connection.js';
import { CONNECTOR_INFOS, ConnectorType } from '@akohn/dashql/platform/connections/connector_info';
import { ConnectionSettingsOverlay } from '../connections/connection_settings_overlay.js';
import { renderWorkbookName } from './workbook_name.js';
import { WorkbookConnectionAttentionContext } from './workbook_connection_attention.js';
import { VerticalScrollShadows } from '@akohn/dashql-react/components/vertical_scroll_shadows';
import { VerticalSplit } from '@akohn/dashql-react/components/vertical_split';
import { displayPath } from '../storage/workbook_locator.js';
import { StorageBackendType } from '@akohn/dashql/platform/storage/storage_backend';
import { WorkbookStorageOverlay } from './persistence/workbook_storage_overlay.js';
import { useStorageReader } from '../storage/storage_provider.js';
import { browserWorkbookFolder } from './persistence/browser_workbook_folder.js';
import { cloneWorkbook } from '../storage/workbook_transfer.js';
import { useWorkbookImport } from './persistence/workbook_import_provider.js';
import { EPHEMERAL_WORKBOOK_NAME, isCloudPreview, scriptsOnConnection, workbookCloudLink, type WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { useScriptSelection } from './scripts/script_selection.js';
import { scriptDisplayName } from '@akohn/dashql/platform/workbook/script_types';
import { renameScript } from './scripts/script_rename.js';
import { useDeleteWorkbook, useInvalidWorkbooks } from './workbook_lifecycle.js';
import { useEnsureEphemeralWorkbook, useOpenGreeter, useWorkbookCreation } from './workbook_creation.js';
import { WORKBOOK_LIST_CARET_COLUMN, WorkbookFolderRow, workbookListRowPadding, startsRowDrag } from './workbook_folder_row.js';
import {
    type WorkbookListDrop,
    type WorkbookListRow as WorkbookListRowOf,
    TOP_LEVEL_DROP_ID,
    flattenWorkbookListRows,
    resolveWorkbookListDrop,
} from './workbook_list_rows.js';
import {
    type WorkbookTreeFolder,
    findWorkbookFolder,
    flattenWorkbookTree,
    folderAt,
    folderNameError,
    folderPathKey,
    freeFolderName,
    moveWorkbookInTree,
    upsertWorkbookInTree,
} from '@akohn/dashql/platform/storage/workbook_tree';
import { NameInput } from '@akohn/dashql-react/components/name_input';
import { type RowContextMenu, useRowContextMenu, useRowContextMenuOpener } from '@akohn/dashql-react/dom/row_context_menu';
import { useMergeConnections } from './workbook_connection_merge.js';
import { useReplaceConnection } from './workbook_connection_replace.js';
import { useDetachConnection } from './workbook_connection_detach.js';
import { useDeleteConnection } from '../connections/connection_deletion.js';
import { connectionMergeCandidates } from '../connections/connection_merge.js';
import { connectionReplaceBlocker, connectionReplaceCandidates } from '../connections/connection_replace.js';
import { connectionLabel, connectionLabelParts, connectionLabelText, connectionOrdinals, isHyperWasmConnection } from '../connections/connection_label.js';
import { useAppFlavor } from '../config/flavor_provider.js';
import { WorkbookURLShareOverlay } from './persistence/workbook_url_share_overlay.js';
import { WorkbookFileSaveOverlay } from './persistence/workbook_file_save_overlay.js';
import * as styles from './workbook_workbench_sidebar.module.css';
import { ConnectionTree, isConnectionInitiallyExpanded, listedConnections, type ConnectionUsage } from '../connections/connection_tree.js';
import * as actionMenuStyles from '../app/action_menu.module.css';
import { useDashQLCoreSetup } from '../host/core_provider.js';
import { useLogger } from '../host/logger_provider.js';
import { PlatformType, usePlatformType } from '../host/platform_type.js';
import { CONNECTOR_ICON_STYLE, useConnectorIcon } from '../connections/connector_icon.js';

interface WorkbookItem {
    workbookId: string;
    /// The connections of the workbook, in the order its scripts use them
    connections: ConnectionState[];
    scripts: WorkbookScripts;
    label: string;
    path: string;
    isNative: boolean;
}

interface InvalidWorkbookItem {
    workbookId: string;
    label: string;
    path: string;
    isNative: boolean;
    invalidReason: string;
}

type WorkbookListRow = WorkbookListRowOf<WorkbookItem>;

/// The rows stay in place while a row is dragged, the drop target shows where the row lands
const KEEP_ROWS_IN_PLACE: SortingStrategy = () => null;

/// A dragged row only moves up and down
const VERTICAL_DRAG: Modifier = ({ transform }) => ({ ...transform, x: 0 });

/// The slim bar between the workbooks and the connections
const SECTION_SEPARATOR_SIZE = 7;
/// The header and about two rows stay visible in a section
const SECTION_MIN_SIZE = 96;

/// The drop target is the row under the pointer, the keyboard picks the closest row
const WORKBOOK_LIST_COLLISIONS: CollisionDetection = args => {
    const hits = pointerWithin(args);
    return hits.length > 0 ? hits : closestCenter(args);
};

/// The drop target at the end of the workbook list. It fills the empty space below the rows and moves a row to the
/// end of the top level, a targeted drop shows the insertion line at the end of the list.
const TopLevelDropZone: React.FC<{ targeted: boolean; depth: number }> = ({ targeted, depth }) => {
    const { setNodeRef } = useDroppable({ id: TOP_LEVEL_DROP_ID });
    return (
        <li
            ref={setNodeRef}
            className={classNames(styles.top_level_drop, { [styles.top_level_drop_targeted]: targeted })}
            style={{ ['--workbook_row_indent' as string]: `${workbookListRowPadding(depth) + WORKBOOK_LIST_CARET_COLUMN}px` }}
            aria-hidden="true"
            data-testid="workbook-top-level-drop"
        />
    );
};

/// The row of the ephemeral workbook, the last workbook of the root. It looks like the other workbooks and only opens the
/// greeter: there is nothing to rename, move or delete until a script promotes the workbook.
const EphemeralWorkbookRow: React.FC<{ selected: boolean; depth: number; onOpen: () => void }> = ({ selected, depth, onOpen }) => (
    <li
        className={classNames(styles.entry_surface, styles.entry_interactive, styles.workbook_row, {
            [styles.entry_selected]: selected,
        })}
        style={{ paddingLeft: workbookListRowPadding(depth) }}
        data-testid="workbook-ephemeral-row"
    >
        <button type="button" className={styles.tree_button} aria-current={selected ? 'page' : undefined} onClick={onOpen}>
            <span aria-hidden="true" />
            <StackIcon size={14} aria-hidden="true" />
            <span className={classNames(styles.workbook_name, styles.workbook_name_ephemeral)}>{EPHEMERAL_WORKBOOK_NAME}</span>
        </button>
    </li>
);

interface Props {
    workbookScripts: WorkbookScripts;
    closeAfterSelection?: () => void;
    /// The connection whose overview is open
    openOverviewId?: string | null;
    /// Open the overview of a connection, or close it with null
    onOpenOverview?: (connectionId: string | null) => void;
    /// The cloud whose overview is open
    openCloudId?: string | null;
    /// Open the overview of a cloud, or close it with null
    onOpenCloud?: (connectionId: string | null) => void;
    /// Show a script of a workbook that was opened from the sidebar
    onOpenScript?: (workbookId: string, fileName: string) => void;
    dependencies?: WorkbookWorkbenchSidebarDependencies;
}

export interface WorkbookWorkbenchSidebarDependencies {
    useRouterNavigate: typeof useRouterNavigate;
    useRouteContext: typeof useRouteContext;
    useRuntime: typeof useRuntime;
    useDispatch: typeof useDispatch;
    useWorkbooks: typeof useWorkbooks;
    useConnections: typeof useConnections;
    useConnectionList: typeof useConnectionList;
    useConnectionViews: typeof useConnectionViews;
    useWorkbookCreation: typeof useWorkbookCreation;
    useOpenGreeter: typeof useOpenGreeter;
    useEnsureEphemeralWorkbook: typeof useEnsureEphemeralWorkbook;
    useMergeConnections: typeof useMergeConnections;
    useReplaceConnection: typeof useReplaceConnection;
    useDetachConnection: typeof useDetachConnection;
    useDeleteConnection: typeof useDeleteConnection;
    useDeleteWorkbook: typeof useDeleteWorkbook;
    useStorageReader: typeof useStorageReader;
    useDashQLCoreSetup: typeof useDashQLCoreSetup;
    useWorkbookImport: typeof useWorkbookImport;
    usePlatformType: typeof usePlatformType;
    useLogger: typeof useLogger;
    useInvalidWorkbooks: typeof useInvalidWorkbooks;
    useNewWorkbookConnection: typeof useNewWorkbookConnection;
    newConnectionFromParams: typeof newConnectionFromParams;
    ConnectionSettingsOverlay: typeof ConnectionSettingsOverlay;
    WorkbookStorageOverlay: typeof WorkbookStorageOverlay;
    WorkbookURLShareOverlay: typeof WorkbookURLShareOverlay;
    WorkbookFileSaveOverlay: typeof WorkbookFileSaveOverlay;
    useCloudWorkbooks: typeof useCloudWorkbooks;
    useClouds: typeof useClouds;
    CloudsFolder: typeof CloudsFolder;
}

const DEFAULT_WORKBOOK_WORKBENCH_SIDEBAR_DEPENDENCIES: WorkbookWorkbenchSidebarDependencies = {
    useRouterNavigate,
    useRouteContext,
    useRuntime,
    useDispatch,
    useWorkbooks,
    useConnections,
    useConnectionList,
    useConnectionViews,
    useWorkbookCreation,
    useOpenGreeter,
    useEnsureEphemeralWorkbook,
    useMergeConnections,
    useReplaceConnection,
    useDetachConnection,
    useDeleteConnection,
    useDeleteWorkbook,
    useStorageReader,
    useDashQLCoreSetup,
    useWorkbookImport,
    usePlatformType,
    useLogger,
    useInvalidWorkbooks,
    useNewWorkbookConnection,
    newConnectionFromParams,
    ConnectionSettingsOverlay,
    WorkbookStorageOverlay,
    WorkbookURLShareOverlay,
    WorkbookFileSaveOverlay,
    useCloudWorkbooks,
    useClouds,
    CloudsFolder,
};

const MoreIcon = SymbolIcon('kebab_horizontal');
const FileZipIcon = SymbolIcon('file_zip_16');

interface WorkbookRowMenuProps {
    item: WorkbookItem;
    onRename: () => void;
    onDuplicate: () => void;
    onDelete: () => void;
    /// The right click of the row opens the menu
    contextMenu: RowContextMenu;
    dependencies: WorkbookWorkbenchSidebarDependencies;
}

const WorkbookRowMenu: React.FC<WorkbookRowMenuProps> = ({ item, onRename, onDuplicate, onDelete, contextMenu, dependencies }) => {
    const [open, setOpen] = React.useState(false);
    useRowContextMenuOpener(contextMenu, () => setOpen(true));
    const [shareOpen, setShareOpen] = React.useState(false);
    const [exportOpen, setExportOpen] = React.useState(false);
    const archiveExport = useAppFlavor().features.workbookArchiveExport;
    const [storageOpen, setStorageOpen] = React.useState(false);
    const triggerRef = React.useRef<HTMLButtonElement>(null);
    const { clouds } = dependencies.useClouds();

    return (
        <AnchoredOverlay
            open={open}
            onOpen={() => setOpen(true)}
            onClose={() => setOpen(false)}
            anchorRef={triggerRef}
            returnFocusRef={triggerRef}
            side={AnchorSide.OutsideRight}
            align={AnchorAlignment.Start}
            anchorOffset={4}
            renderAnchor={(anchorProps) => (
                <IconButton
                    {...anchorProps}
                    ref={triggerRef}
                    size={ButtonSize.Small}
                    variant={ButtonVariant.Invisible}
                    className={styles.workbook_menu_button}
                    data-testid="workbook-row-menu"
                    aria-label={`More actions for ${item.label}`}
                    onClick={(event) => {
                        event.stopPropagation();
                        anchorProps.onClick?.(event);
                    }}
                >
                    <MoreIcon size={14} />
                </IconButton>
            )}
        >
            <div className={actionMenuStyles.menu} role="dialog" aria-label={`Actions for ${item.label}`}>
                <ActionList.List aria-label={`Actions for ${item.label}`}>
                    <dependencies.WorkbookStorageOverlay
                        workbookId={item.workbookId}
                        isOpen={storageOpen}
                        onClose={() => setStorageOpen(false)}
                        side={AnchorSide.OutsideRight}
                        align={AnchorAlignment.Start}
                        renderAnchor={(anchorProps) => (
                            <ActionList.ListItem
                                {...anchorProps}
                                data-testid="workbook-menu-item"
                                data-action="storage"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    setStorageOpen(true);
                                }}
                            >
                                <ActionList.Leading><FileDirectoryIcon size={16} /></ActionList.Leading>
                                <ActionList.ItemText>Storage</ActionList.ItemText>
                            </ActionList.ListItem>
                        )}
                    />
                    <ActionList.ListItem data-testid="workbook-menu-item" data-action="rename" onClick={(event) => {
                        event.stopPropagation();
                        setOpen(false);
                        onRename();
                    }}>
                        <ActionList.Leading><PencilIcon size={16} /></ActionList.Leading>
                        <ActionList.ItemText>Rename</ActionList.ItemText>
                    </ActionList.ListItem>
                    <ActionList.ListItem data-testid="workbook-menu-item" data-action="duplicate" onClick={() => { setOpen(false); onDuplicate(); }}>
                        <ActionList.Leading><CopyIcon size={16} /></ActionList.Leading>
                        <ActionList.ItemText>Duplicate</ActionList.ItemText>
                    </ActionList.ListItem>
                    <ActionList.ListItem data-testid="workbook-menu-item" data-action="share-url" onClick={(event) => {
                        event.stopPropagation();
                        setShareOpen(value => !value);
                    }}>
                        <ActionList.Leading><LinkIcon size={16} /></ActionList.Leading>
                        <ActionList.ItemText>
                            Share as URL
                            <dependencies.WorkbookURLShareOverlay
                                workbookId={item.workbookId}
                                isOpen={shareOpen}
                                setIsOpen={setShareOpen}
                            />
                        </ActionList.ItemText>
                    </ActionList.ListItem>
                    {/* The list takes elements only, the fragment wraps the optional item */}
                    <>{archiveExport && (
                        <ActionList.ListItem data-testid="workbook-menu-item" data-action="export" onClick={(event) => {
                            event.stopPropagation();
                            setExportOpen(value => !value);
                        }}>
                            <ActionList.Leading><FileZipIcon size={16} /></ActionList.Leading>
                            <ActionList.ItemText>
                                Export .dashql
                                <dependencies.WorkbookFileSaveOverlay
                                    isOpen={exportOpen}
                                    setIsOpen={setExportOpen}
                                    workbookScripts={item.scripts}
                                    fileName={item.scripts.name ?? item.scripts.workbookMetadata.originalFileName ?? 'workbook'}
                                />
                            </ActionList.ItemText>
                        </ActionList.ListItem>
                    )}</>
                    <>{clouds.length > 0 && (
                        <WorkbookPublishItems item={item} onRun={() => setOpen(false)} dependencies={dependencies} />
                    )}</>
                    <ActionList.ListItem data-testid="workbook-menu-item" data-action="delete" className={actionMenuStyles.delete_action} onClick={() => { setOpen(false); onDelete(); }}>
                        <ActionList.Leading>{item.isNative ? <UnlinkIcon size={16} /> : <TrashIcon size={16} />}</ActionList.Leading>
                        <ActionList.ItemText>{item.isNative ? 'Unlink' : 'Delete'}</ActionList.ItemText>
                    </ActionList.ListItem>
                </ActionList.List>
            </div>
        </AnchoredOverlay>
    );
};

/// Publish a workbook to a cloud: a new version of the published workbook it is linked to, or a new published workbook.
/// With several clouds every item names its cloud.
const WorkbookPublishItems: React.FC<{ item: WorkbookItem; onRun: () => void; dependencies: WorkbookWorkbenchSidebarDependencies }> = ({ item, onRun, dependencies }) => {
    const cloudWorkbooks = dependencies.useCloudWorkbooks();
    const { clouds } = dependencies.useClouds();
    const logger = dependencies.useLogger();
    const linkedCloud = workbookCloudLink(item.scripts)?.connectionId ?? null;
    const named = clouds.length > 1;
    const publish = (cloudId: string, asNew: boolean) => {
        onRun();
        cloudWorkbooks.publish(item.workbookId, { cloudId, asNew }).catch(error => {
            logger.error(`Publishing "${item.label}" failed`, { workbookId: item.workbookId, error: String(error instanceof Error ? error.message : error) }, 'workbook_workbench');
        });
    };
    const entries: { key: string; action: string; cloudId: string; asNew: boolean; text: string }[] = [];
    for (const cloud of clouds) {
        const name = connectionLabel(cloud.connection);
        if (cloud.connectionId === linkedCloud) {
            entries.unshift({ key: `${cloud.connectionId}:version`, action: 'publish', cloudId: cloud.connectionId, asNew: false, text: named ? `Publish new version to ${name}` : 'Publish new version' });
            entries.push({ key: `${cloud.connectionId}:new`, action: 'publish-as-new', cloudId: cloud.connectionId, asNew: true, text: named ? `Publish as new workbook to ${name}` : 'Publish as new workbook' });
        } else {
            entries.push({ key: `${cloud.connectionId}:new`, action: 'publish', cloudId: cloud.connectionId, asNew: true, text: named ? `Publish to ${name}` : 'Publish to cloud' });
        }
    }
    return (
        <>
            {entries.map(entry => (
                <ActionList.ListItem
                    key={entry.key}
                    data-testid="workbook-menu-item"
                    data-action={entry.action}
                    data-cloud={entry.cloudId}
                    disabled={!cloudWorkbooks.isReady(entry.cloudId)}
                    onClick={() => publish(entry.cloudId, entry.asNew)}
                >
                    <ActionList.Leading><PaperAirplaneIcon size={16} /></ActionList.Leading>
                    <ActionList.ItemText>{entry.text}</ActionList.ItemText>
                </ActionList.ListItem>
            ))}
        </>
    );
};

interface WorkbookRowProps {
    item: WorkbookItem;
    /// The depth of the workbook in the workbook tree, the workbooks of the root are at depth 0
    depth: number;
    selected: boolean;
    onOpen: (anchor: HTMLButtonElement) => void;
    onDuplicate: () => void;
    onDelete: () => void;
    /// Where a dragged workbook lands next to this one, null without a drag
    dropPosition: 'before' | 'after' | null;
    /// Are the scripts of the workbook listed below it?
    expanded: boolean;
    /// Show or hide the scripts of the workbook
    onToggle: () => void;
    /// Open a script of the workbook
    onOpenScript: (fileName: string) => void;
    dependencies: WorkbookWorkbenchSidebarDependencies;
}

const WorkbookRow: React.FC<WorkbookRowProps> = ({ item, depth, selected, onOpen, onDuplicate, onDelete, dropPosition, expanded, onToggle, onOpenScript, dependencies }) => {
    const title = item.scripts.name?.trim() || null;
    const modifyWorkbookScripts = dependencies.useDispatch({ workbook: item.workbookId });
    // The rename action swaps the name for an input until the edit is committed or abandoned
    const [renaming, setRenaming] = React.useState(false);
    const renameInputRef = React.useRef<HTMLInputElement>(null);
    React.useEffect(() => {
        if (!renaming) return;
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
    }, [renaming]);
    const commitRename = React.useCallback((name: string) => {
        setRenaming(false);
        modifyWorkbookScripts({ kind: 'renameWorkbook', value: { name } });
    }, [modifyWorkbookScripts]);
    const cancelRename = React.useCallback(() => setRenaming(false), []);
    const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.workbookId });
    const rowRef = React.useCallback((node: HTMLLIElement | null) => {
        setNodeRef(node);
        // The keyboard sensor only lifts the row when the row itself has the focus
        setActivatorNodeRef(node);
    }, [setNodeRef, setActivatorNodeRef]);
    const rowListeners = React.useMemo(() => listeners == null ? undefined : Object.fromEntries(
        Object.entries(listeners).map(([eventName, handler]) => [eventName, (event: React.SyntheticEvent<HTMLElement>) => {
            if (startsRowDrag(event)) handler(event);
        }]),
    ), [listeners]);
    const contextMenu = useRowContextMenu();
    const scriptNames = item.scripts.scriptOrder ?? [];
    const selection = useScriptSelection();
    const openScript = (fileName: string) => {
        selection.selectFile(item.scripts, fileName);
        onOpenScript(fileName);
    };
    const Caret = expanded ? ChevronDownIcon : ChevronRightIcon;
    const caret = scriptNames.length > 0
        ? <span className={styles.tree_caret} aria-hidden="true"><Caret size={12} /></span>
        : <span aria-hidden="true" />;
    // A click opens the workbook, a click on the open workbook shows or hides its scripts like a folder.
    // Renaming the workbook is in the row menu.
    const clickName = (anchor: HTMLButtonElement) => {
        if (!selected) {
            onOpen(anchor);
        } else if (scriptNames.length > 0) {
            onToggle();
        }
    };
    return (
        <>
        <li
            ref={rowRef}
            className={classNames(
                styles.entry_surface,
                styles.entry_interactive,
                styles.workbook_row,
                {
                    [styles.entry_selected]: selected,
                    [styles.workbook_row_dragging]: isDragging,
                    [styles.drop_before]: dropPosition === 'before',
                    [styles.drop_after]: dropPosition === 'after',
                },
            )}
            style={{
                transform: CSS.Translate.toString(transform),
                transition,
                paddingLeft: workbookListRowPadding(depth),
                // The insertion line of a drop starts at the icon of the workbook
                ['--workbook_row_indent' as string]: `${workbookListRowPadding(depth) + WORKBOOK_LIST_CARET_COLUMN}px`,
            }}
            {...attributes}
            {...rowListeners}
            onContextMenu={contextMenu.onContextMenu}
        >
            {renaming ? (
                <div className={styles.tree_rename}>
                    {caret}
                    <StackIcon size={14} aria-hidden="true" />
                    <NameInput
                        ref={renameInputRef}
                        className={styles.workbook_rename_input}
                        name={title}
                        onCommit={commitRename}
                        onCancel={cancelRename}
                        ariaLabel="Workbook name"
                        placeholder="Name this workbook"
                    />
                </div>
            ) : (
                <button
                    type="button"
                    className={styles.tree_button}
                    aria-current={selected ? 'page' : undefined}
                    aria-expanded={scriptNames.length > 0 ? expanded : undefined}
                    title={item.path}
                    onClick={event => clickName(event.currentTarget)}
                >
                    {caret}
                    <StackIcon size={14} aria-hidden="true" />
                    <span className={title ? styles.workbook_name : styles.workbook_path}>{title ?? item.path}</span>
                </button>
            )}
            <WorkbookRowMenu item={item} onRename={() => setRenaming(true)} onDuplicate={onDuplicate} onDelete={onDelete} contextMenu={contextMenu} dependencies={dependencies} />
        </li>
        {expanded && scriptNames.map(fileName => (
            <WorkbookScriptRow
                key={`${item.workbookId}/${fileName}`}
                fileName={fileName}
                depth={depth}
                onOpen={() => openScript(fileName)}
                onRename={name => { renameScript(item.scripts, modifyWorkbookScripts, fileName, name, null, () => null); }}
            />
        ))}
        </>
    );
};

interface WorkbookScriptRowProps {
    fileName: string;
    /// The depth of the workbook of the script
    depth: number;
    /// Open the script
    onOpen: () => void;
    /// Rename the script, the name is a display name
    onRename: (name: string) => void;
}

/// A script of an expanded workbook. A double-click on the name or the rename action of the menu edits the name.
const WorkbookScriptRow: React.FC<WorkbookScriptRowProps> = ({ fileName, depth, onOpen, onRename }) => {
    const displayName = scriptDisplayName(fileName);
    const [renaming, setRenaming] = React.useState(false);
    const renameInputRef = React.useRef<HTMLInputElement>(null);
    React.useEffect(() => {
        if (!renaming) return;
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
    }, [renaming]);
    const commitRename = React.useCallback((name: string) => {
        setRenaming(false);
        if (name.trim() !== displayName) onRename(name);
    }, [displayName, onRename]);
    const cancelRename = React.useCallback(() => setRenaming(false), []);
    const contextMenu = useRowContextMenu();
    return (
        <li
            className={classNames(styles.entry_surface, styles.entry_interactive, styles.script_row)}
            // The file icons of the scripts sit directly below the icon of their workbook
            style={{ paddingLeft: workbookListRowPadding(depth) + WORKBOOK_LIST_CARET_COLUMN }}
            data-testid="workbook-script-row"
            onContextMenu={contextMenu.onContextMenu}
        >
            {renaming ? (
                <div className={styles.script_rename}>
                    <FileIcon size={14} aria-hidden="true" />
                    <NameInput
                        ref={renameInputRef}
                        className={classNames(styles.workbook_rename_input, styles.script_rename_input)}
                        name={displayName}
                        onCommit={commitRename}
                        onCancel={cancelRename}
                        ariaLabel="Script name"
                        placeholder="Name this script"
                    />
                </div>
            ) : (
                <button
                    type="button"
                    className={styles.workbook_button}
                    title={fileName}
                    onClick={onOpen}
                    onDoubleClick={() => setRenaming(true)}
                >
                    <FileIcon size={14} aria-hidden="true" />
                    <span className={styles.script_name}>{displayName}</span>
                </button>
            )}
            <ScriptRowMenu name={displayName} onRename={() => setRenaming(true)} contextMenu={contextMenu} />
        </li>
    );
};

const ScriptRowMenu: React.FC<{ name: string; onRename: () => void; contextMenu: RowContextMenu }> = ({ name, onRename, contextMenu }) => {
    const [open, setOpen] = React.useState(false);
    useRowContextMenuOpener(contextMenu, () => setOpen(true));
    const triggerRef = React.useRef<HTMLButtonElement>(null);
    return (
        <AnchoredOverlay
            open={open}
            onOpen={() => setOpen(true)}
            onClose={() => setOpen(false)}
            anchorRef={triggerRef}
            returnFocusRef={triggerRef}
            side={AnchorSide.OutsideRight}
            align={AnchorAlignment.Start}
            anchorOffset={4}
            renderAnchor={(anchorProps) => (
                <IconButton
                    {...anchorProps}
                    ref={triggerRef}
                    size={ButtonSize.Small}
                    variant={ButtonVariant.Invisible}
                    className={styles.workbook_menu_button}
                    data-testid="script-row-menu"
                    aria-label={`More actions for script ${name}`}
                    onClick={(event) => {
                        event.stopPropagation();
                        anchorProps.onClick?.(event);
                    }}
                >
                    <MoreIcon size={14} />
                </IconButton>
            )}
        >
            <div className={actionMenuStyles.menu} role="dialog" aria-label={`Actions for script ${name}`}>
                <ActionList.List aria-label={`Actions for script ${name}`}>
                    <ActionList.ListItem data-testid="script-menu-item" data-action="rename" onClick={(event) => {
                        event.stopPropagation();
                        setOpen(false);
                        onRename();
                    }}>
                        <ActionList.Leading><PencilIcon size={16} /></ActionList.Leading>
                        <ActionList.ItemText>Rename</ActionList.ItemText>
                    </ActionList.ListItem>
                </ActionList.List>
            </div>
        </AnchoredOverlay>
    );
};

const InvalidWorkbookRow: React.FC<{ item: InvalidWorkbookItem; depth: number; onDelete: () => void }> = ({ item, depth, onDelete }) => (
    <li className={classNames(styles.entry_surface, styles.workbook_row)} style={{ paddingLeft: workbookListRowPadding(depth) }}>
        <div
            className={classNames(styles.workbook_button, styles.workbook_button_invalid)}
            title={item.invalidReason}
        >
            <AlertIcon size={14} aria-hidden="true" />
            <span>
                <span className={styles.workbook_name}>{item.label}</span>
                <span className={styles.workbook_error}>{item.invalidReason}</span>
            </span>
        </div>
        <IconButton
            size={ButtonSize.Small}
            variant={ButtonVariant.Invisible}
            className={styles.workbook_menu_button}
            aria-label={`${item.isNative ? 'Unlink' : 'Delete'} invalid workbook ${item.label}`}
            onClick={onDelete}
        >
            {item.isNative ? <UnlinkIcon size={14} /> : <TrashIcon size={14} />}
        </IconButton>
    </li>
);

/// The folder of the local workbooks at the top level, next to the folder of the cloud. It only groups the rows, the
/// folders and workbooks inside are the top level of the workbook tree.
const LocalWorkbookFolderRow: React.FC<{ expanded: boolean; count: number; onToggle: () => void }> = ({ expanded, count, onToggle }) => {
    const Caret = expanded ? ChevronDownIcon : ChevronRightIcon;
    return (
        <li
            className={classNames(styles.entry_surface, styles.entry_interactive, styles.workbook_row)}
            style={{ paddingLeft: workbookListRowPadding(0) }}
            data-testid="local-folder"
        >
            <button
                type="button"
                className={classNames(styles.tree_button, styles.root_button)}
                aria-expanded={expanded}
                title="The workbooks of this browser"
                onClick={onToggle}
            >
                <span className={styles.tree_caret} aria-hidden="true"><Caret size={12} /></span>
                <svg width="14" height="14" aria-hidden="true"><use xlinkHref={`${symbols}#device_desktop_24`} /></svg>
                <span className={styles.workbook_name}>Local</span>
                <span className={styles.root_count} aria-label={`${count} local ${count === 1 ? 'workbook' : 'workbooks'}`}>{count}</span>
            </button>
            {/* Where the menu of the cloud is, the counts line up */}
            <span className={styles.root_menu_spacer} aria-hidden="true" />
        </li>
    );
};

export const WorkbookWorkbenchSidebar: React.FC<Props> = (props) => {
    const connectorIcon = useConnectorIcon();
    const dependencies = props.dependencies ?? DEFAULT_WORKBOOK_WORKBENCH_SIDEBAR_DEPENDENCIES;
    const navigate = dependencies.useRouterNavigate();
    const route = dependencies.useRouteContext();
    const runtime = dependencies.useRuntime();
    const connections = dependencies.useConnections();
    const connectionList = dependencies.useConnectionList();
    const scriptsRegistry = dependencies.useWorkbooks();
    const createWorkbook = dependencies.useWorkbookCreation();
    const openGreeterPage = dependencies.useOpenGreeter();
    const ensureEphemeralWorkbook = dependencies.useEnsureEphemeralWorkbook();
    const resolveNewWorkbookConnection = dependencies.useNewWorkbookConnection();
    const cloudConnectionIds = useCloudConnectionIds();
    const setCloudConnection = useSetCloudConnection();
    const mergeConnections = dependencies.useMergeConnections();
    const replaceConnection = dependencies.useReplaceConnection();
    const detachConnectionFromWorkbooks = dependencies.useDetachConnection();
    const modifyCurrentWorkbook = dependencies.useDispatch({ workbook: props.workbookScripts.workbookId });
    const shutDownAndDeleteConnection = dependencies.useDeleteConnection();
    const deleteWorkbookFromRuntime = dependencies.useDeleteWorkbook();
    const storageReader = dependencies.useStorageReader();
    const storageWriter = runtime.storage;
    const setupCore = dependencies.useDashQLCoreSetup();
    const workbookImport = dependencies.useWorkbookImport();
    const platform = dependencies.usePlatformType();
    const logger = dependencies.useLogger();
    const { invalidWorkbooks, deleteInvalidWorkbook } = dependencies.useInvalidWorkbooks();
    const attached = dependencies.useConnectionViews(props.workbookScripts.connectionIds);
    const connectionAttention = React.useContext(WorkbookConnectionAttentionContext);
    const workbookConnectionRows = React.useMemo(() => attached ?? [], [attached]);
    const [connectionOverlayDatabaseId, setConnectionOverlayDatabaseId] = React.useState<string | null>(null);
    const [createConnectionOpen, setCreateConnectionOpen] = React.useState(false);
    const createConnectionButtonRef = React.useRef<HTMLButtonElement>(null);
    const createButtonRef = React.useRef<HTMLButtonElement>(null);
    const connectionSettingsAnchorRef = React.useRef<HTMLButtonElement>(null);
    const folderButtonRef = React.useRef<HTMLButtonElement>(null);
    const folderInputRef = React.useRef<HTMLInputElement>(null);
    // The folders and workbooks of the sidebar, a change shows right away and is reconciled with the storage after its write
    const [workbookTree, setWorkbookTree] = React.useState(() => storageReader.getWorkbookTree());
    const treeWriteRef = React.useRef(Promise.resolve());
    // The collapsed folders, by folder path key
    const [collapsedFolders, setCollapsedFolders] = React.useState<ReadonlySet<string>>(() => new Set());
    // Is the folder of the local workbooks expanded? It is shown while there is a cloud next to it
    const [localExpanded, setLocalExpanded] = React.useState(true);
    // The workbook whose scripts are listed, all are collapsed at first
    const [expandedWorkbook, setExpandedWorkbook] = React.useState<string | null>(null);
    // The folder whose name is being edited, by folder path key
    const [renamingFolder, setRenamingFolder] = React.useState<string | null>(null);
    // Where would the dragged row land?
    const [drop, setDrop] = React.useState<WorkbookListDrop | null>(null);

    React.useEffect(() => {
        if (route.workbookSetupStatus !== WorkbookSetupStatus.CONFIGURING
            || route.workbookId !== props.workbookScripts.workbookId) return;
        const connectionId = scriptsRegistry.get(route.workbookId)?.connectionIds[0] ?? null;
        if (connectionId != null) {
            connectionSettingsAnchorRef.current = document.querySelector('[aria-label="Create workbook"]');
            setConnectionOverlayDatabaseId(connectionId);
        }
    }, [scriptsRegistry, props.workbookScripts.workbookId, route.workbookId, route.workbookSetupStatus]);

    const workbookItems = React.useMemo<Map<string, WorkbookItem>>(() => {
        const items = new Map<string, WorkbookItem>();
        for (const [workbookId, scripts] of scriptsRegistry) {
            // The ephemeral workbook has its own row at the end of the list, a cloud preview shows with the cloud
            if (scripts.ephemeral || isCloudPreview(scripts)) continue;
            const workbookConnections = scripts.connectionIds
                .map(id => connections.get(id))
                .filter((connection): connection is ConnectionState => connection != null);
            const location = storageReader.getWorkbookLocation(workbookId);
            const path = displayPath(workbookId, location);
            items.set(workbookId, {
                workbookId,
                connections: workbookConnections,
                scripts,
                path,
                label: scripts.name?.trim() || path,
                isNative: location.type === StorageBackendType.Native,
            });
        }
        return items;
    }, [connections, scriptsRegistry, storageReader]);

    // The workbooks that the tree doesn't list yet, e.g. new ones before their first write, show where their
    // first write registers them, at the end of the root
    const displayedTree = React.useMemo<WorkbookTreeFolder>(() => {
        const listed = new Set(flattenWorkbookTree(workbookTree).map(entry => entry.path));
        return [...workbookItems.keys()]
            .filter(id => !listed.has(id))
            .reduce((tree, path) => upsertWorkbookInTree(tree, { path }), workbookTree);
    }, [workbookItems, workbookTree]);

    // Opening a workbook expands the folders on the way to it
    const currentWorkbookFolderKey = folderPathKey(findWorkbookFolder(displayedTree, props.workbookScripts.workbookId) ?? []);
    React.useEffect(() => {
        const path = JSON.parse(currentWorkbookFolderKey) as string[];
        setCollapsedFolders(current => {
            const ancestors = path.map((_, index) => folderPathKey(path.slice(0, index + 1))).filter(key => current.has(key));
            if (ancestors.length === 0) return current;
            const next = new Set(current);
            for (const key of ancestors) next.delete(key);
            return next;
        });
    }, [currentWorkbookFolderKey]);
    // Selecting another workbook collapses the one before, also when the selection doesn't come from the sidebar
    const currentWorkbookId = props.workbookScripts.workbookId;
    // Opening a local workbook expands the local folder
    const currentIsLocal = workbookItems.has(currentWorkbookId);
    React.useEffect(() => {
        if (currentIsLocal) setLocalExpanded(true);
    }, [currentIsLocal, currentWorkbookId]);
    React.useEffect(() => {
        setExpandedWorkbook(current => current === currentWorkbookId ? current : null);
    }, [currentWorkbookId]);
    const rows = React.useMemo<WorkbookListRow[]>(() => flattenWorkbookListRows(
        displayedTree,
        workbookItems,
        folder => !collapsedFolders.has(folderPathKey(folder.path)),
    ), [collapsedFolders, displayedTree, workbookItems]);
    const workbooks = React.useMemo(
        () => flattenWorkbookTree(displayedTree).flatMap(entry => workbookItems.get(entry.path) ?? []),
        [displayedTree, workbookItems],
    );

    const invalidItems = React.useMemo<InvalidWorkbookItem[]>(() => [...invalidWorkbooks.values()].map(invalid => {
        const location = storageReader.getWorkbookLocation(invalid.workbookId);
        return {
            workbookId: invalid.workbookId,
            label: invalid.title,
            path: displayPath(invalid.workbookId, location),
            isNative: location.type === StorageBackendType.Native,
            invalidReason: invalid.description,
        };
    }), [invalidWorkbooks, storageReader]);
    const workbookCount = workbooks.length + invalidItems.length;
    // The list of the connections says which are listed, it follows the workbooks that use them
    const connectionRows = React.useMemo(
        () => listedConnections(connections, connectionList, workbookConnectionRows, cloudConnectionIds),
        [connections, connectionList, workbookConnectionRows, cloudConnectionIds],
    );
    const workbookConnectionIds = React.useMemo(
        () => new Set(workbookConnectionRows.map(database => database.connectionId)),
        [workbookConnectionRows],
    );
    const ordinals = React.useMemo(() => connectionOrdinals(connectionList), [connectionList]);
    const labelOf = React.useCallback(
        (database: ConnectionState) => connectionLabelParts(database, ordinals.get(database.connectionId) ?? null),
        [ordinals],
    );
    const connectionCount = connectionRows.length;
    const describeUsage = React.useCallback((connectionId: string): ConnectionUsage => {
        const workbookIds = (connections.get(connectionId)?.workbooks ?? []).filter(workbookId => {
            const scripts = scriptsRegistry.get(workbookId);
            return scripts == null || (!scripts.ephemeral && !isCloudPreview(scripts));
        });
        const database = connections.get(connectionId);
        const scriptsOf = (workbookId: string) => {
            const scripts = scriptsRegistry.get(workbookId);
            return scripts == null ? 0 : scriptsOnConnection(scripts, connectionId);
        };
        return {
            workbookCount: workbookIds.length,
            // The workbooks fall back to the embedded Hyper, every workbook that uses it keeps it
            blockingWorkbookCount: database != null && isHyperWasmConnection(database)
                ? workbookIds.length
                : workbookIds.filter(workbookId => scriptsOf(workbookId) > 0).length,
            usedHere: workbookConnectionRows.some(database => database.connectionId === connectionId),
        };
    }, [connections, workbookConnectionRows, scriptsRegistry]);
    const initiallyExpanded = React.useCallback((database: ConnectionState, _count: number) => (
        workbookConnectionRows.includes(database)
        && isConnectionInitiallyExpanded(database, workbookConnectionRows.length)
    ), [workbookConnectionRows]);

    const dndSensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );
    /// Change the workbook tree: the change shows right away, the write follows the earlier ones, then the
    /// sidebar shows the tree as it is stored. A write that fails, e.g. a taken folder name, is logged.
    const changeWorkbookTree = React.useCallback((
        what: string,
        write: (folders: NonNullable<typeof storageReader.workbookFolders>) => Promise<void>,
        optimistic?: (tree: WorkbookTreeFolder) => WorkbookTreeFolder,
    ) => {
        const workbookFolders = storageReader.workbookFolders;
        if (workbookFolders == null) return;
        if (optimistic != null) setWorkbookTree(optimistic);
        treeWriteRef.current = treeWriteRef.current
            .catch(() => {})
            .then(() => write(workbookFolders))
            .catch(error => logger.warn(`failed to ${what}`, { error: String(error) }, 'workbook_workbench'))
            .then(() => setWorkbookTree(workbookFolders.getWorkbookTree()));
    }, [logger, storageReader.workbookFolders]);

    const moveWorkbook = React.useCallback((workbookId: string, folderPath: string[], index: number) => {
        changeWorkbookTree(
            'move the workbook',
            folders => folders.moveWorkbook(workbookId, folderPath, index),
            tree => moveWorkbookInTree(tree, workbookId, folderPath, index),
        );
    }, [changeWorkbookTree]);

    /// Where the dragged row would land
    const dropOf = React.useCallback((event: DragMoveEvent | DragEndEvent): WorkbookListDrop | null => {
        if (event.over == null) return null;
        const dragged = event.active.rect.current.translated;
        const middle = event.over.rect.top + event.over.rect.height / 2;
        const aboveMiddle = dragged != null && dragged.top + dragged.height / 2 < middle;
        return resolveWorkbookListDrop(rows, displayedTree, String(event.active.id), String(event.over.id), aboveMiddle);
    }, [displayedTree, rows]);

    const showDrop = React.useCallback((event: DragMoveEvent) => {
        const next = dropOf(event);
        setDrop(current => current?.targetId === next?.targetId && current?.position === next?.position ? current : next);
    }, [dropOf]);

    const endDrag = React.useCallback(() => setDrop(null), []);

    const dropRow = React.useCallback((event: DragEndEvent) => {
        endDrag();
        const target = dropOf(event);
        const active = rows.find(row => row.id === event.active.id);
        if (target == null || active == null) return;
        if (active.kind === 'workbook') {
            moveWorkbook(active.item.workbookId, target.folderPath, target.index);
        } else {
            const path = active.folder.path;
            changeWorkbookTree('move the folder', folders => folders.moveFolder(path, target.folderPath));
        }
    }, [changeWorkbookTree, dropOf, endDrag, moveWorkbook, rows]);

    const toggleFolder = React.useCallback((folder: WorkbookTreeFolder) => {
        const key = folderPathKey(folder.path);
        setCollapsedFolders(current => {
            const next = new Set(current);
            if (current.has(key)) next.delete(key); else next.add(key);
            return next;
        });
    }, []);

    const toggleWorkbook = React.useCallback((workbookId: string) => {
        setExpandedWorkbook(current => current === workbookId ? null : workbookId);
    }, []);

    /// Create a folder with a free name and edit its name
    const createFolder = React.useCallback((parentPath: string[]) => {
        const parent = folderAt(workbookTree, parentPath);
        if (parent == null) return;
        const path = [...parentPath, freeFolderName(parent.folders.map(folder => folder.name))];
        setCollapsedFolders(current => {
            const next = new Set(current);
            next.delete(folderPathKey(parentPath));
            return next;
        });
        setRenamingFolder(folderPathKey(path));
        changeWorkbookTree('create the folder', folders => folders.createFolder(path));
    }, [changeWorkbookTree, workbookTree]);

    const renameFolder = React.useCallback((folder: WorkbookTreeFolder, input: string) => {
        setRenamingFolder(null);
        const name = input.trim();
        if (name === folder.name) return;
        const parentPath = folder.path.slice(0, -1);
        const siblings = (folderAt(workbookTree, parentPath)?.folders ?? [])
            .map(sibling => sibling.name)
            .filter(sibling => sibling !== folder.name);
        const error = folderNameError(name, siblings);
        if (error != null) {
            logger.warn('failed to rename the folder', { error }, 'workbook_workbench');
            return;
        }
        changeWorkbookTree('rename the folder', folders => folders.moveFolder(folder.path, parentPath, name));
    }, [changeWorkbookTree, logger, workbookTree]);

    const deleteFolder = React.useCallback((folder: WorkbookTreeFolder) => {
        const count = flattenWorkbookTree(folder).length;
        const into = folder.path.length > 1 ? `"${folder.path[folder.path.length - 2]}"` : 'the top level';
        const workbooksNote = count === 0 ? '' : ` Its ${count === 1 ? 'workbook moves' : `${count} workbooks move`} to ${into}.`;
        if (!window.confirm(`Delete the folder "${folder.name}"?${workbooksNote}`)) return;
        changeWorkbookTree('delete the folder', folders => folders.deleteFolder(folder.path));
    }, [changeWorkbookTree]);

    /// Open the greeter, its first script creates the workbook
    const openGreeter = React.useCallback(() => {
        openGreeterPage();
        props.onOpenOverview?.(null);
        props.closeAfterSelection?.();
    }, [openGreeterPage, props.closeAfterSelection, props.onOpenOverview]);

    /// Create a workbook in a folder on the embedded Hyper, or on the Hyper of the link that the app was opened with.
    /// Its scripts attach other connections.
    const createWorkbookInFolder = React.useCallback((folderPath: string[]) => {
        const { workbookId } = createWorkbook(resolveNewWorkbookConnection());
        moveWorkbook(workbookId, folderPath, Number.MAX_SAFE_INTEGER);
        navigate({ type: SELECT_WORKBOOK, value: workbookId });
        props.closeAfterSelection?.();
    }, [createWorkbook, moveWorkbook, navigate, props.closeAfterSelection, resolveNewWorkbookConnection]);

    // A promoted workbook moves to the end of the root like a new workbook, its entry in the tree may be older than the
    // others. The next ephemeral workbook takes over the row. The aside and the drawer may both do this: the second move
    // changes nothing and the second workbook is found.
    const ephemeralWorkbook = React.useMemo(
        () => [...scriptsRegistry.values()].find(workbook => workbook.ephemeral) ?? null,
        [scriptsRegistry],
    );
    const ephemeralWorkbookId = ephemeralWorkbook?.workbookId ?? null;
    // An open overview of a connection or a cloud replaces the workbook
    const overviewShown = props.openOverviewId != null || props.openCloudId != null;
    const ephemeralWorkbookSelected = !overviewShown && ephemeralWorkbookId === props.workbookScripts.workbookId;
    const knownEphemeralWorkbookId = React.useRef(ephemeralWorkbookId);
    React.useEffect(() => {
        const known = knownEphemeralWorkbookId.current;
        knownEphemeralWorkbookId.current = ephemeralWorkbookId;
        if (known == null || known === ephemeralWorkbookId || !scriptsRegistry.has(known)) return;
        moveWorkbook(known, [], Number.MAX_SAFE_INTEGER);
        ensureEphemeralWorkbook();
    }, [ensureEphemeralWorkbook, ephemeralWorkbookId, moveWorkbook, scriptsRegistry]);

    /// Create a connection and open its settings, the next script of the current workbook runs on it
    const createConnection = React.useCallback((connector: ConnectorType) => {
        setCreateConnectionOpen(false);
        const params = createAttachedConnectionParamsForConnector(CONNECTOR_INFOS[connector]);
        const database = runtime.createConnection(dependencies.newConnectionFromParams(params, { active: true }));
        modifyCurrentWorkbook({ kind: 'setPendingConnection', value: { connectionId: database.connectionId } });
        connectionSettingsAnchorRef.current = createConnectionButtonRef.current;
        setConnectionOverlayDatabaseId(database.connectionId);
    }, [runtime, dependencies, modifyCurrentWorkbook]);

    /// Rename a connection, a blank name restores the default label
    const renameConnection = React.useCallback((connectionId: string, name: string) => {
        runtime.dispatch({ connection: connectionId }, { kind: 'rename', value: { name } });
    }, [runtime]);

    /// Delete a connection that no script uses, other than the embedded Hyper that workbooks fall back to.
    /// The workbooks whose new scripts default to the connection are detached from it first.
    const deleteConnection = React.useCallback((connectionId: string) => {
        const database = connections.get(connectionId);
        if (database == null || isHyperWasmConnection(database) || describeUsage(connectionId).blockingWorkbookCount > 0) return;
        if (!window.confirm(`Delete the connection "${connectionLabelText(labelOf(database))}"?`)) return;
        detachConnectionFromWorkbooks(connectionId)
            .then(() => shutDownAndDeleteConnection(connectionId))
            .catch(error => {
                logger.warn('failed to delete the connection', { connectionId, error: String(error) }, 'workbook_workbench');
            });
    }, [connections, describeUsage, detachConnectionFromWorkbooks, labelOf, logger, shutDownAndDeleteConnection]);

    /// The number of duplicates of a connection
    const mergeCandidateCount = React.useCallback(
        (connectionId: string) => connectionMergeCandidates(runtime.core, connections, connectionList, connectionId).length,
        [runtime, connections, connectionList],
    );
    /// Merge the duplicates of a connection into it, their workbooks move to the connection
    const mergeDuplicates = React.useCallback((connectionId: string) => {
        const database = connections.get(connectionId);
        const duplicates = connectionMergeCandidates(runtime.core, connections, connectionList, connectionId);
        if (database == null || duplicates.length === 0) return;
        const what = duplicates.length === 1 ? 'its duplicate' : `its ${duplicates.length} duplicates`;
        if (!window.confirm(`Merge ${what} into the connection "${connectionLabelText(labelOf(database))}"?`)) return;
        mergeConnections(connectionId, duplicates.map(duplicate => duplicate.connectionId)).catch(error => {
            logger.warn('failed to merge connections', { connectionId, error: String(error) }, 'workbook_workbench');
        });
    }, [connections, connectionList, labelOf, logger, mergeConnections]);

    /// What keeps a connection from being replaced, the picker offers every other listed connection
    const replaceBlocker = React.useCallback(
        (connectionId: string) => connectionReplaceBlocker(connections, connectionList, connectionId, workbookId => storageWriter.isWorkbookHeld(workbookId)),
        [connections, connectionList, storageWriter],
    );
    const replaceCandidates = React.useCallback(
        (connectionId: string) => connectionReplaceCandidates(connections, connectionList, connectionId),
        [connections, connectionList],
    );
    /// Replace a connection with another one in every workbook, the connection is removed afterwards
    const replaceWith = React.useCallback((connectionId: string, targetId: string) => {
        replaceConnection(connectionId, targetId)
            .then(({ removed }) => {
                if (!removed) logger.warn('the replaced connection is still in use', { connectionId, target: targetId }, 'workbook_workbench');
            })
            .catch(error => {
                logger.warn('failed to replace the connection', { connectionId, target: targetId, error: String(error) }, 'workbook_workbench');
            });
    }, [logger, replaceConnection]);

    const closeConnectionOverlay = React.useCallback(() => {
        setConnectionOverlayDatabaseId(null);
        if (route.workbookSetupStatus === WorkbookSetupStatus.CONFIGURING && route.workbookId != null) {
            navigate({ type: SELECT_WORKBOOK, value: route.workbookId });
        }
    }, [navigate, route.workbookId, route.workbookSetupStatus]);

    const duplicateWorkbook = React.useCallback(async (item: WorkbookItem) => {
        const newWorkbookId = crypto.randomUUID();
        try {
            await setupCore('workbook_duplicate');
            await cloneWorkbook(item.workbookId, storageReader.backend, storageReader.backend, newWorkbookId, logger);
            // The runtime restores the copy against its connections and takes it
            await runtime.restoreWorkbook(newWorkbookId);
        } catch (error) {
            logger.warn('failed to duplicate workbook', {
                workbookId: item.workbookId,
                error: String(error),
            }, 'workbook_workbench');
        }
    }, [runtime, logger, setupCore, storageReader.backend]);

    const openWorkbookFolder = React.useCallback(async () => {
        const workbookFolders = storageReader.workbookFolders;
        if (workbookFolders == null) return;
        if (platform === PlatformType.WEB) {
            folderInputRef.current?.click();
            return;
        }
        const folder = await globalThis.dashqlElectron?.openDirectory('Open an existing workbook folder');
        if (folder == null) return;
        try {
            await workbookImport.importWorkbook({ folder: workbookFolders.importFolder(folder) }, {
                presentation: {
                    mode: 'anchored',
                    anchorRef: folderButtonRef,
                    returnFocusRef: folderButtonRef,
                },
            });
        } catch (error) {
            logger.error('adding native workbook from folder failed', { error: String(error) }, 'workbook_workbench');
        }
    }, [logger, workbookImport, platform, storageReader.workbookFolders]);

    const openBrowserWorkbookFolder = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const input = event.currentTarget;
        if (input.files == null || input.files.length === 0) return;
        try {
            await workbookImport.importWorkbook({ folder: browserWorkbookFolder(input.files) }, {
                presentation: {
                    mode: 'anchored',
                    anchorRef: folderButtonRef,
                    returnFocusRef: folderButtonRef,
                },
            });
        } catch (error) {
            logger.error('adding browser workbook folder failed', { error: String(error) }, 'workbook_workbench');
        } finally {
            input.value = '';
        }
    }, [logger, workbookImport]);

    const deleteWorkbook = React.useCallback(async (item: WorkbookItem) => {
        const action = item.isNative ? 'Unlink' : 'Delete';
        if (!window.confirm(`${action} "${item.label}"?${item.isNative ? ' The folder and its files will remain on disk.' : ''}`)) return;
        try {
            await storageWriter.deleteWorkbook(item.workbookId);
        } catch (error) {
            console.error('Failed to delete workbook from storage:', error);
            return;
        }
        deleteWorkbookFromRuntime(item.workbookId);
        // Connections outlive the workbooks that reference them, only the workbook's own
        // computations are dropped.
        const readQuery = (queryId: number) => runtime.store.get('query', queryId);
        for (const database of item.connections) {
            for (const queryId of findWorkbookQueries(database, item.workbookId, readQuery)) {
                runtime.dispatch({ computation: queryId }, { kind: 'deleteComputation' });
            }
        }

        if (item.workbookId === props.workbookScripts.workbookId) {
            const next = workbooks.find(workbook => workbook.workbookId !== item.workbookId);
            if (next != null) navigate({ type: OPEN_WORKBOOK, value: next.workbookId });
            else openGreeter();
        }
    }, [deleteWorkbookFromRuntime, navigate, openGreeter, runtime, workbooks, props.workbookScripts.workbookId, storageWriter]);

    const openWorkbook = React.useCallback((item: WorkbookItem) => {
        navigate({ type: SELECT_WORKBOOK, value: item.workbookId });
        props.onOpenOverview?.(null);
        props.closeAfterSelection?.();
    }, [navigate, props.closeAfterSelection, props.onOpenOverview]);
    /// Open a workbook at one of its scripts, the workbook row selects the script
    const openScript = React.useCallback((item: WorkbookItem, fileName: string) => {
        navigate({ type: SELECT_WORKBOOK, value: item.workbookId });
        props.onOpenOverview?.(null);
        props.onOpenScript?.(item.workbookId, fileName);
        props.closeAfterSelection?.();
    }, [navigate, props.closeAfterSelection, props.onOpenOverview, props.onOpenScript]);
    const onOpenOverview = props.onOpenOverview;
    const closeAfterSelection = props.closeAfterSelection;
    const openOverview = React.useMemo(() => onOpenOverview == null ? undefined : (connectionId: string) => {
        onOpenOverview(connectionId);
        closeAfterSelection?.();
    }, [onOpenOverview, closeAfterSelection]);
    const workbookListRef = React.useRef<HTMLUListElement>(null);
    const getWorkbookScrollElement = React.useCallback(() => workbookListRef.current, []);

    // The local workbooks are a folder of their own next to the folder of the clouds
    const rootDepth = 1;
    const localShown = localExpanded;

    // A preview that was selected below its cloud replaces an open overview
    const openedFromCloud = React.useCallback(() => {
        onOpenOverview?.(null);
        closeAfterSelection?.();
    }, [onOpenOverview, closeAfterSelection]);
    const onOpenCloud = props.onOpenCloud;
    const openCloud = React.useCallback((connectionId: string) => {
        onOpenCloud?.(connectionId);
        closeAfterSelection?.();
    }, [onOpenCloud, closeAfterSelection]);

    return (
        <nav className={styles.workbench} aria-label="Workbook workbench" data-electron-drag-region>
            <VerticalSplit
                className={styles.section_split}
                separatorClassName={styles.section_separator}
                separatorSize={SECTION_SEPARATOR_SIZE}
                defaultRatio={0.42}
                minFirstSize={SECTION_MIN_SIZE}
                minSecondSize={SECTION_MIN_SIZE}
                separatorLabel="Resize workbooks and connections"
                first={(
                    <section className={styles.section} aria-labelledby="workbench-workbooks-heading">
                        <header className={styles.section_header}>
                            <div className={styles.section_title}>
                                <h2 id="workbench-workbooks-heading" className={styles.section_heading}>Workbooks</h2>
                                <span
                                    className={styles.section_count}
                                    data-testid="workbook-count"
                                    aria-label={`${workbookCount} ${workbookCount === 1 ? 'workbook' : 'workbooks'}`}
                                >
                                    {workbookCount}
                                </span>
                            </div>
                            <div className={styles.section_actions}>
                                {storageReader.workbookFolders != null && (
                                    <>
                                        <IconButton
                                            ref={folderButtonRef}
                                            size={ButtonSize.Small}
                                            variant={ButtonVariant.Invisible}
                                            aria-label="Open workbook folder"
                                            onClick={openWorkbookFolder}
                                        >
                                            <UploadIcon size={14} />
                                        </IconButton>
                                        {platform === PlatformType.WEB && (
                                            <input
                                                ref={folderInputRef}
                                                className={styles.folder_input}
                                                type="file"
                                                multiple
                                                {...({ webkitdirectory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
                                                tabIndex={-1}
                                                aria-hidden="true"
                                                onChange={openBrowserWorkbookFolder}
                                            />
                                        )}
                                    </>
                                )}
                                {storageReader.workbookFolders != null && (
                                    <IconButton
                                        data-testid="create-folder"
                                        size={ButtonSize.Small}
                                        variant={ButtonVariant.Invisible}
                                        aria-label="Create folder"
                                        onClick={() => createFolder([])}
                                    ><FileDirectoryPlusIcon size={14} /></IconButton>
                                )}
                                <IconButton
                                    ref={createButtonRef}
                                    data-testid="create-workbook"
                                    size={ButtonSize.Small}
                                    variant={ButtonVariant.Invisible}
                                    aria-label="Create workbook"
                                    disabled={ephemeralWorkbookSelected}
                                    onClick={openGreeter}
                                ><StackPlusIcon size={14} /></IconButton>
                            </div>
                        </header>
                        <div className={styles.scroll_shadow_container}>
                            <DndContext
                                sensors={dndSensors}
                                collisionDetection={WORKBOOK_LIST_COLLISIONS}
                                modifiers={[VERTICAL_DRAG]}
                                onDragMove={showDrop}
                                onDragEnd={dropRow}
                                onDragCancel={endDrag}
                            >
                                <SortableContext items={localShown ? rows.map(row => row.id) : []} strategy={KEEP_ROWS_IN_PLACE}>
                                    <ul ref={workbookListRef} className={styles.workbook_list} aria-label="Workbooks" data-electron-drag-region="false">
                                        {/* The clouds, a folder above the local workbooks */}
                                        <dependencies.CloudsFolder
                                            openCloudId={props.openCloudId ?? null}
                                            currentWorkbookId={overviewShown ? null : props.workbookScripts.workbookId}
                                            onOpenCloud={openCloud}
                                            onOpened={openedFromCloud}
                                        />
                                        <LocalWorkbookFolderRow
                                            expanded={localExpanded}
                                            count={workbookCount}
                                            onToggle={() => setLocalExpanded(value => !value)}
                                        />
                                        {localShown && rows.map(row => row.kind === 'folder' ? (
                                            <WorkbookFolderRow
                                                key={row.id}
                                                rowId={row.id}
                                                folder={row.folder}
                                                depth={row.depth + rootDepth}
                                                expanded={row.expanded}
                                                renaming={renamingFolder === folderPathKey(row.folder.path)}
                                                onToggle={() => toggleFolder(row.folder)}
                                                onStartRename={() => setRenamingFolder(folderPathKey(row.folder.path))}
                                                onRename={name => renameFolder(row.folder, name)}
                                                onCancelRename={() => setRenamingFolder(null)}
                                                onNewWorkbook={() => createWorkbookInFolder(row.folder.path)}
                                                onMoveToTopLevel={row.depth === 0 ? null : () => changeWorkbookTree('move the folder', folders => folders.moveFolder(row.folder.path, []))}
                                                onDelete={() => deleteFolder(row.folder)}
                                                dropTarget={drop?.targetId === row.id}
                                            />
                                        ) : (
                                            <WorkbookRow
                                                key={row.id}
                                                item={row.item}
                                                depth={row.depth + rootDepth}
                                                // An open connection overview replaces the workbook
                                                selected={!overviewShown && row.item.workbookId === props.workbookScripts.workbookId}
                                                onOpen={() => openWorkbook(row.item)}
                                                onDuplicate={() => { void duplicateWorkbook(row.item); }}
                                                onDelete={() => { void deleteWorkbook(row.item); }}
                                                dropPosition={drop?.targetId === row.id && drop.position !== 'into' ? drop.position : null}
                                                expanded={expandedWorkbook === row.item.workbookId}
                                                onToggle={() => toggleWorkbook(row.item.workbookId)}
                                                onOpenScript={fileName => openScript(row.item, fileName)}
                                                dependencies={dependencies}
                                            />
                                        ))}
                                        {localShown && invalidItems.map(item => (
                                            <InvalidWorkbookRow
                                                key={item.workbookId}
                                                item={item}
                                                depth={rootDepth}
                                                onDelete={() => { void deleteInvalidWorkbook(item.workbookId); }}
                                            />
                                        ))}
                                        {localShown && ephemeralWorkbook != null && (
                                            <EphemeralWorkbookRow selected={ephemeralWorkbookSelected} depth={rootDepth} onOpen={openGreeter} />
                                        )}
                                        {storageReader.workbookFolders != null && (
                                            <TopLevelDropZone targeted={drop?.targetId === TOP_LEVEL_DROP_ID} depth={rootDepth} />
                                        )}
                                    </ul>
                                </SortableContext>
                            </DndContext>
                            <VerticalScrollShadows
                                getScrollElement={getWorkbookScrollElement}
                                refreshKey={`${rows.length}:${invalidItems.length}`}
                            />
                        </div>
                    </section>
                )}
                second={(
                    <section className={styles.section} aria-labelledby="workbench-databases-heading">
                        <header className={styles.section_header}>
                            <div className={styles.section_title}>
                                <h2 id="workbench-databases-heading" className={styles.section_heading}>Connections</h2>
                                <span
                                    className={styles.section_count}
                                    data-testid="connection-count"
                                    aria-label={`${connectionCount} ${connectionCount === 1 ? 'connection' : 'connections'}`}
                                >
                                    {connectionCount}
                                </span>
                            </div>
                            <AnchoredOverlay
                                open={createConnectionOpen}
                                onOpen={() => setCreateConnectionOpen(true)}
                                onClose={() => setCreateConnectionOpen(false)}
                                anchorRef={createConnectionButtonRef}
                                returnFocusRef={createConnectionButtonRef}
                                side={AnchorSide.OutsideBottom}
                                align={AnchorAlignment.End}
                                renderAnchor={anchorProps => <IconButton
                                    {...anchorProps}
                                    ref={createConnectionButtonRef}
                                    size={ButtonSize.Small}
                                    variant={ButtonVariant.Invisible}
                                    aria-label="Create connection"
                                ><PlusIcon size={14} /></IconButton>}
                            >
                                <div className={actionMenuStyles.menu} role="dialog" aria-label="Choose connection connector">
                                    <ActionList.List aria-label="Connection connector">
                                        {ATTACHABLE_CONNECTORS.map(connector => (
                                            <ActionList.ListItem key={connector} onClick={() => createConnection(connector)}>
                                                <ActionList.Leading>
                                                    <svg width="16px" height="16px" aria-hidden="true">
                                                        <use xlinkHref={`${symbols}#${connectorIcon(CONNECTOR_INFOS[connector])}`} style={CONNECTOR_ICON_STYLE} />
                                                    </svg>
                                                </ActionList.Leading>
                                                <ActionList.ItemText>{CONNECTOR_INFOS[connector].names.displayShort}</ActionList.ItemText>
                                            </ActionList.ListItem>
                                        ))}
                                    </ActionList.List>
                                </div>
                            </AnchoredOverlay>
                        </header>
                        <div className={styles.database_body} data-electron-drag-region="false">
                            {connectionRows.length > 0 && <ConnectionTree
                                databases={connectionRows}
                                describeUsage={describeUsage}
                                onRename={renameConnection}
                                onDelete={deleteConnection}
                                mergeCandidateCount={mergeCandidateCount}
                                onMerge={mergeDuplicates}
                                replaceBlocker={replaceBlocker}
                                replaceCandidates={replaceCandidates}
                                onReplace={replaceWith}
                                initiallyExpanded={initiallyExpanded}
                                workbookConnectionIds={workbookConnectionIds}
                                labelOf={labelOf}
                                attention={connectionAttention?.active === true}
                                onOpenOverview={openOverview}
                                openOverviewId={props.openOverviewId ?? null}
                                cloudConnectionIds={cloudConnectionIds}
                                onSetCloud={setCloudConnection}
                                onOpenSettings={(connectionId, anchor) => {
                                    connectionSettingsAnchorRef.current = anchor;
                                    setConnectionOverlayDatabaseId(connectionId);
                                }}
                            />}
                        </div>
                    </section>
                )}
            />
            <dependencies.ConnectionSettingsOverlay
                connectionId={connectionOverlayDatabaseId}
                isOpen={connectionOverlayDatabaseId != null}
                onClose={closeConnectionOverlay}
                anchorRef={connectionSettingsAnchorRef}
                renderWorkbookName={renderWorkbookName}
            />
        </nav>
    );
};
