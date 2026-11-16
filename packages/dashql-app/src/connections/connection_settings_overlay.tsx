import * as React from 'react';

import * as styles from './connection_settings_overlay.module.css';
import { AnchoredOverlay } from '../ui/foundations/anchored_overlay.js';
import { AnchorAlignment, AnchorSide } from '../ui/foundations/anchored_position.js';
import { OverlaySize } from '../ui/foundations/overlay.js';
import { Button, ButtonSize, ButtonVariant } from '../ui/foundations/button.js';
import { SymbolIcon } from '../ui/foundations/symbol_icon.js';
import { ConnectorType } from '@ankoh/dashql/platform/connections/connector_info';
import { useConnectionDraft } from './connection_draft.js';
import { useConnection, useDispatch } from '../runtime/runtime_hooks.js';
import { connectionSaveSucceeded, failedWorkbookCopies, useConnectionSave, type ConnectionSaveResult } from './connection_persistence.js';
import { stringifyError } from '@ankoh/dashql/platform/platform/logger/logger';
import { ConnectionHealth, type ConnectionState } from '@ankoh/dashql/platform/connections/connection_state';
import { ToggleSwitch } from '../ui/foundations/toggle_switch.js';
import { HyperConnectorSettings } from './hyper_connection_settings.js';
import { TrinoConnectorSettings } from './trino_connection_settings.js';
import { SalesforceConnectorSettings } from './salesforce_connection_settings.js';
import { connectorInfoOf } from '@ankoh/dashql/platform/connections/connection_state';

const CheckIcon = SymbolIcon('check_16');

interface Props {
    /// The connection to configure
    connectionId: string | null;
    isOpen: boolean;
    onClose: () => void;
    anchorRef: React.RefObject<HTMLElement | null>;
    headerTitle?: string;
    onConnected?: (database: ConnectionState) => void;
    side?: AnchorSide;
    /// Renders the name of a workbook, the workbook id if absent
    renderWorkbookName?: (workbookId: string) => React.ReactNode;
}

export const ConnectionSettingsOverlay: React.FC<Props> = (props: Props) => {
    const conn = useConnection(props.connectionId);
    const modifyConn = useDispatch(props.connectionId == null ? null : { connection: props.connectionId });
    const { paramsDraft, discard } = useConnectionDraft(props.connectionId);
    const { saving, result: saveResult, save, retry } = useConnectionSave(props.connectionId);
    const connecting = conn?.connectionHealth === ConnectionHealth.CONNECTING;

    const currentConnectorType = conn?.connectorType ?? ConnectorType.HYPER;

    const completedDatabaseId = React.useRef<string | null>(null);
    React.useEffect(() => {
        if (!props.isOpen || conn?.connectionHealth !== ConnectionHealth.ONLINE || props.onConnected == null) return;
        if (completedDatabaseId.current === conn.connectionId) return;
        completedDatabaseId.current = conn.connectionId;
        void props.onConnected(conn);
    }, [conn, props.isOpen, props.onConnected]);
    React.useEffect(() => {
        if (!props.isOpen) completedDatabaseId.current = null;
    }, [props.isOpen]);

    // Saving writes every workbook that references the connection, the overlay stays open until all
    // writes are done.
    const onClose = props.onClose;
    const close = React.useCallback(() => {
        if (!saving) onClose();
    }, [saving, onClose]);

    useCloseOnConnect({
        isOpen: props.isOpen,
        connectionId: props.connectionId,
        health: conn?.connectionHealth,
        saving,
        saveResult,
        onClose,
    });

    // The workbooks that use the connection get its saved params as well
    const workbookCount = conn?.workbooks.length ?? 0;

    return (
        <AnchoredOverlay
            renderAnchor={null}
            anchorRef={props.anchorRef as React.RefObject<HTMLElement | null>}
            open={props.isOpen}
            onClose={close}
            side={props.side ?? AnchorSide.OutsideRight}
            align={AnchorAlignment.Start}
            minWidth={OverlaySize.L}
            maxWidth={OverlaySize.XXL}
            height={OverlaySize.XL}
            maxHeight={OverlaySize.XL}
        >
            <div className={styles.overlay_container}>
                <div className={styles.content}>
                    {currentConnectorType === ConnectorType.HYPER && <HyperConnectorSettings connectionId={props.connectionId} onClose={saving ? undefined : props.onClose} />}
                    {currentConnectorType === ConnectorType.TRINO && <TrinoConnectorSettings connectionId={props.connectionId} onClose={saving ? undefined : props.onClose} />}
                    {currentConnectorType === ConnectorType.SALESFORCE_DATA_CLOUD && <SalesforceConnectorSettings connectionId={props.connectionId} connector={ConnectorType.SALESFORCE_DATA_CLOUD} onClose={saving ? undefined : props.onClose} />}
                    {currentConnectorType === ConnectorType.DBCOM && <SalesforceConnectorSettings connectionId={props.connectionId} connector={ConnectorType.DBCOM} onClose={saving ? undefined : props.onClose} />}
                </div>
                <QueryResultCachingRow
                    caching={conn?.cachesQueryResults ?? false}
                    disabled={conn == null}
                    toggle={() => {
                        if (conn != null) modifyConn({ kind: 'setQueryResultCaching', value: { caching: !conn.cachesQueryResults } });
                    }}
                />
                <ConnectionSaveBar
                    dirty={paramsDraft != null}
                    saving={saving}
                    connecting={connecting}
                    online={conn?.connectionHealth === ConnectionHealth.ONLINE}
                    workbookCount={workbookCount}
                    result={saveResult}
                    save={() => { void save(); }}
                    discard={discard}
                    retry={retry}
                    renderWorkbookName={props.renderWorkbookName}
                />
            </div>
        </AnchoredOverlay>
    );
};

