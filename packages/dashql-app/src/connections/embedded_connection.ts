import type { ConnectionAllocator, ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import { newDefaultHyperWasmConnection } from '@akohn/dashql/platform/connections/connection_params';

/// The connection to the embedded Hyper of the app, if one is known
export function findEmbeddedConnection(connections: Iterable<ConnectionState>): ConnectionState | null {
    for (const connection of connections) {
        if (connection.embedded) return connection;
    }
    return null;
}

/// The connection to the embedded Hyper, allocated when none is known.
/// The embedded engine is a single database, the app holds a single connection to it.
export function embeddedConnection(connections: Iterable<ConnectionState>, allocate: ConnectionAllocator): ConnectionState {
    return findEmbeddedConnection(connections) ?? allocate(newDefaultHyperWasmConnection({ active: true }));
}

/// The connection that new workbooks start on: the connection of the latest Hyper link of the tab, otherwise the
/// embedded Hyper. A cloud is no default, the app may have several (docs/design/cloud.md).
export function newWorkbookConnection(
    connections: ReadonlyMap<string, ConnectionState>,
    allocate: ConnectionAllocator,
    linkConnectionId: string | null,
): ConnectionState {
    const linked = linkConnectionId == null ? null : connections.get(linkConnectionId);
    return linked ?? embeddedConnection(connections.values(), allocate);
}
