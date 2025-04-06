import * as React from 'react';
import * as symbols from '../../../static/svg/symbols.generated.svg';
import * as style from './connection_settings.module.css';

import { useNavigate } from 'react-router-dom';

import { FileSymlinkFileIcon, KeyIcon, PlugIcon, XIcon } from '@primer/octicons-react';

import { useConnectionState } from '../../connection/connection_registry.js';
import { ConnectionHealth, ConnectionStatus } from '../../connection/connection_state.js';
import { SalesforceConnectionParams } from '../../connection/salesforce/salesforce_connection_params.js';
import { useSalesforceSetup } from '../../connection/salesforce/salesforce_connector.js';
import { getSalesforceConnectionDetails } from '../../connection/salesforce/salesforce_connection_state.js';
import {
    TextField,
    TextFieldValidationStatus,
    VALIDATION_ERROR,
    VALIDATION_UNKNOWN,
} from '../foundations/text_field.js';
import { IndicatorStatus, StatusIndicator } from '../foundations/status_indicator.js';
import { Dispatch } from '../../utils/variant.js';
import { classNames } from '../../utils/classnames.js';
import { Logger } from '../../platform/logger.js';
import { useLogger } from '../../platform/logger_provider.js';
import { Button, ButtonVariant } from '../foundations/button.js';
import { CONNECTOR_INFOS, ConnectorType, HYPER_GRPC_CONNECTOR, requiresSwitchingToNative, SALESFORCE_DATA_CLOUD_CONNECTOR, TRINO_CONNECTOR } from '../../connection/connector_info.js';
import { DetailedError } from '../../utils/error.js';
import { ConnectionStateDetailsVariant } from '../../connection/connection_state_details.js';
import { useAnyConnectionWorkbook, useConnectionWorkbookSelector } from './connection_workbook.js';

const LOG_CTX = "sf_connector";

interface PageState {
    instanceUrl: string;
    appConsumerKey: string;
};
type PageStateSetter = Dispatch<React.SetStateAction<PageState>>;
const PAGE_STATE_CTX = React.createContext<[PageState, PageStateSetter] | null>(null);

export function getConnectionStatusText(status: ConnectionStatus | undefined, logger: Logger) {
    switch (status) {
        case ConnectionStatus.NOT_STARTED:
            return "Disconnected";
        case ConnectionStatus.AUTH_STARTED:
            return "Starting authorization";
        case ConnectionStatus.AUTH_CANCELLED:
            return "Cancelled authorization";
        case ConnectionStatus.AUTH_FAILED:
            return "Authorization failed";
        case ConnectionStatus.PKCE_GENERATION_STARTED:
            return "Generating PKCE challenge";
        case ConnectionStatus.PKCE_GENERATED:
            return "Generated PKCE challenge";
        case ConnectionStatus.WAITING_FOR_OAUTH_CODE_VIA_LINK:
        case ConnectionStatus.WAITING_FOR_OAUTH_CODE_VIA_WINDOW:
            return "Waiting for OAuth code";
        case ConnectionStatus.OAUTH_CODE_RECEIVED:
            return "Received OAuth code";
        case ConnectionStatus.CORE_ACCESS_TOKEN_REQUESTED:
            return "Requesting Core access token";
        case ConnectionStatus.CORE_ACCESS_TOKEN_RECEIVED:
            return "Received Core access token";
        case ConnectionStatus.DATA_CLOUD_TOKEN_REQUESTED:
            return "Requesting Data Cloud access token";
        case ConnectionStatus.DATA_CLOUD_TOKEN_RECEIVED:
            return "Received Data Cloud access token";
        case ConnectionStatus.CHANNEL_SETUP_STARTED:
            return "Creating channel";
        case ConnectionStatus.CHANNEL_SETUP_FAILED:
            return "Failed to create channel";
        case ConnectionStatus.CHANNEL_SETUP_CANCELLED:
            return "Cancelled channel setup";
        case ConnectionStatus.CHANNEL_READY:
            return "Channel is ready";
        case ConnectionStatus.HEALTH_CHECK_STARTED:
            return "Health check started";
        case ConnectionStatus.HEALTH_CHECK_FAILED:
            return "Health check failed";
        case ConnectionStatus.HEALTH_CHECK_CANCELLED:
            return "Health check cancelled";
        case ConnectionStatus.HEALTH_CHECK_SUCCEEDED:
            return "Health check succeeded";
        case undefined:
            break;
        default:
            logger.warn("unexpected connection status", { "status": status });
    }
    return "";
}

export function getConnectionHealthIndicator(health: ConnectionHealth | null) {
    switch (health) {
        case ConnectionHealth.NOT_STARTED:
            return IndicatorStatus.None;
        case ConnectionHealth.ONLINE:
            return IndicatorStatus.Succeeded;
        case ConnectionHealth.FAILED:
            return IndicatorStatus.Failed;
        case ConnectionHealth.CONNECTING:
            return IndicatorStatus.Running;
        default:
            return IndicatorStatus.None;
    }
}