/// Does the connection cache query results? The choice applies right away, it is no connection parameter.
function QueryResultCachingRow(props: { caching: boolean; disabled: boolean; toggle: () => void }) {
    const labelId = React.useId();
    return (
        <div className={styles.caching}>
            <div className={styles.caching_text}>
                <div id={labelId} className={styles.caching_label}>Cache query results</div>
                <div className={styles.caching_caption}>Reuse the results of unchanged scripts instead of querying the connection again</div>
            </div>
            <ToggleSwitch size="small" checked={props.caching} disabled={props.disabled} onClick={props.toggle} aria-labelledby={labelId} />
        </div>
    );
}

export interface CloseOnConnectProps {
    /// Is the overlay open?
    isOpen: boolean;
    /// The configured connection
    connectionId: string | null;
    /// The health of the connection
    health: ConnectionHealth | undefined;
    /// Is the connection being saved?
    saving: boolean;
    /// The outcome of the last save
    saveResult: ConnectionSaveResult | null;
    /// Close the overlay
    onClose: () => void;
}

/// Close the overlay once a connect seen while open comes online, unless the save bar reports a failure
export function useCloseOnConnect(props: CloseOnConnectProps): void {
    const { isOpen, connectionId, health, saving, saveResult, onClose } = props;
    const connectingId = React.useRef<string | null>(null);
    React.useEffect(() => {
        if (!isOpen || connectionId == null) {
            connectingId.current = null;
        } else if (health === ConnectionHealth.CONNECTING) {
            connectingId.current = connectionId;
        } else if (health !== ConnectionHealth.ONLINE || connectingId.current !== connectionId) {
            connectingId.current = null;
        } else if (!saving && (saveResult == null || connectionSaveSucceeded(saveResult))) {
            connectingId.current = null;
            onClose();
        }
    }, [isOpen, connectionId, health, saving, saveResult, onClose]);
}

/// How long the bar confirms a save
const SAVED_NOTICE_DURATION = 2500;

/// Phrase a number of workbooks
function workbooks(count: number): string {
    return count === 1 ? 'one workbook' : `${count} workbooks`;
}

export interface ConnectionSaveBarProps {
    /// Are there unsaved edits?
    dirty: boolean;
    /// Is the connection being saved?
    saving: boolean;
    /// Is the connection being set up?
    connecting: boolean;
    /// Is the connection online?
    online: boolean;
    /// The number of workbooks that use the connection
    workbookCount: number;
    /// The outcome of the last save
    result: ConnectionSaveResult | null;
    /// Save the edits
    save: () => void;
    /// Discard the edits
    discard: () => void;
    /// Write the copies of workbooks again
    retry: (workbookIds: string[]) => Promise<ConnectionSaveResult | null>;
    /// Renders the name of a workbook
    renderWorkbookName?: (workbookId: string) => React.ReactNode;
}

