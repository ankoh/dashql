import type * as core from '@ankoh/dashql-core';

import type { ConnectionAction, ConnectionState, NewConnection } from './connection_state.js';
import type { QueryExecutionState } from '../query/query_execution_state.js';
import type { ConnectionEntry, WorkbookConnection } from '../storage/storage_backend.js';

/// The connections of the runtime by id and their ids by connector, the views of the last flush of the store
/// (docs/wip/runtime_api.md). The runtime holds the connections, a connection changes when it is set up, saved or
/// refreshed and when a query starts or finishes, not with the progress of a query.
export interface ConnectionRegistry {
    connections: ReadonlyMap<string, ConnectionState>;
    /// The ids of the connections by connector, in the order they were registered
    connectionsByType: string[][];
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

/// The registry of the views of a list of connections
export function connectionRegistryOf(list: core.ConnectionListView | null, connection: (connectionId: string) => ConnectionState | null): ConnectionRegistry {
    const connections = new Map<string, ConnectionState>();
    for (const entry of list?.connections ?? []) {
        const view = connection(entry.connectionId);
        if (view != null) connections.set(entry.connectionId, view);
    }
    return { connections, connectionsByType: list?.connectionsByType ?? [[], [], [], []] };
}

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

/// The queries a workbook issued on a connection, active ones first
export function findWorkbookQueries(
    database: ConnectionState,
    workbookId: string,
    queryOf: (queryId: number) => QueryExecutionState | null,
    includeFinished: boolean = true,
): number[] {
    const ofWorkbook = (queryId: number) => queryOf(queryId)?.queryMetadata.workbookId === workbookId;
    const active = database.queriesActiveOrdered.filter(ofWorkbook);
    if (!includeFinished) return active;
    return [...active, ...database.queriesFinishedOrdered.filter(ofWorkbook)];
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
/// Create a connection, with a fixed id or a new one
export type ConnectionAllocator = (connection: NewConnection, connectionId?: string) => ConnectionState;
export type DynamicConnectionDispatch = (connectionId: string | null, action: ConnectionAction) => void;
