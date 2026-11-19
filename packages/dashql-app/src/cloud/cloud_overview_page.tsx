import * as React from 'react';
import symbols from '@akohn/dashql-svg-symbols';
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

import { Button, ButtonSize, ButtonVariant, IconButton } from '@akohn/dashql-react/components/button';
import { TextInput } from '@akohn/dashql-react/components/text_input';
import { NameInput } from '@akohn/dashql-react/components/name_input';
import { AnchorSide } from '@akohn/dashql-react/dom/anchored_position';
import {
    ChevronDownIcon,
    ChevronRightIcon,
    DownloadIcon,
    EyeIcon,
    FileDirectoryFillIcon,
    FileDirectoryPlusIcon,
    HistoryIcon,
    PencilIcon,
    SearchIcon,
    StackIcon,
    SyncIcon,
    ToolsIcon,
    TrashIcon,
    UnlinkIcon,
    XIcon,
} from '@akohn/dashql-react/components/symbol_icon';
import { useRowContextMenu } from '@akohn/dashql-react/dom/row_context_menu';
import { classNames } from '@akohn/dashql-react/dom/classnames';
import { formatTimeDifference } from '@akohn/dashql-react/format/format';
import { startsRowDrag } from '../workbook/navigation/workbook_folder_row.js';
import { useLogger } from '../host/logger_provider.js';
import { stringifyError } from '@akohn/dashql/platform/logger/logger';
import { CONNECTION_HEALTH_COLORS, CONNECTION_HEALTH_NAMES } from '../connections/connection_status.js';
import { CONNECTOR_ICON_STYLE, useConnectorIcon } from '../connections/connector_icon.js';
import { ConnectionHealth } from '@akohn/dashql/platform/connections/connection_state';
import { CloudConnectionInstaller } from './cloud_connection_installer.js';
import { useCloudRemoval } from './cloud_deletion.js';
import { CloudConnectionRow } from './cloud_connection_row.js';
import { connectionError, useCloudLogin } from './cloud_login.js';
import { CloudRowMenu } from './cloud_row_menu.js';
import { useClouds, useCloudState, type CloudState } from './cloud_state.js';
import { useCloudWorkbooks, type CloudWorkbooks } from './cloud_workbooks.js';
import { CLOUD_PAGE_SIZE, type CloudCursor, type CloudEntry, type CloudFolder } from './cloud_folders.js';
import type { CloudWorkbook, CloudWorkbookVersion } from './cloud_store.js';
import * as styles from './cloud_overview_page.module.css';
import { connectorInfoOf } from '@akohn/dashql/platform/connections/connection_state';

// The overview of a cloud in place of the feed: the cloud connection with its login and the installation of DashQL,
// the counts of the cloud, and its folders and workbooks. See docs/design/cloud.md.
//
// A cloud may hold very many workbooks, so the page never reads them all: it reads one folder a page at a time, in the
// order of the names, and the next page when the end of the list comes into view. The search reads the workbooks that
// it finds the same way, the cloud runs it. Its counts come from a single statement of the cloud state.

const LOG_CTX = 'cloud_overview';
/// How long the search waits for more typing
const SEARCH_DEBOUNCE_MS = 300;
/// The most entries that a listing reads again after a change, the ones that were shown stay
const MAX_RELOAD = 1000;
/// The drop target of the top of the cloud
const TOP_DROP_ID = 'cloud-top';

/// What a drag moves
type DragData = { kind: 'workbook'; workbook: CloudWorkbook } | { kind: 'folder'; folder: CloudFolder };
/// Where a drop moves it: a folder, the top without one
interface DropData {
    folderId: string | null;
}

/// The listeners of a draggable row. A pointer drag starts from the row, not from a text field or the portaled menu,
/// a keyboard drag only from the row itself, so that Enter and Space still press its buttons.
function rowDragListeners(listeners: Record<string, Function> | undefined): Record<string, (event: React.SyntheticEvent<HTMLElement>) => void> | undefined {
    if (listeners == null) return undefined;
    return Object.fromEntries(Object.entries(listeners).map(([eventName, handler]) => [eventName, (event: React.SyntheticEvent<HTMLElement>) => {
        const starts = eventName === 'onKeyDown' ? event.target === event.currentTarget : startsRowDrag(event);
        if (starts) handler(event);
    }]));
}

