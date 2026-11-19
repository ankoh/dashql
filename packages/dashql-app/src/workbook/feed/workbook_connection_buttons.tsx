import * as React from 'react';
import symbols from '@akohn/dashql-svg-symbols';

import * as styles from './workbook_connection_buttons.module.css';

import { AnchorSide } from '@akohn/dashql-react/dom/anchored_position';
import { ButtonSize, ButtonVariant, IconButton } from '@akohn/dashql-react/components/button';
import { ConnectionHealth, type ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import { CONNECTION_HEALTH_COLORS, CONNECTION_HEALTH_NAMES } from '../../connections/connection_status.js';
import { ConnectionSettingsOverlay } from '../../connections/connection_settings_overlay.js';
import { LockIcon } from '@akohn/dashql-react/components/symbol_icon';
import { useWorkbookReadOnly } from '../workbook_read_only.js';
import { useConnectionLabeler } from '../connections/connection_labels.js';
import { CONNECTOR_ICON_STYLE, useConnectorIcon } from '../../connections/connector_icon.js';
import { connectorInfoOf } from '@akohn/dashql/platform/connections/connection_state';

interface Props {
    /// The connections that the scripts of the workbook and the next script run on
    connections: readonly ConnectionState[];
    /// The workbook asks for attention to its connections, e.g. when a blocked run button is hovered
    attention: boolean;
}

export interface WorkbookConnectionButtonsDependencies {
    ConnectionSettingsOverlay: typeof ConnectionSettingsOverlay;
}

const DEFAULT_DEPENDENCIES: WorkbookConnectionButtonsDependencies = {
    ConnectionSettingsOverlay,
};

/// The connections that the scripts of a workbook and its next script run on, a connector logo with a health dot each.
///
/// The user sees which connection is not connected yet. A button opens the settings of its connection,
/// nothing connects by itself. A read-only workbook, a preview of a published workbook, runs only on the embedded Hyper:
/// its other connections are greyed with a lock and open nothing, the import maps them.
export function WorkbookConnectionButtons(props: Props & { dependencies?: WorkbookConnectionButtonsDependencies }): React.ReactElement | null {
    const connectorIcon = useConnectorIcon();
    const dependencies = props.dependencies ?? DEFAULT_DEPENDENCIES;
    const labeler = useConnectionLabeler();
    const readOnly = useWorkbookReadOnly();
    const [settingsConnectionId, setSettingsConnectionId] = React.useState<string | null>(null);
    const anchorRef = React.useRef<HTMLButtonElement | null>(null);
    if (props.connections.length === 0) return null;
    return (
        <div className={styles.buttons} role="group" aria-label="Connections of the workbook" data-testid="workbook-connections">
            {props.connections.map(connection => {
                const health = connection.connectionHealth;
                const locked = readOnly && !connection.embedded;
                const label = locked
                    ? `${labeler(connection).text}: locked until the workbook is imported`
                    : `${labeler(connection).text}: ${CONNECTION_HEALTH_NAMES[health]}`;
                return (
                    <IconButton
                        key={connection.connectionId}
                        className={styles.button}
                        variant={ButtonVariant.Invisible}
                        size={ButtonSize.Small}
                        aria-label={label}
                        data-testid="workbook-connection"
                        data-health={ConnectionHealth[health]}
                        data-locked={locked ? '' : undefined}
                        title={locked ? label : undefined}
                        data-attention={props.attention && !locked && health !== ConnectionHealth.ONLINE ? '' : undefined}
                        onClick={event => {
                            if (locked) return;
                            anchorRef.current = event.currentTarget;
                            setSettingsConnectionId(connection.connectionId);
                        }}
                    >
                        <span className={styles.logo}>
                            <svg width="16px" height="16px" aria-hidden="true">
                                <use xlinkHref={`${symbols}#${connectorIcon(connectorInfoOf(connection))}`} style={CONNECTOR_ICON_STYLE} />
                            </svg>
                            {locked ? (
                                <span className={styles.lock} aria-hidden="true"><LockIcon size={10} /></span>
                            ) : (
                                <svg className={styles.health} width="10px" height="10px" viewBox="0 0 10 10" aria-hidden="true">
                                    <circle cx="5" cy="5" r="5" style={{ fill: 'var(--color_bg_card)' }} />
                                    <circle cx="5" cy="5" r="3.5" style={{ fill: CONNECTION_HEALTH_COLORS[health] }} />
                                </svg>
                            )}
                        </span>
                    </IconButton>
                );
            })}
            {/* Mounted only while open, the overlay subscribes to the connection */}
            {settingsConnectionId != null && (
                <dependencies.ConnectionSettingsOverlay
                    connectionId={settingsConnectionId}
                    isOpen
                    onClose={() => setSettingsConnectionId(null)}
                    anchorRef={anchorRef}
                    side={AnchorSide.OutsideBottom}
                />
            )}
        </div>
    );
}
