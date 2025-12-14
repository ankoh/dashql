import * as core from '@ankoh/dashql-core';
import * as dashql from '@ankoh/dashql-core';
import * as pb from '@ankoh/dashql-protobuf';
import * as buf from '@bufbuild/protobuf';
import * as arrow from 'apache-arrow';

import { HyperGrpcConnectorAction, reduceHyperGrpcConnectorState } from './hyper/hyper_connection_state.js';
import { SalesforceConnectionStateAction, reduceSalesforceConnectionState } from './salesforce/salesforce_connection_state.js';
import { CATALOG_DEFAULT_DESCRIPTOR_POOL, CATALOG_DEFAULT_DESCRIPTOR_POOL_RANK, CatalogUpdateTaskState, reduceCatalogAction } from './catalog_update_state.js';
import { VariantKind } from '../utils/variant.js';
import {
    CONNECTOR_INFOS,
    ConnectorInfo,
    ConnectorType,
    DEMO_CONNECTOR,
    HYPER_GRPC_CONNECTOR,
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
import { DemoConnectorAction, reduceDemoConnectorState } from './demo/demo_connection_state.js';
import { reduceTrinoConnectorState, TrinoConnectorAction } from './trino/trino_connection_state.js';
import { computeConnectionSignatureFromDetails, computeNewConnectionSignatureFromDetails, ConnectionStateDetailsVariant, createConnectionStateDetails } from './connection_state_details.js';
import { ConnectionSignatureMap, ConnectionSignatureState, newConnectionSignature } from './connection_signature.js';
import { DEBOUNCE_DURATION_CONNECTION_WRITE, StorageWriter, WRITE_CONNECTION_STATE } from '../storage/storage_writer.js';

export interface CatalogUpdates {
    /// The running tasks
    tasksRunning: Map<number, CatalogUpdateTaskState>;
    /// The finished tasks
    tasksFinished: Map<number, CatalogUpdateTaskState>;
    /// The most recent catalog update.
    /// We use this to trigger auto-refreshs.
    lastFullRefresh: number | null;
}

export interface ConnectionState {
    /// The connection id
    connectionId: number;

    /// The connection state contains many references into the Wasm heap.
    /// It therefore makes sense that connection state users resolve the "right" module through here.
    instance: core.DashQL;

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
    metrics: pb.dashql.connection.ConnectionMetrics;

    /// The catalog
    catalog: dashql.DashQLCatalog;
    /// The  catalog updates
    catalogUpdates: CatalogUpdates;

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

    // Salesforce OAuth
    AUTH_STARTED,
    AUTH_CANCELLED,
    AUTH_FAILED,
    PKCE_GENERATION_STARTED,
    PKCE_GENERATED,
    WAITING_FOR_OAUTH_CODE_VIA_WINDOW,
    WAITING_FOR_OAUTH_CODE_VIA_LINK,
    OAUTH_CODE_RECEIVED,
    DATA_CLOUD_TOKEN_REQUESTED,
    DATA_CLOUD_TOKEN_RECEIVED,
    CORE_ACCESS_TOKEN_REQUESTED,
    CORE_ACCESS_TOKEN_RECEIVED,
}

export enum ConnectionHealth {
    NOT_STARTED = 0,
    CONNECTING = 1,
    CANCELLED = 2,
    ONLINE = 3,
    FAILED = 4,
}

export type ConnectionStateWithoutId = Omit<ConnectionState, "connectionId">;

export const RESET = Symbol('RESET');
export const UPDATE_CATALOG = Symbol('UPDATE_CATALOG');
export const CATALOG_UPDATE_STARTED = Symbol('CATALOG_UPDATE_STARTED');
export const CATALOG_UPDATE_REGISTER_QUERY = Symbol('CATALOG_UPDATE_REGISTER_QUERY');
export const CATALOG_UPDATE_LOAD_DESCRIPTORS = Symbol('CATALOG_UPDATE_LOAD_DESCRIPTORS');
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

export const HEALTH_CHECK_STARTED = Symbol('HEALTH_CHECK_STARTED');
export const HEALTH_CHECK_CANCELLED = Symbol('HEALTH_CHECK_CANCELLED');
export const HEALTH_CHECK_SUCCEEDED = Symbol('HEALTH_CHECK_SUCCEEDED');
export const HEALTH_CHECK_FAILED = Symbol('HEALTH_CHECK_FAILED');

export type CatalogAction =
    | VariantKind<typeof UPDATE_CATALOG, [number, CatalogUpdateTaskState]>
    | VariantKind<typeof CATALOG_UPDATE_REGISTER_QUERY, [number, number]>
    | VariantKind<typeof CATALOG_UPDATE_LOAD_DESCRIPTORS, [number]>
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
    | VariantKind<typeof QUERY_FAILED, [number, Error, QueryExecutionMetrics | null]>
    | VariantKind<typeof QUERY_CANCELLED, [number, Error, QueryExecutionMetrics | null]>
    ;

export type ConnectionStateAction =
    | VariantKind<typeof RESET, null>
    | CatalogAction
    | QueryExecutionAction
    | HyperGrpcConnectorAction
    | DemoConnectorAction
    | TrinoConnectorAction
    | SalesforceConnectionStateAction
    ;

export function reduceConnectionState(state: ConnectionState, action: ConnectionStateAction, storage: StorageWriter): ConnectionState {
    switch (action.type) {
        case UPDATE_CATALOG:
        case CATALOG_UPDATE_REGISTER_QUERY:
        case CATALOG_UPDATE_LOAD_DESCRIPTORS:
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
            return reduceQueryAction(state, action, storage);

        // RESET is a bit special since we want to clean up our details as well
        case RESET: {
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
                    lastFullRefresh: null,
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
                case HYPER_GRPC_CONNECTOR:
                    newState = reduceHyperGrpcConnectorState(cleaned, action as HyperGrpcConnectorAction, storage);
                    break;
                case HYPER_GRPC_CONNECTOR:
                    newState = reduceTrinoConnectorState(cleaned, action as TrinoConnectorAction, storage);
                    break;
                case DEMO_CONNECTOR:
                    newState = reduceDemoConnectorState(cleaned, action as DemoConnectorAction, storage);
                    break;
                case DATALESS_CONNECTOR:
                    break;
            }

            // Cleaning up details is best-effort. No need to check if RESET was actually consumed
            newState = newState ?? cleaned;

            // Persist the resetted set
            storage.write(`conn/${state.connectionId}`, {
                type: WRITE_CONNECTION_STATE,
                value: [newState.connectionId, newState]
            }, DEBOUNCE_DURATION_CONNECTION_WRITE);
            return newState;
        }

        default: {
            // Dispatch to the individual state detail handlers
            let next: ConnectionState | null = null;
            switch (state.details.type) {
                case SALESFORCE_DATA_CLOUD_CONNECTOR:
                    next = reduceSalesforceConnectionState(state, action as SalesforceConnectionStateAction, storage);
                    break;
                case HYPER_GRPC_CONNECTOR:
                    next = reduceHyperGrpcConnectorState(state, action as HyperGrpcConnectorAction, storage);
                    break;
                case TRINO_CONNECTOR:
                    next = reduceTrinoConnectorState(state, action as TrinoConnectorAction, storage);
                    break;
                case DEMO_CONNECTOR:
                    next = reduceDemoConnectorState(state, action as DemoConnectorAction, storage);
                    break;
                case DATALESS_CONNECTOR:
                    break;
            }
            if (next == null) {
                throw new Error(`failed to apply state action: ${String(action.type)}`);
            }

            // Persist the updated state
            storage.write(`conn/${state.connectionId}`, {
                type: WRITE_CONNECTION_STATE,
                value: [state.connectionId, state]
            }, DEBOUNCE_DURATION_CONNECTION_WRITE);
            return next;
        }
    }
}

