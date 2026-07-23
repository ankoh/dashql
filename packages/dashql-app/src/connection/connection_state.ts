import * as core from '../core/index.js';
import * as dashql from '../core/index.js';
import * as connection from '@ankoh/dashql-jsonschema/connection.js';
import * as arrow from 'apache-arrow';

import { HyperConnectorAction, reduceHyperConnectorState } from './hyper/hyper_connection_state.js';
import { SalesforceConnectionStateAction, reduceSalesforceConnectionState } from './salesforce/salesforce_connection_state.js';
import { CatalogUpdateTaskState, reduceCatalogAction } from './catalog_update_state.js';
import { generateCatalogScriptHeader, CatalogSource } from './catalog_sql_generator.js';
import { generateFunctionScriptHeader } from './catalog_function_sql_generator.js';
import { VariantKind } from '../utils/variant.js';
import {
    CONNECTOR_INFOS,
    ConnectorInfo,
    ConnectorType,
    HYPER_CONNECTOR,
    SALESFORCE_DATA_CLOUD_CONNECTOR,
    DATALESS_CONNECTOR,
    TRINO_CONNECTOR,
} from './connector_info.js';
import {
    QueryExecutionProgress,
    QueryExecutionResponseStream,
    QueryExecutionMetrics,
    QueryExecutionState,
} from './query_execution_state.js';
import { Hasher } from '../utils/hash.js';
import { reduceQueryAction } from './query_execution_state.js';
import { DatalessConnectorAction, reduceDatalessConnectorState } from './dataless/dataless_connection_state.js';
import { reduceTrinoConnectorState, TrinoConnectorAction } from './trino/trino_connection_state.js';
import { computeConnectionSignatureFromDetails, computeNewConnectionSignatureFromDetails, ConnectionStateDetailsVariant, createConnectionStateDetails } from './connection_state_details.js';
import { ConnectionSignatureMap, ConnectionSignatureState, newConnectionSignature } from './connection_signature.js';
import { DEBOUNCE_DURATION_SESSION_WRITE, DELETE_SESSION, groupSessionWrites, StorageWriter, WRITE_SESSION_MANIFEST } from '../platform/storage/storage_writer.js';
import { LoggableException, Logger } from '../platform/logger/logger.js';

export interface CatalogUpdates {
    /// The running tasks
    tasksRunning: Map<number, CatalogUpdateTaskState>;
    /// The finished tasks
    tasksFinished: Map<number, CatalogUpdateTaskState>;
    /// Restored at a certain time
    restoredAt: Date | null;
    /// The id of the running or most recently completed full refresh.
    /// Set at UPDATE_CATALOG start; used to decide whether to kick off
    /// an auto-refresh and to surface the currently-displayed refresh task.
    currentFullRefresh: number | null;
    /// The id of the most recently *completed* full refresh (succeeded,
    /// failed, or cancelled). Only advances on completion, so components
    /// can depend on it to react when the catalog script has been updated.
    lastFullRefresh: number | null;
}

export interface ConnectionState {
    /// The session identifier - fully qualified path (e.g., "opfs://sessions/<uuid>")
    sessionId: string;
    /// The user-supplied session name, or null if the user never named this session. Persisted as
    /// `name` in the session manifest; surfaced as the primary label in the session bar and selector
    /// (the display path is the fallback). Distinct from the connector-derived `title` in the manifest.
    name: string | null;

    /// The connection state contains many references into the Wasm heap.
    /// It therefore makes sense that connection state users resolve the "right" module through here.
    instance: core.DashQL;
    /// Whether this connection has been activated (setup completed at least once).
    /// Storage writes are suppressed until this is true.
    active: boolean;

    /// The connection state
    connectionStatus: ConnectionStatus;
    /// The connection health
    connectionHealth: ConnectionHealth;
    /// The connection info
    connectorInfo: ConnectorInfo;
    /// The connection signature
    connectionSignature: ConnectionSignatureState;

    /// The connection details
    details: ConnectionStateDetailsVariant;
    /// The connection statistics
    metrics: connection.ConnectionMetrics;

    /// The catalog
    catalog: dashql.DashQLCatalog;
    /// The  catalog updates
    catalogUpdates: CatalogUpdates;
    /// The catalog relation script (consolidated SQL for all relations)
    catalogRelationScript: dashql.DashQLScript;
    /// The catalog function script (consolidated SQL for all function declarations)
    catalogFunctionScript: dashql.DashQLScript;

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

export enum ConnectionStatus {
    NOT_STARTED,

