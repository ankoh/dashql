import * as React from 'react';
import symbols from '@ankoh/dashql-svg-symbols';
import {
    DndContext,
    KeyboardSensor,
    PointerSensor,
    pointerWithin,
    useDraggable,
    useDroppable,
    useSensor,
    useSensors,
    type DragEndEvent,
    type DragOverEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';

import * as ActionList from '../ui/foundations/action_list.js';
import { AnchorAlignment, AnchorSide } from '../ui/foundations/anchored_position.js';
import { AnchoredOverlay } from '../ui/foundations/anchored_overlay.js';
import { Button, ButtonSize, ButtonVariant, IconButton } from '../ui/foundations/button.js';
import {
    ChevronDownIcon,
    ChevronRightIcon,
    DownloadIcon,
    EyeIcon,
    FileDirectoryFillIcon,
    FileDirectoryOpenFillIcon,
    FileDirectoryPlusIcon,
    HistoryIcon,
    PencilIcon,
    StackIcon,
    SymbolIcon,
    SyncIcon,
    ToolsIcon,
    TrashIcon,
} from '../ui/foundations/symbol_icon.js';
import { useRowContextMenu, useRowContextMenuOpener, type RowContextMenu } from '../ui/foundations/row_context_menu.js';
import { classNames } from '../utils/classnames.js';
import { formatTimeDifference } from '../utils/format.js';
import { useLogger } from '../platform/logger/logger_provider.js';
import { stringifyError } from '../platform/logger/logger.js';
import { useCloudConnection } from '../connections/cloud_connection.js';
import { ConnectionHealth } from '../connections/connection_state.js';
import { useWorkbookScriptsRegistry } from '../workbook/scripts/workbook_scripts_registry.js';
import { isCloudPreview, workbookCloudLink } from '../workbook/scripts/workbook_scripts.js';
import { startsRowDrag, workbookListRowPadding } from '../workbook/workbook_folder_row.js';
import { freeFolderName } from '../storage/workbook_tree.js';
import { NameInput } from '../ui/foundations/name_input.js';
import * as sidebarStyles from '../workbook/workbook_workbench_sidebar.module.css';
import * as actionMenuStyles from '../app/action_menu.module.css';
import * as styles from './cloud_workbook_folder.module.css';
import type { CloudFolder, CloudFolderNode } from './cloud_folders.js';
import type { CloudWorkbook, CloudWorkbookVersion } from './cloud_store.js';
import { useCloudState } from './cloud_state.js';
import { useCloudWorkbooks } from './cloud_workbooks.js';
import { useCloudLogin, useLocalCloudAutoLogin } from './cloud_login.js';

// The published workbooks of the cloud in the workbook list of the sidebar: a folder at the top level, above the folder
// of the local workbooks, with the folders and workbooks of the cloud inside. See docs/design/cloud.md.
//
// A click on a workbook opens its latest version read-only, its caret lists the versions and a click on a version opens
// that one. The menu of a row imports a version as a local workbook or deletes the published workbook. The menu of the
// cloud creates folders, a workbook is dragged into a folder or onto the cloud to move it to the top.

const LOG_CTX = 'cloud_sidebar';
const MoreIcon = SymbolIcon('kebab_horizontal');
/// The drop target of the top of the cloud
const CLOUD_TOP_DROP_ID = 'cloud-top';

/// Where a dragged published workbook lands: a folder, the top without one
interface CloudDropData {
    folderId: string | null;
}
/// The dragged published workbook and the folder it is in
interface CloudDragData {
    workbook: CloudWorkbook;
    folderId: string | null;
}

interface Props {
    /// The workbook that the workbench shows, null while it shows something else, e.g. a connection overview
    currentWorkbookId: string | null;
    /// A workbook was opened from the folder
    onOpened?: () => void;
}

/// What the folder says while it lists no workbooks
function folderState(cloud: ReturnType<typeof useCloudState>, connectionName: string): { text: string; setup: boolean; login?: boolean } | null {
    if (!cloud.online) return { text: `${connectionName} is not connected`, setup: false, login: true };
    if (cloud.tree != null) return null;
    if (cloud.error != null) return { text: cloud.error, setup: true };
    if (cloud.loading || cloud.installation == null) return { text: 'Looking at the cloud', setup: false };
    switch (cloud.installation.state) {
        case 'unreachable': return { text: 'The connection reaches no database of DashQL', setup: true };
        case 'missing': return { text: 'DashQL is not installed in the cloud', setup: true };
        case 'newer': return { text: 'A newer DashQL updated the cloud, update DashQL to read it', setup: false };
        default: return { text: 'This DashQL may not read the cloud', setup: true };
    }
}

/// The rows of the cloud in the workbook list, an <li> each
export const CloudWorkbookFolder: React.FC<Props> = (props) => {
    const cloud = useCloudState();
    const connection = useCloudConnection();
    const workbooks = useCloudWorkbooks();
    const logger = useLogger();
    const [registry] = useWorkbookScriptsRegistry();
    // The local cloud needs no credentials, it logs in without a click like in the Cloud overlay
    const login = useCloudLogin(connection?.connectionId ?? null);
    useLocalCloudAutoLogin(connection, login);

    // The published workbook and version that the workbench shows
    const current = props.currentWorkbookId == null ? null : registry.workbookScriptsMap.get(props.currentWorkbookId) ?? null;
    const currentLink = current == null ? null : workbookCloudLink(current);
    const currentPreview = current != null && isCloudPreview(current);

    // The cloud and its folders are collapsed at first, the number of its workbooks shows on its row
    const [expanded, setExpanded] = React.useState(false);
    const [expandedFolders, setExpandedFolders] = React.useState<ReadonlySet<string>>(new Set());
    const [expandedWorkbook, setExpandedWorkbook] = React.useState<string | null>(null);
    const [versions, setVersions] = React.useState<CloudWorkbookVersion[] | null>(null);
    // The published workbook that is being opened
    const [opening, setOpening] = React.useState<string | null>(null);
    // The folder whose name is being edited
    const [renamingFolder, setRenamingFolder] = React.useState<string | null>(null);
    // The drop target under a dragged workbook
    const [dropTarget, setDropTarget] = React.useState<string | null>(null);
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
        useSensor(KeyboardSensor),
    );

    // The versions of the expanded workbook, listed again when the cloud was looked at again
    const listVersions = workbooks.listVersions;
    const versionsShown = expanded && expandedWorkbook != null;
    React.useEffect(() => {
        setVersions(null);
        if (!versionsShown || expandedWorkbook == null) return;
        const controller = new AbortController();
        listVersions(expandedWorkbook, controller.signal)
            .then(listed => { if (!controller.signal.aborted) setVersions(listed); })
            .catch(error => {
                if (controller.signal.aborted) return;
                logger.error('Listing the versions of a published workbook failed', { cloudWorkbookId: expandedWorkbook, error: stringifyError(error) }, LOG_CTX);
            });
        return () => controller.abort();
    }, [versionsShown, expandedWorkbook, listVersions, cloud.tree, logger]);

    const open = React.useCallback(async (workbook: CloudWorkbook, options: { versionId?: string; preview: boolean }) => {
        setOpening(workbook.workbookId);
        try {
            const opened = await workbooks.open(workbook.workbookId, { ...options, name: workbook.name ?? 'Untitled' });
            if (opened != null) props.onOpened?.();
        } catch (error) {
            logger.error(`Opening "${workbook.name ?? 'a published workbook'}" failed`, { cloudWorkbookId: workbook.workbookId, error: stringifyError(error) }, LOG_CTX);
        } finally {
            setOpening(null);
        }
    }, [logger, props.onOpened, workbooks]);

    const remove = React.useCallback(async (workbook: CloudWorkbook) => {
        const name = workbook.name ?? 'Untitled';
        if (!window.confirm(`Delete "${name}" from the cloud? It can be restored for 30 days.`)) return;
        try {
            await workbooks.remove(workbook.workbookId);
        } catch (error) {
            logger.error(`Deleting "${name}" from the cloud failed`, { cloudWorkbookId: workbook.workbookId, error: stringifyError(error) }, LOG_CTX);
        }
    }, [logger, workbooks]);

    const toggleFolder = React.useCallback((folderId: string) => setExpandedFolders(expanded => {
        const next = new Set(expanded);
        if (!next.delete(folderId)) next.add(folderId);
        return next;
    }), []);

    /// Create a folder with a free name and edit its name
    const createFolder = React.useCallback(async () => {
        if (cloud.tree == null) return;
        setExpanded(true);
        try {
            const folder = await workbooks.createFolder(freeFolderName(cloud.tree.folders.map(node => node.folder.name)));
            setRenamingFolder(folder.folderId);
        } catch (error) {
            logger.error('Creating a cloud folder failed', { error: stringifyError(error) }, LOG_CTX);
        }
    }, [cloud.tree, logger, workbooks]);
    const renameFolder = React.useCallback(async (folder: CloudFolder, input: string) => {
        setRenamingFolder(null);
        const name = input.trim();
        if (name.length === 0 || name === folder.name) return;
        try {
            await workbooks.renameFolder(folder.folderId, name);
        } catch (error) {
            logger.error(`Renaming the folder "${folder.name}" failed`, { folderId: folder.folderId, error: stringifyError(error) }, LOG_CTX);
        }
    }, [logger, workbooks]);
    const deleteFolder = React.useCallback(async (node: CloudFolderNode) => {
        const what = node.workbooks.length === 0 ? '' : ' Its workbooks move to the top of the cloud.';
        if (!window.confirm(`Delete the folder "${node.folder.name}"?${what}`)) return;
        try {
            await workbooks.deleteFolder(node.folder.folderId);
        } catch (error) {
            logger.error(`Deleting the folder "${node.folder.name}" failed`, { folderId: node.folder.folderId, error: stringifyError(error) }, LOG_CTX);
        }
    }, [logger, workbooks]);

    // A dragged workbook moves into the folder under it, or to the top over the cloud
    const showDrop = React.useCallback((event: DragOverEvent) => {
        const from = (event.active.data.current as CloudDragData | undefined)?.folderId ?? null;
        const to = event.over?.data.current as CloudDropData | undefined;
        setDropTarget(to == null || to.folderId === from ? null : String(event.over!.id));
    }, []);
    const drop = React.useCallback((event: DragEndEvent) => {
        setDropTarget(null);
        const dragged = event.active.data.current as CloudDragData | undefined;
        const to = event.over?.data.current as CloudDropData | undefined;
        if (dragged == null || to == null || to.folderId === dragged.folderId) return;
        const name = dragged.workbook.name ?? 'Untitled';
        // A moved workbook shows in its folder
        if (to.folderId != null) setExpandedFolders(expanded => new Set(expanded).add(to.folderId!));
        workbooks.move(dragged.workbook.workbookId, to.folderId).catch(error => {
            logger.error(`Moving "${name}" failed`, { cloudWorkbookId: dragged.workbook.workbookId, error: stringifyError(error) }, LOG_CTX);
        });
    }, [logger, workbooks]);

    const tree = cloud.tree;
    const count = tree == null ? 0 : tree.workbooks.length + tree.folders.reduce((sum, node) => sum + node.workbooks.length, 0);
    const state = folderState(cloud, connection?.name ?? 'The cloud connection');
    const online = connection?.connectionHealth === ConnectionHealth.ONLINE;

    const renderWorkbook = (workbook: CloudWorkbook, depth: number, folderId: string | null) => {
        const versionsExpanded = expandedWorkbook === workbook.workbookId;
        const linked = currentLink?.workbookId === workbook.workbookId;
        return (
            <React.Fragment key={workbook.workbookId}>
                <CloudWorkbookRow
                    workbook={workbook}
                    folderId={folderId}
                    depth={depth}
                    expanded={versionsExpanded}
                    selected={linked && currentPreview && !versionsExpanded}
                    linked={linked && !currentPreview}
                    opening={opening === workbook.workbookId}
                    onToggle={() => setExpandedWorkbook(versionsExpanded ? null : workbook.workbookId)}
                    onOpen={() => { void open(workbook, { preview: true }); }}
                    onImport={() => { void open(workbook, { preview: false }); }}
                    onDelete={() => { void remove(workbook); }}
                />
                {versionsExpanded && versions == null && (
                    <li className={styles.note} style={{ paddingLeft: workbookListRowPadding(depth + 1) }}>Listing the versions</li>
                )}
                {versionsExpanded && versions?.map(version => (
                    <CloudVersionRow
                        key={version.versionId}
                        version={version}
                        latest={version.versionId === workbook.versionId}
                        depth={depth + 1}
                        selected={linked && currentPreview && currentLink?.versionId === version.versionId}
                        onOpen={() => { void open(workbook, { versionId: version.versionId, preview: true }); }}
                        onImport={() => { void open(workbook, { versionId: version.versionId, preview: false }); }}
                    />
                ))}
            </React.Fragment>
        );
    };
    const renderFolder = (node: CloudFolderNode) => {
        const folderExpanded = expandedFolders.has(node.folder.folderId);
        return (
            <React.Fragment key={node.folder.folderId}>
                <CloudFolderRow
                    node={node}
                    expanded={folderExpanded}
                    renaming={renamingFolder === node.folder.folderId}
                    dropTarget={dropTarget === `cloud-folder:${node.folder.folderId}`}
                    onToggle={() => toggleFolder(node.folder.folderId)}
                    onStartRename={() => setRenamingFolder(node.folder.folderId)}
                    onRename={name => { void renameFolder(node.folder, name); }}
                    onCancelRename={() => setRenamingFolder(null)}
                    onDelete={() => { void deleteFolder(node); }}
                />
                {folderExpanded && node.workbooks.map(workbook => renderWorkbook(workbook, 2, node.folder.folderId))}
            </React.Fragment>
        );
    };

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={pointerWithin}
            onDragOver={showDrop}
            onDragEnd={drop}
            onDragCancel={() => setDropTarget(null)}
            // The announcements go to the body, the rows are items of the workbook list
            accessibility={{ container: document.body }}
        >
            <CloudRootRow
                title={connection?.name ?? 'Cloud'}
                expanded={expanded}
                count={tree == null ? null : count}
                dropTarget={dropTarget === CLOUD_TOP_DROP_ID}
                onToggle={() => setExpanded(value => !value)}
                items={[
                    { action: 'new-folder', icon: FileDirectoryPlusIcon, text: 'New folder', run: () => { void createFolder(); }, disabled: !workbooks.ready },
                    { action: 'refresh', icon: SyncIcon, text: 'Refresh', run: () => { void cloud.refresh(); }, disabled: !online || cloud.loading },
                    { action: 'setup', icon: ToolsIcon, text: 'Cloud setup', run: cloud.openSetup },
                ]}
            />
            {expanded && state != null && (
                <li className={styles.state} style={{ paddingLeft: workbookListRowPadding(1) }} data-testid="cloud-folder-state">
                    <span className={styles.state_text}>{state.text}</span>
                    {state.login && (
                        <Button size={ButtonSize.Small} variant={ButtonVariant.Default} disabled={!login.available}
                            onClick={() => { void login.login(); }} data-testid="cloud-folder-log-in">Log In</Button>
                    )}
                    {state.setup && (
                        <Button size={ButtonSize.Small} variant={ButtonVariant.Default} onClick={cloud.openSetup}>Set Up Cloud</Button>
                    )}
                </li>
            )}
            {expanded && tree?.folders.map(renderFolder)}
            {expanded && tree?.workbooks.map(workbook => renderWorkbook(workbook, 1, null))}
        </DndContext>
    );
};

