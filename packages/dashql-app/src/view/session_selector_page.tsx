import * as React from 'react';

import symbols from '@ankoh/dashql-svg-symbols';
import * as baseStyles from './banner_page.module.css';
import * as styles from './session_selector_page.module.css';

import { List, useListRef } from 'react-window';
import type { RowComponentProps } from 'react-window';
import { ButtonVariant, IconButton } from './foundations/button.js';
import { DASHQL_VERSION } from '../globals.js';
import { SELECT_SESSION, BEGIN_SESSION_SETUP, CANCEL_SESSION_SETUP, SKIP_SESSION_SETUP, useRouteContext, useRouterNavigate } from '../router.js';
import { SessionSetupStatus } from '../session_setup_status.js';
import { ConnectionRegistry, useDynamicConnectionDispatch } from '../connection/connection_registry.js';
import { DELETE_CONNECTION } from '../connection/connection_state.js';
import { TrashIcon, CircleSlashIcon, DashIcon, PlusIcon, AlertIcon } from '@primer/octicons-react';
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
import { disambiguatePathMap } from '../utils/path_disambiguation.js';
import { SymbolIcon } from './foundations/symbol_icon';
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
    displayPath: string;
    connectorType: ConnectorType;
    lastAccessed: Date | null;
    /// Set when the session's metadata was refused a load; carries the reason to display.
    invalidReason: string | null;
}

interface SessionListData {
    sessions: SessionItemData[];
    onSessionClick: (sessionId: string) => void;
    onDelete: (item: SessionItemData) => void;
    isEditMode: boolean;
}

const SESSION_ITEM_HEIGHT = 36; // Height of each session item (32px item + 8px padding)
const LIST_MAX_HEIGHT = 400; // Max height of the scrollable list
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
    const listRef = useListRef(null);

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

        // First pass: collect each session's display path (opfs://… or file://…), reconstructed
        // from its uuid + physical location — the same value the session bar shows. We disambiguate
        // on this so the selector shows a recognizable, prefixed path rather than a bare uuid.
        const sessionPathMap = new Map<string, string>();

        for (const [sessionId] of props.connectionRegistry.connectionMap) {
            const notebook = props.notebookRegistry.notebookMap.get(sessionId);
            if (!notebook) continue;

            sessionPathMap.set(sessionId, sessionDisplayPath(sessionId, storageReader.getSessionLocation(sessionId)));
        }

        // Compute disambiguated paths
        const disambiguatedPaths = disambiguatePathMap(sessionPathMap);

        // Second pass: build session data with disambiguated paths
        for (const [sessionId, connection] of props.connectionRegistry.connectionMap) {
            const notebook = props.notebookRegistry.notebookMap.get(sessionId);
            if (!notebook) continue;

            // Get disambiguated path (already includes schema prefix)
            const pathInfo = disambiguatedPaths.get(sessionId);
            const displayPath = pathInfo?.displayPath || sessionDisplayPath(sessionId, storageReader.getSessionLocation(sessionId));

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
                displayPath,
                connectorType: connection.connectorInfo.connectorType,
                lastAccessed,
                invalidReason: null,
            });
        }

        // Sort: DATALESS first, then by lastAccessed (most recent first), then by display path
        result.sort((a, b) => {
            if (a.connectorType === ConnectorType.DATALESS) return -1;
            if (b.connectorType === ConnectorType.DATALESS) return 1;

            // Sort by lastAccessed if both have it
            if (a.lastAccessed && b.lastAccessed) {
                return b.lastAccessed.getTime() - a.lastAccessed.getTime();
            }
            if (a.lastAccessed) return -1;
            if (b.lastAccessed) return 1;

            return a.displayPath.localeCompare(b.displayPath);
        });

        // Append invalid sessions at the end, sorted by their display label. These were refused a
        // load (bad metadata), so they have no connection — they render marked-invalid, are blocked
        // from opening, and can only be deleted.
        const invalid: SessionItemData[] = [];
        for (const inv of (props.invalidSessions?.values() ?? [])) {
            invalid.push({
                sessionId: inv.sessionId,
                connection: null,
                displayName: inv.title,
                displayPath: inv.title,
                connectorType: inv.connectorType ?? ConnectorType.DATALESS,
                lastAccessed: null,
                invalidReason: describeSessionValidationError(inv.error),
            });
        }
        invalid.sort((a, b) => a.displayPath.localeCompare(b.displayPath));

        return [...result, ...invalid];
    }, [props.connectionRegistry, props.notebookRegistry, props.invalidSessions, storageReader]);

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
                                    <div className={styles.session_list_container}>
                                        <List
                                            listRef={listRef}
                                            style={{
                                                width: LIST_WIDTH,
                                                height: Math.min(LIST_MAX_HEIGHT, sessions.length * SESSION_ITEM_HEIGHT)
                                            }}
                                            rowCount={sessions.length}
                                            rowHeight={SESSION_ITEM_HEIGHT}
                                            rowComponent={SessionItemRow}
                                            rowProps={{
                                                sessions,
                                                onSessionClick,
                                                onDelete: handleDeleteSession,
                                                isEditMode,
                                            }}
                                        />
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

const SessionItemRow = (props: RowComponentProps<SessionListData>) => {
    const { sessions, onSessionClick, onDelete, isEditMode } = props;
    const rowIndex = props.index;
    const session = sessions[rowIndex];

    if (!session) {
        return <div style={props.style} />;
    }

    return (
        <div style={props.style}>
            <SessionItem
                session={session}
                onClick={onSessionClick}
                onDelete={onDelete}
                isEditMode={isEditMode}
            />
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
        <div className={styles.session_item_wrapper}>
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
                <div className={styles.session_item_path}>
                    {session.displayPath}
                </div>
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
                    aria-label="Delete session"
                    onClick={handleDelete}
                >
                    <TrashIcon size={16} />
                </IconButton>
            )}
        </div>
    );
};
