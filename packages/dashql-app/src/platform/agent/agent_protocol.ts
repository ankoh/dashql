// The messages between the page and the local agent server.
// The types are generated from the JSON Schema in proto/json/dashql/agent_bridge.json.
// The agent server lists the methods with their params and results in packages/dashql-cli/src/agent/protocol.rs.

export type * from '@ankoh/dashql-jsonschema/agent_bridge.js';

/// The version of the protocol, the server turns away other versions
export const AGENT_PROTOCOL_VERSION = 2;

/// The default port of the agent server
export const DEFAULT_AGENT_PORT = 47100;
