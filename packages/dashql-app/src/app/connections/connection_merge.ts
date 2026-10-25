import { connectionCatalogIsDurable, connectionParamsShareEqual } from './connection_params.js';
import { isListedConnection, type ConnectionReferences, type ConnectionRegistry } from './connection_registry.js';
import { isConnectionOpen, type ConnectionState } from './connection_state.js';

/// The connections that can be merged into a connection.
///
/// A candidate describes the same database as the target: same connector and the same params,
/// ignoring secrets, the rule that imports consolidate connections with. Only listed connections
/// are candidates, the user can't see the others.
export function connectionMergeCandidates(
    registry: Pick<ConnectionRegistry, 'connections' | 'connectionsByType'>,
    references: ConnectionReferences,
    targetId: string,
): ConnectionState[] {
    const target = registry.connections.get(targetId);
    if (target == null) return [];
    return registry.connectionsByType[target.connectorInfo.connectorType]
        .filter(connectionId => connectionId !== targetId && isListedConnection(registry, references, connectionId))
        .map(connectionId => registry.connections.get(connectionId)!)
        .filter(candidate => connectionParamsShareEqual(candidate.params, target.params));
}

/// Can a connection be merged into another one?
/// Only disconnected connections are merged, nothing runs on them while their sessions move. The
/// embedded database is the exception: it is connected right away and holds nothing that outlives
/// the app, so its sessions can always move.
export function canMergeConnection(database: ConnectionState): boolean {
    return !isConnectionOpen(database.connectionHealth) || !connectionCatalogIsDurable(database.params);
}
