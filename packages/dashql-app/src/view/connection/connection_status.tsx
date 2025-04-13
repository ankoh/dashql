import * as React from 'react';
import * as styles from './connection_status.module.css';

import { ConnectionState } from '../../connection/connection_state.js';
import { classNames } from '../../utils/classnames.js';

export const CONNECTION_HEALTH_NAMES: string[] = [
    "Offline",
    "Connecting",
    "Cancelled",
    "Connected",
    "Failed",
]

export const CONNECTION_HEALTH_CLASSES: string[] = [
    styles.dot_offline,
    styles.dot_connecting,
    styles.dot_cancelled,
    styles.dot_online,
    styles.dot_failed,
];

interface Props {
    className?: string;
    conn: ConnectionState;
}

export function ConnectionStatus(props: Props) {
    const connStatusText = CONNECTION_HEALTH_NAMES[props.conn.connectionHealth ?? 0]
    const connStatusClass = CONNECTION_HEALTH_CLASSES[props.conn.connectionHealth ?? 0];
    return (
        <div className={styles.container}>
            <div className={classNames(styles.status_icon, connStatusClass)} />
            <div className={styles.status_text}>
                {connStatusText}
            </div>
        </div>
    );
}
