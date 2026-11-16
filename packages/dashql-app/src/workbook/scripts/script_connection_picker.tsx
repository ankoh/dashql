import * as React from 'react';
import * as styles from './script_connection_picker.module.css';
import symbols from '@ankoh/dashql-svg-symbols';

import { Button, ButtonSize, ButtonVariant } from '../../ui/foundations/button.js';
import * as ActionList from '../../ui/foundations/action_list.js';
import { AnchorAlignment, AnchorSide } from '../../ui/foundations/anchored_position.js';
import { AnchoredOverlay } from '../../ui/foundations/anchored_overlay.js';
import { ConnectionHealth, type ConnectionState } from '@ankoh/dashql/platform/connections/connection_state';
import type { ConnectorInfo } from '@ankoh/dashql/platform/connections/connector_info';
import { useConnectionList, useConnections, useOptionalRuntime, useWorkbook } from '../../runtime/runtime_hooks.js';
import type { ModifyWorkbookScripts } from '@ankoh/dashql/platform/workbook/workbook_scripts';
import { CONNECTION_HEALTH_COLORS } from '../../connections/connection_status.js';
import { connectionLabelParts, connectionLabelText, connectionOrdinals, type ConnectionLabelParts } from '../../connections/connection_label.js';
import { ConnectionLabelView } from '../../connections/connection_label_view.js';
import { listedConnections } from '../../connections/connection_tree.js';
import { CONNECTOR_ICON_STYLE, useConnectorIcon } from '../../connections/connector_icon.js';
import { connectorInfoOf } from '@ankoh/dashql/platform/connections/connection_state';

/// The fields of a connection that a script shows
export interface ScriptConnectionView {
    /// The connection id
    connectionId: string;
    /// The health of the connection
    connectionHealth: ConnectionHealth;
    /// The connection details
    details: ConnectionState['details'];
    /// The connector info
    connectorInfo: ConnectorInfo;
    /// The label of the connection as plain text
    label: string;
    /// The parts of the label of the connection
    labelParts: ConnectionLabelParts;
}

/// The view of a connection
export function scriptConnectionView(connection: ConnectionState, labelParts: ConnectionLabelParts = connectionLabelParts(connection)): ScriptConnectionView {
    return {
        connectionId: connection.connectionId,
        connectionHealth: connection.connectionHealth,
        details: connection.details,
        connectorInfo: connectorInfoOf(connection),
        label: connectionLabelText(labelParts),
        labelParts,
    };
}

/// Run a script of a workbook on a connection.
/// The workbook uses the connections of its scripts, the workbook file and the connections of the runtime follow the
/// script.
export function usePickScriptConnection(_workbookId: string, modifyWorkbookScripts: ModifyWorkbookScripts): (fileName: string, connectionId: string) => void {
    const runtime = useOptionalRuntime();
    return React.useCallback((fileName: string, connectionId: string) => {
        if (runtime?.store.get('connection', connectionId) == null) return;
        modifyWorkbookScripts({ kind: 'setScriptConnection', value: { fileName, connectionId } });
    }, [modifyWorkbookScripts, runtime]);
}

/// Create the next script of a workbook on a connection
export function usePickPendingConnection(modifyWorkbookScripts: ModifyWorkbookScripts): (connectionId: string) => void {
    const runtime = useOptionalRuntime();
    return React.useCallback((connectionId: string) => {
        if (runtime?.store.get('connection', connectionId) == null) return;
        modifyWorkbookScripts({ kind: 'setPendingConnection', value: { connectionId } });
    }, [modifyWorkbookScripts, runtime]);
}

/// The logo of the database of a connector, see useConnectorIcon
function ConnectorIcon(props: { connectorInfo: ConnectorInfo, size?: number }) {
    const connectorIcon = useConnectorIcon();
    const size = `${props.size ?? 16}px`;
    return (
        <svg className={styles.connector_icon} width={size} height={size} aria-hidden="true">
            <use xlinkHref={`${symbols}#${connectorIcon(props.connectorInfo)}`} style={CONNECTOR_ICON_STYLE} />
        </svg>
    );
}

/// A dot in the color of the connection health
export function HealthDot(props: { health: ConnectionHealth | null }) {
    return (
        <svg className={styles.health} width="16px" height="16px" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="4" style={{ fill: CONNECTION_HEALTH_COLORS[props.health ?? ConnectionHealth.NOT_STARTED] }} />
        </svg>
    );
}

interface Props {
    /// The workbook of the script
    workbookId: string;
    /// The display name of the script
    scriptName: string;
    /// The connection the script runs on, null while it is not registered
    connection: ScriptConnectionView | null;
    /// Picking is disabled, e.g. while the script runs
    disabled: boolean;
    /// Run the script on another connection
    onPick: (connectionId: string) => void;
    /// The trigger sits in the header of an entry card, it shows the logo of the database instead of
    /// the health dot
    entryHeader?: boolean;
    /// The test id of the trigger
    testId?: string;
}