    // Generate setup status
    HEALTH_CHECK_STARTED,
    HEALTH_CHECK_FAILED,
    HEALTH_CHECK_CANCELLED,
    HEALTH_CHECK_SUCCEEDED,

    // Channel setup
    CHANNEL_SETUP_STARTED,
    CHANNEL_SETUP_FAILED,
    CHANNEL_SETUP_CANCELLED,
    CHANNEL_READY,

    // Generate OAuth
    AUTH_STARTED,
    AUTH_CANCELLED,
    AUTH_FAILED,
    PKCE_GENERATION_STARTED,
    PKCE_GENERATED,
    WAITING_FOR_OAUTH_CODE_VIA_WINDOW,
    WAITING_FOR_OAUTH_CODE_VIA_LINK,
    OAUTH_CODE_RECEIVED,
    ACCESS_TOKEN_REQUESTED,
    ACCESS_TOKEN_RECEIVED,

    // Salesforce OAuth
    DATA_CLOUD_TOKEN_REQUESTED,
    DATA_CLOUD_TOKEN_RECEIVED,
    CORE_ACCESS_TOKEN_REQUESTED,
    CORE_ACCESS_TOKEN_RECEIVED,
}

export function canDeleteConnectionWithStatus(status: ConnectionStatus) {
    switch (status) {
        case ConnectionStatus.AUTH_CANCELLED:
        case ConnectionStatus.AUTH_FAILED:
        case ConnectionStatus.CHANNEL_SETUP_CANCELLED:
        case ConnectionStatus.CHANNEL_SETUP_FAILED:
        case ConnectionStatus.CHANNEL_SETUP_STARTED:
        case ConnectionStatus.CORE_ACCESS_TOKEN_RECEIVED:
        case ConnectionStatus.DATA_CLOUD_TOKEN_RECEIVED:
        case ConnectionStatus.HEALTH_CHECK_CANCELLED:
        case ConnectionStatus.HEALTH_CHECK_FAILED:
        case ConnectionStatus.HEALTH_CHECK_SUCCEEDED:
        case ConnectionStatus.NOT_STARTED:
        case ConnectionStatus.OAUTH_CODE_RECEIVED:
        case ConnectionStatus.PKCE_GENERATED:
            return true;
        case ConnectionStatus.AUTH_STARTED:
        case ConnectionStatus.CORE_ACCESS_TOKEN_REQUESTED:
        case ConnectionStatus.DATA_CLOUD_TOKEN_REQUESTED:
        case ConnectionStatus.HEALTH_CHECK_STARTED:
        case ConnectionStatus.PKCE_GENERATION_STARTED:
        case ConnectionStatus.WAITING_FOR_OAUTH_CODE_VIA_LINK:
        case ConnectionStatus.WAITING_FOR_OAUTH_CODE_VIA_WINDOW:
            return false;
    }
}

export enum ConnectionHealth {
    NOT_STARTED = 0,
    CONNECTING = 1,
    CANCELLED = 2,
    ONLINE = 3,
    FAILED = 4,
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

export type ConnectionStateWithoutId = Omit<ConnectionState, "sessionId">;

export const DELETE_CONNECTION = Symbol('DELETE_CONNECTION');
export const RESET_CONNECTION = Symbol('RESET_CONNECTION');
export const SWITCH_CONNECTOR_TYPE = Symbol('SWITCH_CONNECTOR_TYPE');
export const SET_CONNECTION_ACTIVE = Symbol('SET_CONNECTION_ACTIVE');
export const RENAME_SESSION = Symbol('RENAME_SESSION');
export const SET_CATALOG_SCRIPT = Symbol('SET_CATALOG_SCRIPT');
export const UPDATE_CATALOG = Symbol('UPDATE_CATALOG');
export const CATALOG_UPDATE_STARTED = Symbol('CATALOG_UPDATE_STARTED');
export const CATALOG_UPDATE_REGISTER_QUERY = Symbol('CATALOG_UPDATE_REGISTER_QUERY');
export const CATALOG_UPDATE_SCHEMA_SCRIPT = Symbol('CATALOG_UPDATE_SCHEMA_SCRIPT');
export const CATALOG_UPDATE_SUCCEEDED = Symbol('CATALOG_UPDATE_SUCCEEDED');
export const CATALOG_UPDATE_FAILED = Symbol('CATALOG_UPDATE_FAILED');
export const CATALOG_UPDATE_CANCELLED = Symbol('CATALOG_UPDATE_CANCELLED');

export const EXECUTE_QUERY = Symbol('EXECUTE_QUERY');
export const QUERY_PREPARING = Symbol('QUERY_PREPARING');
export const QUERY_SENDING = Symbol('QUERY_SENDING');
export const QUERY_RUNNING = Symbol('QUERY_RUNNING');
export const QUERY_PROGRESS_UPDATED = Symbol('QUERY_PROGRESS_UPDATED');
export const QUERY_RECEIVED_BATCH = Symbol('QUERY_RECEIVED_BATCH');
export const QUERY_RECEIVED_ALL_BATCHES = Symbol('QUERY_RECEIVED_ALL_BATCHES');
export const QUERY_PROCESSING_RESULTS = Symbol('QUERY_PROCESSING_RESULTS');
export const QUERY_PROCESSED_RESULTS = Symbol('QUERY_PROCESSED_RESULTS');
export const QUERY_SUCCEEDED = Symbol('QUERY_SUCCEEDED');
export const QUERY_FAILED = Symbol('QUERY_FAILED');
export const QUERY_CANCELLED = Symbol('QUERY_CANCELLED');
export const QUERY_CACHE_RECORDED = Symbol('QUERY_CACHE_RECORDED');
export const QUERY_CACHE_DELETED = Symbol('QUERY_CACHE_DELETED');

export const HEALTH_CHECK_STARTED = Symbol('HEALTH_CHECK_STARTED');
export const HEALTH_CHECK_CANCELLED = Symbol('HEALTH_CHECK_CANCELLED');
export const HEALTH_CHECK_SUCCEEDED = Symbol('HEALTH_CHECK_SUCCEEDED');
export const HEALTH_CHECK_FAILED = Symbol('HEALTH_CHECK_FAILED');

export type CatalogAction =
    | VariantKind<typeof SET_CATALOG_SCRIPT, dashql.DashQLScript>
    | VariantKind<typeof UPDATE_CATALOG, [number, CatalogUpdateTaskState]>
    | VariantKind<typeof CATALOG_UPDATE_REGISTER_QUERY, [number, number]>
    | VariantKind<typeof CATALOG_UPDATE_SCHEMA_SCRIPT, [number]>
    | VariantKind<typeof CATALOG_UPDATE_CANCELLED, [number, Error]>
    | VariantKind<typeof CATALOG_UPDATE_FAILED, [number, Error]>
    | VariantKind<typeof CATALOG_UPDATE_SUCCEEDED, [number]>
    ;

export type QueryExecutionAction =
    | VariantKind<typeof EXECUTE_QUERY, [number, QueryExecutionState]>
    | VariantKind<typeof QUERY_PREPARING, [number]>
    | VariantKind<typeof QUERY_SENDING, [number]>
    | VariantKind<typeof QUERY_RUNNING, [number, QueryExecutionResponseStream]>
    | VariantKind<typeof QUERY_PROGRESS_UPDATED, [number, QueryExecutionProgress]>
    | VariantKind<typeof QUERY_RECEIVED_BATCH, [number, arrow.RecordBatch, QueryExecutionMetrics]>
    | VariantKind<typeof QUERY_RECEIVED_ALL_BATCHES, [number, arrow.Table, Map<string, string>, QueryExecutionMetrics]>
    | VariantKind<typeof QUERY_PROCESSING_RESULTS, [number]>
    | VariantKind<typeof QUERY_PROCESSED_RESULTS, [number]>
    | VariantKind<typeof QUERY_SUCCEEDED, [number]>
    | VariantKind<typeof QUERY_FAILED, [number, LoggableException, QueryExecutionMetrics | null]>
    | VariantKind<typeof QUERY_CANCELLED, [number, LoggableException, QueryExecutionMetrics | null]>
    | VariantKind<typeof QUERY_CACHE_RECORDED, [number, string, boolean, number | null]>
    | VariantKind<typeof QUERY_CACHE_DELETED, [number]>
    ;

export type ConnectionStateAction =
    | VariantKind<typeof DELETE_CONNECTION, null>
    | VariantKind<typeof RESET_CONNECTION, null>
    | VariantKind<typeof SWITCH_CONNECTOR_TYPE, ConnectorType>
    | VariantKind<typeof SET_CONNECTION_ACTIVE, null>
    | VariantKind<typeof RENAME_SESSION, string | null>
    | CatalogAction
    | QueryExecutionAction
    | HyperConnectorAction
    | DatalessConnectorAction
    | TrinoConnectorAction
    | SalesforceConnectionStateAction
    ;

export function reduceConnectionState(state: ConnectionState, action: ConnectionStateAction, storage: StorageWriter, _logger: Logger): ConnectionState {
    switch (action.type) {
        case SET_CATALOG_SCRIPT:
            return {
                ...state,
                catalogRelationScript: action.value,
            };

        case UPDATE_CATALOG:
        case CATALOG_UPDATE_REGISTER_QUERY:
        case CATALOG_UPDATE_SCHEMA_SCRIPT:
        case CATALOG_UPDATE_CANCELLED:
        case CATALOG_UPDATE_SUCCEEDED:
        case CATALOG_UPDATE_FAILED:
            return reduceCatalogAction(state, action, storage);

        case EXECUTE_QUERY:
        case QUERY_PREPARING:
        case QUERY_RUNNING:
        case QUERY_SENDING:
        case QUERY_PROGRESS_UPDATED:
        case QUERY_RECEIVED_BATCH:
        case QUERY_RECEIVED_ALL_BATCHES:
        case QUERY_PROCESSING_RESULTS:
        case QUERY_PROCESSED_RESULTS:
        case QUERY_SUCCEEDED:
        case QUERY_CANCELLED:
        case QUERY_FAILED:
        case QUERY_CACHE_RECORDED:
        case QUERY_CACHE_DELETED:
            return reduceQueryAction(state, action, storage);

        // RESET_CONNECTION is a bit special since we want to clean up our details as well
        case RESET_CONNECTION: {
            // Reset the DashQL catalog
            state.catalog.clear();

            // XXX Cancel currently running queries

            // Cleanup query executions and catalog
            const cleaned: ConnectionState = {
                ...state,
                connectionStatus: ConnectionStatus.NOT_STARTED,
                connectionHealth: ConnectionHealth.NOT_STARTED,
                metrics: createConnectionMetrics(),
                catalogUpdates: {
                    tasksRunning: new Map(),
                    tasksFinished: new Map(),
                    currentFullRefresh: null,
                    lastFullRefresh: null,
                    restoredAt: null,
                },
                queriesActive: new Map(),
                queriesFinished: new Map(),
            };
            // Cleanup the details
            let newState: ConnectionState | null = null;
            switch (state.details.type) {
                case SALESFORCE_DATA_CLOUD_CONNECTOR:
                    newState = reduceSalesforceConnectionState(cleaned, action as SalesforceConnectionStateAction, storage);
                    break;
                case HYPER_CONNECTOR:
                    newState = reduceHyperConnectorState(cleaned, action as HyperConnectorAction, storage);
                    break;
                case TRINO_CONNECTOR:
                    newState = reduceTrinoConnectorState(cleaned, action as TrinoConnectorAction, storage);
                    break;
                case DATALESS_CONNECTOR:
                    newState = reduceDatalessConnectorState(cleaned, action as DatalessConnectorAction, storage);
                    break;
            }

            // Cleaning up details is best-effort. No need to check if RESET was actually consumed
            newState = newState ?? cleaned;

            // Persist the resetted connection (only if it was previously activated)
            if (newState.active) {
                storage.write(groupSessionWrites(newState.sessionId), { type: WRITE_SESSION_MANIFEST, value: [newState.sessionId, newState] }, DEBOUNCE_DURATION_SESSION_WRITE);
            }
            return newState;
        }

        // SWITCH_CONNECTOR_TYPE changes the connection's type in-place.
        // Only allowed when the connection hasn't been configured yet.
        case SWITCH_CONNECTOR_TYPE: {
            if (state.connectionStatus !== ConnectionStatus.NOT_STARTED) {
                return state;
            }
            const newType = action.value;
            if (state.connectorInfo.connectorType === newType) {
                return state;
            }
            const newInfo = CONNECTOR_INFOS[newType as number];
            const newDetails = createConnectionStateDetails(newType);
            const newSig = computeNewConnectionSignatureFromDetails(newDetails);
            return {
                ...state,
                connectorInfo: newInfo,
                connectionSignature: newConnectionSignature(newSig, state.connectionSignature.signatures, state.sessionId),
                details: newDetails,
            };
        }

        // SET_CONNECTION_ACTIVE marks the connection as active.
        // Once active, storage writes are enabled for both connection and notebook state.
        case SET_CONNECTION_ACTIVE: {
            if (state.active) {
                return state;
            }
            const newState = { ...state, active: true };
            storage.write(groupSessionWrites(newState.sessionId), { type: WRITE_SESSION_MANIFEST, value: [newState.sessionId, newState] }, DEBOUNCE_DURATION_SESSION_WRITE);
            return newState;
        }

        // RENAME_SESSION sets (or clears) the user-supplied session name. A blank/whitespace-only
        // value normalises to null so clearing the name falls back to the display path everywhere.
        case RENAME_SESSION: {
            const trimmed = action.value?.trim() ?? '';
            const newName = trimmed.length > 0 ? trimmed : null;
            if (newName === state.name) {
                return state;
            }
            const newState = { ...state, name: newName };
            // Persist through the shared manifest write. Suppressed until the connection is active,
            // matching the other manifest writes (a not-yet-configured session isn't persisted).
            if (newState.active) {
                storage.write(groupSessionWrites(newState.sessionId), { type: WRITE_SESSION_MANIFEST, value: [newState.sessionId, newState] }, DEBOUNCE_DURATION_SESSION_WRITE);
            }
            return newState;
        }

        /// DELETE_CONNECTION deletes the connection state
        case DELETE_CONNECTION: {
            // XXX This must not be done if there are still notebooks referencing the connection!

            // XXX Cancel currently running queries

            // Cleanup query executions and catalog
            const cleaned: ConnectionState = {
                ...state,
                connectionStatus: ConnectionStatus.NOT_STARTED,
                connectionHealth: ConnectionHealth.NOT_STARTED,
                metrics: createConnectionMetrics(),
                catalogUpdates: {
                    tasksRunning: new Map(),
                    tasksFinished: new Map(),
                    currentFullRefresh: null,
                    lastFullRefresh: null,
                    restoredAt: null,
                },
                queriesActive: new Map(),
                queriesFinished: new Map(),
            };

            // Dispatch to the individual state detail handlers
            let newState: ConnectionState | null = null;
            switch (state.details.type) {
                case SALESFORCE_DATA_CLOUD_CONNECTOR:
                    newState = reduceSalesforceConnectionState(state, action as SalesforceConnectionStateAction, storage);
                    break;
                case HYPER_CONNECTOR:
                    newState = reduceHyperConnectorState(state, action as HyperConnectorAction, storage);
                    break;
                case TRINO_CONNECTOR:
                    newState = reduceTrinoConnectorState(state, action as TrinoConnectorAction, storage);
                    break;
                case DATALESS_CONNECTOR:
                    newState = reduceDatalessConnectorState(state, action as DatalessConnectorAction, storage);
                    break;
            }

            // Cleaning up details is best-effort. No need to check if RESET was actually consumed
            newState = newState ?? cleaned;

            // Cleanup catalog script before destroying catalog
            try {
                state.catalog.dropScript(state.catalogRelationScript);
            } catch (e) {
                // Script may have already been dropped - ignore error
            }
            state.catalogRelationScript.destroy();
            try {
                state.catalog.dropScript(state.catalogFunctionScript);
            } catch (e) {
                // Script may have already been dropped - ignore error
            }
            state.catalogFunctionScript.destroy();

            // Delete the conneciton catalog
            state.catalog.destroy();

            // Delete from storage
            storage.write(groupSessionWrites(state.sessionId), { type: DELETE_SESSION, value: state.sessionId }, DEBOUNCE_DURATION_SESSION_WRITE);
            return newState;
        }

        default: {
            // Dispatch to the individual state detail handlers
            let newState: ConnectionState | null = null;
            switch (state.details.type) {
                case SALESFORCE_DATA_CLOUD_CONNECTOR:
                    newState = reduceSalesforceConnectionState(state, action as SalesforceConnectionStateAction, storage);
                    break;
                case HYPER_CONNECTOR:
                    newState = reduceHyperConnectorState(state, action as HyperConnectorAction, storage);
                    break;
                case TRINO_CONNECTOR:
                    newState = reduceTrinoConnectorState(state, action as TrinoConnectorAction, storage);
                    break;
                case DATALESS_CONNECTOR:
                    newState = reduceDatalessConnectorState(state, action as DatalessConnectorAction, storage);
                    break;
            }
            if (newState == null) {
                throw new Error(`failed to apply state action: ${String(action.type)}`);
            }

            // Activate the connection when the health check succeeds
            if (action.type === HEALTH_CHECK_SUCCEEDED && !newState.active) {
                newState = { ...newState, active: true };
            }

            // Only persist active connections
            if (newState.active) {
                storage.write(groupSessionWrites(newState.sessionId), { type: WRITE_SESSION_MANIFEST, value: [newState.sessionId, newState] }, DEBOUNCE_DURATION_SESSION_WRITE);
            }
            return newState;
        }
    }
}

export function createConnectionMetrics(): connection.ConnectionMetrics {
    return {
        successfulQueries: {
            totalQueries: 0,
            totalBatchesReceived: 0,
            totalRowsReceived: 0,
            accumulatedTimeUntilFirstBatch: 0,
            accumulatedQueryDuration: 0,
        },
        canceledQueries: {
            totalQueries: 0,
            totalBatchesReceived: 0,
            totalRowsReceived: 0,
            accumulatedTimeUntilFirstBatch: 0,
            accumulatedQueryDuration: 0,
        },
        failedQueries: {
            totalQueries: 0,
            totalBatchesReceived: 0,
            totalRowsReceived: 0,
            accumulatedTimeUntilFirstBatch: 0,
            accumulatedQueryDuration: 0,
        },
    };
}

export function createConnectionState(dql: dashql.DashQL, info: ConnectorInfo, connSigs: ConnectionSignatureMap, details: ConnectionStateDetailsVariant): ConnectionStateWithoutId {
    const catalog = dql.createCatalog();
    const catalogRelationScript = dql.createScript(catalog);
    catalogRelationScript.replaceText(generateCatalogScriptHeader(CatalogSource.Unknown));
    const catalogFunctionScript = dql.createScript(catalog);
    catalogFunctionScript.replaceText(generateFunctionScriptHeader(CatalogSource.Unknown));
    const connSig = computeNewConnectionSignatureFromDetails(details);
    return {
        instance: dql,
        name: null,
        active: false,
        connectionStatus: ConnectionStatus.NOT_STARTED,
        connectionHealth: ConnectionHealth.NOT_STARTED,
        connectorInfo: info,
        connectionSignature: newConnectionSignature(connSig, connSigs, null),
        metrics: createConnectionMetrics(),
        details,
        catalog,
        catalogUpdates: {
            tasksRunning: new Map(),
            tasksFinished: new Map(),
            currentFullRefresh: null,
            lastFullRefresh: null,
            restoredAt: null,
        },
        catalogRelationScript,
        catalogFunctionScript,
        snapshotQueriesActiveFinished: 1,
        queriesActive: new Map(),
        queriesActiveOrdered: [],
        queriesFinished: new Map(),
        queriesFinishedOrdered: [],
    };
}

export function createConnectionStateForType(dql: dashql.DashQL, type: ConnectorType, connSigs: ConnectionSignatureMap): ConnectionStateWithoutId {
    const connInfo = CONNECTOR_INFOS[type as number];
    const connMetrics = createConnectionMetrics();
    const connDetails = createConnectionStateDetails(type);
    const connSig = computeNewConnectionSignatureFromDetails(connDetails);

    const catalog = dql.createCatalog();
    const catalogRelationScript = dql.createScript(catalog);
    catalogRelationScript.replaceText(generateCatalogScriptHeader(CatalogSource.Unknown));
    const catalogFunctionScript = dql.createScript(catalog);
    catalogFunctionScript.replaceText(generateFunctionScriptHeader(CatalogSource.Unknown));
    return {
        instance: dql,
        name: null,
        active: false,
        connectionStatus: ConnectionStatus.NOT_STARTED,
        connectionHealth: ConnectionHealth.NOT_STARTED,
        connectorInfo: connInfo,
        connectionSignature: newConnectionSignature(connSig, connSigs, null),
        metrics: connMetrics,
        details: connDetails,
        catalog,
        catalogUpdates: {
            tasksRunning: new Map(),
            tasksFinished: new Map(),
            currentFullRefresh: null,
            lastFullRefresh: null,
            restoredAt: null,
        },
        catalogRelationScript,
        catalogFunctionScript,
        snapshotQueriesActiveFinished: 1,
        queriesActive: new Map(),
        queriesActiveOrdered: [],
        queriesFinished: new Map(),
        queriesFinishedOrdered: [],
    };
}

export function computeConnectionSignature(state: ConnectionState, hasher: Hasher) {
    return computeConnectionSignatureFromDetails(state.details, hasher);
}
