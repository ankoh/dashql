import type * as core from '@akohn/dashql';
import type { ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import type { SessionConnections } from '@akohn/dashql/platform/session/session_folder';

import { listedConnections } from '../connections/connection_tree.js';

/// What the user ticked in the menu of the agent: true for a ticked connection, false for an unticked one
export type AgentConnectionChoices = ReadonlyMap<string, boolean>;

/// May the agent use a connection? What the user ticked, else every connection but a cloud: a cloud keeps the
/// published workbooks, the agent gets it only once the user ticks it. A new connection is allowed until it is unticked.
export function isAgentConnectionAllowed(connectionId: string, choices: AgentConnectionChoices, cloudConnectionIds: readonly string[]): boolean {
    return choices.get(connectionId) ?? !cloudConnectionIds.includes(connectionId);
}

/// The connections that the agent of a session may use among the connections that the menus list
export function agentConnections(
    connections: ReadonlyMap<string, ConnectionState>,
    list: Pick<core.ConnectionListView, 'connections'> | null,
    isAllowed: (connectionId: string) => boolean,
): { listed: number; allowed: SessionConnections } {
    const listed = listedConnections(connections, list, []);
    const allowed = listed
        .filter(connection => isAllowed(connection.connectionId))
        .map(connection => ({ connectionId: connection.connectionId, name: connection.label.text }));
    return { listed: listed.length, allowed: { connections: allowed } };
}
