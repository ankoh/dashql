import { connectionParamsShareEqual } from '@ankoh/dashql/platform/connections/connection_params';
import type * as core from '@ankoh/dashql';
import { isListedConnection } from './connection_label.js';
import type { ConnectionState } from '@ankoh/dashql/platform/connections/connection_state';
import { connectorInfoOf } from '@ankoh/dashql/platform/connections/connection_state';

/// The connections that can be merged into a connection.
///
/// A candidate describes the same database as the target: same connector and the same params,
/// ignoring secrets, the rule that imports consolidate connections with. Only listed connections
/// are candidates, the user can't see the others.
export function connectionMergeCandidates(
    connections: ReadonlyMap<string, ConnectionState>,
    list: Pick<core.ConnectionListView, 'connections' | 'connectionsByType'> | null,
    targetId: string,
): ConnectionState[] {
    const target = connections.get(targetId);
    if (target == null) return [];
    return (list?.connectionsByType[target.connectorType] ?? [])
        .filter(connectionId => connectionId !== targetId && isListedConnection(list, connectionId) && connections.has(connectionId))
        .map(connectionId => connections.get(connectionId)!)
        .filter(candidate => connectionParamsShareEqual(candidate.params, target.params));
}
