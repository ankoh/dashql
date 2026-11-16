import type { NewConnection } from './connection_state.js';
import { decodeConnectionFromProto } from './connection_import.js';
import type { ConnectionParams } from './connection_params.js';
import type { WorkbookConnection } from '../storage/storage_backend.js';

/// The connections of storage that the restore of the Rust runtime doesn't create, e.g. the connections of a native
/// workbook that changed on disk. The restore of the app runs in the runtime (`Runtime.restore`).

/// The stored params of a connection, as the app manifest or a workbook file holds them
export type StoredConnection = Pick<WorkbookConnection, 'params' | 'paramsDraft'> & {
    /// The name of the connection, the app manifest keeps it, an imported workbook brings it along
    name?: string;
    /// Does the connection cache query results? The app manifest keeps it, absent for the default of the connector.
    cacheQueryResults?: boolean;
};

/// A connection of its stored params as the runtime creates it: active, with the draft, the name and the caching
/// choice of storage
export function connectionFromStorage(connectionId: string, stored: StoredConnection): NewConnection {
    return {
        ...decodeConnectionFromProto(stored.params as any, connectionId),
        active: true,
        params: stored.params as ConnectionParams,
        paramsDraft: stored.paramsDraft as ConnectionParams | undefined,
        name: stored.name,
        cacheQueryResults: stored.cacheQueryResults,
    };
}
