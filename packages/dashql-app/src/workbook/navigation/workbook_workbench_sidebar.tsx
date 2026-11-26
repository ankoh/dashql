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
} from '@dnd-kit/sortable';

import { useDispatch, useRuntime, useWorkbooks } from '@akohn/dashql-react/hooks';
import { AnchorAlignment, AnchorSide } from '@akohn/dashql-react/dom/anchored_position';
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
    StackIcon,
    StackPlusIcon,
    TrashIcon,
    SymbolIcon,
    UnlinkIcon,
    UploadIcon,
    PaperAirplaneIcon,
} from '@akohn/dashql-react/components/symbol_icon';
import { classNames } from '@akohn/dashql-react/dom/classnames';
import { OPEN_WORKBOOK, SELECT_WORKBOOK, useRouterNavigate } from '../../app/router.js';
import { useNewWorkbookConnection } from '../../connections/embedded_connection_hooks.js';
import { CloudsFolder } from '../../cloud/cloud_sidebar.js';
import { useClouds } from '../../cloud/cloud_state.js';
import { useCloudWorkbooks } from '../../cloud/cloud_workbooks.js';
import { VerticalScrollShadows } from '@akohn/dashql-react/components/vertical_scroll_shadows';
import { VerticalSplit } from '@akohn/dashql-react/components/vertical_split';
import { displayPath } from '@akohn/dashql/platform/storage/workbook_locator';
import { StorageBackendType } from '@akohn/dashql/platform/storage/storage_backend';
import { WorkbookStorageOverlay } from '../persistence/workbook_storage_overlay.js';
import { useStorageReader, useWorkbookTree } from '../../storage/storage_provider.js';
import { browserWorkbookFolder } from '../persistence/browser_workbook_folder.js';
import { cloneWorkbook } from '@akohn/dashql/platform/storage/workbook_transfer';
import { useWorkbookImport } from '../persistence/workbook_import_provider.js';
import { EPHEMERAL_WORKBOOK_NAME, isCloudPreview, workbookCloudLink, type WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { useScriptSelection } from '../scripts/script_selection.js';
import { scriptDisplayName } from '@akohn/dashql/platform/workbook/script_types';
import { renameScript } from '../scripts/script_rename.js';
import { useDeleteWorkbook, useInvalidWorkbooks } from '../workbook_lifecycle.js';
import { useEnsureEphemeralWorkbook, useOpenGreeter, useWorkbookCreation } from '../workbook_creation.js';
import { WORKBOOK_LIST_CARET_COLUMN, WorkbookFolderRow, WorkbookListRowMenu, useNameEditor, useSortableRow, workbookListRowPadding } from './workbook_folder_row.js';
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
    folderPathKey,
    applyWorkbookTreeChange,
} from '@akohn/dashql/platform/storage/workbook_tree';
import { NameInput } from '@akohn/dashql-react/components/name_input';
import { type RowContextMenu, useRowContextMenu } from '@akohn/dashql-react/dom/row_context_menu';
import { useAppFlavor } from '../../config/flavor_provider.js';
import { WorkbookURLShareOverlay } from '../persistence/workbook_url_share_overlay.js';
import { WorkbookFileSaveOverlay } from '../persistence/workbook_file_save_overlay.js';
import * as styles from './workbook_workbench_sidebar.module.css';
import { WorkbookConnectionsSection } from './workbook_connections_section.js';
import * as actionMenuStyles from '../../app/action_menu.module.css';
import { useDashQLCoreSetup } from '../../host/core_provider.js';
import { useLogger } from '../../host/logger_provider.js';
import { PlatformType, usePlatformType } from '../../host/platform_type.js';

interface WorkbookItem {
    workbookId: string;
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

/// The local workbooks are a folder of their own next to the folder of the clouds
const LOCAL_WORKBOOK_DEPTH = 1;

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
}

const FileZipIcon = SymbolIcon('file_zip_16');