export function getConnectionError(status: ConnectionStateDetailsVariant | null): (DetailedError | null) {
    switch (status?.type) {
        case TRINO_CONNECTOR:
            return status.value.channelError ?? status.value.healthCheckError;
        case SALESFORCE_DATA_CLOUD_CONNECTOR:
            return status.value.channelError ?? status.value.healthCheckError;
        case HYPER_GRPC_CONNECTOR:
            return status.value.channelError ?? status.value.healthCheckError;
        default:
            return null;
    }
}

interface Props {
    connectionId: number;
}

export const SalesforceConnectorSettings: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const navigate = useNavigate();
    const sfSetup = useSalesforceSetup();

    // Can we use the connector here?
    const connectorInfo = CONNECTOR_INFOS[ConnectorType.SALESFORCE_DATA_CLOUD];
    const connectorRequiresSwitch = requiresSwitchingToNative(connectorInfo);

    // Resolve connection state
    const [connectionState, dispatchConnectionState] = useConnectionState(props.connectionId);
    const salesforceConnection = getSalesforceConnectionDetails(connectionState);
    const selectConnectionWorkbook = useConnectionWorkbookSelector();

    // Wire up the page state
    const [pageState, setPageState] = React.useContext(PAGE_STATE_CTX)!;
    const updateInstanceUrl: React.ChangeEventHandler<HTMLInputElement> = ev => setPageState(s => ({ ...s, instanceUrl: ev.target.value }));
    const updateAppConsumerKey: React.ChangeEventHandler<HTMLInputElement> = ev => setPageState(s => ({ ...s, appConsumerKey: ev.target.value }));

    // Maintain setting validations
    const [instanceUrlValidation, setInstanceUrlValidation] = React.useState<TextFieldValidationStatus>({
        type: VALIDATION_UNKNOWN,
        value: null
    });
    const [appConsumerValidation, setAppConsumerValidation] = React.useState<TextFieldValidationStatus>({
        type: VALIDATION_UNKNOWN,
        value: null
    });

    // Helper to start the authorization
    const setupParams = React.useMemo<SalesforceConnectionParams>(() => ({
        instanceUrl: pageState.instanceUrl,
        appConsumerKey: pageState.appConsumerKey,
        appConsumerSecret: null,
        login: null,
    }), []);
    const setupAbortController = React.useRef<AbortController | null>(null);
    const setupConnection = async () => {
        let validationSucceeded = true;
        if (pageState.instanceUrl == "") {
            validationSucceeded = false;
            setInstanceUrlValidation({
                type: VALIDATION_ERROR,
                value: "Instance URL cannot be empty"
            });
        } else {
            setInstanceUrlValidation({
                type: VALIDATION_UNKNOWN,
                value: null
            })
        }
        if (pageState.appConsumerKey === "") {
            validationSucceeded = false;
            setAppConsumerValidation({
                type: VALIDATION_ERROR,
                value: "Connected App cannot be empty"
            });
        } else {
            setAppConsumerValidation({
                type: VALIDATION_UNKNOWN,
                value: null
            })
        }
        if (!validationSucceeded || !sfSetup) {
            return;
        }

        try {
            // Authorize the client
            setupAbortController.current = new AbortController();
            const _channel = await sfSetup.setup(dispatchConnectionState, setupParams, setupAbortController.current.signal);


            // Start the catalog update
            // XXX

        } catch (error: any) {
            // XXX
        }

        setupAbortController.current = null;
    };

    // Helper to cancel and reset the setup
    const cancelSetup = () => {
        if (setupAbortController.current) {
            setupAbortController.current.abort("abort the authorization flow");
            setupAbortController.current = null;
        }
    };
    const resetSetup = async () => {
        if (sfSetup) {
            await sfSetup.reset(dispatchConnectionState);
        }
    };

    // Helper to switch to the editor
    const openEditor = React.useCallback(() => {
        if (connectionState != null) {
            selectConnectionWorkbook(connectionState);
            navigate("/");
        }
    }, []);

    // Get the connection status
    const statusText = getConnectionStatusText(connectionState?.connectionStatus, logger);
    // Get the indicator status
    const indicatorStatus: IndicatorStatus = getConnectionHealthIndicator(connectionState?.connectionHealth ?? null);
    // Get the connection error
    const errorMessage = getConnectionError(connectionState?.details ?? null);

    // Get the action button
    let connectButton: React.ReactElement = <div />;
    let freezeInput = false;
    switch (connectionState?.connectionHealth) {
        case ConnectionHealth.NOT_STARTED:
        case ConnectionHealth.FAILED:
        case ConnectionHealth.CANCELLED:
            connectButton = (
                <Button
                    variant={ButtonVariant.Primary}
                    leadingVisual={PlugIcon}
                    onClick={setupConnection}
                    disabled={connectorRequiresSwitch}
                >
                    Connect
                </Button>
            );
            break;
        case ConnectionHealth.CONNECTING:
            connectButton = <Button variant={ButtonVariant.Danger} leadingVisual={XIcon} onClick={cancelSetup}>Cancel</Button>;
            freezeInput = true;
            break;
        case ConnectionHealth.ONLINE:
            connectButton = <Button variant={ButtonVariant.Danger} leadingVisual={XIcon} onClick={resetSetup}>Disconnect</Button>;
            freezeInput = true;
            break;
    }

    // Lock any changes?
    return (
        <div className={style.layout}>
            <div className={style.connector_header_container}>
                <div className={classNames(style.platform_logo, style.salesforce_logo)}>
                    <svg width="28px" height="28px">
                        <use xlinkHref={`${symbols}#salesforce_notext`} />
                    </svg>
                </div>
                <div className={style.platform_name} id="connector-sf-data-cloud">
                    Salesforce Data Cloud
                </div>
                <div className={style.platform_actions}>
                    {(connectionState?.connectionHealth == ConnectionHealth.ONLINE) && (
                        <Button variant={ButtonVariant.Default} leadingVisual={FileSymlinkFileIcon} onClick={openEditor}>Open Editor</Button>
                    )}
                    {connectButton}
                </div>
            </div>
            <div className={style.status_container}>
                <div className={classNames(style.section, style.status_section)}>
                    <div className={classNames(style.section_layout, style.status_section_layout)}>
                        <div className={style.status_bar}>
                            <div className={style.status_indicator}>
                                <StatusIndicator className={style.status_indicator_spinner} status={indicatorStatus} fill="black" />
                            </div>
                            <div className={style.status_text}>
                                {statusText}
                            </div>
                            {errorMessage && (
                                <div className={style.status_error}>
                                    {errorMessage.toString()}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
            <div className={style.body_container}>
                <div className={style.section}>
                    <div className={classNames(style.section_layout, style.body_section_layout)}>
                        <TextField
                            name="Salesforce Instance URL"
                            caption="URL of the Salesforce Instance"
                            value={pageState.instanceUrl}
                            onChange={updateInstanceUrl}
                            placeholder="Salesforce Instance"
                            leadingVisual={() => <div>URL</div>}
                            validation={instanceUrlValidation}
                            logContext={LOG_CTX}
                            disabled={freezeInput}
                            readOnly={freezeInput}
                        />
                        <TextField
                            name="Connected App"
                            caption="Setup > App Manager > [App] > Manage Consumer Details"
                            value={pageState.appConsumerKey}
                            onChange={updateAppConsumerKey}
                            placeholder="Consumer Key"
                            leadingVisual={() => <div>ID</div>}
                            validation={appConsumerValidation}
                            logContext={LOG_CTX}
                            disabled={freezeInput}
                            readOnly={freezeInput}
                        />
                    </div>
                </div>
                <div className={style.section}>
                    <div className={classNames(style.section_layout, style.body_section_layout)}>
                        <TextField
                            name="Core Access Token"
                            caption="Access Token for Salesforce Core"
                            value={salesforceConnection?.coreAccessToken?.accessToken ?? ''}
                            placeholder=""
                            leadingVisual={KeyIcon}
                            readOnly
                            disabled
                            logContext={LOG_CTX}
                        />
                    </div>
                </div>
                <div className={style.section}>
                    <div className={classNames(style.section_layout, style.body_section_layout)}>
                        <TextField
                            name="Data Cloud Instance URL"
                            caption="URL of the Data Cloud instance"
                            value={salesforceConnection?.dataCloudAccessToken?.instanceUrl?.toString() ?? ''}
                            placeholder=""
                            leadingVisual={() => <div>URL</div>}
                            readOnly
                            disabled
                            logContext={LOG_CTX}
                        />
                        <TextField
                            name="Data Cloud Access Token"
                            caption="URL of the Data Cloud instance"
                            value={salesforceConnection?.dataCloudAccessToken?.jwt?.raw ?? ''}
                            placeholder=""
                            leadingVisual={KeyIcon}
                            readOnly
                            disabled
                            logContext={LOG_CTX}
                        />
                        <TextField
                            name="Core Tenant ID"
                            caption="Tenant id for core apis"
                            value={salesforceConnection?.dataCloudAccessToken?.coreTenantId ?? ''}
                            placeholder=""
                            leadingVisual={() => <div>ID</div>}
                            readOnly
                            disabled
                            logContext={LOG_CTX}
                        />
                        <TextField
                            name="Data Cloud Tenant ID"
                            caption="Tenant id for Data Cloud apis"
                            value={salesforceConnection?.dataCloudAccessToken?.dcTenantId ?? ''}
                            placeholder=""
                            leadingVisual={() => <div>ID</div>}
                            readOnly
                            disabled
                            logContext={LOG_CTX}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

interface ProviderProps { children: React.ReactElement }

export const SalesforceConnectorSettingsStateProvider: React.FC<ProviderProps> = (props: ProviderProps) => {
    const state = React.useState<PageState>({
        instanceUrl: "",
        appConsumerKey: "",
    });
    return (
        <PAGE_STATE_CTX.Provider value={state}>
            {props.children}
        </PAGE_STATE_CTX.Provider>
    );
};
