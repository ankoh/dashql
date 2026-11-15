import * as core from '@ankoh/dashql-core';
import { ConnectionHealth, ConnectionStatus } from '@ankoh/dashql-core';

import {
    HYPER_CHANNEL_READY,
    HYPER_CHANNEL_SETUP_CANCELLED,
    HYPER_CHANNEL_SETUP_FAILED,
    HYPER_CHANNEL_SETUP_STARTED,
    type HyperConnectorAction,
} from './hyper/hyper_connection_state.js';
import {
    GENERATED_PKCE_CHALLENGE as SF_GENERATED_PKCE_CHALLENGE,
    GENERATING_PKCE_CHALLENGE as SF_GENERATING_PKCE_CHALLENGE,
    OAUTH_NATIVE_LINK_OPENED,
    OAUTH_WEB_WINDOW_CLOSED,
    OAUTH_WEB_WINDOW_OPENED,
    RECEIVED_CORE_AUTH_CODE,
    RECEIVED_CORE_AUTH_TOKEN,
    RECEIVED_CORE_USER_INFO,
    RECEIVED_DATA_CLOUD_ACCESS_TOKEN,
    REQUESTING_CORE_AUTH_TOKEN,
    REQUESTING_DATA_CLOUD_ACCESS_TOKEN,
    SETUP_CANCELLED,
    SETUP_FAILED,
    SETUP_STARTED,
    SF_CHANNEL_READY,
    SF_CHANNEL_SETUP_CANCELLED,
    SF_CHANNEL_SETUP_FAILED,
    SF_CHANNEL_SETUP_STARTED,
    type SalesforceConnectionStateAction,
} from './salesforce/salesforce_connection_state.js';
import {
    GENERATED_PKCE_CHALLENGE as TRINO_GENERATED_PKCE_CHALLENGE,
    GENERATING_PKCE_CHALLENGE as TRINO_GENERATING_PKCE_CHALLENGE,
    OAUTH_BROWSER_OPENED,
    OAUTH_CANCELLED,
    OAUTH_FAILED,
    OAUTH_STARTED,
    RECEIVED_ACCESS_TOKEN,
    RECEIVED_OAUTH_CODE,
    REQUESTING_ACCESS_TOKEN,
    TRINO_CHANNEL_READY,
    TRINO_CHANNEL_SETUP_CANCELLED,
    TRINO_CHANNEL_SETUP_FAILED,
    TRINO_CHANNEL_SETUP_STARTED,
    type TrinoConnectorAction,
} from './trino/trino_connection_state.js';
import { VariantKind } from '../utils/variant.js';
import { CONNECTOR_INFOS, type ConnectorInfo, type ConnectorType } from './connector_info.js';
import type { HandleTable } from '../store/handles.js';
import type { RelationName } from './catalog/catalog_sql_generator.js';
import type { ConnectionParams } from './connection_params.js';
import type { DetailedError } from '../utils/error.js';

/// A connection, the view of the slice `connection` of the runtime (docs/wip/runtime_api.md). The params are the
/// connection params of the app.
export type ConnectionState = Omit<core.ConnectionView, 'params' | 'paramsDraft' | 'setupAttemptParams' | 'setupAttemptDraft'> & {
    /// The params of the last successful setup, the initial ones until then
    params: ConnectionParams;
    /// The local settings of the form, independent of the channel and the OAuth state
    paramsDraft: ConnectionParams | null;
    /// The input of the running setup, never saved
    setupAttemptParams: ConnectionParams | null;
    /// The draft when the running setup started, with the raw form rows
    setupAttemptDraft: ConnectionParams | null;
};

/// How far the setup of a connection got and its health, numeric enums of the module
export { ConnectionHealth, ConnectionStatus };

/// The info of the connector of a connection
export function connectorInfoOf(connection: Pick<ConnectionState, 'connectorType'>): ConnectorInfo {
    return CONNECTOR_INFOS[connection.connectorType as ConnectorType];
}