/// A count with its noun
function countOf(count: number, noun: string): string {
    return `${count.toLocaleString()} ${noun}${count === 1 ? '' : 's'}`;
}

/// When something happened, relative and as the title the full time
function timeOf(at: number | null): { text: string; title: string } | null {
    if (at == null) return null;
    const date = new Date(at);
    return { text: formatTimeDifference(date), title: date.toLocaleString() };
}

export interface CloudOverviewPageDependencies {
    useCloudWorkbooks: typeof useCloudWorkbooks;
}

const DEFAULT_DEPENDENCIES: CloudOverviewPageDependencies = { useCloudWorkbooks };

interface Props {
    /// The cloud connection
    connectionId: string;
    /// Close the overview
    onClose: () => void;
    dependencies?: CloudOverviewPageDependencies;
}

/// The overview of a cloud. Closes itself once the connection is no cloud.
export const CloudOverviewPage: React.FC<Props> = ({ connectionId, onClose, dependencies = DEFAULT_DEPENDENCIES }) => {
    const cloud = useCloudState(connectionId);
    React.useEffect(() => {
        if (cloud == null) onClose();
    }, [cloud == null, onClose]);
    if (cloud == null) return null;
    return (
        <div className={styles.container}>
            <section className={styles.page} aria-label={`Overview of the cloud ${cloud.connection.label.text}`} data-testid="cloud-overview">
                <CloudHeader cloud={cloud} />
                <CloudSummary cloud={cloud} />
                {cloud.online && cloud.readable && <CloudBrowser cloud={cloud} useWorkbooks={dependencies.useCloudWorkbooks} />}
            </section>
        </div>
    );
};

/// The cloud connection: its logo, name and health, and the actions of the cloud
const CloudHeader: React.FC<{ cloud: CloudState }> = ({ cloud }) => {
    const connectorIcon = useConnectorIcon();
    const { openSetup } = useClouds();
    const removal = useCloudRemoval(cloud.connectionId, cloud.connection.localCloud);
    const health = cloud.connection.connectionHealth;
    return (
        <header className={styles.header}>
            <svg width="16" height="16" aria-hidden="true">
                <use xlinkHref={`${symbols}#${connectorIcon(connectorInfoOf(cloud.connection))}`} style={CONNECTOR_ICON_STYLE} />
            </svg>
            <h2 className={styles.title}>
                <span className={styles.title_name}>{cloud.connection.label.text}</span>
                <svg className={styles.health} width="8px" height="8px" viewBox="0 0 8 8" role="img" aria-label={CONNECTION_HEALTH_NAMES[health]}>
                    <title>{CONNECTION_HEALTH_NAMES[health]}</title>
                    <circle cx="4" cy="4" r="4" style={{ fill: CONNECTION_HEALTH_COLORS[health] }} />
                </svg>
                <span className={styles.title_separator}>/</span>
                <span>Cloud</span>
            </h2>
            <IconButton variant={ButtonVariant.Invisible} size={ButtonSize.Small} aria-label="Refresh" disabled={!cloud.online || cloud.loading}
                onClick={() => void cloud.refresh()} data-testid="cloud-overview-refresh">
                <SyncIcon size={16} />
            </IconButton>
            <IconButton variant={ButtonVariant.Invisible} size={ButtonSize.Small} aria-label="Cloud setup"
                onClick={() => openSetup(cloud.connectionId)} data-testid="cloud-overview-setup">
                <ToolsIcon size={16} />
            </IconButton>
            <IconButton variant={ButtonVariant.Invisible} size={ButtonSize.Small} aria-label={removal.text}
                onClick={removal.run} data-testid={removal.deletes ? 'cloud-delete' : 'cloud-stop-using'}>
                {removal.deletes ? <TrashIcon size={16} /> : <UnlinkIcon size={16} />}
            </IconButton>
        </header>
    );
};