interface CloudRootRowProps {
    /// The name of the cloud connection
    title: string;
    expanded: boolean;
    /// The number of published workbooks, null while the cloud is not listed
    count: number | null;
    /// Would a dragged workbook move to the top?
    dropTarget: boolean;
    onToggle: () => void;
    items: CloudRowMenuItem[];
}

/// The cloud at the top level of the workbook list: caret, cloud icon, name, the number of published workbooks and a
/// menu. A workbook dropped on it moves to the top of the cloud.
const CloudRootRow: React.FC<CloudRootRowProps> = (props) => {
    const contextMenu = useRowContextMenu();
    const { setNodeRef } = useDroppable({ id: CLOUD_TOP_DROP_ID, data: { folderId: null } satisfies CloudDropData });
    const Caret = props.expanded ? ChevronDownIcon : ChevronRightIcon;
    return (
        <li
            ref={setNodeRef}
            className={classNames(sidebarStyles.entry_surface, sidebarStyles.entry_interactive, sidebarStyles.workbook_row, {
                [sidebarStyles.drop_into]: props.dropTarget,
            })}
            style={{ paddingLeft: workbookListRowPadding(0) }}
            data-testid="cloud-folder"
            onContextMenu={contextMenu.onContextMenu}
        >
            <button
                type="button"
                className={classNames(sidebarStyles.tree_button, sidebarStyles.root_button)}
                aria-expanded={props.expanded}
                title={props.title}
                onClick={props.onToggle}
            >
                <span className={sidebarStyles.tree_caret} aria-hidden="true"><Caret size={12} /></span>
                <svg width="14" height="14" aria-hidden="true"><use xlinkHref={`${symbols}#cloud`} /></svg>
                <span className={sidebarStyles.workbook_name}>Cloud</span>
                {props.count != null && (
                    <span
                        className={sidebarStyles.root_count}
                        data-testid="cloud-workbook-count"
                        aria-label={`${props.count} published ${props.count === 1 ? 'workbook' : 'workbooks'}`}
                    >{props.count}</span>
                )}
            </button>
            <CloudRowMenu label="Cloud" contextMenu={contextMenu} items={props.items} />
        </li>
    );
};

