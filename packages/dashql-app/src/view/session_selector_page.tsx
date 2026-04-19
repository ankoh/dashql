import * as React from 'react';

import symbols from '@ankoh/dashql-svg-symbols';
import * as baseStyles from './banner_page.module.css';
import * as styles from './session_selector_page.module.css';

import { List, useListRef } from 'react-window';
import type { RowComponentProps } from 'react-window';
import { Button, ButtonSize, ButtonVariant, IconButton } from './foundations/button.js';
import { DASHQL_VERSION } from '../globals.js';
import { SELECT_SESSION, useRouterNavigate } from '../router.js';
import { ConnectionRegistry, useDynamicConnectionDispatch } from '../connection/connection_registry.js';
import { DELETE_CONNECTION } from '../connection/connection_state.js';
import { TrashIcon } from '@primer/octicons-react';
import { NotebookRegistry } from '../notebook/notebook_state_registry.js';
import { ConnectionState, ConnectionStateWithoutId } from '../connection/connection_state.js';
import {
    CONNECTOR_INFOS,
    ConnectorType,
} from '../connection/connector_info.js';
import { ConnectorTypePicker } from './connector_type_picker.js';
import { createConnectionStateFromParams, createDefaultConnectionParamsForConnector } from '../connection/connection_params.js';
import { NotebookSetup } from '../notebook/notebook_setup.js';
import type { DashQL } from '../core/index.js';
import { formatRelativeTime } from '../utils/time_format.js';
import { useStorageWriter } from '../platform/storage/storage_provider.js';
import { disambiguatePathMap } from '../utils/path_disambiguation.js';

interface Props {
    connectionRegistry: ConnectionRegistry;
    notebookRegistry: NotebookRegistry;
    allocateConnection: (state: ConnectionStateWithoutId) => ConnectionState;
    setupNotebook: NotebookSetup;
    core: DashQL | null;
}

interface SessionItemData {
    sessionId: string;
    connection: ConnectionState;
    displayName: string;
    displayPath: string;
    connectorType: ConnectorType;
    lastAccessed: Date | null;
}

interface SessionListData {
    sessions: SessionItemData[];
    onSessionClick: (sessionId: string) => void;
    onDelete: (sessionId: string, sessionPath: string, connectorType: ConnectorType) => void;
}

const SESSION_ITEM_HEIGHT = 40; // Height of each session item (32px item + 8px padding)
const LIST_MAX_HEIGHT = 400; // Max height of the scrollable list
const LIST_WIDTH = 400; // Width of the list to accommodate long paths

