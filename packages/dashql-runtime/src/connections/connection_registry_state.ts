import * as core from '@ankoh/dashql-core';
import {
    ConnectionState,
    ConnectionAction,
    type ConnectionStateWithoutId,
    CATALOG_UPDATE_CANCELLED,
    CATALOG_UPDATE_FAILED,
    CATALOG_UPDATE_PARTIALLY_SUCCEEDED,
    CATALOG_UPDATE_SUCCEEDED,
    RELATIONS_TOUCHED,
    DELETE_CONNECTION,
    SWITCH_CONNECTOR_TYPE,
    reduceConnectionState,
    COMMIT_CONNECTION_PARAMS,
} from './connection_state.js';
import { isHyperWasmConnection } from './connection_label.js';
import type { Logger } from '../platform/logger/logger.js';
import type { StorageWriter } from '../storage/storage_writer.js';
import type { ConnectionEntry, WorkbookConnection } from '../storage/storage_backend.js';

const LOG_CTX = 'connection_registry';

/// The connection registry
///
/// Connections are entities of their own, keyed by the global connection
/// id. The scripts of workbooks run on them, several workbooks
/// may reference the same connection and then share its channel, catalog and queries.
///
/// Note that we're deliberately not using immutable maps for the connections here.
/// Following the same reasoning as with the workbook registry, we don't have code that
/// explicitly observes modifications of the registry map.
/// Instead, shallow-compare the entire registry object again.
export interface ConnectionRegistry {
    connections: Map<string, ConnectionState>;  // connectionId -> ConnectionState
    connectionsByType: string[][];  // arrays of databaseIds by connector type
}

/// The workbooks that use the connections.
///
/// The scripts of a workbook own the references to their connections, the workbook scripts registry
/// provides them to the connection layer. A host without workbooks (e.g. the shell) has no references.
export interface ConnectionReferences {
    /// The workbooks with scripts on a connection, in registration order
    workbooksOf(connectionId: string): readonly string[];
    /// The connections that the scripts of a workbook use in feed order, then the pending connection
    connectionsOf(workbookId: string): readonly string[];
    /// Subscribe to changes of the references
    subscribe(listener: () => void): () => void;
}

/// The references of a host without workbooks
export const NO_CONNECTION_REFERENCES: ConnectionReferences = {
    workbooksOf: () => [],
    connectionsOf: () => [],
    subscribe: () => () => { },
};

/// The connections of a workbook, null while a connection is not registered
export function resolveWorkbookConnections(
    registry: Pick<ConnectionRegistry, 'connections'>,
    references: ConnectionReferences,
    workbookId: string | null,
): ConnectionState[] | null {
    if (workbookId == null) return null;
    const connections = references.connectionsOf(workbookId)
        .map(connectionId => registry.connections.get(connectionId));
    if (connections.length === 0 || connections.some(database => database == null)) return null;
    return connections as ConnectionState[];
}

/// Is a connection listed next to the workbooks?
/// Connections that workbooks reference are listed, as are active connections that no workbook references.
export function isListedConnection(
    registry: Pick<ConnectionRegistry, 'connections'>,
    references: ConnectionReferences,
    connectionId: string,
): boolean {
    const database = registry.connections.get(connectionId);
    if (database == null) return false;
    return references.workbooksOf(connectionId).length > 0 || database.active;
}

/// Register a connection in the registry indices (mutates the registry)
export function registerConnection(registry: ConnectionRegistry, database: ConnectionState): void {
    registry.connections.set(database.connectionId, database);
    const byType = registry.connectionsByType[database.connectorInfo.connectorType];
    if (!byType.includes(database.connectionId)) byType.push(database.connectionId);
}

/// The queries a workbook issued on a connection, active ones first
export function findWorkbookQueries(database: ConnectionState, workbookId: string, includeFinished: boolean = true): number[] {
    const active = database.queriesActiveOrdered.filter(queryId => database.queriesActive.get(queryId)?.queryMetadata.workbookId === workbookId);
    if (!includeFinished) return active;
    const finished = database.queriesFinishedOrdered.filter(queryId => database.queriesFinished.get(queryId)?.queryMetadata.workbookId === workbookId);
    return [...active, ...finished];
}

/// Build the manifest entry of a connection
export function connectionEntryFromState(database: ConnectionState): ConnectionEntry {
    return {
        id: database.connectionId,
        params: database.params,
        ...(database.paramsDraft == null ? {} : { paramsDraft: database.paramsDraft }),
        ...(database.name == null ? {} : { name: database.name }),
        ...(database.cacheQueryResults == null ? {} : { cacheQueryResults: database.cacheQueryResults }),
    };
}

/// Build the copy of a connection that a workbook file stores
export function workbookConnectionFromState(database: ConnectionState): WorkbookConnection {
    return {
        connectionId: database.connectionId,
        params: database.params,
    };
}

