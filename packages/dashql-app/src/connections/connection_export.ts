import * as connection from '@ankoh/dashql-jsonschema/connection.js';

import { ConnectionState } from "@ankoh/dashql-runtime/connections/connection_state";
import { sanitizeConnectionParamsForSharing } from '@ankoh/dashql-runtime/connections/connection_params';
import { connectorOfDetails, connectorParams } from '@ankoh/dashql-runtime/connections/connector_descriptor';

export function encodeConnectionAsProto(state: ConnectionState): connection.Connection {
    const connector = connectorOfDetails(state.details);
    const params = sanitizeConnectionParamsForSharing(state.params);
    const setupParams = connector.paramsKey in params ? connectorParams(connector, params) : undefined;
    return { [connector.paramsKey]: { setupTimings: {}, setupParams } } as connection.Connection;
}