interface CloudFolderRowProps {
    node: CloudFolderNode;
    expanded: boolean;
    /// Is the name being edited?
    renaming: boolean;
    /// Would a dragged workbook move into the folder?
    dropTarget: boolean;
    onToggle: () => void;
    onStartRename: () => void;
    onRename: (name: string) => void;
    onCancelRename: () => void;
    onDelete: () => void;
}

/// A folder of the cloud: caret, folder icon, name, the number of its workbooks and a menu. A workbook dropped on it
/// moves into it.
const CloudFolderRow: React.FC<CloudFolderRowProps> = (props) => {
    const contextMenu = useRowContextMenu();
    const { folder } = props.node;
    const { setNodeRef } = useDroppable({ id: `cloud-folder:${folder.folderId}`, data: { folderId: folder.folderId } satisfies CloudDropData });
    const renameInputRef = React.useRef<HTMLInputElement>(null);
    React.useEffect(() => {
        if (!props.renaming) return;
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
    }, [props.renaming]);
    const Caret = props.expanded ? ChevronDownIcon : ChevronRightIcon;
    const FolderIcon = props.expanded ? FileDirectoryOpenFillIcon : FileDirectoryFillIcon;
    return (
        <li
            ref={setNodeRef}
            className={classNames(sidebarStyles.entry_surface, sidebarStyles.entry_interactive, sidebarStyles.workbook_row, {
                [sidebarStyles.drop_into]: props.dropTarget,
            })}
            style={{ paddingLeft: workbookListRowPadding(1) }}
            data-testid="cloud-folder-row"
            onContextMenu={contextMenu.onContextMenu}
        >
            {props.renaming ? (
                <div className={sidebarStyles.tree_rename}>
                    <span className={sidebarStyles.tree_caret} aria-hidden="true"><Caret size={12} /></span>
                    <FolderIcon size={14} aria-hidden="true" />
                    <NameInput
                        ref={renameInputRef}
                        className={sidebarStyles.workbook_rename_input}
                        name={folder.name}
                        onCommit={props.onRename}
                        onCancel={props.onCancelRename}
                        ariaLabel="Folder name"
                        placeholder="Name this folder"
                    />
                </div>
            ) : (
                <button type="button" className={classNames(sidebarStyles.tree_button, sidebarStyles.root_button)}
                    aria-expanded={props.expanded} onClick={props.onToggle}>
                    <span className={sidebarStyles.tree_caret} aria-hidden="true"><Caret size={12} /></span>
                    <FolderIcon size={14} aria-hidden="true" />
                    <span className={sidebarStyles.workbook_name}>{folder.name}</span>
                    <span className={sidebarStyles.root_count}>{props.node.workbooks.length}</span>
                </button>
            )}
            <CloudRowMenu
                label={`folder ${folder.name}`}
                contextMenu={contextMenu}
                items={[
                    { action: 'rename', icon: PencilIcon, text: 'Rename', run: props.onStartRename },
                    { action: 'delete', icon: TrashIcon, text: 'Delete folder', run: props.onDelete, danger: true },
                ]}
            />
        </li>
    );
};

