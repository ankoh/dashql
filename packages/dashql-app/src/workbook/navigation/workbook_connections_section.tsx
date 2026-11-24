import * as React from 'react';
import symbols from '@akohn/dashql-svg-symbols';

import { useConnectionList, useConnections, useConnectionViews, useDispatch, useRuntime, useWorkbooks } from '@akohn/dashql-react/hooks';
import { AnchorAlignment, AnchorSide } from '@akohn/dashql-react/dom/anchored_position';
import { AnchoredOverlay } from '@akohn/dashql-react/components/anchored_overlay';
import * as ActionList from '@akohn/dashql-react/components/action_list';
import { ButtonSize, ButtonVariant, IconButton } from '@akohn/dashql-react/components/button';
import { PlusIcon } from '@akohn/dashql-react/components/symbol_icon';
import type { ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import { newConnectionFromParams, createAttachedConnectionParamsForConnector } from '@akohn/dashql/platform/connections/connection_params';
import { CONNECTOR_INFOS, type ConnectorType } from '@akohn/dashql/platform/connections/connector_info';
import type { WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { ATTACHABLE_CONNECTORS } from '../../connections/attached_connection.js';
import { useCloudConnectionIds, useSetCloudConnection } from '../../connections/cloud_connection.js';
import { useDeleteConnection } from '../../connections/connection_deletion.js';
import { connectionMergeCandidates } from '../../connections/connection_merge.js';
import { connectionReplaceBlocker, connectionReplaceCandidates } from '../../connections/connection_replace.js';
import { ConnectionSettingsOverlay } from '../../connections/connection_settings_overlay.js';
import { ConnectionTree, isConnectionInitiallyExpanded, listedConnections, type ConnectionTreeActions, type ConnectionUsage } from '../../connections/connection_tree.js';
import { CONNECTOR_ICON_STYLE, useConnectorIcon } from '../../connections/connector_icon.js';
import { useLogger } from '../../host/logger_provider.js';
import { useConnectionLabeler } from '../connections/connection_labels.js';
import { WorkbookConnectionAttentionContext } from '../connections/workbook_connection_attention.js';
import { useDetachConnection } from '../connections/workbook_connection_detach.js';
import { useMergeConnections } from '../connections/workbook_connection_merge.js';
import { useReplaceConnection } from '../connections/workbook_connection_replace.js';
import { renderWorkbookName } from '../workbook_name.js';
import * as actionMenuStyles from '../../app/action_menu.module.css';
import * as styles from './workbook_workbench_sidebar.module.css';

const LOG_CTX = 'workbook_workbench';

interface Props {
    /// The workbook that the page shows, its connections come first
    workbookScripts: WorkbookScripts;
    /// The connection whose overview is open
    openOverviewId: string | null;
    /// Open the overview of a connection
    onOpenOverview: (connectionId: string) => void;
}

/// The connections of the workbench below the workbooks: the connections of the workbook, the ones of other workbooks
/// and the unused active ones, with the creation of a connection and its settings
export const WorkbookConnectionsSection: React.FC<Props> = ({ workbookScripts, openOverviewId, onOpenOverview }) => {
    const runtime = useRuntime();
    const connections = useConnections();
    const connectionList = useConnectionList();
    const scriptsRegistry = useWorkbooks();
    const logger = useLogger();
    const connectorIcon = useConnectorIcon();
    const labelOf = useConnectionLabeler();
    const cloudConnectionIds = useCloudConnectionIds();
    const setCloudConnection = useSetCloudConnection();
    const mergeConnections = useMergeConnections();
    const replaceConnection = useReplaceConnection();
    const detachConnectionFromWorkbooks = useDetachConnection();
    const shutDownAndDeleteConnection = useDeleteConnection();
    const modifyCurrentWorkbook = useDispatch({ workbook: workbookScripts.workbookId });
    const attached = useConnectionViews(workbookScripts.connectionIds);
    const connectionAttention = React.useContext(WorkbookConnectionAttentionContext);
    const workbookConnectionRows = React.useMemo(() => attached ?? [], [attached]);
    const storageWriter = runtime.storage;
    const [settingsConnectionId, setSettingsConnectionId] = React.useState<string | null>(null);
    const [createConnectionOpen, setCreateConnectionOpen] = React.useState(false);
    const createConnectionButtonRef = React.useRef<HTMLButtonElement>(null);
    const settingsAnchorRef = React.useRef<HTMLButtonElement>(null);

    // The list of the connections says which are listed, it follows the workbooks that use them
    const connectionRows = React.useMemo(
        () => listedConnections(connections, connectionList, workbookConnectionRows, cloudConnectionIds),
        [connections, connectionList, workbookConnectionRows, cloudConnectionIds],
    );
    const workbookConnectionIds = React.useMemo(
        () => new Set(workbookConnectionRows.map(database => database.connectionId)),
        [workbookConnectionRows],
    );
    // The runtime decides which workbooks keep a connection. The views of the connections and of the workbooks don't
    // enter the callback, a change of them changes what the runtime answers: the tree asks again.
    const describeUsage = React.useCallback((connectionId: string): ConnectionUsage => {
        const usage = runtime.connectionUsage(connectionId);
        return {
            workbookCount: usage.workbookCount,
            blockingWorkbookCount: usage.blockingWorkbookCount,
            usedHere: workbookConnectionRows.some(database => database.connectionId === connectionId),
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [runtime, connections, workbookConnectionRows, scriptsRegistry]);
    const initiallyExpanded = React.useCallback((database: ConnectionState, _count: number) => (
        workbookConnectionRows.includes(database)
        && isConnectionInitiallyExpanded(database, workbookConnectionRows.length)
    ), [workbookConnectionRows]);

    const openSettings = React.useCallback((connectionId: string, anchor: HTMLButtonElement | null) => {
        settingsAnchorRef.current = anchor;
        setSettingsConnectionId(connectionId);
    }, []);
    const closeSettings = React.useCallback(() => setSettingsConnectionId(null), []);

    /// Create a connection and open its settings, the next script of the current workbook runs on it
    const createConnection = React.useCallback((connector: ConnectorType) => {
        setCreateConnectionOpen(false);
        const params = createAttachedConnectionParamsForConnector(runtime.core, CONNECTOR_INFOS[connector]);
        const database = runtime.createConnection(newConnectionFromParams(params, { active: true }));
        modifyCurrentWorkbook({ kind: 'setPendingConnection', value: { connectionId: database.connectionId } });
        openSettings(database.connectionId, createConnectionButtonRef.current);
    }, [runtime, modifyCurrentWorkbook, openSettings]);

    const actions = React.useMemo<ConnectionTreeActions>(() => ({
        describeUsage,
        openSettings,
        openOverview: onOpenOverview,
        // A blank name restores the default label
        rename: (connectionId, name) => runtime.dispatch({ connection: connectionId }, { kind: 'rename', value: { name } }),
        refreshCatalog: connectionId => runtime.refreshCatalog(connectionId, true),
        // Delete a connection that the runtime lets the user delete. The workbooks whose new scripts default to the
        // connection are detached from it first.
        delete: connectionId => {
            const database = connections.get(connectionId);
            if (database == null || !runtime.connectionUsage(connectionId).deletable) return;
            if (!window.confirm(`Delete the connection "${labelOf(database).text}"?`)) return;
            detachConnectionFromWorkbooks(connectionId)
                .then(() => shutDownAndDeleteConnection(connectionId))
                .catch(error => {
                    logger.warn('failed to delete the connection', { connectionId, error: String(error) }, LOG_CTX);
                });
        },
        mergeCandidateCount: connectionId => connectionMergeCandidates(runtime.core, connections, connectionList, connectionId).length,
        // Merge the duplicates of a connection into it, their workbooks move to the connection
        merge: connectionId => {
            const database = connections.get(connectionId);
            const duplicates = connectionMergeCandidates(runtime.core, connections, connectionList, connectionId);
            if (database == null || duplicates.length === 0) return;
            const what = duplicates.length === 1 ? 'its duplicate' : `its ${duplicates.length} duplicates`;
            if (!window.confirm(`Merge ${what} into the connection "${labelOf(database).text}"?`)) return;
            mergeConnections(connectionId, duplicates.map(duplicate => duplicate.connectionId)).catch(error => {
                logger.warn('failed to merge connections', { connectionId, error: String(error) }, LOG_CTX);
            });
        },
        // The picker offers every other listed connection
        replaceBlocker: connectionId => connectionReplaceBlocker(connections, connectionList, connectionId, workbookId => storageWriter.isWorkbookHeld(workbookId)),
        replaceCandidates: connectionId => connectionReplaceCandidates(connections, connectionList, connectionId),
        // Replace a connection with another one in every workbook, the connection is removed afterwards
        replace: (connectionId, targetId) => {
            replaceConnection(connectionId, targetId)
                .then(({ removed }) => {
                    if (!removed) logger.warn('the replaced connection is still in use', { connectionId, target: targetId }, LOG_CTX);
                })
                .catch(error => {
                    logger.warn('failed to replace the connection', { connectionId, target: targetId, error: String(error) }, LOG_CTX);
                });
        },
        setCloud: setCloudConnection,
    }), [connectionList, connections, describeUsage, detachConnectionFromWorkbooks, labelOf, logger, mergeConnections, onOpenOverview, openSettings, replaceConnection, runtime, setCloudConnection, shutDownAndDeleteConnection, storageWriter]);

    return (
        <section className={styles.section} aria-labelledby="workbench-databases-heading">
            <header className={styles.section_header}>
                <div className={styles.section_title}>
                    <h2 id="workbench-databases-heading" className={styles.section_heading}>Connections</h2>
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
                    actions={actions}
                    initiallyExpanded={initiallyExpanded}
                    workbookConnectionIds={workbookConnectionIds}
                    labelOf={labelOf}
                    attention={connectionAttention?.active === true}
                    openOverviewId={openOverviewId}
                    cloudConnectionIds={cloudConnectionIds}
                />}
            </div>
            <ConnectionSettingsOverlay
                connectionId={settingsConnectionId}
                isOpen={settingsConnectionId != null}
                onClose={closeSettings}
                anchorRef={settingsAnchorRef}
                renderWorkbookName={renderWorkbookName}
            />
        </section>
    );
};