/// The ordinals of the connections that share their connector with other connections, 1-based in
/// registration order. Only listed connections are numbered, see `isListedConnection`, so the
/// numbers don't depend on the current workbook.
export function connectionOrdinals(
    registry: Pick<ConnectionRegistry, 'connections' | 'connectionsByType'>,
    references: ConnectionReferences,
): Map<string, number> {
    const ordinals = new Map<string, number>();
    for (const connectionIds of registry.connectionsByType) {
        const listed = connectionIds.filter(connectionId => isListedConnection(registry, references, connectionId));
        if (listed.length < 2) continue;
        listed.forEach((connectionId, index) => ordinals.set(connectionId, index + 1));
    }
    return ordinals;
}

export type ConnectionDispatch = (action: ConnectionAction) => void;
/// Register a new connection, with a fixed id or a new one
export type ConnectionAllocator = (state: ConnectionStateWithoutId, connectionId?: string) => ConnectionState;
export type DynamicConnectionDispatch = (connectionId: string | null, action: ConnectionAction) => void;

/// Apply an action to a connection of the registry (mutates the registry)
export function applyConnectionAction(reg: ConnectionRegistry, references: ConnectionReferences, connectionId: string, action: ConnectionAction, storageWriter: StorageWriter, logger: Logger): ConnectionRegistry {
    const prev = reg.connections.get(connectionId);
    if (!prev) {
        console.warn(`no connection registered with id ${connectionId}`);
        return reg;
    }
    const connectorType = prev.connectorInfo.connectorType;
    const workbookIds = references.workbooksOf(connectionId);

    // Connections outlive the workbooks that reference them, but a referenced connection
    // must neither be deleted nor change its type underneath other workbooks.
    if (action.type == DELETE_CONNECTION && workbookIds.length > 0) {
        logger.warn('refusing to delete a connection that workbooks reference', {
            connectionId,
            workbooks: workbookIds.join(','),
        }, LOG_CTX);
        return reg;
    }
    // Workbooks fall back to the embedded Hyper and the user can't attach one again, it is never deleted
    if (action.type == DELETE_CONNECTION && isHyperWasmConnection(prev)) {
        logger.warn('refusing to delete the connection to the embedded Hyper', { connectionId }, LOG_CTX);
        return reg;
    }
    if (action.type == SWITCH_CONNECTOR_TYPE && workbookIds.length > 1) {
        logger.warn('refusing to switch the type of a shared connection', { connectionId }, LOG_CTX);
        return reg;
    }
    const next = reduceConnectionState(prev, action, logger);

    if (action.type == DELETE_CONNECTION) {
        reg.connectionsByType[connectorType] = reg.connectionsByType[connectorType].filter(id => id != connectionId);
        reg.connections.delete(connectionId);
        // An active connection leaves the app manifest with its files
        void storageWriter.withNativeWriter(async native => core.DashQLConnectionPersistence.scheduleDeleteWrites(native, connectionId, prev.active))
            .catch(error => logger.error('Failed to schedule the deletion of a connection', { connectionId, error: String(error) }, LOG_CTX));
        return { ...reg };
    }
    reg.connections.set(connectionId, next);
    // Update type index when connector type changes
    if (action.type == SWITCH_CONNECTOR_TYPE && next.connectorInfo.connectorType !== connectorType) {
        reg.connectionsByType[connectorType] = reg.connectionsByType[connectorType].filter(id => id != connectionId);
        reg.connectionsByType[next.connectorInfo.connectorType].push(connectionId);
    }
    // The Rust runtime decides what storage keeps of the change (`connection_persistence`): the params, the draft, the
    // name and the caching choice in the app manifest, the saved params in the workbooks, the catalog in the files of
    // the connection
    const fields = persistedFields(prev);
    const change = persistenceChange(action);
    const workbooks = [...workbookIds];
    void storageWriter.withNativeWriter(async native => {
        core.DashQLConnectionPersistence.scheduleWrites(native, next.native.connection, connectionId, fields, change, workbooks);
    }).catch(error => logger.error('Failed to schedule the writes of a connection', { connectionId, error: String(error) }, LOG_CTX));
    return { ...reg };
}

/// What storage keeps of a connection before a change
function persistedFields(state: ConnectionState): core.PersistedConnectionFields {
    return {
        active: state.active,
        params: state.params,
        paramsDraft: state.paramsDraft ?? null,
        name: state.name ?? null,
        cacheQueryResults: state.cacheQueryResults ?? null,
    };
}

/// What an action changed for the persistence of a connection
function persistenceChange(action: ConnectionAction): core.ConnectionPersistenceChange {
    switch (action.type) {
        case COMMIT_CONNECTION_PARAMS:
            return { type: 'paramsCommitted' };
        case RELATIONS_TOUCHED:
            return { type: 'relationsTouched' };
        case CATALOG_UPDATE_SUCCEEDED:
            return { type: 'catalogUpdateFinished', taskId: action.value[0], status: 'succeeded', ...(action.value[1] === false ? { changed: false } : {}) };
        case CATALOG_UPDATE_PARTIALLY_SUCCEEDED:
            return { type: 'catalogUpdateFinished', taskId: action.value[0], status: 'partiallySucceeded' };
        case CATALOG_UPDATE_FAILED:
            return { type: 'catalogUpdateFinished', taskId: action.value[0], status: 'failed' };
        case CATALOG_UPDATE_CANCELLED:
            return { type: 'catalogUpdateFinished', taskId: action.value[0], status: 'cancelled' };
        default:
            return { type: 'other' };
    }
}