interface CloudWorkbookRowProps {
    workbook: CloudWorkbook;
    /// The folder that lists the workbook, null at the top
    folderId: string | null;
    depth: number;
    expanded: boolean;
    /// Does the workbench show a preview of the workbook?
    selected: boolean;
    /// Does the workbench show a local workbook that is linked to the published workbook?
    linked: boolean;
    /// Is the workbook being opened?
    opening: boolean;
    onToggle: () => void;
    onOpen: () => void;
    onImport: () => void;
    onDelete: () => void;
}

/// A published workbook: caret for its versions, icon, name, when its latest version was published and a menu
const CloudWorkbookRow: React.FC<CloudWorkbookRowProps> = (props) => {
    const contextMenu = useRowContextMenu();
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: `cloud-workbook:${props.workbook.workbookId}`,
        data: { workbook: props.workbook, folderId: props.folderId } satisfies CloudDragData,
    });
    // A drag starts from the row itself, not from the overlays of its menu
    const rowListeners = React.useMemo(() => listeners == null ? undefined : Object.fromEntries(
        Object.entries(listeners).map(([eventName, handler]) => [eventName, (event: React.SyntheticEvent<HTMLElement>) => {
            if (startsRowDrag(event)) handler(event);
        }]),
    ), [listeners]);
    const Caret = props.expanded ? ChevronDownIcon : ChevronRightIcon;
    const name = props.workbook.name ?? 'Untitled';
    const publishedAt = props.workbook.readyAt == null ? null : new Date(props.workbook.readyAt);
    return (
        <li
            className={classNames(sidebarStyles.entry_surface, sidebarStyles.entry_interactive, sidebarStyles.workbook_row, {
                [sidebarStyles.entry_selected]: props.selected,
                [styles.linked]: props.linked,
                [styles.opening]: props.opening,
                [sidebarStyles.workbook_row_dragging]: isDragging,
            })}
            ref={setNodeRef}
            style={{ paddingLeft: workbookListRowPadding(props.depth), transform: CSS.Translate.toString(transform) }}
            data-testid="cloud-workbook-row"
            {...attributes}
            {...rowListeners}
            onContextMenu={contextMenu.onContextMenu}
        >
            <div className={styles.workbook_entry}>
                <button
                    type="button"
                    className={styles.caret_button}
                    aria-label={props.expanded ? `Hide the versions of ${name}` : `Show the versions of ${name}`}
                    aria-expanded={props.expanded}
                    onClick={props.onToggle}
                ><Caret size={12} /></button>
                <button
                    type="button"
                    className={styles.open_button}
                    aria-current={props.selected ? 'page' : undefined}
                    title={publishedAt == null ? name : `${name}, version ${props.workbook.version}, published ${publishedAt.toLocaleString()}`}
                    disabled={props.opening}
                    onClick={props.onOpen}
                >
                    <StackIcon size={14} aria-hidden="true" />
                    <span className={sidebarStyles.workbook_name}>{name}</span>
                </button>
            </div>
            <CloudRowMenu
                label={name}
                contextMenu={contextMenu}
                items={[
                    { action: 'open', icon: EyeIcon, text: 'Open read-only', run: props.onOpen },
                    { action: 'import', icon: DownloadIcon, text: 'Import', run: props.onImport },
                    { action: 'delete', icon: TrashIcon, text: 'Delete from cloud', run: props.onDelete, danger: true },
                ]}
            />
        </li>
    );
};

