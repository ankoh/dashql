import type { DashQL } from '@ankoh/dashql-core';
import { destroyConnectionState, type ConnectionState } from './connection_state.js';
import { decodeConnectionFromProto, restoreConnectionState } from './connection_import.js';
import type { WorkbookConnection } from '../storage/storage_backend.js';

/// The connections of storage that the restore of the Rust runtime doesn't create, e.g. the connections of a native
/// workbook that changed on disk. The restore of the app runs in Rust, see `workbook/persistence/app_state_loader.ts`.

/// The stored params of a connection, as the app manifest or a workbook file holds them
export type StoredConnection = Pick<WorkbookConnection, 'params' | 'paramsDraft'> & {
    /// The name of the connection, the app manifest keeps it, an imported workbook brings it along
    name?: string;
    /// Does the connection cache query results? The app manifest keeps it, absent for the default of the connector.
    cacheQueryResults?: boolean;
};

/// Create the state of a connection from its stored params.
/// The connection is neither registered nor written, see `destroyUnregisteredConnection`.
export function connectionStateFromStorage(core: DashQL, connectionId: string, stored: StoredConnection): ConnectionState {
    const [connectorInfo, details] = decodeConnectionFromProto(stored.params as any, connectionId);
    return restoreConnectionState(core, connectionId, connectorInfo, details, stored.paramsDraft, {
        name: stored.name,
        cacheQueryResults: stored.cacheQueryResults,
    });
}

/// Destroy a connection that was created but never registered
export function destroyUnregisteredConnection(connection: ConnectionState): void {
    destroyConnectionState(connection);
}