/// The channel of a connection, an object of the handle table of the runtime
export function channelOf<T>(connection: Pick<ConnectionState, 'details'> | null | undefined, handles: HandleTable): T | null {
    return handles.get<T>(connection?.details.channel) ?? null;
}

/// Is a connection connected or connecting? An open connection keeps its protocol and can't be merged.
export function isConnectionOpen(health: ConnectionHealth | undefined): boolean {
    return health === ConnectionHealth.CONNECTING || health === ConnectionHealth.ONLINE;
}

export function printConnectionHealth(health: ConnectionHealth) {
    switch (health) {
        case ConnectionHealth.NOT_STARTED:
            return "Not Started";
        case ConnectionHealth.CONNECTING:
            return "Connecting";
        case ConnectionHealth.CANCELLED:
            return "Cancelled";
        case ConnectionHealth.ONLINE:
            return "Online";
        case ConnectionHealth.FAILED:
            return "Failed";
    }
}

/// Does a connection cache query results? The connector decides unless the user chose.
export function connectionCachesQueryResults(state: Pick<ConnectionState, 'cacheQueryResults' | 'connectorType'>): boolean {
    return state.cacheQueryResults ?? connectorInfoOf(state).features.queryResultCaching;
}

/// A new connection: its connector, the params its setup starts with and what it is created with
export interface NewConnection {
    connectorType: ConnectorType;
    /// The params of the connector without its field, the details of the setup start with them
    setupParams: unknown;
    /// Does the connection belong to a committed workbook or was it connected once?
    active?: boolean;
    /// The params, derived from the setup params by default
    params?: ConnectionParams;
    /// The draft of the params
    paramsDraft?: ConnectionParams;
    /// The name the user gave the connection
    name?: string;
    /// Does the connection cache query results? The default of the connector without.
    cacheQueryResults?: boolean;
}

/// The action of the runtime that creates a connection, with a fixed id or a new one
export function createConnectionAction(connection: NewConnection, connectionId?: string): core.RuntimeAction {
    return {
        kind: 'createConnection',
        value: {
            connectionId,
            connectorType: connection.connectorType,
            setupParams: (connection.setupParams ?? undefined) as core.JsonParams | undefined,
            active: connection.active,
            params: connection.params as core.JsonParams | undefined,
            paramsDraft: connection.paramsDraft as core.JsonParams | undefined,
            name: connection.name,
            cacheQueryResults: connection.cacheQueryResults,
        },
    };
}

export const DELETE_CONNECTION = Symbol('DELETE_CONNECTION');
export const RESET_CONNECTION = Symbol('RESET_CONNECTION');
export const SWITCH_CONNECTOR_TYPE = Symbol('SWITCH_CONNECTOR_TYPE');
export const HEALTH_CHECK_STARTED = Symbol('HEALTH_CHECK_STARTED');
export const HEALTH_CHECK_CANCELLED = Symbol('HEALTH_CHECK_CANCELLED');
export const HEALTH_CHECK_SUCCEEDED = Symbol('HEALTH_CHECK_SUCCEEDED');
export const HEALTH_CHECK_FAILED = Symbol('HEALTH_CHECK_FAILED');
export const SET_CONNECTION_DRAFT = Symbol('SET_CONNECTION_DRAFT');
export const DISCARD_CONNECTION_DRAFT = Symbol('DISCARD_CONNECTION_DRAFT');
export const COMMIT_CONNECTION_PARAMS = Symbol('COMMIT_CONNECTION_PARAMS');
export const RENAME_CONNECTION = Symbol('RENAME_CONNECTION');
export const SET_CONNECTION_QUERY_RESULT_CACHING = Symbol('SET_CONNECTION_QUERY_RESULT_CACHING');