interface CloudVersionRowProps {
    version: CloudWorkbookVersion;
    /// Is it the latest version?
    latest: boolean;
    depth: number;
    selected: boolean;
    onOpen: () => void;
    onImport: () => void;
}

/// A version of a published workbook: its number, who published it and when
const CloudVersionRow: React.FC<CloudVersionRowProps> = (props) => {
    const contextMenu = useRowContextMenu();
    const publishedAt = props.version.readyAt == null ? null : new Date(props.version.readyAt);
    const label = `Version ${props.version.version}`;
    const details = [
        props.version.publishedBy == null ? null : `by ${props.version.publishedBy}`,
        publishedAt == null ? null : `${formatTimeDifference(publishedAt)} (${publishedAt.toLocaleString()})`,
    ].filter(Boolean).join(' ');
    return (
        <li
            className={classNames(sidebarStyles.entry_surface, sidebarStyles.entry_interactive, sidebarStyles.script_row, {
                [sidebarStyles.entry_selected]: props.selected,
            })}
            style={{ paddingLeft: workbookListRowPadding(props.depth) }}
            data-testid="cloud-version-row"
            onContextMenu={contextMenu.onContextMenu}
        >
            <button
                type="button"
                className={styles.version_button}
                aria-current={props.selected ? 'page' : undefined}
                // The row is too narrow for who published the version and when, the title tells it
                title={details.length === 0 ? label : `${label}, published ${details}`}
                onClick={props.onOpen}
            >
                <HistoryIcon size={14} aria-hidden="true" />
                <span className={sidebarStyles.script_name}>
                    v{props.version.version}{props.latest ? ' (latest)' : ''}
                </span>
            </button>
            <CloudRowMenu
                label={label}
                contextMenu={contextMenu}
                items={[
                    { action: 'open', icon: EyeIcon, text: 'Open read-only', run: props.onOpen },
                    { action: 'import', icon: DownloadIcon, text: 'Import this version', run: props.onImport },
                ]}
            />
        </li>
    );
};

