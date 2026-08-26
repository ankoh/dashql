import * as React from 'react';

import symbols from '@ankoh/dashql-svg-symbols';
import * as baseStyles from '../../ui/banner/banner_page.module.css';
import * as styles from './notebook_selector_page.module.css';

import {
    DndContext,
    DragEndEvent,
    KeyboardSensor,
    PointerSensor,
    closestCenter,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import {
    SortableContext,
    arrayMove,
    verticalListSortingStrategy,
    sortableKeyboardCoordinates,
    useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ButtonVariant, IconButton } from '../../ui/foundations/button.js';
import { DASHQL_VERSION } from '../../globals.js';
import { SELECT_NOTEBOOK, BEGIN_NOTEBOOK_SETUP, CANCEL_NOTEBOOK_SETUP, SKIP_NOTEBOOK_SETUP, useRouteContext, useRouterNavigate } from '../router/router.js';
import { NotebookSetupStatus } from '../router/notebook_setup_status.js';
import { ConnectionRegistry, useDynamicConnectionDispatch } from '../notebook/connections/connection_registry.js';
import { DELETE_CONNECTION } from '../notebook/connections/connection_state.js';
import { TrashIcon, CircleSlashIcon, DashIcon, PlusIcon, AlertIcon, FileDirectoryIcon, UnlinkIcon } from '@primer/octicons-react';
import { NotebookScriptsRegistry, useNotebookScriptsDeletion } from '../notebook/scripts/notebook_scripts_registry.js';
import { ConnectionState, ConnectionStateWithoutId, ConnectionHealth } from '../notebook/connections/connection_state.js';
import {
    CONNECTOR_INFOS,
    ConnectorType,
} from '../notebook/connections/connector_info.js';
import { isNativePlatform } from '../../platform/native_globals.js';
import { createConnectionStateFromParams, createDefaultConnectionParamsForConnector } from '../notebook/connections/connection_params.js';
import { ConnectionConfigCard } from '../notebook/connections/ui/connection_config_card.js';
import { NotebookScriptsSetup } from '../notebook/scripts/notebook_scripts_setup.js';
import type { DashQL } from '../../core/index.js';
import { useStorageReader, useStorageWriter } from '../notebook/persistence/storage_provider.js';
import { cloneNotebook } from '../notebook/persistence/storage_migration.js';
import { mergeRestoredNotebookIntoConnections, mergeRestoredNotebookIntoScripts, restoreSingleNotebook } from '../notebook/persistence/app_state_loader.js';
import { useConnectionRegistry } from '../notebook/connections/connection_registry.js';
import { useNotebookScriptsRegistry } from '../notebook/scripts/notebook_scripts_registry.js';
import { displayPath as notebookDisplayPath } from '../notebook/persistence/notebook_locator.js';
import { StorageBackendType } from '../notebook/persistence/storage_backend.js';
import { CompositeStorageBackend } from '../notebook/persistence/composite_storage_backend.js';
import { addNativeNotebookFromFolder } from '../notebook/persistence/storage_migration_flow.js';
import { PlatformType, usePlatformType } from '../../platform/platform_type.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { SymbolIcon } from '../../ui/foundations/symbol_icon.js';
import { useKeyEvents, KeyEventHandler } from '../../utils/key_events.js';
import { AnchorAlignment, AnchorSide } from '../../ui/foundations/anchored_position.js';
import { InternalsViewerOverlay } from './internals/internals_overlay.js';
import { InvalidNotebook, describeNotebookValidationError } from '../notebook/persistence/notebook_validation.js';
import { useComputationRegistry } from '../../compute/computation_registry.js';
import { DELETE_COMPUTATION } from '../../compute/computation_state.js';

interface Props {
    connectionRegistry: ConnectionRegistry;
    notebookScriptsRegistry: NotebookScriptsRegistry;
    allocateConnection: (state: ConnectionStateWithoutId) => ConnectionState;
    setupNotebookScripts: NotebookScriptsSetup;
    core: DashQL | null;
    /// Notebooks whose metadata was refused a load (keyed by bare UUID). Shown as invalid: blocked
    /// from opening, deletable in edit mode.
    invalidNotebooks?: Map<string, InvalidNotebook>;
    /// Delete an invalid notebook's persisted files and drop it from the list.
    onDeleteInvalidNotebook?: (notebookId: string) => void;
}

interface NotebookItemData {
    notebookId: string;
    /// The connection backing a valid notebook, or null for an invalid (refused) notebook.
    connection: ConnectionState | null;
    displayName: string;
    /// The user-supplied notebook name, or null if the user never named it. When set it leads the
    /// row (primary) with the path dimmed beside it; when null the path is the sole label.
    notebookName: string | null;
    displayPath: string;
    connectorType: ConnectorType;
    lastAccessed: Date | null;
    /// True when the notebook's files live in a native folder on disk. Deleting such a notebook only
    /// unlinks it (the folder stays put), so the delete affordance shows an unlink icon, not a trash.
    isNative: boolean;
    /// Set when the notebook's metadata was refused a load; carries the reason to display.
    invalidReason: string | null;
}

const LIST_MAX_HEIGHT = 400; // Max height of the scrollable list before it scrolls
const LIST_WIDTH = 400; // Width of the list to accommodate long paths
const DuplicateIcon = SymbolIcon('duplicate_16');

export const NotebookSelectorPage: React.FC<Props> = (props: Props) => {
    const navigate = useRouterNavigate();
    const routeContext = useRouteContext();
    const configNotebookId = routeContext.notebookSetupStatus === NotebookSetupStatus.CONFIGURING ? routeContext.notebookId : null;
    const [isEditMode, setIsEditMode] = React.useState(false);
    const [isCopyMode, setIsCopyMode] = React.useState(false);
    const [showInternals, setShowInternals] = React.useState<boolean>(false);
    const [_registry, connectionDispatch] = useDynamicConnectionDispatch();
    const [, setConnReg] = useConnectionRegistry();
    const [, setNotebookScriptsRegistry] = useNotebookScriptsRegistry();
    const [_computationState, computationDispatch] = useComputationRegistry();
    const deleteNotebookScripts = useNotebookScriptsDeletion();
    const storageWriter = useStorageWriter();
    const storageReader = useStorageReader();
    const logger = useLogger();
    const platform = usePlatformType();
    // The manifest notebook order lives in mutable backend state (see storageReader.getNotebookOrder).
    // Bumping this after a drag-persist forces the list to re-read and re-render in the new order.
    const [orderVersion, setOrderVersion] = React.useState(0);

    // Opening a folder-backed notebook needs the native filesystem and a per-notebook-routing
    // composite backend (web OPFS has neither a folder picker nor on-disk notebooks to load).
    const canOpenFolder =
        platform === PlatformType.MACOS &&
        storageReader.backend instanceof CompositeStorageBackend;

    // Compute the internals button only once to prevent svg flickering
    const internalsButton = React.useMemo(() => {
        return (
            <IconButton
                variant={ButtonVariant.Invisible}
                aria-label="Show Internals"
                onClick={() => setShowInternals(s => !s)}
            >
                <svg width="16px" height="16px">
                    <use xlinkHref={`${symbols}#processor`} />
                </svg>
            </IconButton>
        );
    }, []);

    // Build list of notebooks to display
    const notebooks = React.useMemo(() => {
        const result: NotebookItemData[] = [];

        // Build notebook data using each notebook's full display path (opfs://notebooks/<uuid> or
        // fs://<absolute-path>), reconstructed from its uuid + physical location — the same value
        // the notebook bar shows.
        for (const [notebookId, connectionId] of props.connectionRegistry.connectionByNotebook) {
            const connection = props.connectionRegistry.connectionMap.get(connectionId);
            if (!connection) continue;
            const notebookScripts = props.notebookScriptsRegistry.notebookScriptsMap.get(notebookId);
            if (!notebookScripts) continue;

            const location = storageReader.getNotebookLocation(notebookId);
            const displayPath = notebookDisplayPath(notebookId, location);

            // Get display name from notebook or connection signature
            const displayName = notebookScripts.notebookMetadata.originalFileName ||
                connection.connectionSignature.signatureString;

            // Get lastAccessed from notebook metadata if available
            const lastAccessed = (notebookScripts.notebookMetadata as any).lastAccessed
                ? new Date((notebookScripts.notebookMetadata as any).lastAccessed)
                : null;

            result.push({
                notebookId,
                connection,
                displayName,
                notebookName: connection.name ?? null,
                displayPath,
                connectorType: connection.connectorInfo.connectorType,
                lastAccessed,
                isNative: location.type === StorageBackendType.Native,
                invalidReason: null,
            });
        }

        // Order by the manifest (the user-facing, drag-reorderable order). Notebooks present in the
        // manifest lead, in manifest order; any not yet registered there (e.g. a just-created notebook
        // whose first write hasn't landed) are appended in their registry iteration order.
        const manifestOrder = storageReader.getNotebookOrder();
        const rank = new Map(manifestOrder.map((id, i) => [id, i]));
        result.sort((a, b) => {
            const ra = rank.get(a.notebookId) ?? Number.MAX_SAFE_INTEGER;
            const rb = rank.get(b.notebookId) ?? Number.MAX_SAFE_INTEGER;
            return ra - rb;
        });

        // Append invalid notebooks at the end, sorted by their display label. These were refused a
        // load (bad metadata), so they have no connection — they render marked-invalid, are blocked
        // from opening, and can only be deleted.
        const invalid: NotebookItemData[] = [];
        for (const inv of (props.invalidNotebooks?.values() ?? [])) {
            // Prefer the physical display path (fs://<dir> or opfs://notebooks/<uuid>) over the bare
            // UUID title: for a notebook that's invalid *because its files are gone* the location is
            // exactly what lets the user recognise which folder went stale before unlinking it. It's
            // still resolvable here — the composite backend keeps the manifest's uuid->location map.
            const location = storageReader.getNotebookLocation(inv.notebookId);
            const displayPath = notebookDisplayPath(inv.notebookId, location);
            invalid.push({
                notebookId: inv.notebookId,
                connection: null,
                displayName: inv.title,
                notebookName: null,
                displayPath,
                connectorType: inv.connectorType ?? (isNativePlatform() ? ConnectorType.DUCKDB : ConnectorType.HYPER),
                lastAccessed: null,
                isNative: location.type === StorageBackendType.Native,
                invalidReason: describeNotebookValidationError(inv.error),
            });
        }
        invalid.sort((a, b) => a.displayPath.localeCompare(b.displayPath));

        return [...result, ...invalid];
        // orderVersion is a dep because getNotebookOrder() reads mutable backend state that a drag
        // reorder mutates in place; bumping it re-runs this memo against the new manifest order.
    }, [props.connectionRegistry, props.notebookScriptsRegistry, props.invalidNotebooks, storageReader, orderVersion]);

    // The ids that participate in drag reordering: the valid (registered) notebooks, in display
    // order. Invalid notebooks are always pinned at the end and never reorderable.
    const sortableIds = React.useMemo(
        () => notebooks.filter(n => n.invalidReason == null).map(n => n.notebookId),
        [notebooks],
    );
    const canRemoveNotebooks = notebooks.length > 0;
    const canCloneNotebooks = sortableIds.length > 0;

    React.useEffect(() => {
        if (!canRemoveNotebooks) setIsEditMode(false);
        if (!canCloneNotebooks) setIsCopyMode(false);
    }, [canRemoveNotebooks, canCloneNotebooks]);

    // Notebook-row drag-and-drop, mirroring the notebook page tabs: the PointerSensor only arms a
    // drag after a few pixels of movement, so a plain click still opens the notebook.
    const dndSensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );
    const handleNotebookDragEnd = React.useCallback((event: DragEndEvent) => {
        const { active, over } = event;
        if (over == null || active.id === over.id) return;
        const fromIndex = sortableIds.indexOf(String(active.id));
        const toIndex = sortableIds.indexOf(String(over.id));
        if (fromIndex < 0 || toIndex < 0) return;
        const reordered = arrayMove(sortableIds, fromIndex, toIndex);

        // Persist the new order to the manifest. The composite backend applies it to its in-memory
        // order synchronously, so bumping orderVersion right after re-renders the list in the new
        // order without waiting on the write. A bare (test) backend has no reorder support — skip.
        const backend = storageReader.backend;
        if (backend instanceof CompositeStorageBackend) {
            backend.reorderNotebooks(reordered).catch(e =>
                logger.warn('failed to persist notebook order', { error: String(e) }, 'notebook_selector')
            );
            setOrderVersion(v => v + 1);
        }
    }, [sortableIds, storageReader.backend, logger]);

    const onNotebookClick = React.useCallback((notebookId: string) => {
        const connectionId = props.connectionRegistry.connectionByNotebook.get(notebookId);
        const conn = connectionId == null ? null : props.connectionRegistry.connectionMap.get(connectionId);

        // Invalid notebooks were refused a load and have no connection — never open them.
        if (!conn) {
            return;
        }

        if (conn.connectionHealth === ConnectionHealth.ONLINE) {
            navigate({ type: SELECT_NOTEBOOK, value: notebookId });
            return;
        }

        // Show the connection card for disconnected notebooks
        navigate({ type: BEGIN_NOTEBOOK_SETUP, value: notebookId });
    }, [navigate, props.connectionRegistry]);

    const handleCreateNewNotebook = React.useCallback(() => {
        if (!props.core) {
            console.error('Core not available');
            return;
        }

        const connectorType = isNativePlatform() ? ConnectorType.DUCKDB : ConnectorType.HYPER;
        const connectorInfo = CONNECTOR_INFOS[connectorType];

        // Create default connection parameters
        const params = createDefaultConnectionParamsForConnector(connectorInfo);

        // Create connection state
        const stateWithoutId = createConnectionStateFromParams(
            props.core,
            params,
            props.connectionRegistry.connectionsBySignature
        );

        // Allocate connection (assigns notebookId)
        const allocatedConnection = props.allocateConnection(stateWithoutId);

        // Show configuration card — notebook is created later when the connection goes online
        navigate({ type: BEGIN_NOTEBOOK_SETUP, value: allocatedConnection.notebookId });
    }, [props, navigate]);

    const handleOpenFolder = React.useCallback(async () => {
        if (!(storageReader.backend instanceof CompositeStorageBackend)) {
            return;
        }
        try {
            // On success the flow registers the notebook and triggers a full reload, so we never
            // reach steady state here. Errors are logged (and surfaced via the toast) inside the flow.
            await addNativeNotebookFromFolder(storageReader.backend, logger);
        } catch {
            // Keep the button usable; the failure was already reported to the user.
        }
    }, [storageReader.backend, logger]);

    const handleBack = React.useCallback(() => {
        if (configNotebookId) {
            const connectionId = props.connectionRegistry.connectionByNotebook.get(configNotebookId);
            const conn = connectionId == null ? null : props.connectionRegistry.connectionMap.get(connectionId);
            // Only cleanup if this was a NEW notebook (not yet persisted)
            if (conn?.connectionHealth === ConnectionHealth.NOT_STARTED && !conn.active) {
                connectionDispatch(conn.connectionId, { type: DELETE_CONNECTION, value: null });
            }
        }
        navigate({ type: CANCEL_NOTEBOOK_SETUP, value: null });
    }, [configNotebookId, props.connectionRegistry, connectionDispatch, navigate]);

    // Escape from the connection setup panel returns to the notebook selector, mirroring the Back
    // button. Bubble phase so an open internals overlay (capture phase, stops propagation) closes
    // first. As in the notebook, Escape surrenders focus before leaving: while a setup field or
    // button holds focus, the first Escape blurs it and a second one navigates back — so a user
    // typing in a config field isn't bounced out by a stray keystroke.
    //
    // In the notebook list (no config panel), Escape instead leaves edit (delete) mode if it's
    // active, mirroring the toggle button.
    const keyHandlers = React.useMemo<KeyEventHandler[]>(() => [
        {
            key: 'Escape',
            ctrlKey: false,
            callback: () => {
                if (!configNotebookId) {
                    if (isEditMode) {
                        setIsEditMode(false);
                    } else if (isCopyMode) {
                        setIsCopyMode(false);
                    }
                    return;
                }
                const active = document.activeElement as HTMLElement | null;
                if (active && active !== document.body && active !== document.documentElement) {
                    active.blur();
                    return;
                }
                handleBack();
            },
        },
    ], [configNotebookId, isEditMode, isCopyMode, handleBack]);
    useKeyEvents(keyHandlers);

    const handleConnected = React.useCallback((notebookId: string) => {
        const connectionId = props.connectionRegistry.connectionByNotebook.get(notebookId);
        const conn = connectionId == null ? null : props.connectionRegistry.connectionMap.get(connectionId);
        if (conn) {
            const existingNotebookScripts = props.notebookScriptsRegistry.notebookScriptsMap.get(notebookId);
            if (!existingNotebookScripts) {
                props.setupNotebookScripts(conn);
            }
        }
        navigate({ type: SELECT_NOTEBOOK, value: notebookId });
    }, [navigate, props.connectionRegistry, props.notebookScriptsRegistry, props.setupNotebookScripts]);

    const handleSkip = React.useCallback(() => {
        navigate({ type: SKIP_NOTEBOOK_SETUP, value: null });
    }, [navigate]);

    const handleDeleteNotebook = React.useCallback(async (item: NotebookItemData) => {
        // Invalid notebooks never entered the registries — delegate to the loader's cleanup, which
        // removes the persisted files and drops the entry from the invalid list.
        if (item.invalidReason != null) {
            props.onDeleteInvalidNotebook?.(item.notebookId);
            return;
        }

        // Delete from storage
        try {
            await storageWriter.backend.deleteNotebook(item.notebookId);
        } catch (e) {
            console.error('Failed to delete notebook from storage:', e);
        }

        // Tear down the notebook first, while the connection's catalog is still alive: the notebook
        // shares that catalog by reference but owns its scripts, which must be dropped from the
        // catalog before DELETE_CONNECTION destroys it. This also removes the notebook from the
        // registry indices (otherwise it would orphan there).
        deleteNotebookScripts(item.notebookId);

        // Then delete the connection (destroys the catalog + connection state).
        for (const queryId of [...item.connection!.queriesActiveOrdered, ...item.connection!.queriesFinishedOrdered]) {
            computationDispatch({ type: DELETE_COMPUTATION, value: [queryId] });
        }
        connectionDispatch(item.connection!.connectionId, { type: DELETE_CONNECTION, value: null });
    }, [storageWriter, connectionDispatch, computationDispatch, deleteNotebookScripts, props.onDeleteInvalidNotebook]);

    const handleCloneNotebook = React.useCallback(async (item: NotebookItemData) => {
        if (item.invalidReason != null || !props.core) {
            return;
        }
        const newNotebookId = crypto.randomUUID();
        try {
            await cloneNotebook(
                item.notebookId,
                storageReader.backend,
                storageWriter.backend,
                newNotebookId,
                logger,
            );
            const restored = await restoreSingleNotebook(
                props.core,
                storageWriter.backend,
                logger,
                newNotebookId,
                props.connectionRegistry.connectionsBySignature,
            );
            setConnReg(reg => mergeRestoredNotebookIntoConnections(reg, restored));
            setNotebookScriptsRegistry(reg => mergeRestoredNotebookIntoScripts(reg, restored));
        } catch (e) {
            logger.warn('failed to clone notebook', {
                notebookId: item.notebookId,
                error: String(e),
            }, 'notebook_selector');
        }
    }, [
        props.core,
        props.connectionRegistry.connectionsBySignature,
        storageReader.backend,
        storageWriter.backend,
        logger,
        setConnReg,
        setNotebookScriptsRegistry,
    ]);

    return (
        <div className={baseStyles.page} data-tauri-drag-region>
            <div className={baseStyles.banner_and_content_container} data-tauri-drag-region>
                {!configNotebookId && (
                    <div className={baseStyles.banner_container} data-tauri-drag-region>
                        <div className={baseStyles.banner_logo} data-tauri-drag-region>
                            <svg width="100%" height="100%">
                                <use xlinkHref={`${symbols}#dashql`} />
                            </svg>
                        </div>
                        <div className={baseStyles.banner_text_container} data-tauri-drag-region>
                            <div className={baseStyles.banner_title} data-tauri-drag-region>dashql</div>
                            <div className={baseStyles.app_version} data-tauri-drag-region>version {DASHQL_VERSION}</div>
                        </div>
                    </div>
                )}
                <div className={baseStyles.content_container} data-tauri-drag-region>
                    {configNotebookId ? (
                        <ConnectionConfigCard
                            notebookId={configNotebookId}
                            onBack={handleBack}
                            onConnected={handleConnected}
                            onSkip={props.connectionRegistry.connectionMap.get(props.connectionRegistry.connectionByNotebook.get(configNotebookId) ?? '')?.active ? handleSkip : undefined}
                            headerTitle={props.connectionRegistry.connectionMap.get(props.connectionRegistry.connectionByNotebook.get(configNotebookId) ?? '')?.active ? "Connect" : undefined}
                        />
                    ) : (
                        <div className={`${baseStyles.card} ${styles.card_wrapper}`}>
                            <div className={baseStyles.card_header} data-tauri-drag-region>
                                <div className={baseStyles.card_header_left_container}>
                                    <div className={baseStyles.card_header_left_title}>
                                        Select Notebook
                                    </div>
                                </div>
                                <div className={baseStyles.card_header_right_container}>
                                    <InternalsViewerOverlay
                                        isOpen={showInternals}
                                        onClose={() => setShowInternals(false)}
                                        renderAnchor={(p: object) => <div {...p}>{internalsButton}</div>}
                                        side={AnchorSide.OutsideBottom}
                                        align={AnchorAlignment.End}
                                        anchorOffset={16}
                                    />
                                </div>
                            </div>
                            <div className={baseStyles.card_section}>
                                {notebooks.length > 0 ? (
                                    <div
                                        className={styles.notebook_list_container}
                                        style={{ width: LIST_WIDTH, maxHeight: LIST_MAX_HEIGHT }}
                                    >
                                        <DndContext
                                            sensors={dndSensors}
                                            collisionDetection={closestCenter}
                                            onDragEnd={handleNotebookDragEnd}
                                        >
                                            <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                                                {notebooks.map((notebook) => (
                                                    <NotebookItem
                                                        key={notebook.notebookId}
                                                        notebook={notebook}
                                                        onClick={onNotebookClick}
                                                        onDelete={handleDeleteNotebook}
                                                        onClone={handleCloneNotebook}
                                                        isEditMode={isEditMode}
                                                        isCopyMode={isCopyMode}
                                                    />
                                                ))}
                                            </SortableContext>
                                        </DndContext>
                                    </div>
                                ) : (
                                    <div className={styles.empty_state}>
                                        <p>Create your first notebook with '+'</p>
                                    </div>
                                )}
                                <div className={baseStyles.card_actions}>
                                    <div className={baseStyles.card_actions_left}>
                                        <IconButton
                                            variant={isCopyMode ? ButtonVariant.Default : ButtonVariant.Invisible}
                                            aria-label={isCopyMode ? 'Done duplicating' : 'Duplicate notebooks'}
                                            aria-pressed={isCopyMode}
                                            disabled={!canCloneNotebooks}
                                            onClick={() => {
                                                setIsCopyMode(!isCopyMode);
                                                setIsEditMode(false);
                                            }}
                                        >
                                            {isCopyMode
                                                ? <CircleSlashIcon size={16} />
                                                : <DuplicateIcon size={16} />
                                            }
                                        </IconButton>
                                    </div>
                                    <div className={baseStyles.card_actions_right}>
                                        <IconButton
                                            variant={isEditMode ? ButtonVariant.Default : ButtonVariant.Invisible}
                                            aria-label={isEditMode ? 'Done removing' : 'Remove notebooks'}
                                            aria-pressed={isEditMode}
                                            disabled={!canRemoveNotebooks}
                                            onClick={() => {
                                                setIsEditMode(!isEditMode);
                                                setIsCopyMode(false);
                                            }}
                                        >
                                            {isEditMode
                                                ? <CircleSlashIcon size={16} />
                                                : <DashIcon size={16} />
                                            }
                                        </IconButton>
                                        <IconButton
                                            variant={ButtonVariant.Invisible}
                                            aria-label={"Add notebook"}
                                            onClick={handleCreateNewNotebook}
                                        >
                                            <PlusIcon size={16} />
                                        </IconButton>
                                        {canOpenFolder && (
                                            <IconButton
                                                variant={ButtonVariant.Invisible}
                                                aria-label={"Open notebook folder"}
                                                onClick={handleOpenFolder}
                                            >
                                                <FileDirectoryIcon size={16} />
                                            </IconButton>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

interface NotebookItemProps {
    notebook: NotebookItemData;
    onClick: (notebookId: string) => void;
    onDelete: (item: NotebookItemData) => void;
    onClone: (item: NotebookItemData) => void;
    isEditMode: boolean;
    isCopyMode: boolean;
}

const NotebookItem: React.FC<NotebookItemProps> = ({ notebook, onClick, onDelete, onClone, isEditMode, isCopyMode }) => {
    const connectorInfo = CONNECTOR_INFOS.find(c => c.connectorType === notebook.connectorType);
    const isInvalid = notebook.invalidReason != null;

    // Invalid notebooks are pinned at the end and never reorderable, so their sortable is disabled.
    // The PointerSensor's activation distance (see the parent) lets a plain click through to open
    // the notebook while still allowing a drag once the pointer moves.
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: notebook.notebookId,
        disabled: isInvalid,
    });
    const style: React.CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 1 : undefined,
        opacity: isDragging ? 0.8 : undefined,
    };

    const handleClick = React.useCallback(() => {
        if (!isEditMode && !isCopyMode && !isInvalid) {
            onClick(notebook.notebookId);
        }
    }, [notebook.notebookId, onClick, isEditMode, isCopyMode, isInvalid]);

    const handleDelete = React.useCallback((e: React.MouseEvent) => {
        e.stopPropagation(); // Don't trigger notebook selection
        onDelete(notebook);
    }, [notebook, onDelete]);

    const handleClone = React.useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        onClone(notebook);
    }, [notebook, onClone]);

    return (
        <div ref={setNodeRef} style={style} className={styles.notebook_item_wrapper} {...attributes} {...listeners}>
            <button
                className={isInvalid ? `${styles.notebook_item} ${styles.notebook_item_invalid}` : styles.notebook_item}
                onClick={handleClick}
                disabled={isInvalid}
                title={isInvalid ? notebook.invalidReason! : undefined}
            >
                <div className={styles.notebook_item_icon}>
                    {isInvalid ? (
                        <AlertIcon size={16} className={styles.notebook_item_invalid_icon} />
                    ) : (
                        <svg width="16px" height="16px">
                            <use xlinkHref={`${symbols}#${connectorInfo?.icons.colored}`} />
                        </svg>
                    )}
                </div>
                {notebook.notebookName ? (
                    <div className={styles.notebook_item_labels}>
                        <span className={styles.notebook_item_name}>{notebook.notebookName}</span>
                        <span className={styles.notebook_item_path_secondary}>{notebook.displayPath}</span>
                    </div>
                ) : (
                    <div className={styles.notebook_item_path}>
                        {notebook.displayPath}
                    </div>
                )}
                {isInvalid && (
                    <div className={styles.notebook_item_invalid_reason}>
                        {notebook.invalidReason}
                    </div>
                )}
            </button>
            {isEditMode && (
                <IconButton
                    className={styles.delete_button_suffix}
                    variant={ButtonVariant.Invisible}
                    // Native notebooks live in a user-owned folder we never delete — removing one only
                    // unlinks it from dashql, so show an unlink icon. OPFS notebooks are truly deleted.
                    aria-label={notebook.isNative ? "Unlink notebook" : "Delete notebook"}
                    onClick={handleDelete}
                    // Don't let grabbing the delete affordance start a row drag.
                    onPointerDown={(e) => e.stopPropagation()}
                >
                    {notebook.isNative
                        ? <UnlinkIcon size={16} />
                        : <TrashIcon size={16} />
                    }
                </IconButton>
            )}
            {isCopyMode && !isInvalid && (
                <IconButton
                    className={styles.copy_button_suffix}
                    variant={ButtonVariant.Invisible}
                    aria-label="Duplicate notebook"
                    onClick={handleClone}
                    onPointerDown={(e) => e.stopPropagation()}
                >
                    <DuplicateIcon size={16} />
                </IconButton>
            )}
        </div>
    );
};
