import * as React from 'react';
import symbols from '@ankoh/dashql-svg-symbols';
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

import { useComputationDispatch } from '../compute/computation_registry.js';
import { DELETE_COMPUTATION } from '../compute/computation_state.js';
import { AnchorAlignment, AnchorSide } from '../ui/foundations/anchored_position.js';
import { AnchoredOverlay } from '../ui/foundations/anchored_overlay.js';
import * as ActionList from '../ui/foundations/action_list.js';
import { ButtonSize, ButtonVariant, IconButton } from '../ui/foundations/button.js';
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
} from '../ui/foundations/symbol_icon.js';
import { classNames } from '../utils/classnames.js';
import { OPEN_SESSION, SELECT_SESSION, useRouteContext, useRouterNavigate } from '../app/router/router.js';
import { SessionSetupStatus } from '../app/loading/session_setup_status.js';
import { ConnectionState, RENAME_CONNECTION } from '../connections/connection_state.js';
import {
    findSessionQueries,
    useConnectionReferences,
    useConnectionRegistry,
    useConnectionAllocator,
    useSessionConnections,
    useDynamicConnectionDispatch,
} from '../connections/connection_registry.js';
import {
    createConnectionStateFromParams,
    createAttachedConnectionParamsForConnector,
} from '../connections/connection_params.js';
import { useNewSessionConnection } from '../connections/embedded_connection.js';
import { ATTACHABLE_CONNECTORS } from '../connections/attached_connection.js';
import { CONNECTOR_INFOS, ConnectorType } from '../connections/connector_info.js';
import { ConnectionSettingsOverlay } from '../connections/connection_settings_overlay.js';
import { renderSessionName } from './session_name.js';
import { SessionConnectionAttentionContext } from './session_connection_attention.js';
import { VerticalScrollShadows } from '../ui/foundations/vertical_scroll_shadows.js';
import { VerticalSplit } from '../ui/foundations/vertical_split.js';
import { displayPath } from '../storage/session_locator.js';
import { StorageBackendType } from '../storage/storage_backend.js';
import { SessionStorageOverlay } from './persistence/session_storage_overlay.js';
import { useStorageReader, useStorageWriter } from '../storage/storage_provider.js';
import { readSessionBundleFromBrowserFolder } from './persistence/browser_session_folder.js';
import { cloneSession } from '../storage/session_transfer.js';
import {
    mergeRestoredSessionIntoConnections,
    mergeRestoredSessionIntoScripts,
    restoreSingleSession,
} from './persistence/app_state_loader.js';
import { useSessionImport } from './persistence/session_import_provider.js';
import { describeSessionValidationError } from '../storage/session_validation.js';
import { scriptConnectionOf, scriptsOnConnection, SELECT_SCRIPT, SET_PENDING_CONNECTION, type SessionScripts } from './scripts/session_scripts.js';
import { scriptDisplayName } from './scripts/script_types.js';
import { renameScript } from './scripts/script_rename.js';
import {
    useInvalidSessions,
    useSessionScripts,
    useSessionScriptsDeletion,
    useSessionScriptsRegistry,
} from './scripts/session_scripts_registry.js';
import { useSessionCreation } from './session_creation.js';
import { SESSION_LIST_CARET_COLUMN, SessionFolderRow, sessionListRowPadding, startsRowDrag } from './session_folder_row.js';
import {
    type SessionListDrop,
    type SessionListRow as SessionListRowOf,
    TOP_LEVEL_DROP_ID,
    flattenSessionListRows,
    resolveSessionListDrop,
} from './session_list_rows.js';
import {
    type SessionTreeFolder,
    findSessionFolder,
    flattenSessionTree,
    folderAt,
    folderNameError,
    folderPathKey,
    freeFolderName,
    moveSessionInTree,
    upsertSessionInTree,
} from '../storage/session_tree.js';
import { RENAME_SESSION } from './scripts/session_scripts.js';
import { NameInput } from '../ui/foundations/name_input.js';
import { type RowContextMenu, useRowContextMenu, useRowContextMenuOpener } from '../ui/foundations/row_context_menu.js';
import { useMergeConnections } from './session_connection_merge.js';
import { useReplaceConnection } from './session_connection_replace.js';
import { useDetachConnection } from './session_connection_detach.js';
import { useDeleteConnection } from '../connections/connection_deletion.js';
import { connectionMergeCandidates } from '../connections/connection_merge.js';
import { connectionReplaceBlocker, connectionReplaceCandidates } from '../connections/connection_replace.js';
import { connectionLabelParts, connectionLabelText, connectionOrdinals, isHyperWasmConnection } from '../connections/connection_label.js';
import { useAppFlavor } from '../config/flavor_provider.js';
import { SessionURLShareOverlay } from './persistence/session_url_share_overlay.js';
import { SessionFileSaveOverlay } from './persistence/session_file_save_overlay.js';
import * as styles from './session_workbench_sidebar.module.css';
import { ConnectionTree, isConnectionInitiallyExpanded, listedConnections, type ConnectionUsage } from '../connections/connection_tree.js';
import * as actionMenuStyles from '../app/action_menu.module.css';
import { useDashQLCoreSetup } from '../runtime/core_provider.js';
import { useLogger } from '../platform/logger/logger_provider.js';
import { PlatformType, usePlatformType } from '../platform/platform_type.js';
import { useConnectorIcon } from '../connections/connector_icon.js';

interface SessionItem {
    sessionId: string;
    /// The connections of the session, in the order its scripts use them
    connections: ConnectionState[];
    scripts: SessionScripts;
    label: string;
    path: string;
    isNative: boolean;
}

interface InvalidSessionItem {
    sessionId: string;
    label: string;
    path: string;
    isNative: boolean;
    invalidReason: string;
}

type SessionListRow = SessionListRowOf<SessionItem>;

/// The rows stay in place while a row is dragged, the drop target shows where the row lands
const KEEP_ROWS_IN_PLACE: SortingStrategy = () => null;

