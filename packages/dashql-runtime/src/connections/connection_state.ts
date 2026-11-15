import * as core from '@ankoh/dashql-core';
import { ConnectionHealth, ConnectionStatus } from '@ankoh/dashql-core';
import * as connection from '@ankoh/dashql-jsonschema/connection.js';

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
import { CatalogUpdateTaskState, CatalogUpdateTaskStatus } from './catalog/catalog_update_state.js';
import { VariantKind } from '../utils/variant.js';
import { ConnectorInfo, getConnectorInfoForParams, ConnectorType } from './connector_info.js';
import {
    createQueryExecutionMetrics,
    EXECUTE_QUERY,
    QUERY_CANCELLED,
    QUERY_FAILED,
    QUERY_PROGRESS_UPDATED,
    QUERY_RECEIVED_BATCH,
    QUERY_RUNNING,
    QUERY_RECEIVED_ALL_BATCHES,
    QueryExecutionAction,
    QUERY_SUCCEEDED,
    QUERY_PROCESSED_RESULTS,
    QUERY_SENDING,
    QUERY_PROCESSING_RESULTS,
    QUERY_CACHE_RECORDED,
    QUERY_CACHE_DELETED,
    QueryExecutionState,
} from '../query/query_execution_state.js';
import { applyQueryAction } from '../query/query_history_native.js';
import type { ConnectionStateDetailsVariant } from './connection_state_details.js';
import type { Logger } from '../platform/logger/logger.js';
import type { RelationName } from './catalog/catalog_sql_generator.js';
import type { ConnectionParams } from './connection_params.js';
import { cancelConnectionSetup } from './connection_setup_cancellation.js';
import type { DetailedError } from '../utils/error.js';
import { NativeConnection, type ConnectionChannel, type ConnectionFunctionScript } from './connection_native.js';

export interface CatalogUpdates {
    /// The running tasks
    tasksRunning: Map<number, CatalogUpdateTaskState>;
    /// The finished tasks
    tasksFinished: Map<number, CatalogUpdateTaskState>;
    /// Does the catalog describe the connection, from a restored file or a full refresh that succeeded? Until then a
    /// connection is described when it comes online, and nothing is saved: a few relations aren't a catalog.
    described: boolean;
    /// The id of the running or most recently started full refresh, it tells that a refresh is running
    currentFullRefresh: number | null;
    /// The relations that executed statements created or dropped and that no update has answered yet
    touchedRelations: RelationName[];
    /// The updates in a row that failed to answer them
    touchedFailures: number;
}

/// The state of a connection, a projection of the Rust connection of the runtime (`connection_native.ts`)
export interface ConnectionState {
    /// Runtime identity of the connection.
    connectionId: string;

    /// The connection state contains many references into the Wasm heap.
    /// It therefore makes sense that connection state users resolve the "right" module through here.
    instance: core.DashQL;
    /// The Rust connection that the actions apply to, shared by all states of the connection
    native: NativeConnection;
    /// Whether the database belongs to a committed workbook or has connected at least once.
    /// Draft manifest writes are independent of activation; catalog writes require activation.
    active: boolean;

    /// The connection state
    connectionStatus: ConnectionStatus;
    /// The connection health
    connectionHealth: ConnectionHealth;
    /// The connection info
    connectorInfo: ConnectorInfo;
    /// The name the user gave the connection, the label falls back to the connector without it
    name?: string;
    /// Does the connection cache query results? Absent for the default of the connector.
    cacheQueryResults?: boolean;

    /// The connection details
    details: ConnectionStateDetailsVariant;
    /// Last successful parameters (initial defaults until the first successful setup).
    params: ConnectionParams;
    /// Local editable settings, independent of the runtime channel and OAuth state.
    paramsDraft?: ConnectionParams;
    /// Immutable input of the current setup attempt; never persisted.
    setupAttemptParams?: ConnectionParams;
    /// Draft at attempt start, including raw form rows, for exact successful-discard comparison.
    setupAttemptDraft?: ConnectionParams;
    /// The connection statistics
    metrics: connection.ConnectionMetrics;

