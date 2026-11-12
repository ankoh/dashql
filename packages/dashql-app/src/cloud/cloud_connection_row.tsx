import * as React from 'react';
import * as styles from './cloud_connection_row.module.css';
import symbols from '@ankoh/dashql-svg-symbols';

import type { ConnectionState } from '../connections/connection_state.js';
import { connectionLabel } from '../connections/connection_label.js';
import { CONNECTION_HEALTH_COLORS, CONNECTION_HEALTH_NAMES } from '../connections/connection_status.js';
import { CONNECTOR_ICON_STYLE, useConnectorIcon } from '../connections/connector_icon.js';

// A connection of the cloud setup in one line: the logo of its connector, its name, its health and actions.

export function CloudConnectionRow(props: { connection: ConnectionState; children?: React.ReactNode }): React.ReactElement {
    const connectorIcon = useConnectorIcon();
    const health = props.connection.connectionHealth;
    const healthName = CONNECTION_HEALTH_NAMES[health];
    return (
        <div className={styles.row} data-testid="cloud-connection-row">
            <svg className={styles.icon} width="16px" height="16px" aria-hidden="true">
                <use xlinkHref={`${symbols}#${connectorIcon(props.connection.connectorInfo)}`} style={CONNECTOR_ICON_STYLE} />
            </svg>
            <span className={styles.name}>{connectionLabel(props.connection)}</span>
            <svg className={styles.health} width="8px" height="8px" viewBox="0 0 8 8" role="img" aria-label={healthName}>
                <title>{healthName}</title>
                <circle cx="4" cy="4" r="4" style={{ fill: CONNECTION_HEALTH_COLORS[health] }} />
            </svg>
            <div className={styles.actions}>{props.children}</div>
        </div>
    );
}