/// The health check of a connection, every connector runs it the same way
export type HealthCheckAction =
    | VariantKind<typeof HEALTH_CHECK_STARTED, null>
    | VariantKind<typeof HEALTH_CHECK_CANCELLED, null>
    | VariantKind<typeof HEALTH_CHECK_FAILED, DetailedError>
    | VariantKind<typeof HEALTH_CHECK_SUCCEEDED, null>
    ;

/// The actions of the setups of the connectors and the settings, until the setups are commands of the runtime
/// (docs/wip/runtime_api.md, step 3). `runtimeActionOf` maps them to the actions of the runtime.
export type ConnectionAction =
    | VariantKind<typeof SET_CONNECTION_DRAFT, ConnectionParams>
    | VariantKind<typeof DISCARD_CONNECTION_DRAFT, null>
    | VariantKind<typeof COMMIT_CONNECTION_PARAMS, ConnectionParams>
    | VariantKind<typeof RENAME_CONNECTION, string>
    | VariantKind<typeof SET_CONNECTION_QUERY_RESULT_CACHING, boolean>
    | VariantKind<typeof DELETE_CONNECTION, null>
    | VariantKind<typeof RESET_CONNECTION, null>
    | VariantKind<typeof SWITCH_CONNECTOR_TYPE, ConnectorType>
    | HealthCheckAction
    | HyperConnectorAction
    | TrinoConnectorAction
    | SalesforceConnectionStateAction
    ;

/// The steps of the setups by their names in the runtime (`setup_action_from_json` of the crate)
const SETUP_STEPS = new Map<symbol, string>([
    [HEALTH_CHECK_STARTED, 'HEALTH_CHECK_STARTED'],
    [HEALTH_CHECK_CANCELLED, 'HEALTH_CHECK_CANCELLED'],
    [HEALTH_CHECK_FAILED, 'HEALTH_CHECK_FAILED'],
    [HEALTH_CHECK_SUCCEEDED, 'HEALTH_CHECK_SUCCEEDED'],
    [HYPER_CHANNEL_SETUP_STARTED, 'HYPER_CHANNEL_SETUP_STARTED'],
    [HYPER_CHANNEL_SETUP_CANCELLED, 'HYPER_CHANNEL_SETUP_CANCELLED'],
    [HYPER_CHANNEL_SETUP_FAILED, 'HYPER_CHANNEL_SETUP_FAILED'],
    [HYPER_CHANNEL_READY, 'HYPER_CHANNEL_READY'],
    [OAUTH_STARTED, 'OAUTH_STARTED'],
    [OAUTH_CANCELLED, 'OAUTH_CANCELLED'],
    [OAUTH_FAILED, 'OAUTH_FAILED'],
    [TRINO_GENERATING_PKCE_CHALLENGE, 'GENERATING_PKCE_CHALLENGE'],
    [TRINO_GENERATED_PKCE_CHALLENGE, 'GENERATED_PKCE_CHALLENGE'],
    [OAUTH_BROWSER_OPENED, 'OAUTH_BROWSER_OPENED'],
    [RECEIVED_OAUTH_CODE, 'RECEIVED_OAUTH_CODE'],
    [REQUESTING_ACCESS_TOKEN, 'REQUESTING_ACCESS_TOKEN'],
    [RECEIVED_ACCESS_TOKEN, 'RECEIVED_ACCESS_TOKEN'],
    [TRINO_CHANNEL_SETUP_STARTED, 'TRINO_CHANNEL_SETUP_STARTED'],
    [TRINO_CHANNEL_SETUP_CANCELLED, 'TRINO_CHANNEL_SETUP_CANCELLED'],
    [TRINO_CHANNEL_SETUP_FAILED, 'TRINO_CHANNEL_SETUP_FAILED'],
    [TRINO_CHANNEL_READY, 'TRINO_CHANNEL_READY'],
    [SETUP_STARTED, 'SETUP_STARTED'],
    [SETUP_CANCELLED, 'SETUP_CANCELLED'],
    [SETUP_FAILED, 'SETUP_FAILED'],
    [SF_GENERATING_PKCE_CHALLENGE, 'GENERATING_PKCE_CHALLENGE'],
    [SF_GENERATED_PKCE_CHALLENGE, 'GENERATED_PKCE_CHALLENGE'],
    [OAUTH_NATIVE_LINK_OPENED, 'OAUTH_NATIVE_LINK_OPENED'],
    [OAUTH_WEB_WINDOW_OPENED, 'OAUTH_WEB_WINDOW_OPENED'],
    [OAUTH_WEB_WINDOW_CLOSED, 'OAUTH_WEB_WINDOW_CLOSED'],
    [RECEIVED_CORE_AUTH_CODE, 'RECEIVED_CORE_AUTH_CODE'],
    [REQUESTING_CORE_AUTH_TOKEN, 'REQUESTING_CORE_AUTH_TOKEN'],
    [RECEIVED_CORE_AUTH_TOKEN, 'RECEIVED_CORE_AUTH_TOKEN'],
    [RECEIVED_CORE_USER_INFO, 'RECEIVED_CORE_USER_INFO'],
    [REQUESTING_DATA_CLOUD_ACCESS_TOKEN, 'REQUESTING_DATA_CLOUD_ACCESS_TOKEN'],
    [RECEIVED_DATA_CLOUD_ACCESS_TOKEN, 'RECEIVED_DATA_CLOUD_ACCESS_TOKEN'],
    [SF_CHANNEL_SETUP_STARTED, 'SF_CHANNEL_SETUP_STARTED'],
    [SF_CHANNEL_SETUP_CANCELLED, 'SF_CHANNEL_SETUP_CANCELLED'],
    [SF_CHANNEL_SETUP_FAILED, 'SF_CHANNEL_SETUP_FAILED'],
    [SF_CHANNEL_READY, 'SF_CHANNEL_READY'],
]);

