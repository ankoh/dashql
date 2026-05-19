import * as React from 'react';
import * as style from './connection_settings.module.css';
import * as connection from '@ankoh/dashql-jsonschema/connection.js';

import { KeyIcon, PlugIcon, XIcon } from '@primer/octicons-react';

import { useConnectionState } from '../../connection/connection_registry.js';
import { ConnectionHealth, ConnectionStatus } from '../../connection/connection_state.js';
import { performHealthCheck } from '../../connection/health_check.js';
import { useQueryExecutor } from '../../connection/query_executor.js';
import { useSalesforceSetup } from '../../connection/salesforce/salesforce_connector.js';
import { getSalesforceConnectionDetails } from '../../connection/salesforce/salesforce_connection_state.js';
import {
    TextField,
    TextFieldValidationStatus,
    VALIDATION_ERROR,
    VALIDATION_UNKNOWN,
} from '../foundations/text_field.js';
import { IndicatorStatus } from '../foundations/status_indicator.js';
import { classNames } from '../../utils/classnames.js';
import { Logger } from '../../platform/logger/logger.js';
import { Button, ButtonVariant } from '../foundations/button.js';
import { CONNECTOR_INFOS, ConnectorType, HYPER_CONNECTOR, SALESFORCE_DATA_CLOUD_CONNECTOR, TRINO_CONNECTOR } from '../../connection/connector_info.js';
import { isNativePlatform } from '../../platform/native_globals.js';
import { ConnectionStateDetailsVariant } from '../../connection/connection_state_details.js';
import type { DetailedError } from '../../connection/connection_types.js';
import { useAnyConnectionNotebook } from './connection_notebook.js';
import { ConnectionInlineHeader } from './connection_inline_header.js';
import { collectSalesforceAuthInfo } from '../../connection/salesforce/salesforce_api_client.js';

const LOG_CTX = "sf_connector";

interface PageState {
    hyperProtocol: connection.HyperProtocol;
    instanceUrl: string;
    appConsumerKey: string;
};

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
        case ConnectionStatus.ACCESS_TOKEN_REQUESTED:
            return "Requesting access token";
        case ConnectionStatus.ACCESS_TOKEN_RECEIVED:
            return "Received access token";
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
            return (status.value.proto.channelError ?? status.value.proto.healthCheckError ?? null) as DetailedError | null;
        case SALESFORCE_DATA_CLOUD_CONNECTOR:
            return (status.value.proto.channelError ?? status.value.proto.healthCheckError ?? null) as DetailedError | null;
        case HYPER_CONNECTOR:
            return (status.value.proto.channelError ?? status.value.proto.healthCheckError ?? null) as DetailedError | null;
        default:
            return null;
    }
}

interface Props {
    sessionId: string | null;
    onClose?: () => void;
}

