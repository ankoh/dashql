import * as connection from '@ankoh/dashql-jsonschema/connection.js';

import {
    SETUP_CANCELLED,
    SETUP_FAILED,
    SETUP_STARTED,
    GENERATED_PKCE_CHALLENGE,
    GENERATING_PKCE_CHALLENGE,
    OAUTH_NATIVE_LINK_OPENED,
    OAUTH_WEB_WINDOW_CLOSED,
    OAUTH_WEB_WINDOW_OPENED,
    RECEIVED_CORE_AUTH_CODE,
    RECEIVED_CORE_AUTH_TOKEN,
    RECEIVED_CORE_USER_INFO,
    RECEIVED_DATA_CLOUD_ACCESS_TOKEN,
    REQUESTING_CORE_AUTH_TOKEN,
    REQUESTING_DATA_CLOUD_ACCESS_TOKEN,
    SalesforceConnectionStateAction,
    SF_CHANNEL_READY,
    SF_CHANNEL_SETUP_CANCELLED,
    SF_CHANNEL_SETUP_FAILED,
    SF_CHANNEL_SETUP_STARTED,
} from './salesforce_connection_state.js';
import { SalesforceConnectorConfig } from '../connector_configs.js';
import { SalesforceApiClient, SalesforceApiClientInterface, SalesforceDatabaseChannel } from './salesforce_api_client.js';
import { Dispatch } from '../../utils/variant.js';
import { Logger } from '../../platform/logger/logger.js';
import type { OAuthFlow } from '../../oauth/oauth_flow.js';
import type { HttpClient } from '../../platform/http/http_client.js';
import { RESET_CONNECTION } from '../connection_state.js';
import { HyperDatabaseChannel, HyperDatabaseClient, HyperDatabaseConnectionContext } from '../hyper/hyperdb_grpc_client.js';
import { ConnectorType } from '../connector_info.js';
import { loadSetupCore, SetupRun } from '../connection_setup_native.js';

const LOG_CTX = "salesforce_setup";

/// The connectors that share the Salesforce setup
export type SalesforceConnectorType = ConnectorType.SALESFORCE_DATA_CLOUD | ConnectorType.DBCOM;

/// The actions of the Salesforce setup by their names in the Rust runtime
const ACTIONS: Record<string, SalesforceConnectionStateAction['type']> = {
    SETUP_STARTED,
    SETUP_CANCELLED,
    SETUP_FAILED,
    GENERATING_PKCE_CHALLENGE,
    GENERATED_PKCE_CHALLENGE,
    OAUTH_NATIVE_LINK_OPENED,
    OAUTH_WEB_WINDOW_OPENED,
    OAUTH_WEB_WINDOW_CLOSED,
    RECEIVED_CORE_AUTH_CODE,
    REQUESTING_CORE_AUTH_TOKEN,
    RECEIVED_CORE_AUTH_TOKEN,
    RECEIVED_CORE_USER_INFO,
    REQUESTING_DATA_CLOUD_ACCESS_TOKEN,
    RECEIVED_DATA_CLOUD_ACCESS_TOKEN,
    SF_CHANNEL_SETUP_STARTED,
    SF_CHANNEL_SETUP_CANCELLED,
    SF_CHANNEL_SETUP_FAILED,
    SF_CHANNEL_READY,
};

/// The HTTP client that the setup sends the requests of Salesforce with: the one of the API client, or the one passed
export function salesforceHttpClient(apiClient: SalesforceApiClientInterface, http: HttpClient | null = null): HttpClient | null {
    return http ?? (apiClient instanceof SalesforceApiClient ? apiClient.httpClient : null);
}

/// The params of the Hyper channel of a Salesforce connection over HTTP
function channelParams(endpoint: string): connection.HyperConnectionParams {
    return {
        protocol: 'V3_HTTP',
        endpoint,
        tls: { clientKeyPath: "", clientCertPath: "", caCertsPath: "" },
        attachedDatabases: [],
        metadata: {},
    } as connection.HyperConnectionParams;
}

