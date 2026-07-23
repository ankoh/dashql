import * as React from 'react';

import symbols from '@ankoh/dashql-svg-symbols';
import * as baseStyles from './banner_page.module.css';
import * as styles from './session_selector_page.module.css';

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
import { ButtonVariant, IconButton } from './foundations/button.js';
import { DASHQL_VERSION } from '../globals.js';
import { SELECT_SESSION, BEGIN_SESSION_SETUP, CANCEL_SESSION_SETUP, SKIP_SESSION_SETUP, useRouteContext, useRouterNavigate } from '../router.js';
import { SessionSetupStatus } from '../session_setup_status.js';
import { ConnectionRegistry, useDynamicConnectionDispatch } from '../connection/connection_registry.js';
import { DELETE_CONNECTION } from '../connection/connection_state.js';
import { TrashIcon, CircleSlashIcon, DashIcon, PlusIcon, AlertIcon, FileDirectoryIcon, UnlinkIcon } from '@primer/octicons-react';
import { NotebookRegistry, useNotebookDeletion } from '../notebook/notebook_state_registry.js';
import { ConnectionState, ConnectionStateWithoutId, ConnectionHealth } from '../connection/connection_state.js';
import {
    CONNECTOR_INFOS,
    ConnectorType,
} from '../connection/connector_info.js';
import { createConnectionStateFromParams, createDefaultConnectionParamsForConnector } from '../connection/connection_params.js';
import { ConnectionConfigCard } from './connection/connection_config_card.js';
import { NotebookSetup } from '../notebook/notebook_setup.js';
import type { DashQL } from '../core/index.js';
import { useStorageReader, useStorageWriter } from '../platform/storage/storage_provider.js';
import { displayPath as sessionDisplayPath } from '../platform/storage/session_locator.js';
import { StorageBackendType } from '../platform/storage/storage_backend.js';
import { CompositeStorageBackend } from '../platform/storage/composite_storage_backend.js';
import { addNativeSessionFromFolder } from '../platform/storage/storage_migration_flow.js';
import { PlatformType, usePlatformType } from '../platform/platform_type.js';
import { useLogger } from '../platform/logger/logger_provider.js';
import { SymbolIcon } from './foundations/symbol_icon';
import { useKeyEvents, KeyEventHandler } from '../utils/key_events.js';
import { AnchorAlignment, AnchorSide } from './foundations/anchored_position.js';
import { InternalsViewerOverlay } from './internals/internals_overlay.js';
import { InvalidSession, describeSessionValidationError } from '../platform/storage/session_validation.js';

interface Props {
    connectionRegistry: ConnectionRegistry;
    notebookRegistry: NotebookRegistry;
    allocateConnection: (state: ConnectionStateWithoutId) => ConnectionState;
    setupNotebook: NotebookSetup;
    core: DashQL | null;
    /// Sessions whose metadata was refused a load (keyed by bare UUID). Shown as invalid: blocked
    /// from opening, deletable in edit mode.
    invalidSessions?: Map<string, InvalidSession>;
    /// Delete an invalid session's persisted files and drop it from the list.
    onDeleteInvalidSession?: (sessionId: string) => void;
}

interface SessionItemData {
    sessionId: string;
    /// The connection backing a valid session, or null for an invalid (refused) session.
    connection: ConnectionState | null;
    displayName: string;
    /// The user-supplied session name, or null if the user never named it. When set it leads the
    /// row (primary) with the path dimmed beside it; when null the path is the sole label.
    sessionName: string | null;
    displayPath: string;
    connectorType: ConnectorType;
    lastAccessed: Date | null;
    /// True when the session's files live in a native folder on disk. Deleting such a session only
    /// unlinks it (the folder stays put), so the delete affordance shows an unlink icon, not a trash.
    isNative: boolean;
    /// Set when the session's metadata was refused a load; carries the reason to display.
    invalidReason: string | null;
}

const LIST_MAX_HEIGHT = 400; // Max height of the scrollable list before it scrolls
const LIST_WIDTH = 400; // Width of the list to accommodate long paths