interface WorkbookRowMenuProps {
    item: WorkbookItem;
    onRename: () => void;
    onDuplicate: () => void;
    onDelete: () => void;
    /// The right click of the row opens the menu
    contextMenu: RowContextMenu;
}

const WorkbookRowMenu: React.FC<WorkbookRowMenuProps> = ({ item, onRename, onDuplicate, onDelete, contextMenu }) => {
    const [shareOpen, setShareOpen] = React.useState(false);
    const [exportOpen, setExportOpen] = React.useState(false);
    const archiveExport = useAppFlavor().features.workbookArchiveExport;
    const [storageOpen, setStorageOpen] = React.useState(false);
    const { clouds } = useClouds();

    return (
        <WorkbookListRowMenu subject={item.label} testId="workbook-row-menu" contextMenu={contextMenu}>
            {close => (
                <>
                    <WorkbookStorageOverlay
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
                        close();
                        onRename();
                    }}>
                        <ActionList.Leading><PencilIcon size={16} /></ActionList.Leading>
                        <ActionList.ItemText>Rename</ActionList.ItemText>
                    </ActionList.ListItem>
                    <ActionList.ListItem data-testid="workbook-menu-item" data-action="duplicate" onClick={() => { close(); onDuplicate(); }}>
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
                            <WorkbookURLShareOverlay
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
                                <WorkbookFileSaveOverlay
                                    isOpen={exportOpen}
                                    setIsOpen={setExportOpen}
                                    workbookScripts={item.scripts}
                                    fileName={item.scripts.name ?? item.scripts.workbookMetadata.originalFileName ?? 'workbook'}
                                />
                            </ActionList.ItemText>
                        </ActionList.ListItem>
                    )}</>
                    <>{clouds.length > 0 && (
                        <WorkbookPublishItems item={item} onRun={() => close()} />
                    )}</>
                    <ActionList.ListItem data-testid="workbook-menu-item" data-action="delete" className={actionMenuStyles.delete_action} onClick={() => { close(); onDelete(); }}>
                        <ActionList.Leading>{item.isNative ? <UnlinkIcon size={16} /> : <TrashIcon size={16} />}</ActionList.Leading>
                        <ActionList.ItemText>{item.isNative ? 'Unlink' : 'Delete'}</ActionList.ItemText>
                    </ActionList.ListItem>
                </>
            )}
        </WorkbookListRowMenu>
    );
};

/// Publish a workbook to a cloud: a new version of the published workbook it is linked to, or a new published workbook.
/// With several clouds every item names its cloud.
const WorkbookPublishItems: React.FC<{ item: WorkbookItem; onRun: () => void }> = ({ item, onRun }) => {
    const cloudWorkbooks = useCloudWorkbooks();
    const { clouds } = useClouds();
    const logger = useLogger();
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
        const name = cloud.connection.label.text;
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
}

