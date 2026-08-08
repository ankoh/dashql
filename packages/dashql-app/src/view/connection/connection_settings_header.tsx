import * as React from 'react';
import symbols from '@ankoh/dashql-svg-symbols';

import * as style from './connection_settings_header.module.css';

import {
    PlugIcon,
    XIcon,
    LinkIcon,
} from '@primer/octicons-react';

import { Button, ButtonSize, ButtonVariant } from '../foundations/button.js';
import { canDeleteConnectionWithStatus, ConnectionHealth, ConnectionState, DELETE_CONNECTION } from '../../connection/connection_state.js';
import { ConnectorInfo } from '../../connection/connector_info.js';
import { CopyToClipboardButton } from '../../utils/clipboard.js';
import { IndicatorStatus, StatusIndicator } from '../../view/foundations/status_indicator.js';
import { PlatformType, usePlatformType } from '../../platform/platform_type.js';
import { NotebookScripts } from '../../scripts/notebook_scripts.js';
import { exportNotebookAsUrl, NotebookLinkTarget } from '../../platform/storage/notebook_export.js';
import { getConnectionError, getConnectionHealthIndicator, getConnectionStatusText } from './salesforce_connection_settings.js';
import { getConnectionParamsFromStateDetails } from '../../connection/connection_params.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { useStorageReader } from '../../platform/storage/storage_provider.js';
import { useRouterNavigate, NOTEBOOK_PATH } from '../../router.js';
import { useNotebookScriptsSetup } from '../../scripts/notebook_scripts_setup.js';
import { SymbolIcon } from '../../view/foundations/symbol_icon.js';
import { useNotebookScriptsRegistry } from '../../scripts/notebook_scripts_registry.js';
import { useDynamicConnectionDispatch } from '../../connection/connection_registry.js';

const LOG_CTX = "conn_header";

interface Props {
    connector: ConnectorInfo;
    connection: ConnectionState | null;
    wrongPlatform: boolean;
    setupConnection?: () => void;
    cancelSetup?: () => void;
    resetSetup?: () => void;
    notebookScripts: NotebookScripts | null;
    onClose?: () => void;
}

interface SetupURLs {
    browser: URL;
    native: URL;
}

export function ConnectionHeader(props: Props): React.ReactElement {
    const logger = useLogger();
    const navigate = useRouterNavigate();
    const storage = useStorageReader();
    const setupNotebookScripts = useNotebookScriptsSetup();
    const modifyConnection = useDynamicConnectionDispatch()[1];
    const notebookScriptsRegistry = useNotebookScriptsRegistry()[0];

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

    // Create new notebooks
    const createNotebook = React.useCallback(() => {
        if (props.connection == null) {
            return;
        }
        const notebookScripts = setupNotebookScripts(props.connection);
        props.onClose?.();
        navigate({
            type: NOTEBOOK_PATH,
            value: notebookScripts.notebookId
        });
    }, [props.onClose]);

    // Check if we can delete the connection
    let connectionNotebooks = (props.connection == null)
        ? []
        : notebookScriptsRegistry.notebookScriptsByConnection.get(props.connection.notebookId);;
    const cannotDeleteWithStatus = props.connection != null && !canDeleteConnectionWithStatus(props.connection.connectionStatus);
    const cannotDeleteWithNotebooks = (connectionNotebooks?.length ?? 0) > 0
    const canDeleteConnection = !cannotDeleteWithStatus && !cannotDeleteWithNotebooks;
    let deleteTooltip: string = "Delete";
    if (cannotDeleteWithNotebooks) {
        deleteTooltip = "Cannot delete connection with notebooks";
    } else if (cannotDeleteWithStatus) {
        deleteTooltip = "Cannot be online";
    }

    // Helper to delete a ctonnection
    const deleteConnection = React.useCallback(() => {
        if (props.connection == null) {
            return;
        }
        if (!canDeleteConnectionWithStatus(props.connection.connectionStatus)) {
            logger.warn("Refusing to delete connection due to status", {
                connection: props.connection.notebookId,
                status: props.connection.connectionStatus.toString()
            });
            return;
        }
        if ((connectionNotebooks?.length ?? 0) > 0) {
            logger.warn("Refusing to delete connection with notebooks", {
                connection: props.connection.notebookId,
                status: props.connection.connectionStatus.toString(),
                notebooks: connectionNotebooks!.length.toString()
            });
            return;
        }
        props.onClose?.();
        modifyConnection(props.connection.notebookId, {
            type: DELETE_CONNECTION,
            value: null
        });
    }, [props.onClose]);

    // Maintain the setup url for the same platform
    const [setupURLs, setSetupURLs] = React.useState<SetupURLs | null>(null);
    React.useEffect(() => {
        let cancelled = false;

        async function generateURLs() {
            if (props.connection == null || props.notebookScripts == null) {
                setSetupURLs(null);
                return;
            }

            const connParams = getConnectionParamsFromStateDetails(props.connection.details);
            if (!connParams) {
                setSetupURLs(null);
                return;
            }

            const [urlWeb, urlNative] = await Promise.all([
                exportNotebookAsUrl(storage.backend, props.notebookScripts.notebookId, connParams, NotebookLinkTarget.WEB),
                exportNotebookAsUrl(storage.backend, props.notebookScripts.notebookId, connParams, NotebookLinkTarget.NATIVE)
            ]);

            if (!cancelled) {
                setSetupURLs({
                    browser: urlWeb,
                    native: urlNative,
                });
            }
        }

        generateURLs();

        return () => {
            cancelled = true;
        };
    }, [props.notebookScripts, props.connection, storage.backend]);

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
                        onClick={createNotebook}
                    >
                        Create Notebook
                    </Button>
                    <CopyToClipboardButton
                        variant={ButtonVariant.Default}
                        size={ButtonSize.Medium}
                        logContext={LOG_CTX}
                        value={(platformType == PlatformType.WEB ? setupURLs?.browser : setupURLs?.native)?.toString() ?? ""}
                        disabled={!setupURLs || props.connection?.connectionHealth !== ConnectionHealth.ONLINE}
                        icon={LinkIcon}
                        aria-label="Copy Setup Link"
                        aria-labelledby=""
                    />
                    <Button
                        variant={ButtonVariant.Danger}
                        leadingVisual={TrashIcon}
                        disabled={!canDeleteConnection}
                        onClick={deleteConnection}
                    >
                        Delete
                    </Button>
                    {connectButton}
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
                                        {connectionError.message.toString()}
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