    /// The catalog, shared with the Rust connection and the scripts that analyze with it
    catalog: core.DashQLCatalog;
    /// The  catalog updates
    catalogUpdates: CatalogUpdates;
    /// The catalog entry of the descriptor with the relations of the connection
    catalogRelationEntryId: number;
    /// The catalog function script (consolidated SQL for all function declarations)
    catalogFunctionScript: ConnectionFunctionScript;

    /// The queries that are currently running
    queriesActive: Map<number, QueryExecutionState>;
    /// The active queries ordered
    queriesActiveOrdered: number[];
    /// The queries that finished (succeeded, failed, cancelled)
    queriesFinished: Map<number, QueryExecutionState>;
    /// The finished queries ordered
    queriesFinishedOrdered: number[];

    /// The snapshot of query ids that are active or finished
    snapshotQueriesActiveFinished: number;
}

/// How far the setup of a connection got and its health, numeric enums of the module
export { ConnectionHealth, ConnectionStatus };

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

export type ConnectionStateWithoutId = Omit<ConnectionState, "connectionId">;

export const DELETE_CONNECTION = Symbol('DELETE_CONNECTION');
export const RESET_CONNECTION = Symbol('RESET_CONNECTION');
export const SWITCH_CONNECTOR_TYPE = Symbol('SWITCH_CONNECTOR_TYPE');
export const RELATIONS_TOUCHED = Symbol('RELATIONS_TOUCHED');
export const UPDATE_CATALOG = Symbol('UPDATE_CATALOG');
export const CATALOG_UPDATE_REGISTER_QUERY = Symbol('CATALOG_UPDATE_REGISTER_QUERY');
export const CATALOG_UPDATE_SUCCEEDED = Symbol('CATALOG_UPDATE_SUCCEEDED');
export const CATALOG_UPDATE_PARTIALLY_SUCCEEDED = Symbol('CATALOG_UPDATE_PARTIALLY_SUCCEEDED');
export const CATALOG_UPDATE_FAILED = Symbol('CATALOG_UPDATE_FAILED');
export const CATALOG_UPDATE_CANCELLED = Symbol('CATALOG_UPDATE_CANCELLED');

export const HEALTH_CHECK_STARTED = Symbol('HEALTH_CHECK_STARTED');
export const HEALTH_CHECK_CANCELLED = Symbol('HEALTH_CHECK_CANCELLED');
export const HEALTH_CHECK_SUCCEEDED = Symbol('HEALTH_CHECK_SUCCEEDED');
export const HEALTH_CHECK_FAILED = Symbol('HEALTH_CHECK_FAILED');
export const SET_CONNECTION_DRAFT = Symbol('SET_CONNECTION_DRAFT');
export const DISCARD_CONNECTION_DRAFT = Symbol('DISCARD_CONNECTION_DRAFT');
export const COMMIT_CONNECTION_PARAMS = Symbol('COMMIT_CONNECTION_PARAMS');
export const RENAME_CONNECTION = Symbol('RENAME_CONNECTION');
export const SET_CONNECTION_QUERY_RESULT_CACHING = Symbol('SET_CONNECTION_QUERY_RESULT_CACHING');

export type CatalogAction =
    | VariantKind<typeof RELATIONS_TOUCHED, core.buffers.analyzer.QualifiedTableNameT[]>
    | VariantKind<typeof UPDATE_CATALOG, [number, CatalogUpdateTaskState]>
    | VariantKind<typeof CATALOG_UPDATE_REGISTER_QUERY, [number, number]>
    | VariantKind<typeof CATALOG_UPDATE_CANCELLED, [number, Error]>
    | VariantKind<typeof CATALOG_UPDATE_FAILED, [number, Error]>
    | VariantKind<typeof CATALOG_UPDATE_SUCCEEDED, [number] | [number, boolean]>
    | VariantKind<typeof CATALOG_UPDATE_PARTIALLY_SUCCEEDED, [number, Error]>
    ;

/// The health check of a connection, every connector runs it the same way
export type HealthCheckAction =
    | VariantKind<typeof HEALTH_CHECK_STARTED, null>
    | VariantKind<typeof HEALTH_CHECK_CANCELLED, null>
    | VariantKind<typeof HEALTH_CHECK_FAILED, DetailedError>
    | VariantKind<typeof HEALTH_CHECK_SUCCEEDED, null>
    ;

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
    | CatalogAction
    | QueryExecutionAction
    | HyperConnectorAction
    | TrinoConnectorAction
    | SalesforceConnectionStateAction
    ;

