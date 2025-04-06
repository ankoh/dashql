import * as React from 'react';
import * as symbols from '../../../static/svg/symbols.generated.svg';

import * as style from './connection_settings_header.module.css';

import {
    PlugIcon,
    FileSymlinkFileIcon,
    XIcon,
    LinkIcon,
} from '@primer/octicons-react';

import { useNavigate } from 'react-router-dom';
import { Button, ButtonSize, ButtonVariant } from '../foundations/button.js';
import { ConnectionHealth, ConnectionState } from '../../connection/connection_state.js';
import { WorkbookState } from '../../workbook/workbook_state.js';
import { useCurrentWorkbookSelector } from '../../workbook/current_workbook.js';
import { useWorkbookSetup } from '../../workbook/workbook_setup.js';
import { IndicatorStatus, StatusIndicator } from '../../view/foundations/status_indicator.js';
import { getConnectionError, getConnectionHealthIndicator, getConnectionStatusText } from './salesforce_connection_settings.js';
import { useLogger } from '../../platform/logger_provider.js';
import { ConnectorInfo } from '../../connection/connector_info.js';
import { PlatformType, usePlatformType } from '../../platform/platform_type.js';
import { encodeWorkbookAsProto, encodeWorkbookProtoAsUrl, WorkbookLinkTarget } from '../../workbook/workbook_export_url.js';
import { CopyToClipboardButton } from '../../utils/clipboard.js';

const LOG_CTX = "conn_header";

interface Props {
    connector: ConnectorInfo;
    connection: ConnectionState | null;
    wrongPlatform: boolean;
    setupConnection: () => void;
    cancelSetup: () => void;
    resetSetup: () => void;
    workbook: WorkbookState | null;
}

export function ConnectionHeader(props: Props): React.ReactElement {
    const logger = useLogger();
    const navigate = useNavigate();
    const selectWorkbook = useCurrentWorkbookSelector();
    const setupWorkbook = useWorkbookSetup();

    // Get the action button
    let connectButton: React.ReactElement = <div />;
    switch (props.connection?.connectionHealth) {
        case ConnectionHealth.NOT_STARTED:
        case ConnectionHealth.CANCELLED:
        case ConnectionHealth.FAILED:
            connectButton = (
                <Button
                    variant={ButtonVariant.Primary}
                    leadingVisual={PlugIcon}
                    onClick={props.setupConnection}
                    disabled={props.wrongPlatform}
                >
                    Connect
                </Button>
            );
            break;
        case ConnectionHealth.CONNECTING:
            connectButton = <Button variant={ButtonVariant.Danger} leadingVisual={XIcon} onClick={props.cancelSetup}>Cancel</Button>;
            break;
        case ConnectionHealth.ONLINE:
            connectButton = <Button variant={ButtonVariant.Danger} leadingVisual={XIcon} onClick={props.resetSetup}>Disconnect</Button>;
            break;
    }

    // Helper to switch to the editor
    const openEditor = React.useCallback(() => {
        if (props.connection != null) {
            if (props.workbook != null) {
                selectWorkbook(props.workbook.workbookId);
            } else {
                const workbook = setupWorkbook(props.connection);
                selectWorkbook(workbook.workbookId);
            }
            navigate("/");
        }
    }, []);

    // Maintain the setup url for the same platform
    const platformType = usePlatformType();
    const setupLinkTarget = platformType === PlatformType.WEB ? WorkbookLinkTarget.WEB : WorkbookLinkTarget.NATIVE;
    const setupURL = React.useMemo(() => {
        if (props.connection == null) {
            return null;
        }
        // const params: ConnectionParamsVariant = {
        //     type: TRINO_CONNECTOR,
        //     value: pageState.newParams
        // };

        // XXX Get Params
        const proto = encodeWorkbookAsProto(props.workbook, {} as any);
        return encodeWorkbookProtoAsUrl(proto, setupLinkTarget);
    }, [props.workbook, props.connection, setupLinkTarget]);

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
            <div className={style.connector_header_container}>
                <div className={style.platform_logo}>
                    <svg width="28px" height="28px">
                        <use xlinkHref={`${symbols}#${props.connector.icons.colored}`} />
                    </svg>
                </div>
                <div className={style.platform_name} aria-labelledby="connector-name">
                    {props.connector.displayName.long}
                </div>
                <div className={style.platform_actions}>
                    {(props.connection?.connectionHealth == ConnectionHealth.ONLINE) && (
                        <Button variant={ButtonVariant.Default} leadingVisual={FileSymlinkFileIcon} onClick={openEditor}>Open Editor</Button>
                    )}
                    <CopyToClipboardButton
                        variant={ButtonVariant.Default}
                        size={ButtonSize.Medium}
                        logContext={LOG_CTX}
                        value={setupURL?.toString() ?? ""}
                        disabled={setupURL == null}
                        icon={LinkIcon}
                        aria-label="copy-link"
                        aria-labelledby=""
                    />
                    {connectButton}
                </div>
            </div >
            <div className={style.status_container}>
                <div className={style.status_section}>
                    <div className={style.status_section_layout}>
                        <div className={style.status_bar}>
                            <div className={style.status_indicator}>
                                <StatusIndicator className={style.status_indicator_spinner} status={indicatorStatus} fill="black" />
                            </div>
                            <div className={style.status_text}>
                                {statusText}
                            </div>
                            {connectionError && (
                                <div className={style.status_error}>
                                    {connectionError.toString()}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