export const SessionSelectorPage: React.FC<Props> = (props: Props) => {
    const navigate = useRouterNavigate();
    const routeContext = useRouteContext();
    const configSessionId = routeContext.sessionSetupStatus === SessionSetupStatus.CONFIGURING ? routeContext.sessionId : null;
    const [isEditMode, setIsEditMode] = React.useState(false);
    const [showInternals, setShowInternals] = React.useState<boolean>(false);
    const [_registry, connectionDispatch] = useDynamicConnectionDispatch();
    const deleteNotebook = useNotebookDeletion();
    const storageWriter = useStorageWriter();
    const storageReader = useStorageReader();
    const logger = useLogger();
    const platform = usePlatformType();
    // The manifest session order lives in mutable backend state (see storageReader.getSessionOrder).
    // Bumping this after a drag-persist forces the list to re-read and re-render in the new order.
    const [orderVersion, setOrderVersion] = React.useState(0);

    // Opening a folder-backed session needs the native filesystem and a per-session-routing
    // composite backend (web OPFS has neither a folder picker nor on-disk sessions to load).
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

    // Build list of sessions to display
    const sessions = React.useMemo(() => {
        const result: SessionItemData[] = [];

        // Build session data using each session's full display path (opfs://sessions/<uuid> or
        // fs://<absolute-path>), reconstructed from its uuid + physical location — the same value
        // the session bar shows.
        for (const [sessionId, connection] of props.connectionRegistry.connectionMap) {
            const notebook = props.notebookRegistry.notebookMap.get(sessionId);
            if (!notebook) continue;

            const location = storageReader.getSessionLocation(sessionId);
            const displayPath = sessionDisplayPath(sessionId, location);

            // Get display name from notebook or connection signature
            const displayName = notebook.notebookMetadata.originalFileName ||
                connection.connectionSignature.signatureString;

            // Get lastAccessed from notebook metadata if available
            const lastAccessed = (notebook.notebookMetadata as any).lastAccessed
                ? new Date((notebook.notebookMetadata as any).lastAccessed)
                : null;

            result.push({
                sessionId,
                connection,
                displayName,
                sessionName: connection.name ?? null,
                displayPath,
                connectorType: connection.connectorInfo.connectorType,
                lastAccessed,
                isNative: location.type === StorageBackendType.Native,
                invalidReason: null,
            });
        }

        // Order by the manifest (the user-facing, drag-reorderable order). Sessions present in the
        // manifest lead, in manifest order; any not yet registered there (e.g. a just-created session
        // whose first write hasn't landed) are appended in their registry iteration order.
        const manifestOrder = storageReader.getSessionOrder();
        const rank = new Map(manifestOrder.map((id, i) => [id, i]));
        result.sort((a, b) => {
            const ra = rank.get(a.sessionId) ?? Number.MAX_SAFE_INTEGER;
            const rb = rank.get(b.sessionId) ?? Number.MAX_SAFE_INTEGER;
            return ra - rb;
        });

        // Append invalid sessions at the end, sorted by their display label. These were refused a
        // load (bad metadata), so they have no connection — they render marked-invalid, are blocked
        // from opening, and can only be deleted.
        const invalid: SessionItemData[] = [];
        for (const inv of (props.invalidSessions?.values() ?? [])) {
            // Prefer the physical display path (fs://<dir> or opfs://sessions/<uuid>) over the bare
            // UUID title: for a session that's invalid *because its files are gone* the location is
            // exactly what lets the user recognise which folder went stale before unlinking it. It's
            // still resolvable here — the composite backend keeps the manifest's uuid->location map.
            const location = storageReader.getSessionLocation(inv.sessionId);
            const displayPath = sessionDisplayPath(inv.sessionId, location);
            invalid.push({
                sessionId: inv.sessionId,
                connection: null,
                displayName: inv.title,
                sessionName: null,
                displayPath,
                connectorType: inv.connectorType ?? ConnectorType.DATALESS,
                lastAccessed: null,
                isNative: location.type === StorageBackendType.Native,
                invalidReason: describeSessionValidationError(inv.error),
            });
        }
        invalid.sort((a, b) => a.displayPath.localeCompare(b.displayPath));

        return [...result, ...invalid];
        // orderVersion is a dep because getSessionOrder() reads mutable backend state that a drag
        // reorder mutates in place; bumping it re-runs this memo against the new manifest order.
    }, [props.connectionRegistry, props.notebookRegistry, props.invalidSessions, storageReader, orderVersion]);

    // The ids that participate in drag reordering: the valid (registered) sessions, in display
    // order. Invalid sessions are always pinned at the end and never reorderable.
    const sortableIds = React.useMemo(
        () => sessions.filter(s => s.invalidReason == null).map(s => s.sessionId),
        [sessions],
    );

    // Session-row drag-and-drop, mirroring the notebook page tabs: the PointerSensor only arms a
    // drag after a few pixels of movement, so a plain click still opens the session.
    const dndSensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );
    const handleSessionDragEnd = React.useCallback((event: DragEndEvent) => {
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
            backend.reorderSessions(reordered).catch(e =>
                logger.error('failed to persist session order', { error: String(e) }, 'session_selector')
            );
            setOrderVersion(v => v + 1);
        }
    }, [sortableIds, storageReader.backend, logger]);

    const onSessionClick = React.useCallback((sessionId: string) => {
        const conn = props.connectionRegistry.connectionMap.get(sessionId);

        // Invalid sessions were refused a load and have no connection — never open them.
        if (!conn) {
            return;
        }

        // Skip card for DATALESS connectors or already-ONLINE connections
        if (conn.connectorInfo.connectorType === ConnectorType.DATALESS ||
            conn.connectionHealth === ConnectionHealth.ONLINE) {
            navigate({ type: SELECT_SESSION, value: sessionId });
            return;
        }

        // Show the connection card for disconnected sessions
        navigate({ type: BEGIN_SESSION_SETUP, value: sessionId });
    }, [navigate, props.connectionRegistry]);

    const handleCreateNewSession = React.useCallback(() => {
        if (!props.core) {
            console.error('Core not available');
            return;
        }

        const connectorType = ConnectorType.HYPER;
        const connectorInfo = CONNECTOR_INFOS[connectorType];

        // Create default connection parameters
        const params = createDefaultConnectionParamsForConnector(connectorInfo);

        // Create connection state
        const stateWithoutId = createConnectionStateFromParams(
            props.core,
            params,
            props.connectionRegistry.connectionsBySignature
        );

        // Allocate connection (assigns sessionId)
        const allocatedConnection = props.allocateConnection(stateWithoutId);

        // Show configuration card — notebook is created later when the connection goes online
        navigate({ type: BEGIN_SESSION_SETUP, value: allocatedConnection.sessionId });
    }, [props, navigate]);

    const handleOpenFolder = React.useCallback(async () => {
        if (!(storageReader.backend instanceof CompositeStorageBackend)) {
            return;
        }
        try {
            // On success the flow registers the session and triggers a full reload, so we never
            // reach steady state here. Errors are logged (and surfaced via the toast) inside the flow.
            await addNativeSessionFromFolder(storageReader.backend, logger);
        } catch {
            // Keep the button usable; the failure was already reported to the user.
        }
    }, [storageReader.backend, logger]);

    const handleBack = React.useCallback(() => {
        if (configSessionId) {
            const conn = props.connectionRegistry.connectionMap.get(configSessionId);
            // Only cleanup if this was a NEW session (not yet persisted)
            if (conn?.connectionHealth === ConnectionHealth.NOT_STARTED && !conn.active) {
                connectionDispatch(configSessionId, { type: DELETE_CONNECTION, value: null });
            }
        }
        navigate({ type: CANCEL_SESSION_SETUP, value: null });
    }, [configSessionId, props.connectionRegistry, connectionDispatch, navigate]);

    // Escape from the connection setup panel returns to the session selector, mirroring the Back
    // button. Bubble phase so an open internals overlay (capture phase, stops propagation) closes
    // first. As in the notebook, Escape surrenders focus before leaving: while a setup field or
    // button holds focus, the first Escape blurs it and a second one navigates back — so a user
    // typing in a config field isn't bounced out by a stray keystroke.
    //
    // In the session list (no config panel), Escape instead leaves edit (delete) mode if it's
    // active, mirroring the toggle button.
    const keyHandlers = React.useMemo<KeyEventHandler[]>(() => [
        {
            key: 'Escape',
            ctrlKey: false,
            callback: () => {
                if (!configSessionId) {
                    if (isEditMode) {
                        setIsEditMode(false);
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
    ], [configSessionId, isEditMode, handleBack]);
    useKeyEvents(keyHandlers);

    const handleConnected = React.useCallback((sessionId: string) => {
        const conn = props.connectionRegistry.connectionMap.get(sessionId);
        if (conn) {
            const existingNotebook = props.notebookRegistry.notebookMap.get(sessionId);
            if (!existingNotebook) {
                props.setupNotebook(conn);
            }
        }
        navigate({ type: SELECT_SESSION, value: sessionId });
    }, [navigate, props.connectionRegistry, props.notebookRegistry, props.setupNotebook]);

    const handleSkip = React.useCallback(() => {
        navigate({ type: SKIP_SESSION_SETUP, value: null });
    }, [navigate]);

    const handleDeleteSession = React.useCallback(async (item: SessionItemData) => {
        // Invalid sessions never entered the registries — delegate to the loader's cleanup, which
        // removes the persisted files and drops the entry from the invalid list.
        if (item.invalidReason != null) {
            props.onDeleteInvalidSession?.(item.sessionId);
            return;
        }

        // Delete from storage
        try {
            await storageWriter.backend.deleteSession(item.sessionId);
        } catch (e) {
            console.error('Failed to delete session from storage:', e);
        }

        // Tear down the notebook first, while the connection's catalog is still alive: the notebook
        // shares that catalog by reference but owns its scripts, which must be dropped from the
        // catalog before DELETE_CONNECTION destroys it. This also removes the notebook from the
        // registry indices (otherwise it would orphan there).
        deleteNotebook(item.sessionId);

        // Then delete the connection (destroys the catalog + connection state).
        connectionDispatch(item.sessionId, { type: DELETE_CONNECTION, value: null });
    }, [storageWriter, connectionDispatch, deleteNotebook, props.onDeleteInvalidSession]);

    return (
        <div className={baseStyles.page} data-tauri-drag-region>
            <div className={baseStyles.banner_and_content_container} data-tauri-drag-region>
                {!configSessionId && (
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
                    {configSessionId ? (
                        <ConnectionConfigCard
                            sessionId={configSessionId}
                            onBack={handleBack}
                            onConnected={handleConnected}
                            onSkip={props.connectionRegistry.connectionMap.get(configSessionId)?.active ? handleSkip : undefined}
                            headerTitle={props.connectionRegistry.connectionMap.get(configSessionId)?.active ? "Connect" : undefined}
                        />
                    ) : (
                        <div className={`${baseStyles.card} ${styles.card_wrapper}`}>
                            <div className={baseStyles.card_header} data-tauri-drag-region>
                                <div className={baseStyles.card_header_left_container}>
                                    <div className={baseStyles.card_header_left_title}>
                                        Select Session
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
                                {sessions.length > 0 ? (
                                    <div
                                        className={styles.session_list_container}
                                        style={{ width: LIST_WIDTH, maxHeight: LIST_MAX_HEIGHT }}
                                    >
                                        <DndContext
                                            sensors={dndSensors}
                                            collisionDetection={closestCenter}
                                            onDragEnd={handleSessionDragEnd}
                                        >
                                            <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                                                {sessions.map((session) => (
                                                    <SessionItem
                                                        key={session.sessionId}
                                                        session={session}
                                                        onClick={onSessionClick}
                                                        onDelete={handleDeleteSession}
                                                        isEditMode={isEditMode}
                                                    />
                                                ))}
                                            </SortableContext>
                                        </DndContext>
                                    </div>
                                ) : (
                                    <div className={styles.empty_state}>
                                        <p>No sessions available</p>
                                    </div>
                                )}
                                <div className={baseStyles.card_actions}>
                                    <div className={baseStyles.card_actions_right}>
                                        <IconButton
                                            variant={isEditMode ? ButtonVariant.Default : ButtonVariant.Invisible}
                                            aria-label={isEditMode ? 'Done removing' : 'Remove sessions'}
                                            aria-pressed={isEditMode}
                                            onClick={() => setIsEditMode(!isEditMode)}
                                        >
                                            {isEditMode
                                                ? <CircleSlashIcon size={16} />
                                                : <DashIcon size={16} />
                                            }
                                        </IconButton>
                                        <IconButton
                                            variant={ButtonVariant.Invisible}
                                            aria-label={"Add session"}
                                            onClick={handleCreateNewSession}
                                        >
                                            <PlusIcon size={16} />
                                        </IconButton>
                                        {canOpenFolder && (
                                            <IconButton
                                                variant={ButtonVariant.Invisible}
                                                aria-label={"Open session folder"}
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

interface SessionItemProps {
    session: SessionItemData;
    onClick: (sessionId: string) => void;
    onDelete: (item: SessionItemData) => void;
    isEditMode: boolean;
}

const SessionItem: React.FC<SessionItemProps> = ({ session, onClick, onDelete, isEditMode }) => {
    const connectorInfo = CONNECTOR_INFOS.find(c => c.connectorType === session.connectorType);
    const isInvalid = session.invalidReason != null;

    // Invalid sessions are pinned at the end and never reorderable, so their sortable is disabled.
    // The PointerSensor's activation distance (see the parent) lets a plain click through to open
    // the session while still allowing a drag once the pointer moves.
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: session.sessionId,
        disabled: isInvalid,
    });
    const style: React.CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 1 : undefined,
        opacity: isDragging ? 0.8 : undefined,
    };

    const handleClick = React.useCallback(() => {
        if (!isEditMode && !isInvalid) {
            onClick(session.sessionId);
        }
    }, [session.sessionId, onClick, isEditMode, isInvalid]);

    const handleDelete = React.useCallback((e: React.MouseEvent) => {
        e.stopPropagation(); // Don't trigger session selection
        onDelete(session);
    }, [session, onDelete]);

    return (
        <div ref={setNodeRef} style={style} className={styles.session_item_wrapper} {...attributes} {...listeners}>
            <button
                className={isInvalid ? `${styles.session_item} ${styles.session_item_invalid}` : styles.session_item}
                onClick={handleClick}
                disabled={isInvalid}
                title={isInvalid ? session.invalidReason! : undefined}
            >
                <div className={styles.session_item_icon}>
                    {isInvalid ? (
                        <AlertIcon size={16} className={styles.session_item_invalid_icon} />
                    ) : (
                        <svg width="16px" height="16px">
                            <use xlinkHref={`${symbols}#${connectorInfo?.icons.colored}`} />
                        </svg>
                    )}
                </div>
                {session.sessionName ? (
                    <div className={styles.session_item_labels}>
                        <span className={styles.session_item_name}>{session.sessionName}</span>
                        <span className={styles.session_item_path_secondary}>{session.displayPath}</span>
                    </div>
                ) : (
                    <div className={styles.session_item_path}>
                        {session.displayPath}
                    </div>
                )}
                {isInvalid && (
                    <div className={styles.session_item_invalid_reason}>
                        {session.invalidReason}
                    </div>
                )}
            </button>
            {isEditMode && (
                <IconButton
                    className={styles.delete_button_suffix}
                    variant={ButtonVariant.Invisible}
                    // Native sessions live in a user-owned folder we never delete — removing one only
                    // unlinks it from dashql, so show an unlink icon. OPFS sessions are truly deleted.
                    aria-label={session.isNative ? "Unlink session" : "Delete session"}
                    onClick={handleDelete}
                    // Don't let grabbing the delete affordance start a row drag.
                    onPointerDown={(e) => e.stopPropagation()}
                >
                    {session.isNative
                        ? <UnlinkIcon size={16} />
                        : <TrashIcon size={16} />
                    }
                </IconButton>
            )}
        </div>
    );
};