const WorkbookRow: React.FC<WorkbookRowProps> = ({ item, depth, selected, onOpen, onDuplicate, onDelete, dropPosition, expanded, onToggle, onOpenScript }) => {
    const title = item.scripts.name?.trim() || null;
    const modifyWorkbookScripts = useDispatch({ workbook: item.workbookId });
    // The rename action swaps the name for an input until the edit is committed or abandoned
    const [renaming, setRenaming] = React.useState(false);
    const renameInputRef = useNameEditor(renaming);
    const commitRename = React.useCallback((name: string) => {
        setRenaming(false);
        if ((name.trim() || null) !== title) modifyWorkbookScripts({ kind: 'renameWorkbook', value: { name } });
    }, [modifyWorkbookScripts, title]);
    const cancelRename = React.useCallback(() => setRenaming(false), []);
    const sortable = useSortableRow(item.workbookId);
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
            ref={sortable.ref}
            className={classNames(
                styles.entry_surface,
                styles.entry_interactive,
                styles.workbook_row,
                {
                    [styles.entry_selected]: selected,
                    [styles.workbook_row_dragging]: sortable.isDragging,
                    [styles.drop_before]: dropPosition === 'before',
                    [styles.drop_after]: dropPosition === 'after',
                },
            )}
            style={{
                ...sortable.style,
                paddingLeft: workbookListRowPadding(depth),
                // The insertion line of a drop starts at the icon of the workbook
                ['--workbook_row_indent' as string]: `${workbookListRowPadding(depth) + WORKBOOK_LIST_CARET_COLUMN}px`,
            }}
            {...sortable.props}
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
            <WorkbookRowMenu item={item} onRename={() => setRenaming(true)} onDuplicate={onDuplicate} onDelete={onDelete} contextMenu={contextMenu} />
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
    const renameInputRef = useNameEditor(renaming);
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

const ScriptRowMenu: React.FC<{ name: string; onRename: () => void; contextMenu: RowContextMenu }> = ({ name, onRename, contextMenu }) => (
    <WorkbookListRowMenu subject={`script ${name}`} testId="script-row-menu" contextMenu={contextMenu}>
        {close => (
            <ActionList.ListItem data-testid="script-menu-item" data-action="rename" onClick={(event) => {
                event.stopPropagation();
                close();
                onRename();
            }}>
                <ActionList.Leading><PencilIcon size={16} /></ActionList.Leading>
                <ActionList.ItemText>Rename</ActionList.ItemText>
            </ActionList.ListItem>
        )}
    </WorkbookListRowMenu>
);

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
                <span className={styles.root_count} data-testid="local-workbook-count" aria-label={`${count} local ${count === 1 ? 'workbook' : 'workbooks'}`}>{count}</span>
            </button>
            {/* Where the menu of the cloud is, the counts line up */}
            <span className={styles.root_menu_spacer} aria-hidden="true" />
        </li>
    );
};