/// A dragged row only moves up and down
const VERTICAL_DRAG: Modifier = ({ transform }) => ({ ...transform, x: 0 });

/// The slim bar between the sessions and the connections
const SECTION_SEPARATOR_SIZE = 7;
/// The header and about two rows stay visible in a section
const SECTION_MIN_SIZE = 96;

/// The drop target is the row under the pointer, the keyboard picks the closest row
const SESSION_LIST_COLLISIONS: CollisionDetection = args => {
    const hits = pointerWithin(args);
    return hits.length > 0 ? hits : closestCenter(args);
};

/// The drop target at the end of the session list. It fills the empty space below the rows and moves a row to the
/// end of the top level, a targeted drop shows the insertion line at the end of the list.
const TopLevelDropZone: React.FC<{ targeted: boolean }> = ({ targeted }) => {
    const { setNodeRef } = useDroppable({ id: TOP_LEVEL_DROP_ID });
    return (
        <li
            ref={setNodeRef}
            className={classNames(styles.top_level_drop, { [styles.top_level_drop_targeted]: targeted })}
            aria-hidden="true"
            data-testid="session-top-level-drop"
        />
    );
};

interface Props {
    sessionScripts: SessionScripts;
    closeAfterSelection?: () => void;
    /// The connection whose overview is open
    openOverviewId?: string | null;
    /// Open the overview of a connection, or close it with null
    onOpenOverview?: (connectionId: string | null) => void;
    /// Show a script of a session that was opened from the sidebar
    onOpenScript?: (sessionId: string, fileName: string) => void;
    dependencies?: SessionWorkbenchSidebarDependencies;
}

export interface SessionWorkbenchSidebarDependencies {
    useRouterNavigate: typeof useRouterNavigate;
    useRouteContext: typeof useRouteContext;
    useDynamicConnectionDispatch: typeof useDynamicConnectionDispatch;
    useSessionScriptsRegistry: typeof useSessionScriptsRegistry;
    useSessionScripts: typeof useSessionScripts;
    useConnectionRegistry: typeof useConnectionRegistry;
    useConnectionReferences: typeof useConnectionReferences;
    useConnectionAllocator: typeof useConnectionAllocator;
    useSessionCreation: typeof useSessionCreation;
    useMergeConnections: typeof useMergeConnections;
    useReplaceConnection: typeof useReplaceConnection;
    useDetachConnection: typeof useDetachConnection;
    useDeleteConnection: typeof useDeleteConnection;
    useSessionScriptsDeletion: typeof useSessionScriptsDeletion;
    useComputationDispatch: typeof useComputationDispatch;
    useStorageReader: typeof useStorageReader;
    useStorageWriter: typeof useStorageWriter;
    useDashQLCoreSetup: typeof useDashQLCoreSetup;
    useSessionImport: typeof useSessionImport;
    usePlatformType: typeof usePlatformType;
    useLogger: typeof useLogger;
    useInvalidSessions: typeof useInvalidSessions;
    useSessionConnections: typeof useSessionConnections;
    useNewSessionConnection: typeof useNewSessionConnection;
    createConnectionStateFromParams: typeof createConnectionStateFromParams;
    ConnectionSettingsOverlay: typeof ConnectionSettingsOverlay;
    SessionStorageOverlay: typeof SessionStorageOverlay;
    SessionURLShareOverlay: typeof SessionURLShareOverlay;
    SessionFileSaveOverlay: typeof SessionFileSaveOverlay;
}

const DEFAULT_SESSION_WORKBENCH_SIDEBAR_DEPENDENCIES: SessionWorkbenchSidebarDependencies = {
    useRouterNavigate,
    useRouteContext,
    useDynamicConnectionDispatch,
    useSessionScriptsRegistry,
    useSessionScripts,
    useConnectionRegistry,
    useConnectionReferences,
    useConnectionAllocator,
    useSessionCreation,
    useMergeConnections,
    useReplaceConnection,
    useDetachConnection,
    useDeleteConnection,
    useSessionScriptsDeletion,
    useComputationDispatch,
    useStorageReader,
    useStorageWriter,
    useDashQLCoreSetup,
    useSessionImport,
    usePlatformType,
    useLogger,
    useInvalidSessions,
    useSessionConnections,
    useNewSessionConnection,
    createConnectionStateFromParams,
    ConnectionSettingsOverlay,
    SessionStorageOverlay,
    SessionURLShareOverlay,
    SessionFileSaveOverlay,
};

const MoreIcon = SymbolIcon('kebab_horizontal');
const FileZipIcon = SymbolIcon('file_zip_16');

interface SessionRowMenuProps {
    item: SessionItem;
    onRename: () => void;
    onDuplicate: () => void;
    onDelete: () => void;
    /// The right click of the row opens the menu
    contextMenu: RowContextMenu;
    dependencies: SessionWorkbenchSidebarDependencies;
}