/// The version of the tables of DashQL and the counts of the cloud, the login while the connection is not online
const CloudSummary: React.FC<{ cloud: CloudState }> = ({ cloud }) => {
    const login = useCloudLogin(cloud.connectionId);
    const health = cloud.connection.connectionHealth;
    if (!cloud.online) {
        const error = health === ConnectionHealth.FAILED ? connectionError(cloud.connection) : null;
        return (
            <div className={styles.card} data-testid="cloud-overview-login">
                <CloudConnectionRow connection={cloud.connection}>
                    {health === ConnectionHealth.CONNECTING
                        ? <Button variant={ButtonVariant.Default} size={ButtonSize.Small} onClick={login.cancel}>Cancel</Button>
                        : (
                            <Button variant={ButtonVariant.Primary} size={ButtonSize.Small} disabled={!login.available}
                                onClick={() => void login.login()} data-testid="cloud-log-in">
                                Log In
                            </Button>
                        )}
                </CloudConnectionRow>
                {error != null && <p className={styles.error} role="alert">{error}</p>}
            </div>
        );
    }
    const stats = cloud.stats;
    const version = cloud.installation?.store?.version ?? null;
    const published = timeOf(stats?.lastPublishedAt ?? null);
    return (
        <>
            <dl className={styles.facts} data-testid="cloud-overview-facts">
                <div className={styles.fact}>
                    <dt>Version</dt>
                    <dd data-testid="cloud-fact-version">{version == null ? '–' : version}</dd>
                </div>
                <div className={styles.fact}>
                    <dt>Workbooks</dt>
                    <dd data-testid="cloud-fact-workbooks">{stats == null ? '–' : stats.workbooks.toLocaleString()}</dd>
                </div>
                <div className={styles.fact}>
                    <dt>Folders</dt>
                    <dd data-testid="cloud-fact-folders">{stats == null ? '–' : stats.folders.toLocaleString()}</dd>
                </div>
                <div className={styles.fact}>
                    <dt>Versions</dt>
                    <dd data-testid="cloud-fact-versions">{stats == null ? '–' : stats.versions.toLocaleString()}</dd>
                </div>
                <div className={styles.fact}>
                    <dt>Last published</dt>
                    <dd title={published?.title}>{published?.text ?? '–'}</dd>
                </div>
            </dl>
            <div className={styles.card} data-testid="cloud-installation">
                <div className={styles.label}>Installation</div>
                <CloudConnectionInstaller cloud={cloud.connection} />
                {cloud.error != null && <p className={styles.error} role="alert">{cloud.error}</p>}
            </div>
        </>
    );
};

/// A listing of the cloud as it was read: its entries and where the next page starts
interface Listing {
    /// What the listing shows, a folder or a search
    key: string;
    entries: CloudEntry[];
    next: CloudCursor | null;
    loading: boolean;
    error: string | null;
}

