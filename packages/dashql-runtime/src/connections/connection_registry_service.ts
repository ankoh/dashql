import type { Logger } from '../platform/logger/logger.js';
import { Store, UpdateQueue, type UpdateScheduler } from '../store/store.js';
import { groupConnectionEntryWrites, WRITE_CONNECTION_ENTRY, type StorageWriter } from '../storage/storage_writer.js';
import { QUERY_PROGRESS_UPDATED, QUERY_RECEIVED_BATCH } from '../query/query_execution_state.js';
import { CONNECTOR_TYPES } from './connector_info.js';
import type { ConnectionAction, ConnectionState, ConnectionStateWithoutId } from './connection_state.js';
import {
    applyConnectionAction,
    connectionEntryFromState,
    registerConnection,
    type ConnectionReferences,
    type ConnectionRegistry,
} from './connection_registry_state.js';

export interface ConnectionRegistryDependencies {
    logger: Logger;
    storageWriter: StorageWriter;
    /// The workbooks that use the connections
    references: ConnectionReferences;
}

/// The empty registry of connections
export function emptyConnectionRegistry(): ConnectionRegistry {
    return { connections: new Map(), connectionsByType: CONNECTOR_TYPES.map(() => []) };
}

/// Holds the connections. Registry updates free Wasm objects and schedule storage writes, the store runs every update
/// once, and the actions of all callers are applied in order through one queue.
export class ConnectionRegistryService {
    readonly store: Store<ConnectionRegistry>;
    readonly queue: UpdateQueue<ConnectionRegistry>;
    protected deps: ConnectionRegistryDependencies;

    constructor(deps: ConnectionRegistryDependencies, scheduler: UpdateScheduler) {
        this.deps = deps;
        this.store = new Store(emptyConnectionRegistry());
        this.queue = new UpdateQueue(this.store, scheduler);
    }

    setDependencies(deps: ConnectionRegistryDependencies): void {
        this.deps = deps;
    }

    /// Apply an action to a connection, nothing without an id
    dispatch = (connectionId: string | null, action: ConnectionAction): void => {
        if (connectionId == null) return;
        // Arrow batches are decoded and the states updated on the thread of the app. A fast result stream would
        // enqueue a microtask cascade that renders the workbook again and again before a frame is painted. The
        // progress of a stream is applied once per frame; the other actions apply the queued ones first, in order.
        const waitForFrame = action.type === QUERY_PROGRESS_UPDATED || action.type === QUERY_RECEIVED_BATCH;
        const { references, storageWriter, logger } = this.deps;
        this.queue.push(reg => applyConnectionAction(reg, references, connectionId, action, storageWriter, logger), waitForFrame);
    };

    /// Register a new connection that no workbook references yet, with a fixed id or a new one.
    /// A workbook references the connection once its scripts use it. Active connections are written into the app
    /// manifest right away.
    allocate = (state: ConnectionStateWithoutId, fixedId?: string): ConnectionState => {
        const connectionId = fixedId ?? crypto.randomUUID();
        const connection: ConnectionState = { ...state, connectionId };
        this.store.update(reg => {
            registerConnection(reg, connection);
            return { ...reg };
        });
        if (connection.active) {
            void this.deps.storageWriter.write(
                groupConnectionEntryWrites(connectionId),
                { type: WRITE_CONNECTION_ENTRY, value: { ...connectionEntryFromState(connection), createdAt: new Date().toISOString() } },
            );
        }
        return connection;
    };

    /// Stop applying queued updates
    dispose(): void {
        this.queue.dispose();
    }
}
