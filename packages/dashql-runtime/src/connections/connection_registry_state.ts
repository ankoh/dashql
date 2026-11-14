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
import {
    DEBOUNCE_DURATION_WORKBOOK_WRITE,
    groupConnectionEntryWrites,
    groupConnectionFileWrites,
    groupWorkbookConnectionCopyWrites,
    WRITE_CONNECTION_ENTRY,
    WRITE_CONNECTION_FILE,
    PATCH_WORKBOOK_CONNECTION,
    DELETE_CONNECTION_ENTRY,
    type StorageWriter,
} from '../storage/storage_writer.js';
import { generateRelationsFile, readRelationName } from './catalog/catalog_sql_generator.js';
import { CatalogUpdateVariant, pendingRelations } from './catalog/catalog_update_state.js';
import { STORAGE_CATALOG_STATE, STORAGE_CATALOG_FUNCTIONS, STORAGE_CATALOG_RELATIONS, type ConnectionEntry, type WorkbookConnection } from '../storage/storage_backend.js';
import { connectionCatalogIsDurable, connectionParamsEqual } from './connection_params.js';

const LOG_CTX = 'connection_registry';

/// Drafts are written to the app manifest only, edits arrive with every keystroke
export const DEBOUNCE_DURATION_CONNECTION_DRAFT_WRITE = 250;

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

/// Did the saved params change?
export function didConnectionParamsChange(prev: ConnectionState, next: ConnectionState): boolean {
    return !connectionParamsEqual(prev.params, next.params);
}


/// Did the persisted connection entry change?
export function didPersistedConnectionChange(prev: ConnectionState, next: ConnectionState): boolean {
    if (!prev.active && next.active) return true;
    return didConnectionParamsChange(prev, next) || !connectionParamsEqual(prev.paramsDraft, next.paramsDraft) || prev.name !== next.name || prev.cacheQueryResults !== next.cacheQueryResults;
}

/// Write the saved params of a connection into the app manifest and into every workbook that
/// references it. The writes are debounced and not awaited, Save awaits them explicitly.
export function scheduleConnectionParamsWrites(references: ConnectionReferences, database: ConnectionState, storageWriter: StorageWriter): void {
    void storageWriter.write(
        groupConnectionEntryWrites(database.connectionId),
        { type: WRITE_CONNECTION_ENTRY, value: connectionEntryFromState(database) },
        DEBOUNCE_DURATION_WORKBOOK_WRITE,
    );
    for (const workbookId of references.workbooksOf(database.connectionId)) {
        void storageWriter.write(
            groupWorkbookConnectionCopyWrites(workbookId, database.connectionId),
            { type: PATCH_WORKBOOK_CONNECTION, value: [workbookId, workbookConnectionFromState(database)] },
            DEBOUNCE_DURATION_WORKBOOK_WRITE,
        );
    }
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
        if (prev.active) {
            storageWriter.cancelPendingConnectionFileWrites(connectionId);
            void storageWriter.write(groupConnectionEntryWrites(connectionId), { type: DELETE_CONNECTION_ENTRY, value: connectionId });
        }
        return { ...reg };
    }
    reg.connections.set(connectionId, next);
    // Update type index when connector type changes
    if (action.type == SWITCH_CONNECTOR_TYPE && next.connectorInfo.connectorType !== connectorType) {
        reg.connectionsByType[connectorType] = reg.connectionsByType[connectorType].filter(id => id != connectionId);
        reg.connectionsByType[next.connectorInfo.connectorType].push(connectionId);
    }
    // Only connections that workbooks reference or that were activated are persisted.
    // Saving writes the committed params by itself and awaits the writes.
    if (workbookIds.length === 0 && !next.active) {
        return { ...reg };
    }
    if (action.type !== COMMIT_CONNECTION_PARAMS) {
        if (didConnectionParamsChange(prev, next) || (!prev.active && next.active)) {
            // Saved params are replicated into every workbook that references the connection
            scheduleConnectionParamsWrites(references, next, storageWriter);
        } else if (didPersistedConnectionChange(prev, next)) {
            // Drafts, names and the caching choice only live in the app manifest
            void storageWriter.write(
                groupConnectionEntryWrites(connectionId),
                { type: WRITE_CONNECTION_ENTRY, value: connectionEntryFromState(next) },
                DEBOUNCE_DURATION_CONNECTION_DRAFT_WRITE,
            );
        }
    }
    if (!next.active) {
        return { ...reg };
    }
    // The catalog of the connection is written into the app storage, workbooks don't keep a copy.
    // The relations of a connection whose database doesn't outlive the app are never written.
    const durable = connectionCatalogIsDurable(next.params);
    if (action.type === CATALOG_UPDATE_SUCCEEDED || action.type === CATALOG_UPDATE_PARTIALLY_SUCCEEDED) {
        const task = next.catalogUpdates.tasksFinished.get(action.value[0]);
        const refreshed = task?.taskVariant !== CatalogUpdateVariant.RELATION_REFRESH;
        // A lookup that changed nothing has nothing to save
        if (durable && next.catalogUpdates.described && (refreshed || action.value[1] !== false)) {
            void storageWriter.write(
                groupConnectionFileWrites(connectionId, STORAGE_CATALOG_RELATIONS),
                // Rendered when the write runs, a run of statements saves the relations once
                { type: WRITE_CONNECTION_FILE, value: [connectionId, STORAGE_CATALOG_RELATIONS, () => {
                    // A reset cleared the catalog in the meantime, what is on disk is better than nothing
                    const descriptor = next.catalog.readDescriptor(next.catalogRelationEntryId);
                    return descriptor == null ? null : generateRelationsFile(descriptor);
                }] },
                DEBOUNCE_DURATION_WORKBOOK_WRITE,
            );
        }
        // Only a full refresh reads the functions
        if (refreshed) {
            void storageWriter.write(
                groupConnectionFileWrites(connectionId, STORAGE_CATALOG_FUNCTIONS),
                { type: WRITE_CONNECTION_FILE, value: [connectionId, STORAGE_CATALOG_FUNCTIONS, next.catalogFunctionScript.toString()] },
                DEBOUNCE_DURATION_WORKBOOK_WRITE,
            );
        }
    }
    // Statements and the updates that answer them change what the relations don't say. A relation stays pending until an
    // update answered, so that a restart in between asks again.
    if (durable && (action.type === RELATIONS_TOUCHED || action.type === CATALOG_UPDATE_SUCCEEDED
        || action.type === CATALOG_UPDATE_PARTIALLY_SUCCEEDED || action.type === CATALOG_UPDATE_FAILED || action.type === CATALOG_UPDATE_CANCELLED)) {
        const state = JSON.stringify({
            pending: pendingRelations(next),
            gone: next.catalog.absentRelations().map(name => readRelationName(name)),
        });
        void storageWriter.write(
            groupConnectionFileWrites(connectionId, STORAGE_CATALOG_STATE),
            { type: WRITE_CONNECTION_FILE, value: [connectionId, STORAGE_CATALOG_STATE, state] },
            DEBOUNCE_DURATION_WORKBOOK_WRITE,
        );
    }
    return { ...reg };
}