export const SalesforceConnectorSettings: React.FC<Props> = (props: Props) => {
    const sfSetup = useSalesforceSetup();
    const queryExecutor = useQueryExecutor();

    // Can we use the connector here?
    const connectorInfo = CONNECTOR_INFOS[ConnectorType.SALESFORCE_DATA_CLOUD];

    // Resolve connection state
    const [connectionState, dispatchConnectionState] = useConnectionState(props.sessionId);
    const connectionNotebook = useAnyConnectionNotebook(props.sessionId);
    const salesforceConnection = getSalesforceConnectionDetails(connectionState);

    // Seed the form state from the restored connection params so a session
    // that was saved across an app restart displays its endpoint/key.
    // Re-seeds whenever the stored setupParams reference changes (session
    // switch, async storage hydration, or an action like RESET that swaps
    // the wrapper state).
    const buildPageState = (params: connection.SalesforceConnectionParams | undefined): PageState => ({
        hyperProtocol: params?.hyperProtocol ?? (isNativePlatform() ? "V3_GRPC" : "V3_HTTP"),
        instanceUrl: params?.instanceUrl ?? "",
        appConsumerKey: params?.appConsumerKey ?? "",
    });
    const [pageState, setPageState] = React.useState<PageState>(() =>
        buildPageState(salesforceConnection?.proto.setupParams));
    const seededParamsRef = React.useRef(salesforceConnection?.proto.setupParams);
    React.useEffect(() => {
        const params = salesforceConnection?.proto.setupParams;
        if (params !== seededParamsRef.current) {
            seededParamsRef.current = params;
            setPageState(buildPageState(params));
        }
    }, [salesforceConnection]);
    const hyperProtocol = pageState.hyperProtocol;

    // gRPC requires the native platform
    const wrongPlatform = hyperProtocol === "V3_GRPC" && !isNativePlatform();
    const setHyperProtocol = (v: connection.HyperProtocol) => setPageState(s => ({ ...s, hyperProtocol: v }));
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
    const setupParams = React.useMemo<connection.SalesforceConnectionParams>(() => ({
        hyperProtocol: pageState.hyperProtocol,
        instanceUrl: pageState.instanceUrl,
        appConsumerKey: pageState.appConsumerKey,
        appConsumerSecret: "",
        login: "",
    }), [pageState.hyperProtocol, pageState.instanceUrl, pageState.appConsumerKey]);
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
            });
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
            });
        }
        if (!validationSucceeded || !sfSetup) {
            return;
        }

        try {
            // Authorize the client
            setupAbortController.current = new AbortController();
            const sfChannel = await sfSetup.setup(dispatchConnectionState, setupParams, setupAbortController.current.signal);
            if (connectionState != null) {
                await performHealthCheck(queryExecutor, connectionState.sessionId, { type: 'salesforce', channel: sfChannel }, dispatchConnectionState, setupAbortController.current.signal);
            }


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
                    disabled={wrongPlatform}
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

    // Read the auth info
    const coreAccessToken = salesforceConnection?.proto.oauthState?.coreAccessToken;
    const dcAccessToken = salesforceConnection?.proto.oauthState?.dataCloudAccessToken;
    const dcAuthInfo = (coreAccessToken && dcAccessToken)
        ? collectSalesforceAuthInfo(coreAccessToken, dcAccessToken)
        : null;

    // Lock any changes?
    return (
        <div className={style.layout}>
            <ConnectionInlineHeader
                connector={connectorInfo}
                connection={connectionState}
                wrongPlatform={wrongPlatform}
                setupConnection={setupConnection}
                cancelSetup={cancelSetup}
                resetSetup={resetSetup}
                notebook={connectionNotebook}
                protocol={hyperProtocol}
                protocols={["V3_GRPC", "V3_HTTP"]}
                onProtocolChange={setHyperProtocol}
                freezeInput={freezeInput}
                onClose={props.onClose}
            />
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
                            value={dcAuthInfo?.coreAccessToken ?? ''}
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
                            value={dcAuthInfo?.offcoreInstanceUrl ?? ''}
                            placeholder=""
                            leadingVisual={() => <div>URL</div>}
                            readOnly
                            disabled
                            logContext={LOG_CTX}
                        />
                        <TextField
                            name="Data Cloud Access Token"
                            caption="Raw Data Cloud JWT"
                            value={dcAuthInfo?.offcoreRawJwt ?? ''}
                            placeholder=""
                            leadingVisual={KeyIcon}
                            readOnly
                            disabled
                            logContext={LOG_CTX}
                        />
                        <TextField
                            name="Core Tenant ID"
                            caption="Tenant id for core apis"
                            value={dcAuthInfo?.coreTenantId ?? ''}
                            placeholder=""
                            leadingVisual={() => <div>ID</div>}
                            readOnly
                            disabled
                            logContext={LOG_CTX}
                        />
                        <TextField
                            name="Data Cloud Tenant ID"
                            caption="Tenant id for Data Cloud apis"
                            value={dcAuthInfo?.offcoreTenantId ?? ''}
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