export function createConnectionMetrics(): pb.dashql.connection.ConnectionMetrics {
    return buf.create(pb.dashql.connection.ConnectionMetricsSchema, {
        successfulQueries: buf.create(pb.dashql.connection.ConnectionQueryMetricsSchema),
        canceledQueries: buf.create(pb.dashql.connection.ConnectionQueryMetricsSchema),
        failedQueries: buf.create(pb.dashql.connection.ConnectionQueryMetricsSchema),
    });
}

export function createConnectionState(dql: dashql.DashQL, info: ConnectorInfo, connSigs: ConnectionSignatureMap, details: ConnectionStateDetailsVariant): ConnectionStateWithoutId {
    const catalog = dql.createCatalog();
    catalog.addDescriptorPool(CATALOG_DEFAULT_DESCRIPTOR_POOL, CATALOG_DEFAULT_DESCRIPTOR_POOL_RANK);
    const connSig = computeNewConnectionSignatureFromDetails(details);
    return {
        instance: dql,
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
            lastFullRefresh: null,
        },
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
    catalog.addDescriptorPool(CATALOG_DEFAULT_DESCRIPTOR_POOL, CATALOG_DEFAULT_DESCRIPTOR_POOL_RANK);
    return {
        instance: dql,
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
            lastFullRefresh: null,
        },
        snapshotQueriesActiveFinished: 1,
        queriesActive: new Map(),
        queriesActiveOrdered: [],
        queriesFinished: new Map(),
        queriesFinishedOrdered: [],
    };
}

export function createDatalessConnectionState(dql: dashql.DashQL, connSigs: ConnectionSignatureMap): ConnectionStateWithoutId {
    const state = createConnectionState(dql, CONNECTOR_INFOS[ConnectorType.DATALESS], connSigs, {
        type: DATALESS_CONNECTOR,
        value: {}
    });
    state.connectionStatus = ConnectionStatus.CHANNEL_READY;
    state.connectionHealth = ConnectionHealth.ONLINE;
    return state;
}

export function computeConnectionSignature(state: ConnectionState, hasher: Hasher) {
    return computeConnectionSignatureFromDetails(state.details, hasher);
}