// We use the web-server OAuth Flow with PKCE and without consumer secret, see `connection_setup/salesforce.rs` of the
// Rust runtime. Don't embed an External Client App secret!

/// Set up a Salesforce or Database.com connection: the OAuth flow of the platform, the core token, the Data Cloud
/// token and the Hyper channel over HTTP. The setup runs in the Rust runtime (`connection_setup/salesforce.rs`) and
/// sends its requests with the HTTP client of the API client, the channel is a `SalesforceDatabaseChannel`.
export async function setupSalesforceConnection(modifyState: Dispatch<SalesforceConnectionStateAction>, logger: Logger, connector: SalesforceConnectorType, params: connection.SalesforceConnectionParams, config: SalesforceConnectorConfig, oauthFlow: OAuthFlow, apiClient: SalesforceApiClientInterface, httpClient: HyperDatabaseClient | null, forceReLogin: boolean, abortSignal: AbortSignal, http: HttpClient | null = null): Promise<SalesforceDatabaseChannel> {
    const core = await loadSetupCore();
    let endpoint = "";
    const run = new SetupRun({
        logger,
        http: salesforceHttpClient(apiClient, http),
        oauthFlow,
        signal: abortSignal,
        dispatch: (action, channel) => {
            const type = ACTIONS[action.type];
            if (type == null) return;
            if (type === RECEIVED_DATA_CLOUD_ACCESS_TOKEN) endpoint = action.value?.instanceUrl ?? "";
            const value = type === SF_CHANNEL_READY ? channel
                : type === SF_CHANNEL_SETUP_STARTED ? channelParams(endpoint)
                    : action.value;
            modifyState({ type, value } as SalesforceConnectionStateAction);
        },
        connectSalesforceChannel: async description => {
            if (!httpClient) throw new Error(`No client available for protocol V3_HTTP`);
            // Inject the database name, the audience header and the bearer token
            const context: HyperDatabaseConnectionContext = {
                getAttachedDatabases: () => description.attachedDatabases,
                getRequestMetadata: async () => description.requestMetadata,
                getQueryParameters: () => ({}),
            };
            const hyperChannel = await httpClient.connect(channelParams(description.endpoint), context);
            return new SalesforceDatabaseChannel(apiClient, description.tokens.core, description.tokens.dataCloud, hyperChannel);
        },
        closeChannel: channel => void (channel as HyperDatabaseChannel).close(),
    });
    const setup = core.connectionSetup.salesforce(run.host(), connector === ConnectorType.DBCOM, params, config.auth ?? {}, forceReLogin);
    const { channel } = await run.result<{ channel: number }>(setup, LOG_CTX);
    return run.channels.get(channel) as SalesforceDatabaseChannel;
}

export interface SalesforceSetupApi {
    setup(dispatch: Dispatch<SalesforceConnectionStateAction>, connector: SalesforceConnectorType, params: connection.SalesforceConnectionParams, abortSignal: AbortSignal): Promise<SalesforceDatabaseChannel>
    reset(dispatch: Dispatch<SalesforceConnectionStateAction>): Promise<void>
}

export function createSalesforceSetup(httpClient: HyperDatabaseClient | null, salesforceApi: SalesforceApiClientInterface, oauthFlow: OAuthFlow, config: SalesforceConnectorConfig, forceReLogin: boolean, logger: Logger, http: HttpClient | null = null): (SalesforceSetupApi | null) {
    const setup = async (updateState: Dispatch<SalesforceConnectionStateAction>, connector: SalesforceConnectorType, params: connection.SalesforceConnectionParams, abort: AbortSignal) => {
        return setupSalesforceConnection(updateState, logger, connector, params, config, oauthFlow, salesforceApi, httpClient, forceReLogin, abort, http);
    };
    const reset = async (updateState: Dispatch<SalesforceConnectionStateAction>) => {
        updateState({
            type: RESET_CONNECTION,
            value: null,
        });
    };
    return { setup, reset };
};
