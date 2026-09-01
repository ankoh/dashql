import * as connection from '@ankoh/dashql-jsonschema/connection.js';

import { AttachedDatabaseState } from "./attached_database_state.js";
import { HYPER_CONNECTOR, SALESFORCE_DATA_CLOUD_CONNECTOR, TRINO_CONNECTOR } from './connector_info.js';

export function encodeConnectionAsProto(state: AttachedDatabaseState): connection.Connection {
    switch (state.details.type) {
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
