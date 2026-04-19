import * as React from 'react';

import { ConnectionState } from '../../connection/connection_state.js';
import { ConnectorType } from '../../connection/connector_info.js';
import { Button, ButtonVariant } from '../../view/foundations/button.js';
import { CONNECTION_PATH, useRouterNavigate } from '../../router.js';

interface ButtonProps {
    sessionId?: string;
    conn: ConnectionState;
    onClick?: () => void;
}

interface ButtonWithRefProps extends ButtonProps {
    buttonRef?: React.RefObject<HTMLButtonElement>;
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
    const navigate = useRouterNavigate();
    const connStatusText = CONNECTION_HEALTH_NAMES[props.conn.connectionHealth ?? 0]
    const connStatusColor = CONNECTION_HEALTH_COLORS[props.conn.connectionHealth ?? 0];

    const handleClick = () => {
        if (props.onClick) {
            props.onClick();
        } else {
            navigate({
                type: CONNECTION_PATH,
                value: props.conn.sessionId
            });
        }
    };

    // Don't show a connector info for dataless connections
    if (props.conn.connectorInfo.connectorType == ConnectorType.DATALESS) {
        return <div />;
    }
    return (
        <Button
            ref={ref}
            variant={ButtonVariant.Default}
            trailingVisual={
                () => (
                    <svg width="8" height="8" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="4" cy="4" r="4" fill={connStatusColor} />
                    </svg>
                )
            }
            onClick={handleClick}
        >
            {connStatusText}
        </Button>
    );
});
