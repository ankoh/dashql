import * as React from 'react';

import { ConnectionState } from '../../connection/connection_state.js';
import { ConnectorType } from '../../connection/connector_info.js';
import { Button, ButtonVariant } from '../../view/foundations/button.js';

export const CONNECTION_HEALTH_NAMES: string[] = [
    "Disconnected",
    "Connecting",
    "Cancelled",
    "Connected",
    "Failed",
]

export const CONNECTION_HEALTH_COLORS: string[] = [
    "#cf222e",
    "#9a6700",
    "#cf222e",
    "#1f883d",
    "#cf222e",
];

interface Props {
    conn: ConnectionState;
}

export function ConnectionStatus(props: Props) {
    const connStatusText = CONNECTION_HEALTH_NAMES[props.conn.connectionHealth ?? 0]
    const connStatusColor = CONNECTION_HEALTH_COLORS[props.conn.connectionHealth ?? 0];

    // Don't show a connector info for serverless connections
    if (props.conn.connectorInfo.connectorType == ConnectorType.SERVERLESS) {
        return <div />;
    }
    return (
        <Button
            variant={ButtonVariant.Default}
            trailingVisual={
                () => (
                    <svg width="8" height="8" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="4" cy="4" r="4" fill={connStatusColor} />
                    </svg>
                )
            }
        >
            {connStatusText}
        </Button>
    );
}