/// Does a connection cache query results? The connector decides unless the user chose.
export function connectionCachesQueryResults(state: Pick<ConnectionState, 'cacheQueryResults' | 'connectorInfo'>): boolean {
    return state.cacheQueryResults ?? state.connectorInfo.features.queryResultCaching;
}

/// Apply an action to a connection. The Rust connection of the state applies it, the effects run here: aborting
/// catalog updates and queries, closing channels, invalidating catalog batches. Returns the state if nothing changed.
/// Only the latest state of a connection can be reduced, an older state shares the Rust connection.
export function reduceConnectionState(state: ConnectionState, action: ConnectionAction, _logger: Logger): ConnectionState {
    const native = state.native;
    if (native == null) {
        throw new Error(`the connection ${state.connectionId} has no Rust connection for the action ${String(action.type)}`);
    }
    const connection = native.connection;
    const now = Date.now();
    let outcome: core.ConnectionOutcome;
    switch (action.type) {
        case SET_CONNECTION_DRAFT:
            // Params of another connector are ignored
            if (getConnectorInfoForParams(action.value)?.connectorType !== state.connectorInfo.connectorType) return state;
            outcome = connection.setDraft(action.value as Record<string, unknown>, now);
            break;
        case DISCARD_CONNECTION_DRAFT:
            outcome = connection.discardDraft(now);
            break;
        case COMMIT_CONNECTION_PARAMS:
            outcome = connection.commitParams(action.value as Record<string, unknown>, now);
            break;
        case RENAME_CONNECTION:
            outcome = connection.rename(action.value, now);
            break;
        case SET_CONNECTION_QUERY_RESULT_CACHING:
            outcome = connection.setQueryResultCaching(action.value, now);
            break;
        case RESET_CONNECTION:
            outcome = connection.reset(now);
            break;
        case DELETE_CONNECTION:
            outcome = connection.delete(now);
            break;
        case SWITCH_CONNECTOR_TYPE:
            outcome = connection.switchConnectorType(action.value, now);
            break;

        case HEALTH_CHECK_STARTED:
            outcome = connection.healthCheckStarted(now);
            break;
        case HEALTH_CHECK_CANCELLED:
            outcome = connection.healthCheckCancelled(now);
            break;
        case HEALTH_CHECK_FAILED:
            outcome = connection.healthCheckFailed(action.value, now);
            break;
        case HEALTH_CHECK_SUCCEEDED:
            outcome = connection.healthCheckSucceeded(now);
            break;

        case RELATIONS_TOUCHED:
            outcome = connection.relationsTouched(action.value.map(name => ({
                databaseName: (name.databaseName as string | null) ?? null,
                schemaName: (name.schemaName as string | null) ?? null,
                tableName: (name.tableName as string | null) ?? null,
            })), now);
            break;
        case UPDATE_CATALOG: {
            const [taskId, task] = action.value;
            outcome = native.updateCatalog(taskId, task.cancellation, handle =>
                connection.updateCatalog(taskId, handle, task.taskVariant, task.startedAt?.getTime() ?? null, task.touchedRelations ?? [], now));
            break;
        }
        case CATALOG_UPDATE_REGISTER_QUERY:
            outcome = connection.catalogUpdateRegisterQuery(action.value[0], action.value[1], now);
            break;
        case CATALOG_UPDATE_SUCCEEDED:
            outcome = connection.catalogUpdateFinished(action.value[0], CatalogUpdateTaskStatus.SUCCEEDED, null, now);
            break;
        case CATALOG_UPDATE_FAILED:
        case CATALOG_UPDATE_CANCELLED:
        case CATALOG_UPDATE_PARTIALLY_SUCCEEDED: {
            const status = action.type === CATALOG_UPDATE_FAILED ? CatalogUpdateTaskStatus.FAILED
                : action.type === CATALOG_UPDATE_CANCELLED ? CatalogUpdateTaskStatus.CANCELLED
                    : CatalogUpdateTaskStatus.PARTIALLY_SUCCEEDED;
            const [taskId, error] = action.value;
            outcome = connection.catalogUpdateFinished(taskId, status, { message: error?.message ?? '' }, now);
            if (outcome.changed) native.setTaskError(taskId, error);
            break;
        }

        case EXECUTE_QUERY:
        case QUERY_SENDING:
        case QUERY_RUNNING:
        case QUERY_PROGRESS_UPDATED:
        case QUERY_RECEIVED_BATCH:
        case QUERY_RECEIVED_ALL_BATCHES:
        case QUERY_PROCESSING_RESULTS:
        case QUERY_PROCESSED_RESULTS:
        case QUERY_SUCCEEDED:
        case QUERY_FAILED:
        case QUERY_CANCELLED:
        case QUERY_CACHE_RECORDED:
        case QUERY_CACHE_DELETED:
            outcome = applyQueryAction(connection, native.handles, action, now);
            break;

        default:
            outcome = reduceSetupStep(native, action, now);
            break;
    }
    native.applyEffects(state, outcome.effects, { cancelSetup: cancelConnectionSetup });
    if (!outcome.changed && outcome.effects.length === 0) return state;
    const next = native.project(state.connectionId);
    if (action.type === DELETE_CONNECTION) {
        // Other holders of the catalog see it empty, it drops with the last of them
        native.destroy();
    }
    return next;
}

