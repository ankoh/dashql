// The messages between the page and the local agent server.
// The types are generated from the JSON Schema in proto/json/dashql/agent_bridge.json, AgentServerMethods and
// AgentClientMethods name the params and results of the methods.

import type { AgentClientMethods, ClientSessionsParams } from '@ankoh/dashql-jsonschema/agent_bridge.js';

export type * from '@ankoh/dashql-jsonschema/agent_bridge.js';

/// The version of the protocol, the server turns away other versions
export const AGENT_PROTOCOL_VERSION: ClientSessionsParams['protocol'] = 2;

/// The path of the WebSocket endpoint
export const AGENT_WEBSOCKET_PATH = '/v1/ws';

/// A notification of the server, a method without a result
export type AgentNotification = {
    [M in keyof AgentClientMethods]: AgentClientMethods[M] extends { result: unknown }
        ? never
        : { method: M; params: AgentClientMethods[M]['params'] };
}[keyof AgentClientMethods];
