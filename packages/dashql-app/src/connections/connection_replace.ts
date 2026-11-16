import type * as core from '@ankoh/dashql-core';
import { isHyperWasmConnection, isListedConnection } from './connection_label.js';
import type { ConnectionState } from '@ankoh/dashql-platform/connections/connection_state';
import { connectorInfoOf } from '@ankoh/dashql-platform/connections/connection_state';

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
    connections: ReadonlyMap<string, ConnectionState>,
    list: Pick<core.ConnectionListView, 'connections'> | null,
    sourceId: string,
): ConnectionReplaceCandidates {
    const source = connections.get(sourceId);
    const candidates: ConnectionReplaceCandidates = { sameConnector: [], otherConnectors: [] };
    if (source == null) return candidates;
    for (const [connectionId, connection] of connections) {
        if (connectionId === sourceId || !isListedConnection(list, connectionId)) continue;
        if (connection.connectorType === source.connectorType) {
            candidates.sameConnector.push(connection);
        } else {
            candidates.otherConnectors.push(connection);
        }
    }
    return candidates;
}

/// What keeps a connection from being replaced, null if it can be replaced.
///
/// A replacement moves the scripts of every workbook to the other connection and removes the
/// connection afterwards. Everything that would leave it half done blocks it up front:
///  - The embedded Hyper is the connection that workbooks fall back to, it is never removed.
///  - Running queries would lose the connection they run on.
///  - A workbook whose script changed outside the app holds its writes, its file can't follow.
export function connectionReplaceBlocker(
    connections: ReadonlyMap<string, ConnectionState>,
    list: Pick<core.ConnectionListView, 'connections'> | null,
    sourceId: string,
    isWorkbookHeld: (workbookId: string) => boolean,
): string | null {
    const source = connections.get(sourceId);
    if (source == null) return 'Unknown connection';
    if (isHyperWasmConnection(source)) return 'Workbooks fall back to it';
    const running = source.queriesActiveOrdered.length;
    if (running > 0) return `${running} ${running === 1 ? 'query' : 'queries'} running`;
    const held = source.workbooks.filter(isWorkbookHeld).length;
    if (held > 0) return `${held} ${held === 1 ? 'workbook' : 'workbooks'} changed outside the app`;
    const candidates = connectionReplaceCandidates(connections, list, sourceId);
    if (candidates.sameConnector.length + candidates.otherConnectors.length === 0) return 'No other connection';
    return null;
}
