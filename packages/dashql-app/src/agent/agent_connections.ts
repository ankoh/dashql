import type * as core from '@akohn/dashql';
import type { ConnectionState } from '@akohn/dashql/platform/connections/connection_state';

import { listedConnections } from '../connections/connection_tree.js';

/// A connection that the agent may use, with its name
export interface AgentConnection {
    connectionId: string;
    name: string;
    /// Is it the embedded Hyper?
    embedded?: true;
}

/// What the user ticked in the menu of the agent: true for a ticked connection, false for an unticked one
export type AgentConnectionChoices = ReadonlyMap<string, boolean>;

/// May the agent use a connection on a workbook? What the user ticked, else only the default connections: the ones
/// that the workbook uses and the embedded Hyper, which post-processes the results of remote scripts. More connections
/// confuse the agent, the user ticks the others when the agent needs them.
export function isAgentConnectionAllowed(connectionId: string, choices: AgentConnectionChoices, workbookConnectionIds: readonly string[], embedded: boolean): boolean {
    return choices.get(connectionId) ?? (embedded || workbookConnectionIds.includes(connectionId));
}

/// The connections that the agent may use among the connections that the menus list
export function agentConnections(
    connections: ReadonlyMap<string, ConnectionState>,
    list: Pick<core.ConnectionListView, 'connections'> | null,
    isAllowed: (connectionId: string) => boolean,
): { listed: number; allowed: AgentConnection[] } {
    const listed = listedConnections(connections, list, []);
    const allowed = listed
        .filter(connection => isAllowed(connection.connectionId))
        .map(connection => connection.embedded
            ? { connectionId: connection.connectionId, name: connection.label.text, embedded: true as const }
            : { connectionId: connection.connectionId, name: connection.label.text });
    return { listed: listed.length, allowed };
}