/// Pick the connection that a script is analyzed and executed with
export const ScriptConnectionPicker: React.FC<Props> = (props) => {
    const [open, setOpen] = React.useState(false);
    const triggerRef = React.useRef<HTMLButtonElement>(null);
    const label = props.connection?.label ?? 'Unknown connection';
    return (
        <AnchoredOverlay
            open={open}
            onOpen={() => setOpen(true)}
            onClose={() => setOpen(false)}
            side={AnchorSide.OutsideBottom}
            align={AnchorAlignment.End}
            anchorOffset={4}
            anchorRef={triggerRef}
            returnFocusRef={triggerRef}
            renderAnchor={(anchorProps) => (
                <Button
                    {...anchorProps}
                    ref={triggerRef}
                    className={styles.trigger}
                    variant={ButtonVariant.Invisible}
                    size={ButtonSize.Small}
                    disabled={props.disabled}
                    leadingVisual={props.connection == null ? undefined : props.entryHeader
                        ? <ConnectorIcon connectorInfo={props.connection.connectorInfo} size={14} />
                        : <HealthDot health={props.connection.connectionHealth} />}
                    aria-label={`Connection of ${props.scriptName} script: ${label}`}
                    data-testid={props.testId ?? "script-connection-picker"}
                    title={label}
                >
                    <span className={styles.trigger_label}>{props.connection?.labelParts.name ?? label}</span>
                </Button>
            )}
        >
            <ConnectionMenu
                workbookId={props.workbookId}
                label={`${props.scriptName} script`}
                connectionId={props.connection?.connectionId ?? null}
                onPick={connectionId => {
                    setOpen(false);
                    if (connectionId !== props.connection?.connectionId) props.onPick(connectionId);
                }}
            />
        </AnchoredOverlay>
    );
};

interface MenuProps {
    /// The workbook whose connections come first
    workbookId: string;
    /// What picks the connection, e.g. "Main script", named in the aria labels
    label: string;
    /// The picked connection
    connectionId: string | null;
    /// Pick a connection
    onPick: (connectionId: string) => void;
    /// A menu that ticks connections: is a connection ticked? A pick toggles it, the trailing visual is a checkbox.
    checked?: (connectionId: string) => boolean;
}

/// The connections a script or a shell can run on, the connections of the workbook first.
/// Subscribes to the connections only while it is open.
export function ConnectionMenu(props: MenuProps) {
    const connections = useConnections();
    const list = useConnectionList();
    // Renders again when the workbook uses other connections
    const connectionIds = useWorkbook(props.workbookId)?.connectionIds;
    const { workbookConnections, otherConnections, ordinals } = React.useMemo(() => {
        // The connections of the workbook, none while one of them is unknown
        const resolved = (connectionIds ?? []).map(connectionId => connections.get(connectionId));
        const workbookConnections = resolved.some(connection => connection == null) ? [] : resolved as ConnectionState[];
        const listed = listedConnections(connections, list, workbookConnections);
        return {
            workbookConnections,
            otherConnections: listed.slice(workbookConnections.length),
            ordinals: connectionOrdinals(list),
        };
    }, [connections, list, connectionIds, props.workbookId]);
    const renderItem = (connection: ConnectionState) => (
        <ActionList.ListItem
            key={connection.connectionId}
            aria-current={props.checked == null && connection.connectionId === props.connectionId ? 'true' : undefined}
            aria-pressed={props.checked?.(connection.connectionId)}
            data-connection={connection.connectionId}
            onClick={() => props.onPick(connection.connectionId)}
        >
            <ActionList.Leading>
                <ConnectorIcon connectorInfo={connectorInfoOf(connection)} />
            </ActionList.Leading>
            <ActionList.ItemText>
                <ActionList.ItemTextTitle>
                    <ConnectionLabelView parts={connectionLabelParts(connection, ordinals.get(connection.connectionId) ?? null)} />
                </ActionList.ItemTextTitle>
            </ActionList.ItemText>
            <ActionList.Trailing>
                {props.checked == null
                    ? <HealthDot health={connection.connectionHealth} />
                    : <input type="checkbox" className={styles.check} checked={props.checked(connection.connectionId)} readOnly tabIndex={-1} aria-hidden="true" />}
            </ActionList.Trailing>
        </ActionList.ListItem>
    );
    return (
        <div className={styles.menu} role="dialog" aria-label={`Connection of ${props.label}`}>
            <ActionList.List aria-label={`Connections for ${props.label}`}>
                {/* The list takes elements only, the fragments wrap the optional groups */}
                <>{workbookConnections.length > 0 && (
                    <>
                        <ActionList.GroupHeading>This workbook</ActionList.GroupHeading>
                        {workbookConnections.map(renderItem)}
                    </>
                )}</>
                <>{otherConnections.length > 0 && (
                    <>
                        <ActionList.GroupHeading>Other connections</ActionList.GroupHeading>
                        {otherConnections.map(renderItem)}
                    </>
                )}</>
            </ActionList.List>
        </div>
    );
}
