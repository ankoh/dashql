import * as pb from '@ankoh/dashql-protobuf';
import * as buf from "@bufbuild/protobuf";

import { ConnectionState } from "./connection_state.js";
import { DATALESS_CONNECTOR, DEMO_CONNECTOR, HYPER_GRPC_CONNECTOR, SALESFORCE_DATA_CLOUD_CONNECTOR, TRINO_CONNECTOR } from './connector_info.js';

type ConnectionDetailsProto = pb.dashql.connection.Connection['details'];

export function encodeConnectionAsProto(state: ConnectionState): pb.dashql.connection.Connection {

    let details: ConnectionDetailsProto | null = null;
    switch (state.details.type) {
        case DATALESS_CONNECTOR:
            details = {
                case: "dataless",
                value: buf.create(pb.google_protobuf.empty.EmptySchema),
            };
            break;
        case DEMO_CONNECTOR:
            details = {
                case: "demo",
                value: state.details.value.proto,
            };
            break;
        case SALESFORCE_DATA_CLOUD_CONNECTOR:
            details = {
                case: "salesforce",
                value: state.details.value.proto,
            };
            break;
        case HYPER_GRPC_CONNECTOR:
            details = {
                case: "hyper",
                value: state.details.value.proto,
            };
            break;
        case TRINO_CONNECTOR:
            details = {
                case: "trino",
                value: state.details.value.proto,
            };
            break;
    }

    return buf.create(pb.dashql.connection.ConnectionSchema, {
        details
    });
}
