import * as React from 'react';
import symbols from '@ankoh/dashql-svg-symbols';

import * as styles from './session_connection_buttons.module.css';

import { AnchorSide } from '../../../../ui/foundations/anchored_position.js';
import { ButtonSize, ButtonVariant, IconButton } from '../../../../ui/foundations/button.js';
import { ConnectionHealth, type ConnectionState } from '../../../connections/connection_state.js';
import { CONNECTION_HEALTH_COLORS, CONNECTION_HEALTH_NAMES } from '../../../connections/ui/connection_status.js';
import { ConnectionSettingsOverlay } from '../../../connections/ui/connection_settings_overlay.js';
import { connectionLabelText } from '../../../connections/ui/connection_label.js';
import { useConnectionLabeler } from '../connection_labels.js';

interface Props {
    /// The connections that the scripts of the session run on
    connections: readonly ConnectionState[];
    /// The session asks for attention to its connections, e.g. when a blocked run button is hovered
    attention: boolean;
}

export interface SessionConnectionButtonsDependencies {
    ConnectionSettingsOverlay: typeof ConnectionSettingsOverlay;
}

const DEFAULT_DEPENDENCIES: SessionConnectionButtonsDependencies = {
    ConnectionSettingsOverlay,
};

/// The connections that the scripts of a session run on, a connector logo with a health dot each.
///
/// The user sees which connection is not connected yet. A button opens the settings of its connection,
/// nothing connects by itself.
export function SessionConnectionButtons(props: Props & { dependencies?: SessionConnectionButtonsDependencies }): React.ReactElement | null {
    const dependencies = props.dependencies ?? DEFAULT_DEPENDENCIES;
    const labeler = useConnectionLabeler();
    const [settingsConnectionId, setSettingsConnectionId] = React.useState<string | null>(null);
    const anchorRef = React.useRef<HTMLButtonElement | null>(null);
    if (props.connections.length === 0) return null;
    return (
        <div className={styles.buttons} role="group" aria-label="Connections of the session" data-testid="session-connections">
            {props.connections.map(connection => {
                const health = connection.connectionHealth;
                const label = `${connectionLabelText(labeler(connection))}: ${CONNECTION_HEALTH_NAMES[health]}`;
                return (
                    <IconButton
                        key={connection.connectionId}
                        className={styles.button}
                        variant={ButtonVariant.Invisible}
                        size={ButtonSize.Small}
                        aria-label={label}
                        data-testid="session-connection"
                        data-health={ConnectionHealth[health]}
                        data-attention={props.attention && health !== ConnectionHealth.ONLINE ? '' : undefined}
                        onClick={event => {
                            anchorRef.current = event.currentTarget;
                            setSettingsConnectionId(connection.connectionId);
                        }}
                    >
                        <span className={styles.logo}>
                            <svg width="16px" height="16px" aria-hidden="true">
                                <use xlinkHref={`${symbols}#${connection.connectorInfo.icons.colored}`} />
                            </svg>
                            <svg className={styles.health} width="10px" height="10px" viewBox="0 0 10 10" aria-hidden="true">
                                <circle cx="5" cy="5" r="5" fill="white" />
                                <circle cx="5" cy="5" r="3.5" style={{ fill: CONNECTION_HEALTH_COLORS[health] }} />
                            </svg>
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
