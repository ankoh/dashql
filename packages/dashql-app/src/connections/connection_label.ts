import type * as core from '@akohn/dashql';

import type { ConnectionState } from '@akohn/dashql/platform/connections/connection_state';

/// The label of a connection, its name and the protocol it speaks, as the runtime gives it
export type ConnectionLabelParts = core.ConnectionLabel;

/// The labels of the connections of the list of the runtime (`connectionList`) by id, with the ordinals that tell the
/// listed connections of a connector apart
export function connectionLabels(list: Pick<core.ConnectionListView, 'connections'> | null | undefined): Map<string, ConnectionLabelParts> {
    return new Map((list?.connections ?? []).map(entry => [entry.connectionId, entry.label]));
}

/// The label of a connection: the one of the list with its ordinal, the label of the connection outside of a list
export function connectionLabelOf(connection: Pick<ConnectionState, 'connectionId' | 'label'>, labels: ReadonlyMap<string, ConnectionLabelParts>): ConnectionLabelParts {
    return labels.get(connection.connectionId) ?? connection.label;
}

/// Is a connection listed next to the workbooks? Connections that workbooks use are, as are active ones.
export function isListedConnection(list: Pick<core.ConnectionListView, 'connections'> | null | undefined, connectionId: string): boolean {
    return list?.connections.some(entry => entry.connectionId === connectionId && entry.listed) ?? false;
}
