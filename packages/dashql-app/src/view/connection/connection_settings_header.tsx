import * as React from 'react';
import * as symbols from '../../../static/svg/symbols.generated.svg';

import * as style from './connection_settings_header.module.css';

import {
    PlugIcon,
    FileSymlinkFileIcon,
    XIcon,
    LinkIcon,
} from '@primer/octicons-react';

import { Button, ButtonSize, ButtonVariant } from '../foundations/button.js';
import { canDeleteConnectionWithStatus, ConnectionHealth, ConnectionState, ConnectionStatus, DELETE_CONNECTION } from '../../connection/connection_state.js';
import { ConnectorInfo } from '../../connection/connector_info.js';
import { CopyToClipboardButton } from '../../utils/clipboard.js';
import { IndicatorStatus, StatusIndicator } from '../../view/foundations/status_indicator.js';
import { PlatformType, usePlatformType } from '../../platform/platform_type.js';
import { WorkbookState } from '../../workbook/workbook_state.js';
import { encodeWorkbookAsProto, encodeWorkbookProtoAsUrl, WorkbookLinkTarget } from '../../workbook/workbook_export.js';
import { getConnectionError, getConnectionHealthIndicator, getConnectionStatusText } from './salesforce_connection_settings.js';
import { getConnectionParamsFromStateDetails } from '../../connection/connection_params.js';
import { useLogger } from '../../platform/logger_provider.js';
import { CONNECTION_PATH, useRouterNavigate, WORKBOOK_PATH } from '../../router.js';
import { useWorkbookSetup } from '../../workbook/workbook_setup.js';
import { SymbolIcon } from '../../view/foundations/symbol_icon.js';
import { useWorkbookRegistry } from '../../workbook/workbook_state_registry.js';
import { useDynamicConnectionDispatch } from '../../connection/connection_registry.js';

const LOG_CTX = "conn_header";

interface Props {
    connector: ConnectorInfo;
    connection: ConnectionState | null;
    wrongPlatform: boolean;
    setupConnection?: () => void;
    cancelSetup?: () => void;
    resetSetup?: () => void;
    workbook: WorkbookState | null;
}

interface SetupURLs {
    browser: URL;
    native: URL;
}

export function ConnectionHeader(props: Props): React.ReactElement {
    const logger = useLogger();
    const navigate = useRouterNavigate();
    const setupWorkbook = useWorkbookSetup();
    const modifyConnection = useDynamicConnectionDispatch()[1];
    const workbookRegistry = useWorkbookRegistry()[0];

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

    // Create new workbooks
    const createWorkbook = React.useCallback(() => {
        if (props.connection == null) {
            return;
        }
        let workbookId: number | undefined = undefined;
        const workbook = setupWorkbook(props.connection);
        workbookId = workbook.workbookId;
        navigate({
            type: WORKBOOK_PATH,
            value: {
                connectionId: props.connection.connectionId,
                workbookId: workbookId,
            }
        });
    }, []);

    // Create helper to delete a connection
    let connectionWorkbooks = (props.connection == null)
        ? []
        : workbookRegistry.workbooksByConnection.get(props.connection.connectionId);
    const canDeleteConnection =
        props.connection != null
        && canDeleteConnectionWithStatus(props.connection.connectionStatus)
        && (connectionWorkbooks?.length ?? 0) == 0;
    const deleteConnection = React.useCallback(() => {
        if (props.connection == null) {
            return;
        }
        if (!canDeleteConnectionWithStatus(props.connection.connectionStatus)) {
            logger.warn("refusing to delete connection due to status", {
                connection: props.connection.connectionId.toString(),
                status: props.connection.connectionStatus.toString()
            });
            return;
        }
        if ((connectionWorkbooks?.length ?? 0) > 0) {
            logger.warn("refusing to delete connection with workbooks", {
                connection: props.connection.connectionId.toString(),
                status: props.connection.connectionStatus.toString(),
                workbooks: connectionWorkbooks!.length.toString()
            });
            return;
        }
        navigate({
            type: CONNECTION_PATH,
            value: null
        })
        modifyConnection(props.connection.connectionId, {
            type: DELETE_CONNECTION,
            value: null
        });
    }, []);

    // Maintain the setup url for the same platform
    const setupURLs = React.useMemo<SetupURLs | null>(() => {
        if (props.connection == null || props.workbook == null) return null;
        const connParams = getConnectionParamsFromStateDetails(props.connection.details);
        const proto = encodeWorkbookAsProto(props.workbook, true, connParams);
        const urlWeb = encodeWorkbookProtoAsUrl(proto, WorkbookLinkTarget.WEB)
        const urlNative = encodeWorkbookProtoAsUrl(proto, WorkbookLinkTarget.NATIVE);
        const setupURLs: SetupURLs = {
            browser: urlWeb,
            native: urlNative,
        };
        return setupURLs;
    }, [props.workbook, props.connection]);

    // Determine platform type
    const platformType = usePlatformType();
    // XXX Add a button to switch the platform (that's why we're computing both setup urls)

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

    const TrashIcon = SymbolIcon("trash_16");
    const FilePlusIcon = SymbolIcon("file_plus_16");
    return (
        <div className={style.container}>
            <div className={style.connector_header_container}>
                <div className={style.platform_logo}>
                    <svg width="24px" height="28px">
                        <use xlinkHref={`${symbols}#${props.connector.icons.colored}`} />
                    </svg>
                </div>
                <div className={style.platform_name} aria-labelledby="connector-name">
                    {props.connector.names.displayLong}
                </div>
                <div className={style.platform_actions}>
                    <Button
                        variant={ButtonVariant.Default}
                        leadingVisual={FilePlusIcon}
                        onClick={createWorkbook}
                    >
                        Create Workbook
                    </Button>
                    <CopyToClipboardButton
                        variant={ButtonVariant.Default}
                        size={ButtonSize.Medium}
                        logContext={LOG_CTX}
                        value={(platformType == PlatformType.WEB ? setupURLs?.browser : setupURLs?.native)?.toString() ?? ""}
                        disabled={!setupURLs}
                        icon={LinkIcon}
                        aria-label="copy-link"
                        aria-labelledby=""
                    />
                    {connectButton}
                    <Button
                        variant={ButtonVariant.Danger}
                        leadingVisual={TrashIcon}
                        disabled={!canDeleteConnection}
                        onClick={deleteConnection}
                    >
                        Delete
                    </Button>
                </div>
            </div >
            {props.connector.features.healthChecks && (
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
            )}
        </div>
    );
}
