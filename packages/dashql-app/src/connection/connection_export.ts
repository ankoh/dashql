import * as connection from '@ankoh/dashql-jsonschema/connection.js';

import { ConnectionState } from "./connection_state.js";
import { DATALESS_CONNECTOR, DEMO_CONNECTOR, HYPER_CONNECTOR, SALESFORCE_DATA_CLOUD_CONNECTOR, TRINO_CONNECTOR } from './connector_info.js';

export function encodeConnectionAsProto(state: ConnectionState): connection.Connection {
    switch (state.details.type) {
        case DATALESS_CONNECTOR:
            return {
                dataless: { message: "" }
            };
        case DEMO_CONNECTOR:
            return {
                demo: state.details.value.proto,
            };
        case SALESFORCE_DATA_CLOUD_CONNECTOR:
            return {
                salesforce: state.details.value.proto,
            };
        case HYPER_CONNECTOR:
            return {
                hyper: state.details.value.proto,
            };
        case TRINO_CONNECTOR:
            return {
                trino: state.details.value.proto,
            };
    }
}