/// The unsaved edits of a connection, the actions to save or discard them and the outcome of saving
export function ConnectionSaveBar(props: ConnectionSaveBarProps): React.ReactElement | null {
    const label = props.renderWorkbookName ?? ((workbookId: string) => workbookId);
    const { saving, result } = props;

    // Confirm a save that finished while the bar is shown
    const [prevSaving, setPrevSaving] = React.useState(saving);
    const [savedResult, setSavedResult] = React.useState<ConnectionSaveResult | null>(null);
    if (prevSaving !== saving) {
        setPrevSaving(saving);
        setSavedResult(!saving && result != null && connectionSaveSucceeded(result) ? result : null);
    }
    React.useEffect(() => {
        if (savedResult == null) return;
        const timer = setTimeout(() => setSavedResult(null), SAVED_NOTICE_DURATION);
        return () => clearTimeout(timer);
    }, [savedResult]);
    const savedNotice = savedResult != null && savedResult === result;

    const draftActions = props.dirty && (
        <div className={styles.footer_actions}>
            <Button
                variant={ButtonVariant.Invisible}
                size={ButtonSize.Small}
                title="Discard changes and restore saved connection settings"
                data-testid="connection-discard"
                disabled={props.connecting || saving}
                onClick={props.discard}
            >Discard</Button>
            <Button
                variant={ButtonVariant.Primary}
                size={ButtonSize.Small}
                title="Save the connection settings for every workbook that uses the connection"
                data-testid="connection-save"
                disabled={props.connecting || saving}
                onClick={props.save}
            >{saving ? 'Saving…' : 'Save'}</Button>
        </div>
    );

    if (result != null && !saving && result.manifest.status !== 'written') {
        const reason = result.manifest.status === 'failed' ? stringifyError(result.manifest.error) : 'storage is busy';
        return (
            <div className={styles.footer} role="alert" data-testid="connection-save-bar" data-state="save-failed">
                <div className={styles.footer_error}>The connection could not be saved: {reason}</div>
                {draftActions}
            </div>
        );
    }
    const failed = result == null ? [] : failedWorkbookCopies(result);
    if (failed.length > 0 && !saving) {
        return (
            <div className={styles.footer} role="alert" data-testid="connection-save-bar" data-state="workbooks-failed">
                <div className={styles.footer_error}>
                    The connection is saved, but {workbooks(failed.length)} could not be updated.
                    They are updated when they are loaded next time.
                    <ul className={styles.footer_list}>
                        {failed.map(n => (
                            <li key={n.workbookId}>
                                {label(n.workbookId)}: {n.result.status === 'failed' ? stringifyError(n.result.error) : 'storage is busy'}
                            </li>
                        ))}
                    </ul>
                </div>
                <div className={styles.footer_actions}>
                    <Button
                        size={ButtonSize.Small}
                        data-testid="connection-save-retry"
                        onClick={() => { void props.retry(failed.map(n => n.workbookId)); }}
                    >Retry</Button>
                    {draftActions}
                </div>
            </div>
        );
    }
    if (saving) {
        return (
            <div className={styles.footer} role="status" data-testid="connection-save-bar" data-state="saving">
                <div className={styles.footer_notice}>
                    {props.workbookCount > 1 ? `Saving the connection for ${workbooks(props.workbookCount)}…` : 'Saving the connection…'}
                </div>
                {draftActions}
            </div>
        );
    }
    if (props.dirty) {
        let hint: string | null = null;
        if (props.online) {
            hint = 'The open connection keeps the previous settings until you reconnect.';
        } else if (!props.connecting) {
            hint = 'Connecting saves them too.';
        }
        return (
            <div className={styles.footer} role="status" data-testid="connection-save-bar" data-state="unsaved">
                <div className={styles.footer_notice}>
                    <span className={styles.footer_dirty}>
                        <span className={styles.footer_dirty_dot} aria-hidden="true" />
                        Unsaved changes
                    </span>
                    {props.workbookCount > 1 && ` · applies to ${workbooks(props.workbookCount)}`}
                    {hint != null && <div className={styles.footer_hint} data-testid="connection-save-hint" data-hint={props.online ? 'reconnect' : 'connect'}>{hint}</div>}
                </div>
                {draftActions}
            </div>
        );
    }
    if (savedNotice) {
        return (
            <div className={styles.footer} role="status" data-testid="connection-save-bar" data-state="saved">
                <div className={styles.footer_saved}>
                    <CheckIcon />
                    {props.workbookCount > 1 ? `Saved for ${workbooks(props.workbookCount)}` : 'Saved'}
                </div>
            </div>
        );
    }
    return null;
}
