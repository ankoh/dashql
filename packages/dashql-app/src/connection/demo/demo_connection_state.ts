import * as dashql from "@ankoh/dashql-core";
import * as pb from "@ankoh/dashql-protobuf";
import * as buf from "@bufbuild/protobuf";

import { ConnectionHealth, ConnectionState, ConnectionStateWithoutId, ConnectionStatus, createConnectionState, HEALTH_CHECK_SUCCEEDED, RESET } from "../connection_state.js";
import { CONNECTOR_INFOS, ConnectorType, DEMO_CONNECTOR } from "../connector_info.js";
import { DemoDatabaseChannel } from "./demo_database_channel.js";
import { VariantKind } from '../../utils/variant.js';
import { Hasher } from "../../utils/hash.js";
import { ConnectionSignatureMap } from "../../connection/connection_signature.js";
import { StorageWriter } from "platform/storage_writer.js";

export interface DemoConnectionStateDetails {
    /// The proto
    proto: pb.dashql.connection.DemoConnectionDetails,
    /// The demo channel
    channel: DemoDatabaseChannel | null;
}

export function createDemoConnectionStateDetails(params?: pb.dashql.connection.DemoParams): DemoConnectionStateDetails {
    return {
        proto: buf.create(pb.dashql.connection.DemoConnectionDetailsSchema, {
            setupParams: params

        }),
        channel: null,
    };
}

export function createDemoConnectionState(dql: dashql.DashQL, connSigs: ConnectionSignatureMap): ConnectionStateWithoutId {
    const details = createDemoConnectionStateDetails();
    const state = createConnectionState(dql, CONNECTOR_INFOS[ConnectorType.DEMO], connSigs, {
        type: DEMO_CONNECTOR,
        value: details,
    });
    return state;
}

export function computeDemoConnectionSignature(_details: DemoConnectionStateDetails, hasher: Hasher) {
    hasher.add("demo");
}

export const DEMO_CHANNEL_READY = Symbol('DEMO_CHANNEL_READY');
export const DEMO_CHANNEL_SETUP_FAILED = Symbol('DEMO_CHANNEL_SETUP_FAILED');
export const DEMO_CHANNEL_SETUP_CANCELLED = Symbol('DEMO_CHANNEL_SETUP_CANCELLED');

export type DemoConnectorAction =
    | VariantKind<typeof RESET, null>
    | VariantKind<typeof DEMO_CHANNEL_READY, DemoDatabaseChannel>
    | VariantKind<typeof DEMO_CHANNEL_SETUP_CANCELLED, pb.dashql.error.DetailedError>
    | VariantKind<typeof DEMO_CHANNEL_SETUP_FAILED, pb.dashql.error.DetailedError>
    | VariantKind<typeof HEALTH_CHECK_SUCCEEDED, null>
    ;

export function reduceDemoConnectorState(state: ConnectionState, action: DemoConnectorAction, _storage: StorageWriter): ConnectionState | null {
    const details = state.details.value as DemoConnectionStateDetails;
    let next: ConnectionState | null = null;
    switch (action.type) {
        case DEMO_CHANNEL_SETUP_FAILED:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.CHANNEL_SETUP_FAILED,
                connectionHealth: ConnectionHealth.FAILED,
                details: {
                    type: DEMO_CONNECTOR,
                    value: {
                        ...details,
                        proto: buf.create(pb.dashql.connection.DemoConnectionDetailsSchema, {
                            ...details.proto,
                            channelError: action.value,
                        }),
                        channel: null
                    }
                },
            };
            break;
        case DEMO_CHANNEL_SETUP_CANCELLED:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.CHANNEL_SETUP_CANCELLED,
                connectionHealth: ConnectionHealth.CANCELLED,
                details: {
                    type: DEMO_CONNECTOR,
                    value: {
                        ...details,
                        proto: buf.create(pb.dashql.connection.DemoConnectionDetailsSchema, {
                            ...details.proto,
                            channelError: action.value,
                        }),
                        channel: null
                    }
                },
            };
            break;
        case DEMO_CHANNEL_READY:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.CHANNEL_READY,
                connectionHealth: ConnectionHealth.CONNECTING,
                details: {
                    type: DEMO_CONNECTOR,
                    value: {
                        ...details,
                        channel: action.value,
                    }
                },
            };
            break;
        case HEALTH_CHECK_SUCCEEDED:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.HEALTH_CHECK_SUCCEEDED,
                connectionHealth: ConnectionHealth.ONLINE,
                details: {
                    type: DEMO_CONNECTOR,
                    value: {
                        ...details,
                    }
                },
            };
            break;
        case RESET:
            next = {
                ...state,
                details: {
                    type: DEMO_CONNECTOR,
                    value: {
                        ...details,
                        proto: buf.create(pb.dashql.connection.DemoConnectionDetailsSchema)
                    }
                }
            };
            break;
    }
    return next;
}