/// The action of the runtime of an action of a setup or the settings. The channel of a ready step goes into the handle
/// table, the connection takes its handle.
export function runtimeActionOf(action: ConnectionAction, handles: HandleTable): core.RuntimeAction {
    const params = (value: unknown) => value as core.JsonParams;
    switch (action.type) {
        case SET_CONNECTION_DRAFT:
            return { kind: 'setDraft', value: { params: params(action.value) } };
        case DISCARD_CONNECTION_DRAFT:
            return { kind: 'discardDraft' };
        case COMMIT_CONNECTION_PARAMS:
            return { kind: 'commitParams', value: { params: params(action.value) } };
        case RENAME_CONNECTION:
            return { kind: 'rename', value: { name: action.value } };
        case SET_CONNECTION_QUERY_RESULT_CACHING:
            return { kind: 'setQueryResultCaching', value: { caching: action.value } };
        case DELETE_CONNECTION:
            return { kind: 'deleteConnection' };
        case RESET_CONNECTION:
            return { kind: 'resetConnection' };
        case SWITCH_CONNECTOR_TYPE:
            return { kind: 'switchConnectorType', value: { connectorType: action.value } };
    }
    const step = SETUP_STEPS.get(action.type);
    if (step == null) throw new Error(`failed to apply state action: ${String((action as ConnectionAction).type)}`);
    switch (action.type) {
        case HYPER_CHANNEL_READY: {
            const [channel, setupParams] = action.value;
            return { kind: 'setupStep', value: { step, value: setupParams, channel: handles.register(channel) } };
        }
        case TRINO_CHANNEL_READY:
        case SF_CHANNEL_READY:
            return { kind: 'setupStep', value: { step, channel: handles.register(action.value) } };
        default:
            return { kind: 'setupStep', value: { step, value: action.value ?? undefined } };
    }
}

/// The relations of a catalog update as the runtime takes them
export function relationNames(names: readonly RelationName[] | null | undefined): core.ConnectionRelationName[] {
    return (names ?? []).map(name => ({ databaseName: name.databaseName, schemaName: name.schemaName, tableName: name.tableName }));
}