const SessionRowMenu: React.FC<SessionRowMenuProps> = ({ item, onRename, onDuplicate, onDelete, contextMenu, dependencies }) => {
    const [open, setOpen] = React.useState(false);
    useRowContextMenuOpener(contextMenu, () => setOpen(true));
    const [shareOpen, setShareOpen] = React.useState(false);
    const [exportOpen, setExportOpen] = React.useState(false);
    const archiveExport = useAppFlavor().features.sessionArchiveExport;
    const [storageOpen, setStorageOpen] = React.useState(false);
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
                    className={styles.session_menu_button}
                    data-testid="session-row-menu"
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
                    <dependencies.SessionStorageOverlay
                        sessionId={item.sessionId}
                        isOpen={storageOpen}
                        onClose={() => setStorageOpen(false)}
                        side={AnchorSide.OutsideRight}
                        align={AnchorAlignment.Start}
                        renderAnchor={(anchorProps) => (
                            <ActionList.ListItem
                                {...anchorProps}
                                data-testid="session-menu-item"
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
                    <ActionList.ListItem data-testid="session-menu-item" data-action="rename" onClick={(event) => {
                        event.stopPropagation();
                        setOpen(false);
                        onRename();
                    }}>
                        <ActionList.Leading><PencilIcon size={16} /></ActionList.Leading>
                        <ActionList.ItemText>Rename</ActionList.ItemText>
                    </ActionList.ListItem>
                    <ActionList.ListItem data-testid="session-menu-item" data-action="duplicate" onClick={() => { setOpen(false); onDuplicate(); }}>
                        <ActionList.Leading><CopyIcon size={16} /></ActionList.Leading>
                        <ActionList.ItemText>Duplicate</ActionList.ItemText>
                    </ActionList.ListItem>
                    <ActionList.ListItem data-testid="session-menu-item" data-action="share-url" onClick={(event) => {
                        event.stopPropagation();
                        setShareOpen(value => !value);
                    }}>
                        <ActionList.Leading><LinkIcon size={16} /></ActionList.Leading>
                        <ActionList.ItemText>
                            Share as URL
                            <dependencies.SessionURLShareOverlay
                                sessionId={item.sessionId}
                                isOpen={shareOpen}
                                setIsOpen={setShareOpen}
                            />
                        </ActionList.ItemText>
                    </ActionList.ListItem>
                    {/* The list takes elements only, the fragment wraps the optional item */}
                    <>{archiveExport && (
                        <ActionList.ListItem data-testid="session-menu-item" data-action="export" onClick={(event) => {
                            event.stopPropagation();
                            setExportOpen(value => !value);
                        }}>
                            <ActionList.Leading><FileZipIcon size={16} /></ActionList.Leading>
                            <ActionList.ItemText>
                                Export .dashql
                                <dependencies.SessionFileSaveOverlay
                                    isOpen={exportOpen}
                                    setIsOpen={setExportOpen}
                                    sessionScripts={item.scripts}
                                    fileName={item.scripts.name ?? item.scripts.sessionMetadata.originalFileName ?? 'session'}
                                />
                            </ActionList.ItemText>
                        </ActionList.ListItem>
                    )}</>
                    <ActionList.ListItem data-testid="session-menu-item" data-action="delete" className={actionMenuStyles.delete_action} onClick={() => { setOpen(false); onDelete(); }}>
                        <ActionList.Leading>{item.isNative ? <UnlinkIcon size={16} /> : <TrashIcon size={16} />}</ActionList.Leading>
                        <ActionList.ItemText>{item.isNative ? 'Unlink' : 'Delete'}</ActionList.ItemText>
                    </ActionList.ListItem>
                </ActionList.List>
            </div>
        </AnchoredOverlay>
    );
};

interface SessionRowProps {
    item: SessionItem;
    /// The depth of the session in the session tree, the sessions of the root are at depth 0
    depth: number;
    selected: boolean;
    onOpen: (anchor: HTMLButtonElement) => void;
    onDuplicate: () => void;
    onDelete: () => void;
    /// Where a dragged session lands next to this one, null without a drag
    dropPosition: 'before' | 'after' | null;
    /// Are the scripts of the session listed below it?
    expanded: boolean;
    /// Show or hide the scripts of the session
    onToggle: () => void;
    /// Open a script of the session
    onOpenScript: (fileName: string) => void;
    dependencies: SessionWorkbenchSidebarDependencies;
}

const SessionRow: React.FC<SessionRowProps> = ({ item, depth, selected, onOpen, onDuplicate, onDelete, dropPosition, expanded, onToggle, onOpenScript, dependencies }) => {
    const title = item.scripts.name?.trim() || null;
    const [, modifySessionScripts] = dependencies.useSessionScripts(item.sessionId);
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
        void modifySessionScripts({ type: RENAME_SESSION, value: name });
    }, [modifySessionScripts]);
    const cancelRename = React.useCallback(() => setRenaming(false), []);
    const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.sessionId });
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
    const openScript = (fileName: string) => {
        void modifySessionScripts({ type: SELECT_SCRIPT, value: fileName });
        onOpenScript(fileName);
    };
    const Caret = expanded ? ChevronDownIcon : ChevronRightIcon;
    const caret = scriptNames.length > 0
        ? <span className={styles.tree_caret} aria-hidden="true"><Caret size={12} /></span>
        : <span aria-hidden="true" />;
    // A click opens the session and lists its scripts, a click on the open session shows or hides them like a folder.
    // Renaming the session is in the row menu.
    const clickName = (anchor: HTMLButtonElement) => {
        if (!selected) {
            onOpen(anchor);
            if (!expanded && scriptNames.length > 0) onToggle();
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
                styles.session_row,
                {
                    [styles.entry_selected]: selected,
                    [styles.session_row_dragging]: isDragging,
                    [styles.drop_before]: dropPosition === 'before',
                    [styles.drop_after]: dropPosition === 'after',
                },
            )}
            style={{
                transform: CSS.Translate.toString(transform),
                transition,
                paddingLeft: sessionListRowPadding(depth),
                // The insertion line of a drop starts at the icon of the session
                ['--session_row_indent' as string]: `${sessionListRowPadding(depth) + SESSION_LIST_CARET_COLUMN}px`,
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
                        className={styles.session_rename_input}
                        name={title}
                        onCommit={commitRename}
                        onCancel={cancelRename}
                        ariaLabel="Session name"
                        placeholder="Name this session"
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
                    <span className={title ? styles.session_name : styles.session_path}>{title ?? item.path}</span>
                </button>
            )}
            <SessionRowMenu item={item} onRename={() => setRenaming(true)} onDuplicate={onDuplicate} onDelete={onDelete} contextMenu={contextMenu} dependencies={dependencies} />
        </li>
        {expanded && scriptNames.map(fileName => (
            <SessionScriptRow
                key={`${item.sessionId}/${fileName}`}
                fileName={fileName}
                depth={depth}
                onOpen={() => openScript(fileName)}
                onRename={name => { void renameScript(item.scripts, modifySessionScripts, fileName, name, null); }}
            />
        ))}
        </>
    );
};

interface SessionScriptRowProps {
    fileName: string;
    /// The depth of the session of the script
    depth: number;
    /// Open the script
    onOpen: () => void;
    /// Rename the script, the name is a display name
    onRename: (name: string) => void;
}