export const SessionSelectorPage: React.FC<Props> = (props: Props) => {
    const navigate = useRouterNavigate();
    const [showConnectorPicker, setShowConnectorPicker] = React.useState(false);
    const [_registry, connectionDispatch] = useDynamicConnectionDispatch();
    const storageWriter = useStorageWriter();
    const listRef = useListRef(null);

    // Build list of sessions to display
    const sessions = React.useMemo(() => {
        const result: SessionItemData[] = [];

        // First pass: collect all sessions with their paths
        const sessionPathMap = new Map<string, string>();

        for (const [sessionId, connection] of props.connectionRegistry.connectionMap) {
            const notebook = props.notebookRegistry.notebookMap.get(sessionId);
            if (!notebook) continue;

            sessionPathMap.set(sessionId, connection.sessionId);
        }

        // Compute disambiguated paths
        const disambiguatedPaths = disambiguatePathMap(sessionPathMap);

        // Second pass: build session data with disambiguated paths
        for (const [sessionId, connection] of props.connectionRegistry.connectionMap) {
            const notebook = props.notebookRegistry.notebookMap.get(sessionId);
            if (!notebook) continue;

            // Get disambiguated path (already includes schema prefix)
            const pathInfo = disambiguatedPaths.get(sessionId);
            const displayPath = pathInfo?.displayPath || connection.sessionId;

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
            });
        }

        // Sort: DATALESS and DEMO first, then by lastAccessed (most recent first), then by display path
        result.sort((a, b) => {
            if (a.connectorType === ConnectorType.DATALESS) return -1;
            if (b.connectorType === ConnectorType.DATALESS) return 1;
            if (a.connectorType === ConnectorType.DEMO) return -1;
            if (b.connectorType === ConnectorType.DEMO) return 1;

            // Sort by lastAccessed if both have it
            if (a.lastAccessed && b.lastAccessed) {
                return b.lastAccessed.getTime() - a.lastAccessed.getTime();
            }
            if (a.lastAccessed) return -1;
            if (b.lastAccessed) return 1;

            return a.displayPath.localeCompare(b.displayPath);
        });

        return result;
    }, [props.connectionRegistry, props.notebookRegistry]);

    const onSessionClick = React.useCallback((sessionId: string) => {
        navigate({
            type: SELECT_SESSION,
            value: sessionId,
        });
    }, [navigate]);

    const handleCreateNewSession = React.useCallback(() => {
        setShowConnectorPicker(true);
    }, []);

    const handleConnectorSelected = React.useCallback((connectorType: ConnectorType) => {
        setShowConnectorPicker(false);

        if (!props.core) {
            console.error('Core not available');
            return;
        }

        // Get connector info
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

        // Create notebook for this connection
        const notebook = props.setupNotebook(allocatedConnection);

        // For DATALESS, we can select immediately
        // For other connectors, they need configuration first
        if (connectorType === ConnectorType.DATALESS) {
            navigate({
                type: SELECT_SESSION,
                value: allocatedConnection.sessionId,
            });
        }
        // For other connectors, the session will appear in the list but may need setup
        // We could navigate to connection setup page here if needed
    }, [props, navigate]);

    const handleCancelConnectorPicker = React.useCallback(() => {
        setShowConnectorPicker(false);
    }, []);

    const handleDeleteSession = React.useCallback(async (sessionId: string, sessionPath: string, connectorType: ConnectorType) => {
        // Confirmation dialog
        if (!confirm('Delete this session? This cannot be undone.')) {
            return;
        }

        // Delete from storage
        try {
            await storageWriter.backend.deleteSession(sessionPath);
        } catch (e) {
            console.error('Failed to delete session from storage:', e);
        }

        // Delete from registry
        connectionDispatch(sessionId, { type: DELETE_CONNECTION, value: null });

        // Note: Notebook will be removed when connection is deleted
        // The registry handles cleaning up the associated notebook
    }, [storageWriter, connectionDispatch]);

    return (
        <div className={baseStyles.page} data-tauri-drag-region>
            <div className={baseStyles.banner_and_content_container} data-tauri-drag-region>
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
                <div className={baseStyles.content_container} data-tauri-drag-region>
                    <div className={`${baseStyles.card} ${styles.card_wrapper}`}>
                        <div className={baseStyles.card_header} data-tauri-drag-region>
                            <div className={baseStyles.card_header_left_container}>
                                Select Session
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
                                    <Button
                                        variant={ButtonVariant.Default}
                                        size={ButtonSize.Medium}
                                        onClick={handleCreateNewSession}
                                    >
                                        Create New Session
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            {showConnectorPicker && (
                <ConnectorTypePicker
                    onConnectorSelected={handleConnectorSelected}
                    onCancel={handleCancelConnectorPicker}
                />
            )}
        </div>
    );
};

const SessionItemRow = (props: RowComponentProps<SessionListData>) => {
    const { sessions, onSessionClick, onDelete } = props;
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
            />
        </div>
    );
};

interface SessionItemProps {
    session: SessionItemData;
    onClick: (sessionId: string) => void;
    onDelete: (sessionId: string, sessionPath: string, connectorType: ConnectorType) => void;
}

const SessionItem: React.FC<SessionItemProps> = ({ session, onClick, onDelete }) => {
    const connectorInfo = CONNECTOR_INFOS.find(c => c.connectorType === session.connectorType);

    const handleClick = React.useCallback(() => {
        onClick(session.sessionId);
    }, [session.sessionId, onClick]);

    const handleDelete = React.useCallback((e: React.MouseEvent) => {
        e.stopPropagation(); // Don't trigger session selection
        onDelete(session.sessionId, session.sessionId, session.connectorType);
    }, [session, onDelete]);

    return (
        <div className={styles.session_item_wrapper}>
            <button className={styles.session_item} onClick={handleClick}>
                <div className={styles.session_item_icon}>
                    <svg width="16px" height="16px">
                        <use xlinkHref={`${symbols}#${connectorInfo?.icons.colored}`} />
                    </svg>
                </div>
                <div className={styles.session_item_path}>
                    {session.displayPath}
                </div>
            </button>
            <IconButton
                className={styles.delete_button}
                variant={ButtonVariant.Invisible}
                aria-label="Delete session"
                onClick={handleDelete}
            >
                <TrashIcon size={16} />
            </IconButton>
        </div>
    );
};
