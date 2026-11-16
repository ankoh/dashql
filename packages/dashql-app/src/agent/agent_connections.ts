import type * as core from '@ankoh/dashql';
import type { ConnectionState } from '@ankoh/dashql/platform/connections/connection_state';
import type { SessionConnections } from '@ankoh/dashql/platform/session/workbook_journal';

import { connectionLabelParts, connectionLabelText } from '../connections/connection_label.js';
import { listedConnections } from '../connections/connection_tree.js';

/// The connections that the agent of a session may use: the connections that the menus list, without the ones that the
/// user unticked. A new connection is allowed until the user unticks it.
export function agentConnections(
    connections: ReadonlyMap<string, ConnectionState>,
    list: Pick<core.ConnectionListView, 'connections'> | null,
    excluded: ReadonlySet<string>,
): { listed: number; allowed: SessionConnections } {
    const listed = listedConnections(connections, list, []);
    const allowed = listed
        .filter(connection => !excluded.has(connection.connectionId))
        .map(connection => ({ connectionId: connection.connectionId, name: connectionLabelText(connectionLabelParts(connection)) }));
    return { listed: listed.length, allowed: { connections: allowed } };
}