/// A script of an expanded session. A double-click on the name or the rename action of the menu edits the name.
const SessionScriptRow: React.FC<SessionScriptRowProps> = ({ fileName, depth, onOpen, onRename }) => {
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
            // The file icons of the scripts sit directly below the icon of their session
            style={{ paddingLeft: sessionListRowPadding(depth) + SESSION_LIST_CARET_COLUMN }}
            data-testid="session-script-row"
            onContextMenu={contextMenu.onContextMenu}
        >
            {renaming ? (
                <div className={styles.script_rename}>
                    <FileIcon size={14} aria-hidden="true" />
                    <NameInput
                        ref={renameInputRef}
                        className={classNames(styles.session_rename_input, styles.script_rename_input)}
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
                    className={styles.session_button}
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
                    className={styles.session_menu_button}
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

const InvalidSessionRow: React.FC<{ item: InvalidSessionItem; onDelete: () => void }> = ({ item, onDelete }) => (
    <li className={classNames(styles.entry_surface, styles.session_row)}>
        <div
            className={classNames(styles.session_button, styles.session_button_invalid)}
            title={item.invalidReason}
        >
            <AlertIcon size={14} aria-hidden="true" />
            <span>
                <span className={styles.session_name}>{item.label}</span>
                <span className={styles.session_error}>{item.invalidReason}</span>
            </span>
        </div>
        <IconButton
            size={ButtonSize.Small}
            variant={ButtonVariant.Invisible}
            className={styles.session_menu_button}
            aria-label={`${item.isNative ? 'Unlink' : 'Delete'} invalid session ${item.label}`}
            onClick={onDelete}
        >
            {item.isNative ? <UnlinkIcon size={14} /> : <TrashIcon size={14} />}
        </IconButton>
    </li>
);

export const SessionWorkbenchSidebar: React.FC<Props> = (props) => {
    const connectorIcon = useConnectorIcon();
    const dependencies = props.dependencies ?? DEFAULT_SESSION_WORKBENCH_SIDEBAR_DEPENDENCIES;
    const navigate = dependencies.useRouterNavigate();
    const route = dependencies.useRouteContext();
    const [databaseRegistry, connectionDispatch] = dependencies.useDynamicConnectionDispatch();
    const [scriptsRegistry, setScriptsRegistry] = dependencies.useSessionScriptsRegistry();
    const [, setDatabaseRegistry] = dependencies.useConnectionRegistry();
    const references = dependencies.useConnectionReferences();
    const allocateConnection = dependencies.useConnectionAllocator();
    const createSession = dependencies.useSessionCreation();
    const resolveNewSessionConnection = dependencies.useNewSessionConnection();
    const mergeConnections = dependencies.useMergeConnections();
    const replaceConnection = dependencies.useReplaceConnection();
    const detachConnectionFromSessions = dependencies.useDetachConnection();
    const [, modifyCurrentSession] = dependencies.useSessionScripts(props.sessionScripts.sessionId);
    const shutDownAndDeleteConnection = dependencies.useDeleteConnection();
    const deleteSessionScripts = dependencies.useSessionScriptsDeletion();
    const computationDispatch = dependencies.useComputationDispatch();
    const storageReader = dependencies.useStorageReader();
    const storageWriter = dependencies.useStorageWriter();
    const setupCore = dependencies.useDashQLCoreSetup();
    const sessionImport = dependencies.useSessionImport();
    const platform = dependencies.usePlatformType();
    const logger = dependencies.useLogger();
    const { invalidSessions, deleteInvalidSession } = dependencies.useInvalidSessions();
    const attached = dependencies.useSessionConnections(props.sessionScripts.sessionId);
    const connectionAttention = React.useContext(SessionConnectionAttentionContext);
    const sessionConnectionRows = React.useMemo(() => attached ?? [], [attached]);
    const [connectionOverlayDatabaseId, setConnectionOverlayDatabaseId] = React.useState<string | null>(null);
    const [createConnectionOpen, setCreateConnectionOpen] = React.useState(false);
    const createConnectionButtonRef = React.useRef<HTMLButtonElement>(null);
    const createButtonRef = React.useRef<HTMLButtonElement>(null);
    const connectionSettingsAnchorRef = React.useRef<HTMLButtonElement>(null);
    const folderButtonRef = React.useRef<HTMLButtonElement>(null);
    const folderInputRef = React.useRef<HTMLInputElement>(null);
    // The folders and sessions of the sidebar, a change shows right away and is reconciled with the storage after its write
    const [sessionTree, setSessionTree] = React.useState(() => storageReader.getSessionTree());
    const treeWriteRef = React.useRef(Promise.resolve());
    // The collapsed folders, by folder path key
    const [collapsedFolders, setCollapsedFolders] = React.useState<ReadonlySet<string>>(() => new Set());
    // The sessions whose scripts are listed, all are collapsed at first
    const [expandedSessions, setExpandedSessions] = React.useState<ReadonlySet<string>>(() => new Set());
    // The folder whose name is being edited, by folder path key
    const [renamingFolder, setRenamingFolder] = React.useState<string | null>(null);
    // Where would the dragged row land?
    const [drop, setDrop] = React.useState<SessionListDrop | null>(null);

    React.useEffect(() => {
        if (route.sessionSetupStatus !== SessionSetupStatus.CONFIGURING
            || route.sessionId !== props.sessionScripts.sessionId) return;
        const connectionId = references.connectionsOf(route.sessionId)[0] ?? null;
        if (connectionId != null) {
            connectionSettingsAnchorRef.current = document.querySelector('[aria-label="Create session"]');
            setConnectionOverlayDatabaseId(connectionId);
        }
    }, [references, scriptsRegistry, props.sessionScripts.sessionId, route.sessionId, route.sessionSetupStatus]);

    const sessionItems = React.useMemo<Map<string, SessionItem>>(() => {
        const items = new Map<string, SessionItem>();
        for (const [sessionId, scripts] of scriptsRegistry.sessionScriptsMap) {
            const connections = references.connectionsOf(sessionId)
                .map(id => databaseRegistry.connections.get(id))
                .filter((connection): connection is ConnectionState => connection != null);
            const location = storageReader.getSessionLocation(sessionId);
            const path = displayPath(sessionId, location);
            items.set(sessionId, {
                sessionId,
                connections,
                scripts,
                path,
                label: scripts.name?.trim() || path,
                isNative: location.type === StorageBackendType.Native,
            });
        }
        return items;
    }, [databaseRegistry, references, scriptsRegistry, storageReader]);

    // The sessions that the tree doesn't list yet, e.g. new ones before their first write, show where their
    // first write registers them, at the end of the root
    const displayedTree = React.useMemo<SessionTreeFolder>(() => {
        const listed = new Set(flattenSessionTree(sessionTree).map(entry => entry.path));
        return [...sessionItems.keys()]
            .filter(id => !listed.has(id))
            .reduce((tree, path) => upsertSessionInTree(tree, { path }), sessionTree);
    }, [sessionItems, sessionTree]);

    // Opening a session expands the folders on the way to it
    const currentSessionFolderKey = folderPathKey(findSessionFolder(displayedTree, props.sessionScripts.sessionId) ?? []);
    React.useEffect(() => {
        const path = JSON.parse(currentSessionFolderKey) as string[];
        setCollapsedFolders(current => {
            const ancestors = path.map((_, index) => folderPathKey(path.slice(0, index + 1))).filter(key => current.has(key));
            if (ancestors.length === 0) return current;
            const next = new Set(current);
            for (const key of ancestors) next.delete(key);
            return next;
        });
    }, [currentSessionFolderKey]);
    const rows = React.useMemo<SessionListRow[]>(() => flattenSessionListRows(
        displayedTree,
        sessionItems,
        folder => !collapsedFolders.has(folderPathKey(folder.path)),
    ), [collapsedFolders, displayedTree, sessionItems]);
    const sessions = React.useMemo(
        () => flattenSessionTree(displayedTree).flatMap(entry => sessionItems.get(entry.path) ?? []),
        [displayedTree, sessionItems],
    );

    const invalidItems = React.useMemo<InvalidSessionItem[]>(() => [...invalidSessions.values()].map(invalid => {
        const location = storageReader.getSessionLocation(invalid.sessionId);
        return {
            sessionId: invalid.sessionId,
            label: invalid.title,
            path: displayPath(invalid.sessionId, location),
            isNative: location.type === StorageBackendType.Native,
            invalidReason: describeSessionValidationError(invalid.error),
        };
    }), [invalidSessions, storageReader]);
    const sessionCount = sessions.length + invalidItems.length;
    // The references follow the scripts registry
    const connectionRows = React.useMemo(
        () => listedConnections(databaseRegistry, references, sessionConnectionRows),
        [databaseRegistry, references, scriptsRegistry, sessionConnectionRows],
    );
    const sessionConnectionIds = React.useMemo(
        () => new Set(sessionConnectionRows.map(database => database.connectionId)),
        [sessionConnectionRows],
    );
    const ordinals = React.useMemo(
        () => connectionOrdinals(databaseRegistry, references),
        [databaseRegistry, references, scriptsRegistry],
    );
    const labelOf = React.useCallback(
        (database: ConnectionState) => connectionLabelParts(database, ordinals.get(database.connectionId) ?? null),
        [ordinals],
    );
    const connectionCount = connectionRows.length;
    const describeUsage = React.useCallback((connectionId: string): ConnectionUsage => {
        const sessionIds = references.sessionsOf(connectionId);
        const database = databaseRegistry.connections.get(connectionId);
        const scriptsOf = (sessionId: string) => {
            const scripts = scriptsRegistry.sessionScriptsMap.get(sessionId);
            return scripts == null ? 0 : scriptsOnConnection(scripts, connectionId);
        };
        return {
            sessionCount: sessionIds.length,
            // The sessions fall back to the embedded Hyper, every session that uses it keeps it
            blockingSessionCount: database != null && isHyperWasmConnection(database)
                ? sessionIds.length
                : sessionIds.filter(sessionId => scriptsOf(sessionId) > 0).length,
            usedHere: sessionConnectionRows.some(database => database.connectionId === connectionId),
        };
    }, [databaseRegistry, props.sessionScripts.sessionId, sessionConnectionRows, references, scriptsRegistry]);
    const initiallyExpanded = React.useCallback((database: ConnectionState, _count: number) => (
        sessionConnectionRows.includes(database)
        && isConnectionInitiallyExpanded(database, sessionConnectionRows.length)
    ), [sessionConnectionRows]);

    const dndSensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );
    /// Change the session tree: the change shows right away, the write follows the earlier ones, then the
    /// sidebar shows the tree as it is stored. A write that fails, e.g. a taken folder name, is logged.
    const changeSessionTree = React.useCallback((
        what: string,
        write: (folders: NonNullable<typeof storageReader.sessionFolders>) => Promise<void>,
        optimistic?: (tree: SessionTreeFolder) => SessionTreeFolder,
    ) => {
        const sessionFolders = storageReader.sessionFolders;
        if (sessionFolders == null) return;
        if (optimistic != null) setSessionTree(optimistic);
        treeWriteRef.current = treeWriteRef.current
            .catch(() => {})
            .then(() => write(sessionFolders))
            .catch(error => logger.warn(`failed to ${what}`, { error: String(error) }, 'session_workbench'))
            .then(() => setSessionTree(sessionFolders.getSessionTree()));
    }, [logger, storageReader.sessionFolders]);

    const moveSession = React.useCallback((sessionId: string, folderPath: string[], index: number) => {
        changeSessionTree(
            'move the session',
            folders => folders.moveSession(sessionId, folderPath, index),
            tree => moveSessionInTree(tree, sessionId, folderPath, index),
        );
    }, [changeSessionTree]);

    /// Where the dragged row would land
    const dropOf = React.useCallback((event: DragMoveEvent | DragEndEvent): SessionListDrop | null => {
        if (event.over == null) return null;
        const dragged = event.active.rect.current.translated;
        const middle = event.over.rect.top + event.over.rect.height / 2;
        const aboveMiddle = dragged != null && dragged.top + dragged.height / 2 < middle;
        return resolveSessionListDrop(rows, displayedTree, String(event.active.id), String(event.over.id), aboveMiddle);
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
        if (active.kind === 'session') {
            moveSession(active.item.sessionId, target.folderPath, target.index);
        } else {
            const path = active.folder.path;
            changeSessionTree('move the folder', folders => folders.moveFolder(path, target.folderPath));
        }
    }, [changeSessionTree, dropOf, endDrag, moveSession, rows]);

    const toggleFolder = React.useCallback((folder: SessionTreeFolder) => {
        const key = folderPathKey(folder.path);
        setCollapsedFolders(current => {
            const next = new Set(current);
            if (current.has(key)) next.delete(key); else next.add(key);
            return next;
        });
    }, []);

    const toggleSession = React.useCallback((sessionId: string) => {
        setExpandedSessions(current => {
            const next = new Set(current);
            if (current.has(sessionId)) next.delete(sessionId); else next.add(sessionId);
            return next;
        });
    }, []);

    /// Create a folder with a free name and edit its name
    const createFolder = React.useCallback((parentPath: string[]) => {
        const parent = folderAt(sessionTree, parentPath);
        if (parent == null) return;
        const path = [...parentPath, freeFolderName(parent.folders.map(folder => folder.name))];
        setCollapsedFolders(current => {
            const next = new Set(current);
            next.delete(folderPathKey(parentPath));
            return next;
        });
        setRenamingFolder(folderPathKey(path));
        changeSessionTree('create the folder', folders => folders.createFolder(path));
    }, [changeSessionTree, sessionTree]);

    const renameFolder = React.useCallback((folder: SessionTreeFolder, input: string) => {
        setRenamingFolder(null);
        const name = input.trim();
        if (name === folder.name) return;
        const parentPath = folder.path.slice(0, -1);
        const siblings = (folderAt(sessionTree, parentPath)?.folders ?? [])
            .map(sibling => sibling.name)
            .filter(sibling => sibling !== folder.name);
        const error = folderNameError(name, siblings);
        if (error != null) {
            logger.warn('failed to rename the folder', { error }, 'session_workbench');
            return;
        }
        changeSessionTree('rename the folder', folders => folders.moveFolder(folder.path, parentPath, name));
    }, [changeSessionTree, logger, sessionTree]);

    const deleteFolder = React.useCallback((folder: SessionTreeFolder) => {
        const count = flattenSessionTree(folder).length;
        const into = folder.path.length > 1 ? `"${folder.path[folder.path.length - 2]}"` : 'the top level';
        const sessionsNote = count === 0 ? '' : ` Its ${count === 1 ? 'session moves' : `${count} sessions move`} to ${into}.`;
        if (!window.confirm(`Delete the folder "${folder.name}"?${sessionsNote}`)) return;
        changeSessionTree('delete the folder', folders => folders.deleteFolder(folder.path));
    }, [changeSessionTree]);

    /// Create a session on the embedded Hyper, or on the Hyper of the link that the app was opened with.
    /// Its scripts attach other connections.
    const createNewSession = React.useCallback((folderPath: string[] = []) => {
        const { sessionId } = createSession(resolveNewSessionConnection(props.sessionScripts.instance));
        if (folderPath.length > 0) moveSession(sessionId, folderPath, Number.MAX_SAFE_INTEGER);
        navigate({ type: SELECT_SESSION, value: sessionId });
        props.closeAfterSelection?.();
    }, [createSession, moveSession, navigate, props.closeAfterSelection, props.sessionScripts.instance, resolveNewSessionConnection]);

    /// Create a connection and open its settings, the next script of the current session runs on it
    const createConnection = React.useCallback((connector: ConnectorType) => {
        setCreateConnectionOpen(false);
        const params = createAttachedConnectionParamsForConnector(CONNECTOR_INFOS[connector]);
        const initialDatabase = dependencies.createConnectionStateFromParams(props.sessionScripts.instance, params);
        const database = allocateConnection({ ...initialDatabase, active: true });
        void modifyCurrentSession({ type: SET_PENDING_CONNECTION, value: scriptConnectionOf(database) });
        connectionSettingsAnchorRef.current = createConnectionButtonRef.current;
        setConnectionOverlayDatabaseId(database.connectionId);
    }, [allocateConnection, dependencies, modifyCurrentSession, props.sessionScripts.instance]);

    /// Rename a connection, a blank name restores the default label
    const renameConnection = React.useCallback((connectionId: string, name: string) => {
        connectionDispatch(connectionId, { type: RENAME_CONNECTION, value: name });
    }, [connectionDispatch]);

    /// Delete a connection that no script uses, other than the embedded Hyper that sessions fall back to.
    /// The sessions whose new scripts default to the connection are detached from it first.
    const deleteConnection = React.useCallback((connectionId: string) => {
        const database = databaseRegistry.connections.get(connectionId);
        if (database == null || isHyperWasmConnection(database) || describeUsage(connectionId).blockingSessionCount > 0) return;
        if (!window.confirm(`Delete the connection "${connectionLabelText(labelOf(database))}"?`)) return;
        detachConnectionFromSessions(props.sessionScripts.instance, connectionId)
            .then(() => shutDownAndDeleteConnection(connectionId))
            .catch(error => {
                logger.warn('failed to delete the connection', { connectionId, error: String(error) }, 'session_workbench');
            });
    }, [databaseRegistry, describeUsage, detachConnectionFromSessions, labelOf, logger, props.sessionScripts.instance, shutDownAndDeleteConnection]);

    /// The number of duplicates of a connection
    const mergeCandidateCount = React.useCallback(
        (connectionId: string) => connectionMergeCandidates(databaseRegistry, references, connectionId).length,
        [databaseRegistry, references, scriptsRegistry],
    );
    /// Merge the duplicates of a connection into it, their sessions move to the connection
    const mergeDuplicates = React.useCallback((connectionId: string) => {
        const database = databaseRegistry.connections.get(connectionId);
        const duplicates = connectionMergeCandidates(databaseRegistry, references, connectionId);
        if (database == null || duplicates.length === 0) return;
        const what = duplicates.length === 1 ? 'its duplicate' : `its ${duplicates.length} duplicates`;
        if (!window.confirm(`Merge ${what} into the connection "${connectionLabelText(labelOf(database))}"?`)) return;
        mergeConnections(connectionId, duplicates.map(duplicate => duplicate.connectionId)).catch(error => {
            logger.warn('failed to merge connections', { connectionId, error: String(error) }, 'session_workbench');
        });
    }, [databaseRegistry, labelOf, logger, mergeConnections, references]);

    /// What keeps a connection from being replaced, the picker offers every other listed connection
    const replaceBlocker = React.useCallback(
        (connectionId: string) => connectionReplaceBlocker(databaseRegistry, references, connectionId, sessionId => storageWriter.isSessionPaused(sessionId)),
        [databaseRegistry, references, scriptsRegistry, storageWriter],
    );
    const replaceCandidates = React.useCallback(
        (connectionId: string) => connectionReplaceCandidates(databaseRegistry, references, connectionId),
        [databaseRegistry, references, scriptsRegistry],
    );
    /// Replace a connection with another one in every session, the connection is removed afterwards
    const replaceWith = React.useCallback((connectionId: string, targetId: string) => {
        replaceConnection(connectionId, targetId)
            .then(({ removed }) => {
                if (!removed) logger.warn('the replaced connection is still in use', { connectionId, target: targetId }, 'session_workbench');
            })
            .catch(error => {
                logger.warn('failed to replace the connection', { connectionId, target: targetId, error: String(error) }, 'session_workbench');
            });
    }, [logger, replaceConnection]);

    const closeConnectionOverlay = React.useCallback(() => {
        setConnectionOverlayDatabaseId(null);
        if (route.sessionSetupStatus === SessionSetupStatus.CONFIGURING && route.sessionId != null) {
            navigate({ type: SELECT_SESSION, value: route.sessionId });
        }
    }, [navigate, route.sessionId, route.sessionSetupStatus]);

    const duplicateSession = React.useCallback(async (item: SessionItem) => {
        const newSessionId = crypto.randomUUID();
        try {
            const coreInstance = await setupCore('session_duplicate');
            await cloneSession(item.sessionId, storageReader.backend, storageWriter.backend, newSessionId, logger);
            const restored = await restoreSingleSession(
                coreInstance,
                storageWriter.backend,
                logger,
                newSessionId,
                databaseRegistry,
            );
            setDatabaseRegistry(registry => mergeRestoredSessionIntoConnections(registry, restored));
            setScriptsRegistry(registry => mergeRestoredSessionIntoScripts(registry, restored));
        } catch (error) {
            logger.warn('failed to duplicate session', {
                sessionId: item.sessionId,
                error: String(error),
            }, 'session_workbench');
        }
    }, [databaseRegistry, logger, setDatabaseRegistry, setScriptsRegistry, setupCore, storageReader.backend, storageWriter.backend]);

    const openSessionFolder = React.useCallback(async () => {
        if (storageReader.sessionFolders == null) return;
        if (platform === PlatformType.WEB) {
            folderInputRef.current?.click();
            return;
        }
        const folder = await globalThis.dashqlElectron?.openDirectory('Open an existing session folder');
        if (folder == null) return;
        try {
            await sessionImport.importNativeFolder(folder, {
                mode: 'anchored',
                anchorRef: folderButtonRef,
                returnFocusRef: folderButtonRef,
            });
        } catch (error) {
            logger.error('adding native session from folder failed', { error: String(error) }, 'session_workbench');
        }
    }, [logger, sessionImport, platform, storageReader.sessionFolders]);

    const openBrowserSessionFolder = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const input = event.currentTarget;
        if (input.files == null || input.files.length === 0) return;
        try {
            const bundle = await readSessionBundleFromBrowserFolder(input.files);
            await sessionImport.importPortableBundle(bundle, {
                presentation: {
                    mode: 'anchored',
                    anchorRef: folderButtonRef,
                    returnFocusRef: folderButtonRef,
                },
            });
        } catch (error) {
            logger.error('adding browser session folder failed', { error: String(error) }, 'session_workbench');
        } finally {
            input.value = '';
        }
    }, [logger, sessionImport]);

    const deleteSession = React.useCallback(async (item: SessionItem) => {
        const action = item.isNative ? 'Unlink' : 'Delete';
        if (!window.confirm(`${action} "${item.label}"?${item.isNative ? ' The folder and its files will remain on disk.' : ''}`)) return;
        try {
            await storageWriter.deleteSession(item.sessionId);
        } catch (error) {
            console.error('Failed to delete session from storage:', error);
            return;
        }
        deleteSessionScripts(item.sessionId);
        // Connections outlive the sessions that reference them, only the session's own
        // computations are dropped.
        for (const database of item.connections) {
            for (const queryId of findSessionQueries(database, item.sessionId)) {
                computationDispatch({ type: DELETE_COMPUTATION, value: [queryId] });
            }
        }

        if (item.sessionId === props.sessionScripts.sessionId) {
            const next = sessions.find(session => session.sessionId !== item.sessionId);
            if (next != null) navigate({ type: OPEN_SESSION, value: next.sessionId });
        }
    }, [computationDispatch, deleteSessionScripts, navigate, sessions, props.sessionScripts.sessionId, storageWriter]);

    const openSession = React.useCallback((item: SessionItem) => {
        navigate({ type: SELECT_SESSION, value: item.sessionId });
        props.onOpenOverview?.(null);
        props.closeAfterSelection?.();
    }, [navigate, props.closeAfterSelection, props.onOpenOverview]);
    /// Open a session at one of its scripts, the session row selects the script
    const openScript = React.useCallback((item: SessionItem, fileName: string) => {
        navigate({ type: SELECT_SESSION, value: item.sessionId });
        props.onOpenOverview?.(null);
        props.onOpenScript?.(item.sessionId, fileName);
        props.closeAfterSelection?.();
    }, [navigate, props.closeAfterSelection, props.onOpenOverview, props.onOpenScript]);
    const onOpenOverview = props.onOpenOverview;
    const closeAfterSelection = props.closeAfterSelection;
    const openOverview = React.useMemo(() => onOpenOverview == null ? undefined : (connectionId: string) => {
        onOpenOverview(connectionId);
        closeAfterSelection?.();
    }, [onOpenOverview, closeAfterSelection]);
    const sessionListRef = React.useRef<HTMLUListElement>(null);
    const getSessionScrollElement = React.useCallback(() => sessionListRef.current, []);

    return (
        <nav className={styles.workbench} aria-label="Session workbench" data-electron-drag-region>
            <VerticalSplit
                className={styles.section_split}
                separatorClassName={styles.section_separator}
                separatorSize={SECTION_SEPARATOR_SIZE}
                defaultRatio={0.42}
                minFirstSize={SECTION_MIN_SIZE}
                minSecondSize={SECTION_MIN_SIZE}
                separatorLabel="Resize sessions and connections"
                first={(
                    <section className={styles.section} aria-labelledby="workbench-sessions-heading">
                        <header className={styles.section_header}>
                            <div className={styles.section_title}>
                                <h2 id="workbench-sessions-heading" className={styles.section_heading}>Sessions</h2>
                                <span
                                    className={styles.section_count}
                                    data-testid="session-count"
                                    aria-label={`${sessionCount} ${sessionCount === 1 ? 'session' : 'sessions'}`}
                                >
                                    {sessionCount}
                                </span>
                            </div>
                            <div className={styles.section_actions}>
                                {storageReader.sessionFolders != null && (
                                    <>
                                        <IconButton
                                            ref={folderButtonRef}
                                            size={ButtonSize.Small}
                                            variant={ButtonVariant.Invisible}
                                            aria-label="Open session folder"
                                            onClick={openSessionFolder}
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
                                                onChange={openBrowserSessionFolder}
                                            />
                                        )}
                                    </>
                                )}
                                {storageReader.sessionFolders != null && (
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
                                    data-testid="create-session"
                                    size={ButtonSize.Small}
                                    variant={ButtonVariant.Invisible}
                                    aria-label="Create session"
                                    onClick={() => createNewSession()}
                                ><StackPlusIcon size={14} /></IconButton>
                            </div>
                        </header>
                        <div className={styles.scroll_shadow_container}>
                            <DndContext
                                sensors={dndSensors}
                                collisionDetection={SESSION_LIST_COLLISIONS}
                                modifiers={[VERTICAL_DRAG]}
                                onDragMove={showDrop}
                                onDragEnd={dropRow}
                                onDragCancel={endDrag}
                            >
                                <SortableContext items={rows.map(row => row.id)} strategy={KEEP_ROWS_IN_PLACE}>
                                    <ul ref={sessionListRef} className={styles.session_list} aria-label="Sessions" data-electron-drag-region="false">
                                        {rows.map(row => row.kind === 'folder' ? (
                                            <SessionFolderRow
                                                key={row.id}
                                                rowId={row.id}
                                                folder={row.folder}
                                                depth={row.depth}
                                                expanded={row.expanded}
                                                renaming={renamingFolder === folderPathKey(row.folder.path)}
                                                onToggle={() => toggleFolder(row.folder)}
                                                onStartRename={() => setRenamingFolder(folderPathKey(row.folder.path))}
                                                onRename={name => renameFolder(row.folder, name)}
                                                onCancelRename={() => setRenamingFolder(null)}
                                                onNewSession={() => createNewSession(row.folder.path)}
                                                onMoveToTopLevel={row.depth === 0 ? null : () => changeSessionTree('move the folder', folders => folders.moveFolder(row.folder.path, []))}
                                                onDelete={() => deleteFolder(row.folder)}
                                                dropTarget={drop?.targetId === row.id}
                                            />
                                        ) : (
                                            <SessionRow
                                                key={row.id}
                                                item={row.item}
                                                depth={row.depth}
                                                // An open connection overview replaces the session
                                                selected={props.openOverviewId == null && row.item.sessionId === props.sessionScripts.sessionId}
                                                onOpen={() => openSession(row.item)}
                                                onDuplicate={() => { void duplicateSession(row.item); }}
                                                onDelete={() => { void deleteSession(row.item); }}
                                                dropPosition={drop?.targetId === row.id && drop.position !== 'into' ? drop.position : null}
                                                expanded={expandedSessions.has(row.item.sessionId)}
                                                onToggle={() => toggleSession(row.item.sessionId)}
                                                onOpenScript={fileName => openScript(row.item, fileName)}
                                                dependencies={dependencies}
                                            />
                                        ))}
                                        {invalidItems.map(item => (
                                            <InvalidSessionRow
                                                key={item.sessionId}
                                                item={item}
                                                onDelete={() => { void deleteInvalidSession(item.sessionId); }}
                                            />
                                        ))}
                                        {storageReader.sessionFolders != null && (
                                            <TopLevelDropZone targeted={drop?.targetId === TOP_LEVEL_DROP_ID} />
                                        )}
                                    </ul>
                                </SortableContext>
                            </DndContext>
                            <VerticalScrollShadows
                                getScrollElement={getSessionScrollElement}
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
                                                        <use xlinkHref={`${symbols}#${connectorIcon(CONNECTOR_INFOS[connector])}`} />
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
                                sessionConnectionIds={sessionConnectionIds}
                                labelOf={labelOf}
                                attention={connectionAttention?.active === true}
                                onOpenOverview={openOverview}
                                openOverviewId={props.openOverviewId ?? null}
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
                renderSessionName={renderSessionName}
            />
        </nav>
    );
};
