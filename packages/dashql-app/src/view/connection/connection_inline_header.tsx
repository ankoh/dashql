import * as React from 'react';
import symbols from '@ankoh/dashql-svg-symbols';

import * as style from './connection_inline_header.module.css';

import {
    PlugIcon,
    XIcon,
} from '@primer/octicons-react';

import { Button, ButtonVariant } from '../foundations/button.js';
import { ConnectionHealth, ConnectionState } from '../../connection/connection_state.js';
import { ConnectorInfo } from '../../connection/connector_info.js';
import { IndicatorStatus, StatusIndicator } from '../foundations/status_indicator.js';
import { NotebookState } from '../../notebook/notebook_state.js';
import { getConnectionError, getConnectionHealthIndicator, getConnectionStatusText } from './salesforce_connection_settings.js';
import { useLogger } from '../../platform/logger/logger_provider.js';

const LOG_CTX = "conn_inline_header";

interface Props {
    connector: ConnectorInfo;
    connection: ConnectionState | null;
    wrongPlatform: boolean;
    setupConnection?: () => void;
    cancelSetup?: () => void;
    resetSetup?: () => void;
    notebook: NotebookState | null;
    onClose?: () => void;
}

export function ConnectionInlineHeader(props: Props): React.ReactElement {
    const logger = useLogger();

    // Get the action button
    let connectButton: React.ReactElement = <div />;
    if (props.connector.features.manualSetup) {
        switch (props.connection?.connectionHealth) {
            case ConnectionHealth.NOT_STARTED:
            case ConnectionHealth.CANCELLED:
            case ConnectionHealth.FAILED:
                connectButton = (
                    <Button
                        variant={ButtonVariant.Primary}
                        leadingVisual={PlugIcon}
                        onClick={props.setupConnection}
                        disabled={props.wrongPlatform || !props.setupConnection}
                    >
                        Connect
                    </Button>
                );
                break;
            case ConnectionHealth.CONNECTING:
                connectButton = (
                    <Button
                        variant={ButtonVariant.Danger}
                        leadingVisual={XIcon}
                        onClick={props.cancelSetup}
                        disabled={!props.cancelSetup}
                    >
                        Cancel
                    </Button>
                );
                break;
            case ConnectionHealth.ONLINE:
                connectButton = (
                    <Button
                        variant={ButtonVariant.Danger}
                        leadingVisual={XIcon}
                        onClick={props.resetSetup}
                        disabled={!props.resetSetup}
                    >
                        Disconnect
                    </Button>
                );
                break;
        }
    }

    // Get the connection status
    let statusText: string = "";
    let indicatorStatus: IndicatorStatus = IndicatorStatus.None;
    if (props.wrongPlatform) {
        statusText = "Connector is disabled in the browser";
        indicatorStatus = IndicatorStatus.Skip;
    } else {
        statusText = getConnectionStatusText(props.connection?.connectionStatus, logger);
        indicatorStatus = getConnectionHealthIndicator(props.connection?.connectionHealth ?? null);
    }

    // Get the connection error (if any)
    const connectionError = getConnectionError(props.connection?.details ?? null);

    return (
        <div className={style.container}>
            <div className={style.header_row}>
                <div className={style.connector_info}>
                    <div className={style.connector_icon}>
                        <svg width="20px" height="24px">
                            <use xlinkHref={`${symbols}#${props.connector.icons.colored}`} />
                        </svg>
                    </div>
                    <div className={style.connector_name}>
                        {props.connector.names.displayLong}
                    </div>
                </div>
                <div className={style.actions}>
                    {connectButton}
                </div>
            </div>
            {props.connector.features.healthChecks && (
                <div className={style.status_row}>
                    <div className={style.status_indicator}>
                        <StatusIndicator status={indicatorStatus} fill="black" />
                    </div>
                    <div className={style.status_text}>
                        {statusText}
                    </div>
                    {connectionError && (
                        <div className={style.status_error}>
                            {connectionError.message.toString()}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