/// The folders and workbooks of the cloud: a search, the path of the folder, and its entries a page at a time
const CloudBrowser: React.FC<{ cloud: CloudState; useWorkbooks: typeof useCloudWorkbooks }> = ({ cloud, useWorkbooks }) => {
    const cloudId = cloud.connectionId;
    const workbooks = useWorkbooks();
    const logger = useLogger();
    // The folder that is shown, the top without one
    const [folderId, setFolderId] = React.useState<string | null>(null);
    // The folders from the top down to the folder
    const [path, setPath] = React.useState<CloudFolder[]>([]);
    // The text of the search, and the one that the listing searches once the typing paused
    const [searchInput, setSearchInput] = React.useState('');
    const [search, setSearch] = React.useState('');
    React.useEffect(() => {
        const timer = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [searchInput]);
    const searching = search.length > 0;
    const listingKey = searching ? `search:${search}` : `folder:${folderId ?? ''}`;

    const [listing, setListing] = React.useState<Listing>({ key: listingKey, entries: [], next: null, loading: true, error: null });
    const listingRef = React.useRef(listing);
    listingRef.current = listing;
    // The page that is being read, a new listing aborts it
    const reading = React.useRef<AbortController | null>(null);
    const [actionError, setActionError] = React.useState<string | null>(null);

    // Read the first page again when the listing changes and after every look at the cloud, e.g. after a change. A
    // listing that is shown keeps as many entries as it showed.
    const list = workbooks.list;
    React.useEffect(() => {
        reading.current?.abort();
        const controller = new AbortController();
        reading.current = controller;
        const shown = listingRef.current.key === listingKey ? listingRef.current.entries.length : 0;
        const limit = Math.min(MAX_RELOAD, Math.max(CLOUD_PAGE_SIZE, shown));
        setListing(previous => previous.key === listingKey
            ? { ...previous, loading: true, error: null }
            : { key: listingKey, entries: [], next: null, loading: true, error: null });
        list(cloudId, { folderId: searching ? null : folderId, search: searching ? { text: search } : null, limit }, controller.signal)
            .then(page => {
                if (controller.signal.aborted) return;
                setListing({ key: listingKey, entries: page.entries, next: page.next, loading: false, error: null });
            })
            .catch(error => {
                if (controller.signal.aborted) return;
                setListing(previous => ({ ...previous, loading: false, error: error instanceof Error ? error.message : String(error) }));
            });
        return () => controller.abort();
    }, [cloudId, folderId, list, listingKey, search, searching, cloud.revision]);

    /// Read the next page of the listing
    const loadMore = React.useCallback(() => {
        const current = listingRef.current;
        if (current.loading || current.next == null) return;
        const controller = new AbortController();
        reading.current = controller;
        setListing({ ...current, loading: true });
        list(cloudId, { folderId: searching ? null : folderId, search: searching ? { text: search } : null, after: current.next }, controller.signal)
            .then(page => {
                if (controller.signal.aborted) return;
                setListing(previous => previous.key !== current.key ? previous : {
                    ...previous, entries: [...previous.entries, ...page.entries], next: page.next, loading: false,
                });
            })
            .catch(error => {
                if (controller.signal.aborted) return;
                setListing(previous => ({ ...previous, loading: false, error: error instanceof Error ? error.message : String(error) }));
            });
    }, [cloudId, folderId, list, search, searching]);

    // The next page is read when the end of the list comes into view
    const endRef = React.useRef<HTMLDivElement>(null);
    React.useEffect(() => {
        const end = endRef.current;
        if (end == null || listing.next == null || typeof IntersectionObserver === 'undefined') return;
        const observer = new IntersectionObserver(seen => {
            if (seen.some(entry => entry.isIntersecting)) loadMore();
        });
        observer.observe(end);
        return () => observer.disconnect();
    }, [listing.next, loadMore]);

    // The path of the folder, the folder may be gone after a look at the cloud
    const folderPath = workbooks.folderPath;
    React.useEffect(() => {
        if (folderId == null) {
            setPath([]);
            return;
        }
        const controller = new AbortController();
        folderPath(cloudId, folderId, controller.signal)
            .then(found => { if (!controller.signal.aborted) setPath(found); })
            .catch(() => { if (!controller.signal.aborted) setFolderId(null); });
        return () => controller.abort();
    }, [cloudId, folderId, folderPath, cloud.revision]);

    /// Run an action, its failure shows above the list
    const run = React.useCallback(async (what: string, action: () => Promise<unknown>) => {
        setActionError(null);
        try {
            await action();
        } catch (error) {
            logger.error(`${what} failed`, { cloudId, error: stringifyError(error) }, LOG_CTX);
            setActionError(`${what} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }, [cloudId, logger]);

    // The folder whose name is being edited, the workbook whose versions are listed and the one that is being opened
    const [renamingFolder, setRenamingFolder] = React.useState<string | null>(null);
    const [expandedWorkbook, setExpandedWorkbook] = React.useState<string | null>(null);
    const [opening, setOpening] = React.useState<string | null>(null);

    const openFolder = (id: string | null) => {
        setSearchInput('');
        setSearch('');
        setFolderId(id);
        setExpandedWorkbook(null);
    };
    const createFolder = () => run('Creating a folder', async () => {
        const taken = new Set(listing.entries.flatMap(entry => entry.kind === 'folder' ? [entry.folder.name.toLowerCase()] : []));
        let name = 'New Folder';
        for (let i = 2; taken.has(name.toLowerCase()); ++i) name = `New Folder ${i}`;
        const folder = await workbooks.createFolder(cloudId, name, folderId);
        setRenamingFolder(folder.folderId);
    });
    const renameFolder = (folder: CloudFolder, input: string) => {
        setRenamingFolder(null);
        const name = input.trim();
        if (name.length === 0 || name === folder.name) return;
        void run(`Renaming the folder "${folder.name}"`, () => workbooks.renameFolder(cloudId, folder.folderId, name));
    };
    const deleteFolder = (folder: CloudFolder) => {
        if (!window.confirm(`Delete the folder "${folder.name}"? Its folders and workbooks move to the folder above.`)) return;
        void run(`Deleting the folder "${folder.name}"`, () => workbooks.deleteFolder(cloudId, folder.folderId));
    };
    const open = (workbook: CloudWorkbook, options: { versionId?: string; preview: boolean }) => {
        setOpening(workbook.workbookId);
        void run(`Opening "${workbook.name ?? 'Untitled'}"`, () => workbooks.open(cloudId, workbook.workbookId, { ...options, name: workbook.name ?? 'Untitled' }))
            .finally(() => setOpening(null));
    };
    const remove = (workbook: CloudWorkbook) => {
        const name = workbook.name ?? 'Untitled';
        if (!window.confirm(`Delete "${name}" from the cloud? It disappears for everyone who uses the cloud.`)) return;
        void run(`Deleting "${name}"`, () => workbooks.remove(cloudId, workbook.workbookId));
    };
    const parentId = path.length > 1 ? path[path.length - 2].folderId : null;

    // A dragged row moves into the folder or the folder of the path under it
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
        useSensor(KeyboardSensor),
    );
    const [dropTarget, setDropTarget] = React.useState<string | null>(null);
    const showDrop = (event: DragOverEvent) => {
        const dragged = event.active.data.current as DragData | undefined;
        const to = event.over?.data.current as DropData | undefined;
        const moves = dragged != null && to != null && to.folderId !== folderId && !(dragged.kind === 'folder' && dragged.folder.folderId === to.folderId);
        setDropTarget(moves ? String(event.over!.id) : null);
    };
    const drop = (event: DragEndEvent) => {
        setDropTarget(null);
        const dragged = event.active.data.current as DragData | undefined;
        const to = event.over?.data.current as DropData | undefined;
        if (dragged == null || to == null || to.folderId === folderId) return;
        if (dragged.kind === 'workbook') {
            void run(`Moving "${dragged.workbook.name ?? 'Untitled'}"`, () => workbooks.move(cloudId, dragged.workbook.workbookId, to.folderId));
        } else if (dragged.folder.folderId !== to.folderId) {
            void run(`Moving the folder "${dragged.folder.name}"`, () => workbooks.moveFolder(cloudId, dragged.folder.folderId, to.folderId));
        }
    };

    const entries = listing.key === listingKey ? listing.entries : [];
    return (
        <DndContext
            sensors={sensors}
            collisionDetection={pointerWithin}
            onDragOver={showDrop}
            onDragEnd={drop}
            onDragCancel={() => setDropTarget(null)}
        >
            <div className={styles.browser} data-testid="cloud-browser">
                <div className={styles.toolbar}>
                    <TextInput
                        className={styles.search}
                        type="search"
                        placeholder="Search the workbooks by name or script"
                        aria-label="Search the workbooks"
                        leadingVisual={SearchIcon}
                        value={searchInput}
                        data-testid="cloud-search"
                        onChange={event => setSearchInput(event.target.value)}
                        onKeyDown={event => {
                            if (event.key === 'Enter') setSearch(searchInput.trim());
                            if (event.key === 'Escape') { setSearchInput(''); setSearch(''); }
                        }}
                    />
                    <Button variant={ButtonVariant.Default} size={ButtonSize.Small} leadingVisual={FileDirectoryPlusIcon}
                        disabled={searching} onClick={() => void createFolder()} data-testid="cloud-new-folder">
                        New Folder
                    </Button>
                </div>
                <nav className={styles.path} aria-label="Folder path" data-testid="cloud-path">
                    {searching ? (
                        <>
                            <span className={styles.path_current}>Workbooks that contain “{search}”</span>
                            <IconButton variant={ButtonVariant.Invisible} size={ButtonSize.Small} aria-label="Clear the search"
                                onClick={() => { setSearchInput(''); setSearch(''); }}>
                                <XIcon size={14} />
                            </IconButton>
                        </>
                    ) : (
                        <>
                            <PathSegment id={TOP_DROP_ID} folderId={null} name={cloud.connection.label.text} current={folderId == null}
                                dropTarget={dropTarget === TOP_DROP_ID} onOpen={() => openFolder(null)} />
                            {path.map((folder, index) => (
                                <React.Fragment key={folder.folderId}>
                                    <span className={styles.path_separator}>/</span>
                                    <PathSegment id={`path:${folder.folderId}`} folderId={folder.folderId} name={folder.name}
                                        current={index === path.length - 1} dropTarget={dropTarget === `path:${folder.folderId}`}
                                        onOpen={() => openFolder(folder.folderId)} />
                                </React.Fragment>
                            ))}
                        </>
                    )}
                </nav>
                {actionError != null && (
                    <p className={styles.error} role="alert" data-testid="cloud-action-error">
                        {actionError}
                        <IconButton variant={ButtonVariant.Invisible} size={ButtonSize.Small} aria-label="Dismiss" onClick={() => setActionError(null)}>
                            <XIcon size={12} />
                        </IconButton>
                    </p>
                )}
                <ul className={styles.list} aria-label={searching ? 'Workbooks found' : 'Folders and workbooks'} data-testid="cloud-entries">
                    {entries.map(entry => entry.kind === 'folder' ? (
                        <FolderEntry
                            key={`folder:${entry.folder.folderId}`}
                            entry={entry}
                            renaming={renamingFolder === entry.folder.folderId}
                            dropTarget={dropTarget === `folder:${entry.folder.folderId}`}
                            onOpen={() => openFolder(entry.folder.folderId)}
                            onStartRename={() => setRenamingFolder(entry.folder.folderId)}
                            onRename={name => renameFolder(entry.folder, name)}
                            onCancelRename={() => setRenamingFolder(null)}
                            onMoveUp={folderId == null ? null : () => void run(`Moving the folder "${entry.folder.name}"`, () => workbooks.moveFolder(cloudId, entry.folder.folderId, parentId))}
                            onDelete={() => deleteFolder(entry.folder)}
                        />
                    ) : (
                        <WorkbookEntry
                            key={`workbook:${entry.workbook.workbookId}`}
                            cloudId={cloudId}
                            listVersions={workbooks.listVersions}
                            workbook={entry.workbook}
                            folderName={searching ? entry.folderName : null}
                            expanded={expandedWorkbook === entry.workbook.workbookId}
                            opening={opening === entry.workbook.workbookId}
                            revision={cloud.revision}
                            onToggle={() => setExpandedWorkbook(expanded => expanded === entry.workbook.workbookId ? null : entry.workbook.workbookId)}
                            onOpen={versionId => open(entry.workbook, { versionId, preview: true })}
                            onImport={versionId => open(entry.workbook, { versionId, preview: false })}
                            onMoveUp={folderId == null || searching ? null : () => void run(`Moving "${entry.workbook.name ?? 'Untitled'}"`, () => workbooks.move(cloudId, entry.workbook.workbookId, parentId))}
                            onDelete={() => remove(entry.workbook)}
                        />
                    ))}
                </ul>
                {!listing.loading && listing.error == null && entries.length === 0 && (
                    <p className={styles.note} data-testid="cloud-entries-empty">
                        {searching ? 'No workbook contains the text.' : folderId == null ? 'No published workbooks yet. Publish a workbook from its menu.' : 'The folder is empty.'}
                    </p>
                )}
                {listing.error != null && <p className={styles.error} role="alert">{listing.error}</p>}
                <div ref={endRef} className={styles.end}>
                    {listing.loading && <span className={styles.note}>Loading</span>}
                    {!listing.loading && listing.next != null && (
                        <Button variant={ButtonVariant.Invisible} size={ButtonSize.Small} onClick={loadMore} data-testid="cloud-load-more">
                            Load more
                        </Button>
                    )}
                </div>
            </div>
        </DndContext>
    );
};

interface PathSegmentProps {
    id: string;
    folderId: string | null;
    name: string;
    /// Is it the folder that is shown?
    current: boolean;
    dropTarget: boolean;
    onOpen: () => void;
}

/// A folder of the path, a row dropped on it moves into it
const PathSegment: React.FC<PathSegmentProps> = (props) => {
    const { setNodeRef } = useDroppable({ id: props.id, data: { folderId: props.folderId } satisfies DropData });
    return (
        <button
            ref={setNodeRef}
            type="button"
            className={classNames(styles.path_segment, { [styles.path_current]: props.current, [styles.drop_into]: props.dropTarget })}
            aria-current={props.current ? 'location' : undefined}
            onClick={props.onOpen}
            data-testid="cloud-path-segment"
        >
            {props.name}
        </button>
    );
};

interface FolderEntryProps {
    entry: Extract<CloudEntry, { kind: 'folder' }>;
    renaming: boolean;
    dropTarget: boolean;
    onOpen: () => void;
    onStartRename: () => void;
    onRename: (name: string) => void;
    onCancelRename: () => void;
    /// Move the folder to the folder above, null at the top
    onMoveUp: (() => void) | null;
    onDelete: () => void;
}

/// A folder: its name and what it holds. A click opens it, a row dropped on it moves into it.
const FolderEntry: React.FC<FolderEntryProps> = (props) => {
    const { folder } = props.entry;
    const contextMenu = useRowContextMenu();
    const { setNodeRef: setDropRef } = useDroppable({ id: `folder:${folder.folderId}`, data: { folderId: folder.folderId } satisfies DropData });
    const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({
        id: `drag-folder:${folder.folderId}`,
        data: { kind: 'folder', folder } satisfies DragData,
        disabled: props.renaming,
    });
    const renameInputRef = React.useRef<HTMLInputElement>(null);
    React.useEffect(() => {
        if (!props.renaming) return;
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
    }, [props.renaming]);
    const contents = [
        props.entry.folders > 0 ? countOf(props.entry.folders, 'folder') : null,
        countOf(props.entry.workbooks, 'workbook'),
    ].filter(Boolean).join(', ');
    return (
        <li
            ref={node => { setDropRef(node); setDragRef(node); }}
            className={classNames(styles.entry, { [styles.drop_into]: props.dropTarget, [styles.dragging]: isDragging })}
            style={{ transform: CSS.Translate.toString(transform) }}
            data-testid="cloud-folder-entry"
            {...attributes}
            {...rowDragListeners(listeners)}
            onContextMenu={contextMenu.onContextMenu}
        >
            <span className={styles.caret} aria-hidden="true" />
            <FileDirectoryFillIcon size={14} aria-hidden="true" />
            {props.renaming ? (
                <NameInput
                    ref={renameInputRef}
                    className={styles.rename_input}
                    name={folder.name}
                    onCommit={props.onRename}
                    onCancel={props.onCancelRename}
                    ariaLabel="Folder name"
                    placeholder="Name this folder"
                />
            ) : (
                <button type="button" className={styles.name_button} data-testid="cloud-entry-name" onClick={props.onOpen} title={folder.name}>
                    {folder.name}
                </button>
            )}
            <span className={styles.detail}>{contents}</span>
            <span className={styles.detail} />
            <CloudRowMenu
                label={`folder ${folder.name}`}
                contextMenu={contextMenu}
                side={AnchorSide.OutsideBottom}
                items={[
                    { action: 'rename', icon: PencilIcon, text: 'Rename', run: props.onStartRename },
                    ...(props.onMoveUp == null ? [] : [{ action: 'move-up', icon: FileDirectoryFillIcon, text: 'Move to the folder above', run: props.onMoveUp }]),
                    { action: 'delete', icon: TrashIcon, text: 'Delete folder', run: props.onDelete, danger: true },
                ]}
            />
        </li>
    );
};

interface WorkbookEntryProps {
    cloudId: string;
    listVersions: CloudWorkbooks['listVersions'];
    workbook: CloudWorkbook;
    /// The folder of the workbook, shown with the results of a search
    folderName: string | null;
    expanded: boolean;
    opening: boolean;
    /// The versions are listed again when the cloud was looked at again
    revision: number;
    onToggle: () => void;
    /// Open a version read-only, the latest without one
    onOpen: (versionId?: string) => void;
    /// Import a version, the latest without one
    onImport: (versionId?: string) => void;
    /// Move the workbook to the folder above, null at the top
    onMoveUp: (() => void) | null;
    onDelete: () => void;
}

/// A published workbook: its name, its latest version, who published it and when. A click opens it read-only, its
/// caret lists its versions.
const WorkbookEntry: React.FC<WorkbookEntryProps> = (props) => {
    const { workbook } = props;
    const contextMenu = useRowContextMenu();
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: `drag-workbook:${workbook.workbookId}`,
        data: { kind: 'workbook', workbook } satisfies DragData,
    });
    const name = workbook.name ?? 'Untitled';
    const published = timeOf(workbook.readyAt);
    const Caret = props.expanded ? ChevronDownIcon : ChevronRightIcon;
    return (
        <>
            <li
                ref={setNodeRef}
                className={classNames(styles.entry, { [styles.opening]: props.opening, [styles.dragging]: isDragging })}
                style={{ transform: CSS.Translate.toString(transform) }}
                data-testid="cloud-workbook-entry"
                {...attributes}
                {...rowDragListeners(listeners)}
                onContextMenu={contextMenu.onContextMenu}
            >
                <button
                    type="button"
                    className={styles.caret}
                    aria-label={props.expanded ? `Hide the versions of ${name}` : `Show the versions of ${name}`}
                    aria-expanded={props.expanded}
                    onClick={props.onToggle}
                ><Caret size={12} /></button>
                <StackIcon size={14} aria-hidden="true" />
                <button type="button" className={styles.name_button} data-testid="cloud-entry-name" disabled={props.opening} onClick={() => props.onOpen()} title={name}>
                    {name}
                    {props.folderName != null && <span className={styles.name_folder}>{props.folderName}</span>}
                </button>
                <span className={styles.detail}>v{workbook.version}{workbook.publishedBy == null ? '' : ` by ${workbook.publishedBy}`}</span>
                <span className={styles.detail} title={published?.title}>{published?.text ?? ''}</span>
                <CloudRowMenu
                    label={name}
                    contextMenu={contextMenu}
                    side={AnchorSide.OutsideBottom}
                    items={[
                        { action: 'open', icon: EyeIcon, text: 'Open read-only', run: () => props.onOpen() },
                        { action: 'import', icon: DownloadIcon, text: 'Import', run: () => props.onImport() },
                        ...(props.onMoveUp == null ? [] : [{ action: 'move-up', icon: FileDirectoryFillIcon, text: 'Move to the folder above', run: props.onMoveUp }]),
                        { action: 'delete', icon: TrashIcon, text: 'Delete from cloud', run: props.onDelete, danger: true },
                    ]}
                />
            </li>
            {props.expanded && <WorkbookVersions {...props} />}
        </>
    );
};

/// The versions of a published workbook, the latest first
const WorkbookVersions: React.FC<WorkbookEntryProps> = (props) => {
    const logger = useLogger();
    const [versions, setVersions] = React.useState<CloudWorkbookVersion[] | null>(null);
    const { cloudId, revision, listVersions } = props;
    const workbookId = props.workbook.workbookId;
    React.useEffect(() => {
        const controller = new AbortController();
        listVersions(cloudId, workbookId, controller.signal)
            .then(listed => { if (!controller.signal.aborted) setVersions(listed); })
            .catch(error => {
                if (controller.signal.aborted) return;
                logger.error('Listing the versions of a published workbook failed', { cloudWorkbookId: workbookId, error: stringifyError(error) }, LOG_CTX);
                setVersions([]);
            });
        return () => controller.abort();
    }, [cloudId, workbookId, listVersions, logger, revision]);
    if (versions == null) return <li className={classNames(styles.version, styles.note)}>Listing the versions</li>;
    return (
        <>
            {versions.map(version => {
                const published = timeOf(version.readyAt);
                const label = `Version ${version.version}`;
                return (
                    <li key={version.versionId} className={styles.version} data-testid="cloud-version-entry">
                        <span className={styles.caret} aria-hidden="true" />
                        <HistoryIcon size={14} aria-hidden="true" />
                        <button type="button" className={styles.name_button} data-testid="cloud-entry-name" onClick={() => props.onOpen(version.versionId)}>
                            v{version.version}{version.versionId === props.workbook.versionId ? ' (latest)' : ''}
                        </button>
                        <span className={styles.detail}>{version.publishedBy == null ? '' : `by ${version.publishedBy}`}</span>
                        <span className={styles.detail} title={published?.title}>{published?.text ?? ''}</span>
                        <CloudRowMenu
                            label={label}
                            side={AnchorSide.OutsideBottom}
                            items={[
                                { action: 'open', icon: EyeIcon, text: 'Open read-only', run: () => props.onOpen(version.versionId) },
                                { action: 'import', icon: DownloadIcon, text: 'Import this version', run: () => props.onImport(version.versionId) },
                            ]}
                        />
                    </li>
                );
            })}
        </>
    );
};