/// Apply a step of the setup of a connector. The handle of a channel of an action that fails is released.
function reduceSetupStep(native: NativeConnection, action: ConnectionAction, now: number): core.ConnectionOutcome {
    const connection = native.connection;
    const withChannel = (channel: ConnectionChannel, apply: (handle: number) => core.ConnectionOutcome) => native.handOver(channel, apply);
    const params = (value: object) => value as Record<string, unknown>;
    switch (action.type) {
        // Hyper
        case HYPER_CHANNEL_SETUP_STARTED:
            return connection.hyperChannelSetupStarted(params(action.value), now);
        case HYPER_CHANNEL_SETUP_CANCELLED:
            return connection.hyperChannelSetupCancelled(action.value, now);
        case HYPER_CHANNEL_SETUP_FAILED:
            return connection.hyperChannelSetupFailed(action.value, now);
        case HYPER_CHANNEL_READY: {
            const [channel, setupParams] = action.value;
            return withChannel(channel, id => connection.hyperChannelReady(id, params(setupParams), now));
        }

        // Trino
        case OAUTH_STARTED:
            return connection.trinoOAuthStarted(params(action.value), now);
        case OAUTH_CANCELLED:
            return connection.trinoOAuthCancelled(action.value, now);
        case OAUTH_FAILED:
            return connection.trinoOAuthFailed(action.value, now);
        case TRINO_GENERATING_PKCE_CHALLENGE:
            return connection.trinoGeneratingPkceChallenge(now);
        case TRINO_GENERATED_PKCE_CHALLENGE:
            return connection.trinoGeneratedPkceChallenge(action.value.value, action.value.verifier, now);
        case OAUTH_BROWSER_OPENED:
            return connection.trinoOAuthBrowserOpened(now);
        case RECEIVED_OAUTH_CODE:
            return connection.trinoReceivedOAuthCode(action.value.token, action.value.createdAt, now);
        case REQUESTING_ACCESS_TOKEN:
            return connection.trinoRequestingAccessToken(now);
        case RECEIVED_ACCESS_TOKEN:
            return connection.trinoReceivedAccessToken(action.value, now);
        case TRINO_CHANNEL_SETUP_STARTED:
            return connection.trinoChannelSetupStarted(params(action.value), now);
        case TRINO_CHANNEL_SETUP_CANCELLED:
            return connection.trinoChannelSetupCancelled(action.value, now);
        case TRINO_CHANNEL_SETUP_FAILED:
            return connection.trinoChannelSetupFailed(action.value, now);
        case TRINO_CHANNEL_READY:
            return withChannel(action.value, id => connection.trinoChannelReady(id, now));

        // Salesforce and Database.com
        case SETUP_STARTED:
            return connection.salesforceSetupStarted(params(action.value), now);
        case SETUP_CANCELLED:
            return connection.salesforceSetupCancelled(action.value, now);
        case SETUP_FAILED:
            return connection.salesforceSetupFailed(action.value, now);
        case SF_GENERATING_PKCE_CHALLENGE:
            return connection.salesforceGeneratingPkceChallenge(now);
        case SF_GENERATED_PKCE_CHALLENGE:
            return connection.salesforceGeneratedPkceChallenge(action.value.value, action.value.verifier, now);
        case OAUTH_NATIVE_LINK_OPENED:
            return connection.salesforceOAuthNativeLinkOpened(now);
        case OAUTH_WEB_WINDOW_OPENED:
            return connection.salesforceOAuthWebWindowOpened(now);
        case OAUTH_WEB_WINDOW_CLOSED:
            return connection.salesforceOAuthWebWindowClosed(now);
        case RECEIVED_CORE_AUTH_CODE:
            return connection.salesforceReceivedCoreAuthCode(action.value.token, action.value.createdAt, now);
        case REQUESTING_CORE_AUTH_TOKEN:
            return connection.salesforceRequestingCoreAuthToken(now);
        case RECEIVED_CORE_AUTH_TOKEN:
            return connection.salesforceReceivedCoreAuthToken(action.value, now);
        case RECEIVED_CORE_USER_INFO:
            return connection.salesforceReceivedCoreUserInfo(action.value.preferredUsername ?? null, action.value.email ?? null, now);
        case REQUESTING_DATA_CLOUD_ACCESS_TOKEN:
            return connection.salesforceRequestingDataCloudAccessToken(now);
        case RECEIVED_DATA_CLOUD_ACCESS_TOKEN:
            return connection.salesforceReceivedDataCloudAccessToken(action.value, now);
        case SF_CHANNEL_SETUP_STARTED:
            return connection.salesforceChannelSetupStarted(now);
        case SF_CHANNEL_SETUP_CANCELLED:
            return connection.salesforceChannelSetupCancelled(action.value, now);
        case SF_CHANNEL_SETUP_FAILED:
            return connection.salesforceChannelSetupFailed(action.value, now);
        case SF_CHANNEL_READY:
            return withChannel(action.value, id => connection.salesforceChannelReady(id, now));
    }
    throw new Error(`failed to apply state action: ${String((action as ConnectionAction).type)}`);
}

