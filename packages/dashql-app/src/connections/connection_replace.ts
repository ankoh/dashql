import { isHyperWasmConnection } from './connection_label.js';
import { isListedConnection, type ConnectionReferences, type ConnectionRegistry } from './connection_registry.js';
import type { ConnectionState } from './connection_state.js';

/// The connections that can replace a connection, grouped by their connector
export interface ConnectionReplaceCandidates {
    /// The connections of the same connector
    sameConnector: ConnectionState[];
    /// The connections of other connectors
    otherConnectors: ConnectionState[];
}

/// The connections that can replace a connection.
///
/// Every other listed connection can, the user can't see the others. The connections of the same
/// connector come first, they are the likely replacements.
export function connectionReplaceCandidates(
    registry: Pick<ConnectionRegistry, 'connections'>,
    references: ConnectionReferences,
    sourceId: string,
): ConnectionReplaceCandidates {
    const source = registry.connections.get(sourceId);
    const candidates: ConnectionReplaceCandidates = { sameConnector: [], otherConnectors: [] };
    if (source == null) return candidates;
    for (const [connectionId, connection] of registry.connections) {
        if (connectionId === sourceId || !isListedConnection(registry, references, connectionId)) continue;
        if (connection.connectorInfo.connectorType === source.connectorInfo.connectorType) {
            candidates.sameConnector.push(connection);
        } else {
            candidates.otherConnectors.push(connection);
        }
    }
    return candidates;
}

/// What keeps a connection from being replaced, null if it can be replaced.
///
/// A replacement moves the scripts of every session to the other connection and removes the
/// connection afterwards. Everything that would leave it half done blocks it up front:
///  - The embedded Hyper is the connection that sessions fall back to, it is never removed.
///  - Running queries would lose the connection they run on.
///  - A session whose script changed outside the app holds its writes, its file can't follow.
export function connectionReplaceBlocker(
    registry: Pick<ConnectionRegistry, 'connections'>,
    references: ConnectionReferences,
    sourceId: string,
    isSessionHeld: (sessionId: string) => boolean,
): string | null {
    const source = registry.connections.get(sourceId);
    if (source == null) return 'Unknown connection';
    if (isHyperWasmConnection(source)) return 'Sessions fall back to it';
    const running = source.queriesActiveOrdered.length;
    if (running > 0) return `${running} ${running === 1 ? 'query' : 'queries'} running`;
    const held = references.sessionsOf(sourceId).filter(isSessionHeld).length;
    if (held > 0) return `${held} ${held === 1 ? 'session' : 'sessions'} changed outside the app`;
    const candidates = connectionReplaceCandidates(registry, references, sourceId);
    if (candidates.sameConnector.length + candidates.otherConnectors.length === 0) return 'No other connection';
    return null;
}
