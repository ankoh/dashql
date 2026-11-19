import * as React from 'react';
import * as core from '@akohn/dashql';
import symbols from '@akohn/dashql-svg-symbols';
import { List, type RowComponentProps, useListRef } from 'react-window';

import * as ActionList from '../ui/foundations/action_list.js';
import { AnchorAlignment, AnchorSide } from '../ui/foundations/anchored_position.js';
import { AnchoredOverlay } from '../ui/foundations/anchored_overlay.js';
import { ButtonSize, ButtonVariant, IconButton } from '../ui/foundations/button.js';
import { IndicatorStatus, StatusIndicator } from '../ui/foundations/status_indicator.js';
import { observeSize } from '../ui/foundations/size_observer.js';
import { VerticalScrollShadows } from '../ui/foundations/vertical_scroll_shadows.js';
import { NameInput } from '../ui/foundations/name_input.js';
import { type RowContextMenu, useRowContextMenu, useRowContextMenuOpener } from '../ui/foundations/row_context_menu.js';
import {
    ChevronDownIcon,
    ChevronRightIcon,
    CpuIcon,
    DatabaseIcon,
    FileDirectoryIcon,
    LinkIcon,
    PencilIcon,
    SymbolIcon,
    AlertIcon,
    SyncIcon,
    TableIcon,
    TrashIcon,
} from '../ui/foundations/symbol_icon.js';
import { classNames } from '../utils/classnames.js';
import { ConnectionHealth, type ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import { CONNECTION_HEALTH_COLORS, CONNECTION_HEALTH_NAMES } from './connection_status.js';
import {
    connectionLabelParts,
    connectionLabelText,
    isHyperWasmConnection,
    isListedConnection,
    supportsConnectionOverview,
    type ConnectionLabelParts,
} from './connection_label.js';
import { ConnectionLabelView } from './connection_label_view.js';
import { ConnectionURLShareOverlay } from './connection_url_share_overlay.js';
import type { ConnectionReplaceCandidates } from './connection_replace.js';
import { ConnectionReplacePicker } from './connection_replace_picker.js';
import { isCloudCapable } from './cloud_connection.js';
import * as styles from './connection_tree.module.css';
import * as actionMenuStyles from '../app/action_menu.module.css';
import { CONNECTOR_ICON_STYLE, useConnectorIcon } from './connector_icon.js';
import { connectorInfoOf } from '@akohn/dashql/platform/connections/connection_state';
import { useOptionalRuntime } from '@akohn/dashql-react/hooks';

const MoreIcon = SymbolIcon('kebab_horizontal');
/// No clouds
const NO_CLOUDS: readonly string[] = [];
const ColumnsIcon = SymbolIcon('columns_16');
const SettingsIcon = SymbolIcon('settings_16');
const MergeIcon = SymbolIcon('git_merge_16');
const ReplaceIcon = SymbolIcon('arrow_right_16');

export interface CatalogNode {
    key: string;
    name: string;
    kind: 'database' | 'schema' | 'table' | 'column';
    index: number;
    childBegin: number;
    childCount: number;
}

interface CatalogRow extends CatalogNode {
    type: 'catalog';
    depth: number;
}

interface ConnectionListRow {
    type: 'connection';
    key: string;
    database: ConnectionState;
}

/// The overview of a connection, below the connection
interface ConnectionOverviewRow {
    /// The row type
    type: 'connection-overview';
    /// The row key
    key: string;
    /// The connection
    database: ConnectionState;
}

/// The catalog of a connection, below the connection
interface ConnectionCatalogRow {
    /// The row type
    type: 'connection-catalog';
    /// The row key
    key: string;
    /// The connection
    database: ConnectionState;
}

/// The heading of a group of connections
interface ConnectionGroupRow {
    /// The row type
    type: 'connection-group';
    /// The row key
    key: string;
    /// The group
    group: ConnectionGroupKind;
    /// The heading
    label: string;
}

type ConnectionTreeRow = ConnectionGroupRow | ConnectionListRow | ConnectionOverviewRow | ConnectionCatalogRow | CatalogRow;

/// The heights of the rows with their spacing, see the heights of the entries in connection_tree.module.css
const CONNECTION_ROW_HEIGHT = 30;
const CATALOG_ROW_HEIGHT = 26;
/// The overview and catalog rows below a connection
const SECTION_ROW_HEIGHT = 28;
const CONNECTION_GROUP_ROW_HEIGHT = 26;
/// The extra space above a group label that follows another group
const CONNECTION_GROUP_GAP = 16;
/// The extra space above the first group label
const CONNECTION_GROUP_FIRST_GAP = 10;

export function isVisibleCatalogNode(kind: CatalogNode['kind'], name: string): boolean {
    return (kind !== 'database' && kind !== 'schema') || name.trim().length > 0;
}

function readCatalogNode(
    reader: core.DashQLFlatCatalogReader,
    level: CatalogNode['kind'],
    index: number,
    parentKey: string,
): CatalogNode | null {
    const catalog = reader.catalogReader;
    const entry = new core.buffers.catalog.FlatCatalogEntry();
    const value = level === 'database'
        ? catalog.databases(index, entry)
        : level === 'schema'
            ? catalog.schemas(index, entry)
            : level === 'table'
                ? catalog.tables(index, entry)
                : catalog.columns(index, entry);
    if (value == null) return null;

    const name = reader.readName(value.nameId());
    if (!isVisibleCatalogNode(level, name)) return null;
    const key = `${parentKey}/${level}:${index}:${name}`;
    return {
        key,
        name,
        kind: level,
        index,
        childBegin: value.childBegin(),
        childCount: value.childCount(),
    };
}

function catalogLevelLength(reader: core.DashQLFlatCatalogReader, level: CatalogNode['kind']): number {
    const catalog = reader.catalogReader;
    switch (level) {
        case 'database': return catalog.databasesLength();
        case 'schema': return catalog.schemasLength();
        case 'table': return catalog.tablesLength();
        case 'column': return catalog.columnsLength();
    }
}

function nextCatalogLevel(level: CatalogNode['kind']): CatalogNode['kind'] | null {
    switch (level) {
        case 'database': return 'schema';
        case 'schema': return 'table';
        case 'table': return 'column';
        case 'column': return null;
    }
}

export function createCatalogTree(reader: core.DashQLFlatCatalogReader, parentKey = 'catalog'): CatalogNode[] {
    const nodes: CatalogNode[] = [];
    for (let index = 0; index < reader.catalogReader.databasesLength(); ++index) {
        const node = readCatalogNode(reader, 'database', index, parentKey);
        if (node != null) nodes.push(node);
    }
    return nodes;
}

export function flattenCatalogRows(
    reader: core.DashQLFlatCatalogReader,
    roots: CatalogNode[],
    expanded: ReadonlySet<string>,
): CatalogRow[] {
    const rows: CatalogRow[] = [];
    const append = (node: CatalogNode, depth: number) => {
        rows.push({ ...node, type: 'catalog', depth });
        const nextLevel = nextCatalogLevel(node.kind);
        if (nextLevel == null || node.childCount === 0 || !expanded.has(node.key)) return;
        const end = Math.min(node.childBegin + node.childCount, catalogLevelLength(reader, nextLevel));
        for (let index = node.childBegin; index < end; ++index) {
            const child = readCatalogNode(reader, nextLevel, index, node.key);
            if (child != null) append(child, depth + 1);
        }
    };
    for (const root of roots) append(root, 0);
    return rows;
}

function catalogIcon(kind: CatalogNode['kind']): React.ReactElement {
    switch (kind) {
        case 'database': return <DatabaseIcon size={14} />;
        case 'schema': return <FileDirectoryIcon size={14} />;
        case 'table': return <TableIcon size={14} />;
        case 'column': return <ColumnsIcon size={14} />;
    }
}

interface ConnectionTreeEntryProps {
    name: string;
    /// The rendered name, the plain name by default
    label?: React.ReactNode;
    icon: React.ReactNode;
    depth: number;
    expanded?: boolean;
    onToggle?: () => void;
    /// Select the entry, only for entries that do not collapse
    onSelect?: () => void;
    /// Is the entry selected?
    selected?: boolean;
    children?: React.ReactNode;
    className?: string;
    /// The test id of the main element
    testId?: string;
    /// Double-click the entry, only for entries that collapse
    onDoubleClick?: () => void;
    /// An editor that replaces the name, e.g. while renaming
    editor?: React.ReactNode;
}

/// The left padding of an entry: the overview and catalog sit a little deeper than their connection, the catalog
/// entries one step per level
function connectionTreeEntryPadding(depth: number): number {
    return depth === 0 ? 8 : 16 + (depth - 1) * 12;
}

const ConnectionTreeEntry: React.FC<ConnectionTreeEntryProps> = ({
    name,
    label,
    icon,
    depth,
    expanded,
    onToggle,
    onSelect,
    selected,
    children,
    className,
    testId,
    onDoubleClick,
    editor,
}) => {
    const collapsible = onToggle != null;
    return (
        <div
            className={classNames(
                styles.entry_surface,
                (collapsible || onSelect != null) && styles.entry_interactive,
                selected && styles.entry_selected,
                styles.tree_entry,
                className,
            )}
            style={{ paddingLeft: `${connectionTreeEntryPadding(depth)}px` }}
        >
            {editor != null ? (
                <div className={styles.tree_entry_main} data-testid={testId}>
                    {collapsible
                        ? (expanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />)
                        : <span className={styles.tree_entry_spacer} />}
                    <span className={styles.tree_entry_icon} aria-hidden="true">{icon}</span>
                    {editor}
                </div>
            ) : collapsible ? (
                <button
                    type="button"
                    className={classNames(styles.tree_entry_main, styles.tree_entry_toggle)}
                    data-testid={testId}
                    aria-expanded={expanded}
                    aria-label={`${expanded ? 'Collapse' : 'Expand'} ${name}`}
                    onClick={onToggle}
                    onDoubleClick={onDoubleClick}
                >
                    {expanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
                    <span className={styles.tree_entry_icon} aria-hidden="true">{icon}</span>
                    <span className={styles.tree_entry_name}>{label ?? name}</span>
                </button>
            ) : onSelect != null ? (
                <button
                    type="button"
                    className={classNames(styles.tree_entry_main, styles.tree_entry_toggle)}
                    data-testid={testId}
                    aria-label={name}
                    aria-current={selected ? 'page' : undefined}
                    onClick={onSelect}
                >
                    <span className={styles.tree_entry_spacer} />
                    <span className={styles.tree_entry_icon} aria-hidden="true">{icon}</span>
                    <span className={styles.tree_entry_name}>{label ?? name}</span>
                </button>
            ) : (
                <div className={styles.tree_entry_main} data-testid={testId}>
                    <span className={styles.tree_entry_spacer} />
                    <span className={styles.tree_entry_icon} aria-hidden="true">{icon}</span>
                    <span className={styles.tree_entry_name}>{label ?? name}</span>
                </div>
            )}
            {children != null && <span className={styles.tree_entry_children}>{children}</span>}
        </div>
    );
};

interface ConnectionRenameInputProps {
    /// The renamed connection
    database: ConnectionState;
    /// The placeholder while the connection has no name
    placeholder: string;
    /// Commit the name, blank input means no name
    onCommit: (name: string) => void;
    /// Abandon the rename
    onCancel: () => void;
}

/// The name of a connection as an input, focused and selected when it appears
const ConnectionRenameInput: React.FC<ConnectionRenameInputProps> = ({ database, placeholder, onCommit, onCancel }) => {
    const inputRef = React.useRef<HTMLInputElement>(null);
    React.useEffect(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
    }, []);
    return (
        <NameInput
            ref={inputRef}
            className={styles.connection_rename_input}
            name={database.name ?? null}
            onCommit={onCommit}
            onCancel={onCancel}
            ariaLabel="Connection name"
            placeholder={placeholder}
        />
    );
};

interface ConnectionTreeRowProps {
    rows: ConnectionTreeRow[];
    expanded: ReadonlySet<string>;
    onToggle: (key: string) => void;
    onOpenSettings: (connectionId: string, anchor: HTMLButtonElement) => void;
    describeUsage?: (connectionId: string) => ConnectionUsage;
    onDelete?: (connectionId: string) => void;
    mergeCandidateCount?: (connectionId: string) => number;
    onMerge?: (connectionId: string) => void;
    replaceBlocker?: (connectionId: string) => string | null;
    replaceCandidates?: (connectionId: string) => ConnectionReplaceCandidates;
    onReplace?: (connectionId: string, targetId: string) => void;
    labelOf: (database: ConnectionState) => ConnectionLabelParts;
    attention: boolean;
    /// Open the overview of a connection
    onOpenOverview?: (connectionId: string) => void;
    /// The connection whose overview is open
    openOverviewId: string | null;
    /// Rename a connection, connections can't be renamed without it
    onRename?: (connectionId: string, name: string) => void;
    /// The connection that is being renamed
    renamingId: string | null;
    /// Start or stop renaming a connection
    setRenamingId: (connectionId: string | null) => void;
    /// The cloud connections
    cloudConnectionIds: readonly string[];
    /// Make a connection a cloud or stop using it as one
    onSetCloud?: (connectionId: string, isCloud: boolean) => void;
}

/// How workbooks use a connection
export interface ConnectionUsage {
    /// The number of workbooks that use the connection
    workbookCount: number;
    /// The number of workbooks that keep the connection from being deleted.
    /// A workbook whose new scripts merely default to the connection lets go of it.
    blockingWorkbookCount: number;
    /// Does the current workbook use the connection?
    usedHere: boolean;
}

export function connectionTreeRowHeight(index: number, props: Pick<ConnectionTreeRowProps, 'rows'>): number {
    switch (props.rows[index]?.type) {
        case 'connection-group':
            return CONNECTION_GROUP_ROW_HEIGHT + (index === 0 ? CONNECTION_GROUP_FIRST_GAP : CONNECTION_GROUP_GAP);
        case 'connection':
            return CONNECTION_ROW_HEIGHT + (index === 0 ? 8 : 0);
        case 'connection-overview':
        case 'connection-catalog':
            return SECTION_ROW_HEIGHT;
        default:
            return CATALOG_ROW_HEIGHT;
    }
}

const ConnectionTreeRow = (props: RowComponentProps<ConnectionTreeRowProps>) => {
    const connectorIcon = useConnectorIcon();
    const contextMenu = useRowContextMenu();
    const row = props.rows[props.index];
    if (row == null) return <div style={props.style} />;
    if (row.type === 'connection-group') {
        return (
            <div
                style={props.style}
                className={classNames(styles.connection_group_row, props.index === 0 && styles.connection_group_row_first)}
                role="heading"
                aria-level={3}
                data-testid="connection-group"
                data-group={row.group}
            >
                {row.label}
            </div>
        );
    }
    if (row.type === 'connection') {
        const expanded = props.expanded.has(row.key);
        const labelParts = props.labelOf(row.database);
        const label = connectionLabelText(labelParts);
        const usage = props.describeUsage?.(row.database.connectionId) ?? null;
        const connectionId = row.database.connectionId;
        const isCloud = props.cloudConnectionIds.includes(connectionId);
        const onRename = props.onRename;
        const startRename = onRename == null ? undefined : () => props.setRenamingId(connectionId);
        return (
            <div
                style={props.style}
                className={classNames(
                    styles.tree_row_container,
                    styles.database_row_container,
                    props.index === 0 && styles.database_row_container_first,
                )}
                data-connection-id={row.database.connectionId}
                onContextMenu={contextMenu.onContextMenu}
            >
                <ConnectionTreeEntry
                    className={styles.database_row}
                    testId="connection-toggle"
                    name={label}
                    label={<ConnectionLabelView parts={labelParts} />}
                    depth={0}
                    expanded={expanded}
                    onToggle={() => props.onToggle(row.key)}
                    onDoubleClick={startRename}
                    editor={onRename != null && props.renamingId === connectionId
                        ? (
                            <ConnectionRenameInput
                                database={row.database}
                                placeholder={labelParts.connector}
                                onCommit={name => {
                                    props.setRenamingId(null);
                                    onRename(connectionId, name);
                                }}
                                onCancel={() => props.setRenamingId(null)}
                            />
                        )
                        : undefined}
                    icon={(
                        <svg width="14" height="14">
                            <use xlinkHref={`${symbols}#${connectorIcon(connectorInfoOf(row.database))}`} style={CONNECTOR_ICON_STYLE} />
                        </svg>
                    )}
                >
                    {isCloud && (
                        <span className={styles.cloud_badge} title="Cloud" aria-label="Cloud" role="img" data-testid="connection-cloud-badge">
                            <svg width="14" height="14" aria-hidden="true">
                                <use xlinkHref={`${symbols}#cloud`} />
                            </svg>
                        </span>
                    )}
                    <ConnectionStatusButton
                        database={row.database}
                        label={label}
                        usedHere={usage?.usedHere ?? false}
                        attention={props.attention}
                        onOpenSettings={anchor => props.onOpenSettings(row.database.connectionId, anchor)}
                    />
                    <ConnectionRowMenu
                        database={row.database}
                        label={label}
                        contextMenu={contextMenu}
                        onOpenSettings={anchor => props.onOpenSettings(row.database.connectionId, anchor)}
                        onRename={startRename}
                        // Workbooks fall back to the embedded Hyper, it is never deleted
                        onDelete={props.onDelete == null || usage == null || isHyperWasmConnection(row.database) ? undefined : () => props.onDelete!(row.database.connectionId)}
                        onMerge={props.onMerge == null ? undefined : () => props.onMerge!(row.database.connectionId)}
                        mergeCandidateCount={props.mergeCandidateCount?.(row.database.connectionId)}
                        onReplace={props.onReplace == null || props.replaceCandidates == null
                            ? undefined
                            : targetId => props.onReplace!(connectionId, targetId)}
                        replaceBlocker={props.replaceBlocker == null ? undefined : () => props.replaceBlocker!(connectionId)}
                        replaceCandidates={props.replaceCandidates == null ? undefined : () => props.replaceCandidates!(connectionId)}
                        labelOf={props.labelOf}
                        workbookCount={usage?.blockingWorkbookCount}
                        isCloud={isCloud}
                        onSetCloud={props.onSetCloud == null || (!isCloud && !isCloudCapable(row.database.params))
                            ? undefined
                            : cloud => props.onSetCloud!(connectionId, cloud)}
                    />
                </ConnectionTreeEntry>
            </div>
        );
    }
    if (row.type === 'connection-overview') {
        const label = connectionLabelText(props.labelOf(row.database));
        return (
            <div style={props.style} className={styles.tree_row_container} data-connection-id={row.database.connectionId}>
                <ConnectionTreeEntry
                    className={styles.section_row}
                    testId="connection-overview"
                    name={`Overview of ${label}`}
                    label="Overview"
                    icon={<CpuIcon size={14} />}
                    depth={1}
                    selected={props.openOverviewId === row.database.connectionId}
                    onSelect={() => props.onOpenOverview?.(row.database.connectionId)}
                />
            </div>
        );
    }
    if (row.type === 'connection-catalog') {
        const label = connectionLabelText(props.labelOf(row.database));
        return (
            <div style={props.style} className={styles.tree_row_container} data-connection-id={row.database.connectionId}>
                <ConnectionTreeEntry
                    className={styles.section_row}
                    testId="connection-catalog-toggle"
                    name={`Catalog of ${label}`}
                    label="Catalog"
                    icon={<DatabaseIcon size={14} />}
                    depth={1}
                    expanded={props.expanded.has(row.key)}
                    onToggle={() => props.onToggle(row.key)}
                >
                    <ConnectionRefreshButton database={row.database} label={label} />
                </ConnectionTreeEntry>
            </div>
        );
    }
    const node = row;
    const expandable = node.childCount > 0;
    const expanded = props.expanded.has(node.key);
    return (
        <div style={props.style} className={styles.tree_row_container}>
            <ConnectionTreeEntry
                className={styles.catalog_row}
                testId="catalog-node"
                name={node.name || 'Unnamed'}
                icon={catalogIcon(node.kind)}
                depth={node.depth + 2}
                expanded={expanded}
                onToggle={expandable ? () => props.onToggle(node.key) : undefined}
            >
                <span className={styles.catalog_node_kind}>{node.kind}</span>
            </ConnectionTreeEntry>
        </div>
    );
};

interface ConnectionTreeProps {
    databases: ConnectionState[];
    /// The catalogs of the connections, the ones of the runtime by default
    catalogOf?: (connectionId: string) => core.DashQLCatalog | null;
    /// Open the settings of a connection
    onOpenSettings: (connectionId: string, anchor: HTMLButtonElement) => void;
    /// Describe how workbooks use a connection
    describeUsage?: (connectionId: string) => ConnectionUsage;
    /// Delete a connection that no workbook uses
    onDelete?: (connectionId: string) => void;
    /// The number of connections that can be merged into a connection
    mergeCandidateCount?: (connectionId: string) => number;
    /// Merge other connections into a connection
    onMerge?: (connectionId: string) => void;
    /// What keeps a connection from being replaced, null if it can be replaced
    replaceBlocker?: (connectionId: string) => string | null;
    /// The connections that can replace a connection
    replaceCandidates?: (connectionId: string) => ConnectionReplaceCandidates;
    /// Replace a connection with another one in every workbook
    onReplace?: (connectionId: string, targetId: string) => void;
    /// Is a connection expanded initially?
    initiallyExpanded?: (database: ConnectionState, databaseCount: number) => boolean;
    /// The connections of the current workbook, they are grouped apart from the other connections and the unused ones
    workbookConnectionIds?: ReadonlySet<string>;
    /// Label a connection
    labelOf?: (database: ConnectionState) => ConnectionLabelParts;
    /// Does the current workbook ask for its connections to execute?
    attention?: boolean;
    /// Open the overview of a connection, connections offer no overview without it
    onOpenOverview?: (connectionId: string) => void;
    /// The connection whose overview is open
    openOverviewId?: string | null;
    /// Rename a connection, a blank name restores the default label. Connections can't be renamed without it
    onRename?: (connectionId: string, name: string) => void;
    /// The cloud connections, they are listed first in their group
    cloudConnectionIds?: readonly string[];
    /// Make a connection a cloud or stop using it as one. Connections can't become clouds without it
    onSetCloud?: (connectionId: string, isCloud: boolean) => void;
}

const connectionKey = (connectionId: string) => `connection:${connectionId}`;
const catalogKey = (connectionId: string) => `${connectionKey(connectionId)}/catalog`;
const overviewKey = (connectionId: string) => `${connectionKey(connectionId)}/overview`;

/// The groups of the connection tree
type ConnectionGroupKind = 'workbook' | 'other' | 'unused';

/// The order of the groups of the connection tree
const CONNECTION_GROUP_ORDER: ConnectionGroupKind[] = ['workbook', 'other', 'unused'];

/// The headings of the groups of the connection tree
const CONNECTION_GROUP_LABELS: Record<ConnectionGroupKind, string> = {
    workbook: 'This workbook',
    other: 'Other connections',
    unused: 'Unused connections',
};

const defaultConnectionLabelOf = (database: ConnectionState) => connectionLabelParts(database);

/// Keep the identity of an array as long as its elements are identical
function useShallowStableArray<T>(values: T[]): T[] {
    const ref = React.useRef(values);
    if (ref.current.length !== values.length || ref.current.some((value, i) => value !== values[i])) {
        ref.current = values;
    }
    return ref.current;
}

export const ConnectionTree: React.FC<ConnectionTreeProps> = ({
    databases,
    onOpenSettings,
    describeUsage,
    onDelete,
    mergeCandidateCount,
    onMerge,
    replaceBlocker,
    replaceCandidates,
    onReplace,
    initiallyExpanded = isConnectionInitiallyExpanded,
    workbookConnectionIds,
    labelOf = defaultConnectionLabelOf,
    attention = false,
    onOpenOverview,
    openOverviewId = null,
    onRename,
    cloudConnectionIds = NO_CLOUDS,
    onSetCloud,
    catalogOf,
}) => {
    const runtime = useOptionalRuntime();
    // The database states change with every query event while the catalogs rarely change.
    // A catalog caches its flat form until its version changes, so its identity tells us when the trees
    // must be rebuilt.
    const connectionIds = useShallowStableArray(databases.map(database => database.connectionId));
    const catalog = (connectionId: string) => catalogOf != null ? catalogOf(connectionId) : runtime?.catalog(connectionId) ?? null;
    const flatCatalogs = useShallowStableArray(databases.map(database => catalog(database.connectionId)?.flatten() ?? null));
    const catalogTrees = React.useMemo(() => connectionIds.map((connectionId, i) => {
        const reader = flatCatalogs[i]?.read() ?? null;
        return {
            connectionId,
            reader,
            roots: reader == null ? [] : createCatalogTree(reader, catalogKey(connectionId)),
        };
    }), [connectionIds, flatCatalogs]);
    const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(() => {
        const initial = new Set<string>();
        catalogTrees.forEach((tree, i) => {
            if (!initiallyExpanded(databases[i], databases.length)) return;
            initial.add(connectionKey(tree.connectionId));
            initial.add(catalogKey(tree.connectionId));
            for (const root of tree.roots) initial.add(root.key);
        });
        return initial;
    });
    const knownConnectionIds = React.useRef(new Set(connectionIds));
    React.useEffect(() => {
        const nextConnectionIds = new Set(connectionIds);
        setExpanded(current => {
            const next = new Set([...current].filter(key => {
                const connectionId = key.split(':', 2)[1]?.split('/', 1)[0];
                return connectionId == null || nextConnectionIds.has(connectionId);
            }));
            catalogTrees.forEach((tree, i) => {
                if (knownConnectionIds.current.has(tree.connectionId)) return;
                if (initiallyExpanded(databases[i], databases.length)) {
                    next.add(connectionKey(tree.connectionId));
                    next.add(catalogKey(tree.connectionId));
                    for (const root of tree.roots) next.add(root.key);
                }
            });
            return next;
        });
        knownConnectionIds.current = nextConnectionIds;
    }, [connectionIds]);
    const catalogRows = React.useMemo(() => catalogTrees.map(tree => (
        expanded.has(connectionKey(tree.connectionId)) && expanded.has(catalogKey(tree.connectionId))
            ? (tree.reader == null ? [] : flattenCatalogRows(tree.reader, tree.roots, expanded))
            : []
    )), [catalogTrees, expanded]);
    const rows = React.useMemo(() => {
        const next: ConnectionTreeRow[] = [];
        const pushConnection = (database: ConnectionState, i: number) => {
            next.push({ type: 'connection', key: connectionKey(database.connectionId), database });
            if (!expanded.has(connectionKey(database.connectionId))) return;
            if (onOpenOverview != null && supportsConnectionOverview(database)) {
                next.push({ type: 'connection-overview', key: overviewKey(database.connectionId), database });
            }
            next.push({ type: 'connection-catalog', key: catalogKey(database.connectionId), database });
            next.push(...catalogRows[i]);
        };
        // The clouds come first in their group, in their order
        const cloudRank = (i: number) => {
            const rank = cloudConnectionIds.indexOf(databases[i].connectionId);
            return rank < 0 ? cloudConnectionIds.length : rank;
        };
        const order = databases.map((_, i) => i).sort((a, b) => cloudRank(a) - cloudRank(b) || a - b);
        if (workbookConnectionIds == null) {
            for (const i of order) pushConnection(databases[i], i);
            return next;
        }
        const groupOf = (database: ConnectionState): ConnectionGroupKind => {
            if (workbookConnectionIds.has(database.connectionId)) return 'workbook';
            return describeUsage?.(database.connectionId).workbookCount === 0 ? 'unused' : 'other';
        };
        const groups = databases.map(groupOf);
        for (const group of CONNECTION_GROUP_ORDER) {
            if (!groups.includes(group)) continue;
            next.push({ type: 'connection-group', key: `connection-group:${group}`, group, label: CONNECTION_GROUP_LABELS[group] });
            for (const i of order) {
                if (groups[i] === group) pushConnection(databases[i], i);
            }
        }
        return next;
    }, [databases, catalogRows, cloudConnectionIds, describeUsage, expanded, onOpenOverview, workbookConnectionIds]);
    // The rows are virtualized, the tree remembers the renamed connection while its row scrolls out of view
    const [renamingId, setRenamingId] = React.useState<string | null>(null);
    const containerRef = React.useRef<HTMLDivElement>(null);
    const size = observeSize(containerRef);
    const listRef = useListRef(null);
    const getScrollElement = React.useCallback(() => listRef.current?.element ?? null, [listRef]);
    const toggle = React.useCallback((key: string) => {
        setExpanded(current => {
            const next = new Set(current);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }, []);
    const rowProps = React.useMemo<ConnectionTreeRowProps>(() => ({
        rows,
        expanded,
        onToggle: toggle,
        onOpenSettings,
        describeUsage,
        onDelete,
        mergeCandidateCount,
        onMerge,
        replaceBlocker,
        replaceCandidates,
        onReplace,
        labelOf,
        attention,
        onOpenOverview,
        openOverviewId,
        onRename,
        renamingId,
        setRenamingId,
        cloudConnectionIds,
        onSetCloud,
    }), [attention, cloudConnectionIds, describeUsage, expanded, labelOf, mergeCandidateCount, onDelete, onMerge, onOpenOverview, onOpenSettings, onRename, onReplace, onSetCloud, openOverviewId, renamingId, replaceBlocker, replaceCandidates, rows, toggle]);
    return (
        <div ref={containerRef} className={styles.database_list} aria-label="Connections and catalogs">
            <List
                listRef={listRef}
                style={{ width: size?.width ?? 200, height: size?.height ?? 200 }}
                rowCount={rows.length}
                rowHeight={connectionTreeRowHeight}
                rowComponent={ConnectionTreeRow}
                rowProps={rowProps}
            />
            <VerticalScrollShadows getScrollElement={getScrollElement} refreshKey={rows.length} />
        </div>
    );
};

/// The connections shown next to the workbooks.
/// The connections of the current workbook come first, followed by the connections of other
/// workbooks and active connections that no workbook uses. The clouds are always listed.
export function listedConnections(
    connections: ReadonlyMap<string, ConnectionState>,
    list: Pick<core.ConnectionListView, 'connections'> | null,
    currentWorkbookConnections: readonly ConnectionState[],
    cloudConnectionIds: readonly string[] = NO_CLOUDS,
): ConnectionState[] {
    const listed = [...currentWorkbookConnections];
    const seen = new Set(listed.map(database => database.connectionId));
    for (const [connectionId, database] of connections) {
        if (!seen.has(connectionId) && (cloudConnectionIds.includes(connectionId) || isListedConnection(list, connectionId))) {
            listed.push(database);
        }
    }
    return listed;
}

export function isConnectionInitiallyExpanded(database: ConnectionState, databaseCount: number): boolean {
    return databaseCount === 1 || !isHyperWasmConnection(database);
}

interface ConnectionRowMenuProps {
    database: ConnectionState;
    label: string;
    onOpenSettings: (anchor: HTMLButtonElement) => void;
    /// Rename the connection
    onRename?: () => void;
    /// Delete the connection, only possible if no workbook keeps it
    onDelete?: () => void;
    /// Merge other connections into the connection
    onMerge?: () => void;
    /// The number of connections that can be merged into the connection
    mergeCandidateCount?: number;
    /// Replace the connection with another one in every workbook
    onReplace?: (targetId: string) => void;
    /// What keeps the connection from being replaced, null if it can be replaced. Read while the menu is open
    replaceBlocker?: () => string | null;
    /// The connections that can replace the connection, read when the picker opens
    replaceCandidates?: () => ConnectionReplaceCandidates;
    /// Label a connection of the replace picker
    labelOf?: (database: ConnectionState) => ConnectionLabelParts;
    /// The number of workbooks that keep the connection from being deleted
    workbookCount?: number;
    /// The right click of the row that opens the menu
    contextMenu?: RowContextMenu;
    /// Is the connection the cloud connection?
    isCloud?: boolean;
    /// Use the connection as cloud connection or stop using it, only for connections that can be one
    onSetCloud?: (cloud: boolean) => void;
    dependencies?: ConnectionRefreshDependencies;
}

export interface ConnectionRefreshDependencies {
    /// Request a refresh of the catalog of a connection, `force` to refresh its whole catalog
    useRefreshCatalog: () => (connectionId: string, force: boolean) => void;
}

/// Request a refresh of the catalog of a connection from the catalog loader of the runtime. The runtime is resolved
/// when the function is called.
function useRefreshCatalog(): (connectionId: string, force: boolean) => void {
    const runtime = useOptionalRuntime();
    return React.useCallback((connectionId: string, force: boolean) => {
        if (runtime == null) throw new Error('the catalog loader needs a RuntimeProvider');
        runtime.refreshCatalog(connectionId, force);
    }, [runtime]);
}

const DEFAULT_CONNECTION_REFRESH_DEPENDENCIES: ConnectionRefreshDependencies = {
    useRefreshCatalog,
};

export const ConnectionRowMenu: React.FC<ConnectionRowMenuProps> = ({ database, label, onOpenSettings, onRename, onDelete, onMerge, mergeCandidateCount = 0, onReplace, replaceBlocker: readReplaceBlocker, replaceCandidates, labelOf = defaultConnectionLabelOf, workbookCount = 0, contextMenu, isCloud = false, onSetCloud, dependencies = DEFAULT_CONNECTION_REFRESH_DEPENDENCIES }) => {
    const [open, setOpen] = React.useState(false);
    useRowContextMenuOpener(contextMenu, () => setOpen(true));
    // The menu turns into the picker of the connection that replaces this one
    const [replacing, setReplacing] = React.useState<ConnectionReplaceCandidates | null>(null);
    const close = React.useCallback(() => {
        setOpen(false);
        setReplacing(null);
    }, []);
    const replaceBlocker = open && onReplace != null ? readReplaceBlocker?.() ?? null : null;
    const [shareOpen, setShareOpen] = React.useState(false);
    // The embedded Hyper is local to the app, a link to it would open an empty workbook on the embedded Hyper of the recipient
    const canShare = !isHyperWasmConnection(database);
    const triggerRef = React.useRef<HTMLButtonElement>(null);
    const refreshCatalog = dependencies.useRefreshCatalog();
    const isRefreshing = database.catalogUpdates.refreshRunning;
    const canRefresh = database.canRefresh;

    return (
        <AnchoredOverlay
            open={open}
            onOpen={() => setOpen(true)}
            onClose={close}
            // The picker is taller than the actions, the overlay is placed again when it shows
            positionRevision={replacing == null ? 0 : 1}
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
                    className={styles.database_menu_button}
                    data-testid="connection-row-menu"
                    aria-label={`More actions for ${label}`}
                    onClick={(event) => {
                        event.stopPropagation();
                        anchorProps.onClick?.(event);
                    }}
                >
                    <MoreIcon size={14} />
                </IconButton>
            )}
        >
            {replacing != null && onReplace != null ? (
                <ConnectionReplacePicker
                    source={database}
                    candidates={replacing}
                    labelOf={labelOf}
                    onCancel={() => setReplacing(null)}
                    onConfirm={targetId => {
                        close();
                        onReplace(targetId);
                    }}
                />
            ) : <div className={actionMenuStyles.menu} role="dialog" aria-label={`Actions for ${label}`}>
                <ActionList.List aria-label={`Actions for ${label}`}>
                    {/* The list takes elements only, the fragment wraps the optional item */}
                    <>{onRename && (
                        <ActionList.ListItem data-testid="connection-menu-item" data-action="rename" onClick={() => {
                            setOpen(false);
                            onRename();
                        }}>
                            <ActionList.Leading><PencilIcon size={16} /></ActionList.Leading>
                            <ActionList.ItemText>Rename</ActionList.ItemText>
                        </ActionList.ListItem>
                    )}</>
                    <ActionList.ListItem data-testid="connection-menu-item" data-action="settings" onClick={() => {
                        const anchor = triggerRef.current;
                        setOpen(false);
                        if (anchor != null) onOpenSettings(anchor);
                    }}>
                        <ActionList.Leading><SettingsIcon size={16} /></ActionList.Leading>
                        <ActionList.ItemText>Settings</ActionList.ItemText>
                    </ActionList.ListItem>
                    <ActionList.ListItem
                        data-testid="connection-menu-item"
                        data-action="refresh"
                        disabled={!canRefresh}
                        aria-busy={isRefreshing}
                        onClick={() => {
                            setOpen(false);
                            refreshCatalog(database.connectionId, true);
                        }}
                    >
                        <ActionList.Leading>
                            {isRefreshing
                                ? <StatusIndicator status={IndicatorStatus.Running} width="16px" height="16px" />
                                : <SyncIcon size={16} />}
                        </ActionList.Leading>
                        <ActionList.ItemText>Refresh</ActionList.ItemText>
                    </ActionList.ListItem>
                    {/* The list takes elements only, the fragment wraps the optional item */}
                    <>{onSetCloud && (
                        <ActionList.ListItem data-testid="connection-menu-item" data-action="cloud" onClick={() => {
                            setOpen(false);
                            onSetCloud(!isCloud);
                        }}>
                            <ActionList.Leading>
                                <svg width="16" height="16" aria-hidden="true">
                                    <use xlinkHref={`${symbols}#${isCloud ? 'cloud_offline' : 'cloud'}`} />
                                </svg>
                            </ActionList.Leading>
                            <ActionList.ItemText>{isCloud ? 'Stop Using as Cloud' : 'Use as Cloud'}</ActionList.ItemText>
                        </ActionList.ListItem>
                    )}</>
                    {/* The list takes elements only, the fragment wraps the optional item */}
                    <>{canShare && (
                        <ActionList.ListItem data-testid="connection-menu-item" data-action="share-url" onClick={(event) => {
                            event.stopPropagation();
                            setShareOpen(value => !value);
                        }}>
                            <ActionList.Leading><LinkIcon size={16} /></ActionList.Leading>
                            <ActionList.ItemText>
                                Share as URL
                                <ConnectionURLShareOverlay database={database} isOpen={shareOpen} setIsOpen={setShareOpen} />
                            </ActionList.ItemText>
                        </ActionList.ListItem>
                    )}</>
                    {/* The list takes elements only, the fragments wrap the optional items */}
                    <>{onMerge && mergeCandidateCount > 0 && (
                        <ActionList.ListItem data-testid="connection-menu-item" data-action="merge" onClick={() => {
                            setOpen(false);
                            onMerge();
                        }}>
                            <ActionList.Leading><MergeIcon size={16} /></ActionList.Leading>
                            <ActionList.ItemText>
                                <ActionList.ItemTextTitle>Merge…</ActionList.ItemTextTitle>
                                <ActionList.ItemTextDescription>{`${mergeCandidateCount} ${mergeCandidateCount === 1 ? 'duplicate' : 'duplicates'}`}</ActionList.ItemTextDescription>
                            </ActionList.ItemText>
                        </ActionList.ListItem>
                    )}</>
                    <>{onReplace && replaceCandidates && (
                        <ActionList.ListItem
                            data-testid="connection-menu-item"
                            data-action="replace"
                            disabled={replaceBlocker != null}
                            title={replaceBlocker ?? undefined}
                            onClick={(event) => {
                                // The menu stays open, it shows the picker
                                event.stopPropagation();
                                setReplacing(replaceCandidates());
                            }}
                        >
                            <ActionList.Leading><ReplaceIcon size={16} /></ActionList.Leading>
                            <ActionList.ItemText>
                                <ActionList.ItemTextTitle>Replace with</ActionList.ItemTextTitle>
                                {replaceBlocker != null
                                    ? <ActionList.ItemTextDescription>{replaceBlocker}</ActionList.ItemTextDescription>
                                    : <></>}
                            </ActionList.ItemText>
                        </ActionList.ListItem>
                    )}</>
                    <>{onDelete && (
                        <ActionList.ListItem
                            className={actionMenuStyles.delete_action}
                            data-testid="connection-menu-item"
                            data-action="delete"
                            disabled={workbookCount > 0}
                            title={workbookCount > 0 ? `Used by ${workbookCount} ${workbookCount === 1 ? 'workbook' : 'workbooks'}` : undefined}
                            onClick={() => {
                                setOpen(false);
                                onDelete();
                            }}
                        >
                            <ActionList.Leading><TrashIcon size={16} /></ActionList.Leading>
                            <ActionList.ItemText>
                                <ActionList.ItemTextTitle>Delete</ActionList.ItemTextTitle>
                                {workbookCount > 0
                                    ? <ActionList.ItemTextDescription>{`Used by ${workbookCount} ${workbookCount === 1 ? 'workbook' : 'workbooks'}`}</ActionList.ItemTextDescription>
                                    : <></>}
                            </ActionList.ItemText>
                        </ActionList.ListItem>
                    )}</>
                </ActionList.List>
            </div>}
        </AnchoredOverlay>
    );
};

interface ConnectionRefreshButtonProps {
    database: ConnectionState;
    label: string;
    dependencies?: ConnectionRefreshDependencies;
}

export const ConnectionRefreshButton: React.FC<ConnectionRefreshButtonProps> = ({ database, label, dependencies = DEFAULT_CONNECTION_REFRESH_DEPENDENCIES }) => {
    const refreshCatalog = dependencies.useRefreshCatalog();
    const isRefreshing = database.catalogUpdates.refreshRunning;
    const canRefresh = database.canRefresh;

    return (
        <IconButton
            size={ButtonSize.Small}
            variant={ButtonVariant.Invisible}
            className={styles.database_refresh_button}
            data-testid="connection-refresh"
            aria-label={database.catalogUpdates.outOfDate ? `The catalog of ${label} may be out of date, refresh it` : `Refresh catalog for ${label}`}
            title={database.catalogUpdates.outOfDate ? 'The catalog may be out of date. Refresh it.' : undefined}
            aria-busy={isRefreshing}
            disabled={!canRefresh}
            onClick={() => refreshCatalog(database.connectionId, true)}
        >
            {isRefreshing
                ? <StatusIndicator status={IndicatorStatus.Running} width="14px" height="14px" />
                : database.catalogUpdates.outOfDate
                    ? <AlertIcon size={14} />
                    : <SyncIcon size={14} />}
        </IconButton>
    );
};

interface ConnectionStatusButtonProps {
    /// The connection
    database: ConnectionState;
    /// The label of the connection
    label: string;
    /// Does the current workbook use the connection?
    usedHere: boolean;
    /// Does the current workbook ask for its connections to execute?
    attention?: boolean;
    /// Open the settings of the connection
    onOpenSettings: (anchor: HTMLButtonElement) => void;
}

/// The health of a connection, opens its settings.
/// Pulses while the current workbook asks for a connection to execute and the connection is not online.
export const ConnectionStatusButton: React.FC<ConnectionStatusButtonProps> = ({ database, label, usedHere, attention = false, onOpenSettings }) => {
    const health = database.connectionHealth;
    const online = health === ConnectionHealth.ONLINE;
    const pulse = usedHere && !online && attention;
    return (
        <IconButton
            size={ButtonSize.Small}
            variant={ButtonVariant.Invisible}
            className={classNames(styles.database_status_button, pulse && styles.database_status_attention)}
            data-connection-attention={pulse ? 'true' : undefined}
            aria-label={`${label}: ${CONNECTION_HEALTH_NAMES[health] ?? 'Disconnected'}`}
            title={online ? `${label} connection settings` : 'Connect to execute queries'}
            onClick={event => onOpenSettings(event.currentTarget)}
        >
            {health === ConnectionHealth.CONNECTING
                ? <StatusIndicator status={IndicatorStatus.Running} width="14px" height="14px" />
                : <svg width="14px" height="14px" viewBox="0 0 16 16" aria-hidden="true" data-testid="connection-health-dot">
                    <circle cx="8" cy="8" r="4" style={{ fill: CONNECTION_HEALTH_COLORS[health] ?? CONNECTION_HEALTH_COLORS[ConnectionHealth.NOT_STARTED] }} />
                </svg>}
        </IconButton>
    );
};