export function createConnectionMetrics(): connection.ConnectionMetrics {
    return createQueryExecutionMetrics();
}

/// The optional properties of a new connection state
export interface ConnectionStateOptions {
    /// Does the connection belong to a committed workbook or was it connected once?
    active?: boolean;
    /// The params, derived from the details by default
    params?: ConnectionParams;
    /// The draft of the params
    paramsDraft?: ConnectionParams;
    /// The name the user gave the connection
    name?: string;
    /// Does the connection cache query results? The default of the connector without.
    cacheQueryResults?: boolean;
}

/// Create the state of a connection with an empty catalog. The details name the connector and its setup params.
export function createConnectionState(dql: core.DashQL, info: ConnectorInfo, details: ConnectionStateDetailsVariant, options: ConnectionStateOptions = {}): ConnectionStateWithoutId {
    const connection = dql.createConnection('', info.connectorType, {
        setupParams: (details.value.proto?.setupParams ?? null) as unknown as Record<string, unknown> | null,
        active: options.active ?? false,
        params: (options.params ?? null) as Record<string, unknown> | null,
        paramsDraft: (options.paramsDraft ?? null) as Record<string, unknown> | null,
    });
    try {
        if (options.name != null) connection.rename(options.name);
        if (options.cacheQueryResults != null) connection.setQueryResultCaching(options.cacheQueryResults);
        return new NativeConnection(dql, connection).project('');
    } catch (error) {
        connection.destroy();
        throw error;
    }
}

/// Restore the state of the catalog updates from the files of the catalog, null keeps a field. Returns the next state
/// of the connection, the state stays as it was.
export function restoreCatalogUpdates(state: ConnectionState, described: boolean | null, touchedRelations: RelationName[] | null): ConnectionState {
    return state.native.restoreCatalogUpdates(state, described, touchedRelations);
}

/// Destroy a connection that was never registered: the Rust connection and its catalog handle
export function destroyConnectionState(state: ConnectionState): void {
    state.native.destroy();
}