/// The workbench of a workbook. Memoized: it reads what it shows itself, the page around it renders more often.
export const WorkbookWorkbenchSidebar = React.memo(function WorkbookWorkbenchSidebar(props: Props): React.ReactElement {
    const navigate = useRouterNavigate();
    const runtime = useRuntime();
    const scriptsRegistry = useWorkbooks();
    const createWorkbook = useWorkbookCreation();
    const openGreeterPage = useOpenGreeter();
    const ensureEphemeralWorkbook = useEnsureEphemeralWorkbook();
    const resolveNewWorkbookConnection = useNewWorkbookConnection();
    const deleteWorkbookFromRuntime = useDeleteWorkbook();
    const storageReader = useStorageReader();
    const { onOpenOverview, closeAfterSelection, onOpenScript } = props;
    const setupCore = useDashQLCoreSetup();
    const workbookImport = useWorkbookImport();
    const platform = usePlatformType();
    const logger = useLogger();
    const { invalidWorkbooks, deleteInvalidWorkbook } = useInvalidWorkbooks();
    const createButtonRef = React.useRef<HTMLButtonElement>(null);
    const folderButtonRef = React.useRef<HTMLButtonElement>(null);
    const folderInputRef = React.useRef<HTMLInputElement>(null);
    // The folders and workbooks of the sidebar as the storage shows them, with the changes of every sidebar
    const workbookTree = useWorkbookTree(storageReader.workbookFolders);
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

    const workbookItems = React.useMemo<Map<string, WorkbookItem>>(() => {
        const items = new Map<string, WorkbookItem>();
        for (const [workbookId, scripts] of scriptsRegistry) {
            // The ephemeral workbook has its own row at the end of the list, a cloud preview shows with the cloud
            if (scripts.ephemeral || isCloudPreview(scripts)) continue;
            const location = storageReader.getWorkbookLocation(workbookId);
            const path = displayPath(workbookId, location);
            items.set(workbookId, {
                workbookId,
                scripts,
                path,
                label: scripts.name?.trim() || path,
                isNative: location.type === StorageBackendType.Native,
            });
        }
        return items;
    }, [scriptsRegistry, storageReader]);

    // The workbooks that the tree doesn't list yet, e.g. new ones before their first write, show where their
    // first write registers them, at the end of the root
    const displayedTree = React.useMemo<WorkbookTreeFolder>(() => {
        const listed = new Set(flattenWorkbookTree(workbookTree).map(entry => entry.path));
        return [...workbookItems.keys()]
            .filter(id => !listed.has(id))
            .reduce((tree, path) => applyWorkbookTreeChange(runtime.core, tree, { kind: 'upsert', entry: { path } }), workbookTree);
    }, [runtime, workbookItems, workbookTree]);

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

    const dndSensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );
    /// Change the workbook tree, the storage shows a move of a workbook right away and the other changes once they are
    /// written. A write that fails, e.g. a taken folder name, is logged.
    const treeFolders = storageReader.workbookFolders;
    const changeWorkbookTree = React.useCallback((what: string, write: (folders: NonNullable<typeof treeFolders>) => Promise<void>) => {
        if (treeFolders == null) return;
        write(treeFolders).catch(error => logger.warn(`failed to ${what}`, { error: String(error) }, 'workbook_workbench'));
    }, [logger, treeFolders]);

    const moveWorkbook = React.useCallback((workbookId: string, folderPath: string[], index: number) => {
        changeWorkbookTree('move the workbook', folders => folders.moveWorkbook(workbookId, folderPath, index));
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
        const path = [...parentPath, runtime.core.freeFolderName(parent.folders.map(folder => folder.name))];
        setCollapsedFolders(current => {
            const next = new Set(current);
            next.delete(folderPathKey(parentPath));
            return next;
        });
        setRenamingFolder(folderPathKey(path));
        changeWorkbookTree('create the folder', folders => folders.createFolder(path));
    }, [changeWorkbookTree, runtime, workbookTree]);

    const renameFolder = React.useCallback((folder: WorkbookTreeFolder, input: string) => {
        setRenamingFolder(null);
        const name = input.trim();
        if (name === folder.name) return;
        const parentPath = folder.path.slice(0, -1);
        const siblings = (folderAt(workbookTree, parentPath)?.folders ?? [])
            .map(sibling => sibling.name)
            .filter(sibling => sibling !== folder.name);
        const error = runtime.core.folderNameError(name, siblings);
        if (error != null) {
            logger.warn('failed to rename the folder', { error }, 'workbook_workbench');
            return;
        }
        changeWorkbookTree('rename the folder', folders => folders.moveFolder(folder.path, parentPath, name));
    }, [changeWorkbookTree, logger, runtime, workbookTree]);

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
        onOpenOverview?.(null);
        closeAfterSelection?.();
    }, [openGreeterPage, closeAfterSelection, onOpenOverview]);

    /// Create a workbook in a folder on the embedded Hyper, or on the Hyper of the link that the app was opened with.
    /// Its scripts attach other connections.
    const createWorkbookInFolder = React.useCallback((folderPath: string[]) => {
        const { workbookId } = createWorkbook(resolveNewWorkbookConnection());
        moveWorkbook(workbookId, folderPath, Number.MAX_SAFE_INTEGER);
        navigate({ type: SELECT_WORKBOOK, value: workbookId });
        closeAfterSelection?.();
    }, [createWorkbook, moveWorkbook, navigate, closeAfterSelection, resolveNewWorkbookConnection]);

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
        // Connections outlive the workbooks that reference them, the runtime drops the workbook's own computations
        try {
            await deleteWorkbookFromRuntime(item.workbookId);
        } catch (error) {
            logger.error('deleting a workbook failed', { workbookId: item.workbookId, error: String(error) }, 'workbook_workbench');
            return;
        }

        if (item.workbookId === props.workbookScripts.workbookId) {
            const next = workbooks.find(workbook => workbook.workbookId !== item.workbookId);
            if (next != null) navigate({ type: OPEN_WORKBOOK, value: next.workbookId });
            else openGreeter();
        }
    }, [deleteWorkbookFromRuntime, logger, navigate, openGreeter, workbooks, props.workbookScripts.workbookId]);

    const openWorkbook = React.useCallback((item: WorkbookItem) => {
        navigate({ type: SELECT_WORKBOOK, value: item.workbookId });
        onOpenOverview?.(null);
        closeAfterSelection?.();
    }, [navigate, closeAfterSelection, onOpenOverview]);
    /// Open a workbook at one of its scripts, the workbook row selects the script
    const openScript = React.useCallback((item: WorkbookItem, fileName: string) => {
        navigate({ type: SELECT_WORKBOOK, value: item.workbookId });
        onOpenOverview?.(null);
        onOpenScript?.(item.workbookId, fileName);
        closeAfterSelection?.();
    }, [navigate, closeAfterSelection, onOpenOverview, onOpenScript]);
    const workbookListRef = React.useRef<HTMLUListElement>(null);
    const getWorkbookScrollElement = React.useCallback(() => workbookListRef.current, []);

    const openConnectionOverview = React.useCallback((connectionId: string) => {
        onOpenOverview?.(connectionId);
        closeAfterSelection?.();
    }, [onOpenOverview, closeAfterSelection]);

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
                                <SortableContext items={localExpanded ? rows.map(row => row.id) : []} strategy={KEEP_ROWS_IN_PLACE}>
                                    <ul ref={workbookListRef} className={styles.workbook_list} aria-label="Workbooks" data-electron-drag-region="false">
                                        {/* The clouds, a folder above the local workbooks */}
                                        <CloudsFolder
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
                                        {localExpanded && rows.map(row => row.kind === 'folder' ? (
                                            <WorkbookFolderRow
                                                key={row.id}
                                                rowId={row.id}
                                                folder={row.folder}
                                                depth={row.depth + LOCAL_WORKBOOK_DEPTH}
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
                                                depth={row.depth + LOCAL_WORKBOOK_DEPTH}
                                                // An open connection overview replaces the workbook
                                                selected={!overviewShown && row.item.workbookId === props.workbookScripts.workbookId}
                                                onOpen={() => openWorkbook(row.item)}
                                                onDuplicate={() => { void duplicateWorkbook(row.item); }}
                                                onDelete={() => { void deleteWorkbook(row.item); }}
                                                dropPosition={drop?.targetId === row.id && drop.position !== 'into' ? drop.position : null}
                                                expanded={expandedWorkbook === row.item.workbookId}
                                                onToggle={() => toggleWorkbook(row.item.workbookId)}
                                                onOpenScript={fileName => openScript(row.item, fileName)}
                                            />
                                        ))}
                                        {localExpanded && invalidItems.map(item => (
                                            <InvalidWorkbookRow
                                                key={item.workbookId}
                                                item={item}
                                                depth={LOCAL_WORKBOOK_DEPTH}
                                                onDelete={() => { void deleteInvalidWorkbook(item.workbookId); }}
                                            />
                                        ))}
                                        {localExpanded && ephemeralWorkbook != null && (
                                            <EphemeralWorkbookRow selected={ephemeralWorkbookSelected} depth={LOCAL_WORKBOOK_DEPTH} onOpen={openGreeter} />
                                        )}
                                        {storageReader.workbookFolders != null && (
                                            <TopLevelDropZone targeted={drop?.targetId === TOP_LEVEL_DROP_ID} depth={LOCAL_WORKBOOK_DEPTH} />
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
                second={<WorkbookConnectionsSection
                    workbookScripts={props.workbookScripts}
                    openOverviewId={props.openOverviewId ?? null}
                    onOpenOverview={openConnectionOverview}
                />}
            />
        </nav>
    );
});