interface CloudRowMenuItem {
    action: string;
    icon: React.ElementType;
    text: string;
    run: () => void;
    danger?: boolean;
    disabled?: boolean;
}

/// The menu of a row of the cloud section
const CloudRowMenu: React.FC<{ label: string; items: CloudRowMenuItem[]; contextMenu?: RowContextMenu }> = (props) => {
    const [open, setOpen] = React.useState(false);
    useRowContextMenuOpener(props.contextMenu, () => setOpen(true));
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
                    className={sidebarStyles.workbook_menu_button}
                    data-testid="cloud-row-menu"
                    aria-label={`More actions for ${props.label}`}
                    onClick={(event) => {
                        event.stopPropagation();
                        anchorProps.onClick?.(event);
                    }}
                >
                    <MoreIcon size={14} />
                </IconButton>
            )}
        >
            <div className={actionMenuStyles.menu} role="dialog" aria-label={`Actions for ${props.label}`}>
                <ActionList.List aria-label={`Actions for ${props.label}`}>
                    {props.items.map(item => (
                        <ActionList.ListItem
                            key={item.action}
                            data-testid="cloud-row-menu-item"
                            data-action={item.action}
                            className={item.danger ? actionMenuStyles.delete_action : undefined}
                            disabled={item.disabled}
                            onClick={(event: React.SyntheticEvent) => {
                                event.stopPropagation();
                                setOpen(false);
                                item.run();
                            }}
                        >
                            <ActionList.Leading><item.icon size={16} /></ActionList.Leading>
                            <ActionList.ItemText>{item.text}</ActionList.ItemText>
                        </ActionList.ListItem>
                    ))}
                </ActionList.List>
            </div>
        </AnchoredOverlay>
    );
};
