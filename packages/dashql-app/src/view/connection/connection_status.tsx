import * as React from 'react';
import symbols from '@ankoh/dashql-svg-symbols';

import { ConnectionState } from '../../connection/connection_state.js';
import { ConnectorType } from '../../connection/connector_info.js';
import { DatalessConnectionStateDetails, isDemoConnector } from '../../connection/dataless/dataless_connection_state.js';
import { Button, ButtonVariant } from '../../view/foundations/button.js';

interface ButtonProps {
    sessionId?: string;
    conn: ConnectionState;
    onClick?: () => void;
    compact?: boolean;
}

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

export const ConnectionStatus = React.forwardRef<HTMLButtonElement, ButtonProps>((props, ref) => {
    const health = props.conn.connectionHealth ?? 0;
    const connectorIcon = props.conn.connectorInfo.icons.colored;

    const isDatalessNonDemo =
        props.conn.connectorInfo.connectorType === ConnectorType.DATALESS &&
        !isDemoConnector(props.conn.details.value as DatalessConnectionStateDetails);
    const connStatusText = isDatalessNonDemo ? "Dataless" : "Demo";
    const connStatusColor = CONNECTION_HEALTH_COLORS[health];

    const handleClick = () => {
        if (props.onClick) {
            props.onClick();
        }
    };

    const ConnectorIconVisual = () => (
        <svg width="16" height="16">
            <use xlinkHref={`${symbols}#${connectorIcon}`} />
        </svg>
    );
    const StatusDotVisual = () => (
        <svg width="8" height="8" xmlns="http://www.w3.org/2000/svg">
            <circle cx="4" cy="4" r="4" fill={connStatusColor} />
        </svg>
    );

    return (
        <Button
            ref={ref}
            variant={ButtonVariant.Default}
            leadingVisual={ConnectorIconVisual}
            trailingVisual={isDatalessNonDemo ? undefined : StatusDotVisual}
            onClick={handleClick}
            aria-label={props.compact ? connStatusText : undefined}
        >
            {props.compact ? null : connStatusText}
        </Button>
    );
});
