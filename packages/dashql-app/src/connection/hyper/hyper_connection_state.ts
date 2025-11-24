import * as dashql from "@ankoh/dashql-core";
import * as buf from "@bufbuild/protobuf";
import * as pb from '@ankoh/dashql-protobuf';

import { VariantKind } from '../../utils/variant.js';
import { HyperDatabaseChannel } from '../../connection/hyper/hyperdb_client.js';
import { ConnectorType, CONNECTOR_INFOS, HYPER_GRPC_CONNECTOR } from '../connector_info.js';
import {
    ConnectionHealth,
    ConnectionStatus,
    ConnectionState,
    ConnectionStateWithoutId,
    createConnectionState,
    RESET,
    HEALTH_CHECK_STARTED,
    HEALTH_CHECK_CANCELLED,
    HEALTH_CHECK_FAILED,
    HEALTH_CHECK_SUCCEEDED,
} from '../connection_state.js';
import { Hasher } from "../../utils/hash.js";
import { ConnectionSignatureMap, updateConnectionSignature } from "../../connection/connection_signature.js";
import { DefaultHasher } from "../../utils/hash_default.js";
import { dateToTimestamp } from "../../connection/proto_helper.js";

export interface HyperGrpcConnectionDetails {
    /// The protobuf
    proto: pb.dashql.connection.HyperConnectionDetails;
    /// The hyper channel
    channel: HyperDatabaseChannel | null;
}

export function createHyperGrpcConnectionStateDetails(params?: pb.dashql.connection.HyperConnectionParams): HyperGrpcConnectionDetails {
    return {
        proto: buf.create(pb.dashql.connection.HyperConnectionDetailsSchema, {
            setupTimings: buf.create(pb.dashql.connection.SetupTimingsSchema),
            setupParams: params ?? buf.create(pb.dashql.connection.HyperConnectionParamsSchema),
        }),
        channel: null
    };
}

export function createHyperGrpcConnectionState(dql: dashql.DashQL, connSigs: ConnectionSignatureMap): ConnectionStateWithoutId {
    return createConnectionState(dql, CONNECTOR_INFOS[ConnectorType.HYPER_GRPC], connSigs, {
        type: HYPER_GRPC_CONNECTOR,
        value: createHyperGrpcConnectionStateDetails()
    });
}

export function getHyperGrpcConnectionDetails(state: ConnectionState | null): HyperGrpcConnectionDetails | null {
    if (state == null) return null;
    switch (state.details.type) {
        case HYPER_GRPC_CONNECTOR: return state.details.value;
        default: return null;
    }
}

export function computeHyperGrpcConnectionSignature(details: HyperGrpcConnectionDetails, hasher: Hasher) {
    hasher.add("hyper-grpc");
    hasher.add(details.proto.setupParams?.endpoint ?? "");
}

export const HYPER_CHANNEL_SETUP_CANCELLED = Symbol('HYPER_CHANNEL_SETUP_CANCELLED');
export const HYPER_CHANNEL_SETUP_FAILED = Symbol('HYPER_CHANNEL_SETUP_FAILED');
export const HYPER_CHANNEL_SETUP_STARTED = Symbol('HYPER_CHANNEL_SETUP_STARTED');
export const HYPER_CHANNEL_READY = Symbol('HYPER_CHANNEL_READY');

export type HyperGrpcConnectorAction =
    | VariantKind<typeof RESET, null>
    | VariantKind<typeof HYPER_CHANNEL_SETUP_STARTED, pb.dashql.connection.HyperConnectionParams>
    | VariantKind<typeof HYPER_CHANNEL_SETUP_CANCELLED, pb.dashql.error.DetailedError>
    | VariantKind<typeof HYPER_CHANNEL_SETUP_FAILED, pb.dashql.error.DetailedError>
    | VariantKind<typeof HYPER_CHANNEL_READY, HyperDatabaseChannel>
    | VariantKind<typeof HEALTH_CHECK_STARTED, null>
    | VariantKind<typeof HEALTH_CHECK_CANCELLED, null>
    | VariantKind<typeof HEALTH_CHECK_FAILED, pb.dashql.error.DetailedError>
    | VariantKind<typeof HEALTH_CHECK_SUCCEEDED, null>
    ;

export function reduceHyperGrpcConnectorState(state: ConnectionState, action: HyperGrpcConnectorAction): ConnectionState | null {
    const details = state.details.value as HyperGrpcConnectionDetails;
    let next: ConnectionState | null = null;
    switch (action.type) {
        case RESET:
            if (details.channel) {
                details.channel.close();
            }
            next = {
                ...state,
                details: {
                    type: HYPER_GRPC_CONNECTOR,
                    value: {
                        ...details,
                        proto: buf.create(pb.dashql.connection.HyperConnectionDetailsSchema, {
                            ...details.proto,
                            setupTimings: buf.create(pb.dashql.connection.SetupTimingsSchema),
                            channelError: undefined,
                            healthCheckError: undefined,
                        }),
                        channel: null
                    }
                },
            };
            break;
        case HYPER_CHANNEL_SETUP_CANCELLED:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.CHANNEL_SETUP_CANCELLED,
                connectionHealth: ConnectionHealth.CANCELLED,
                details: {
                    type: HYPER_GRPC_CONNECTOR,
                    value: {
                        ...details,
                        proto: buf.create(pb.dashql.connection.HyperConnectionDetailsSchema, {
                            ...details.proto,
                            setupTimings: buf.create(pb.dashql.connection.SetupTimingsSchema, {
                                ...details.proto.setupTimings,
                                channelSetupCancelledAt: dateToTimestamp(new Date()),
                            }),
                            setupParams: details.proto.setupParams,
                            channelError: action.value,
                            healthCheckError: undefined,
                        }),
                        channel: null
                    }
                },
            };
            break;
        case HYPER_CHANNEL_SETUP_FAILED:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.CHANNEL_SETUP_FAILED,
                connectionHealth: ConnectionHealth.FAILED,
                details: {
                    type: HYPER_GRPC_CONNECTOR,
                    value: {
                        ...details,
                        proto: buf.create(pb.dashql.connection.HyperConnectionDetailsSchema, {
                            ...details.proto,
                            setupTimings: buf.create(pb.dashql.connection.SetupTimingsSchema, {
                                ...details.proto.setupTimings,
                                channelSetupFailedAt: dateToTimestamp(new Date()),
                            }),
                            channelError: action.value,
                        }),
                        channel: null
                    }
                },
            };
            break;
        case HYPER_CHANNEL_SETUP_STARTED: {
            const details: HyperGrpcConnectionDetails = {
                proto: buf.create(pb.dashql.connection.HyperConnectionDetailsSchema, {
                    setupTimings: buf.create(pb.dashql.connection.SetupTimingsSchema, {
                        channelSetupStartedAt: dateToTimestamp(new Date()),
                    }),
                    setupParams: action.value,
                    channelError: undefined,
                    healthCheckError: undefined,
                }),
                channel: null,
            };
            const sig = new DefaultHasher();
            computeHyperGrpcConnectionSignature(details, sig);
            next = {
                ...state,
                connectionStatus: ConnectionStatus.CHANNEL_SETUP_STARTED,
                connectionHealth: ConnectionHealth.CONNECTING,
                details: {
                    type: HYPER_GRPC_CONNECTOR,
                    value: details,
                },
                connectionSignature: updateConnectionSignature(state.connectionSignature, sig, state.connectionId),
            };
            break;
        }
        case HYPER_CHANNEL_READY:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.CHANNEL_READY,
                connectionHealth: ConnectionHealth.CONNECTING,
                details: {
                    type: HYPER_GRPC_CONNECTOR,
                    value: {
                        ...details,
                        proto: buf.create(pb.dashql.connection.HyperConnectionDetailsSchema, {
                            ...details.proto,
                            setupTimings: buf.create(pb.dashql.connection.SetupTimingsSchema, {
                                ...details.proto.setupTimings,
                                channelReadyAt: dateToTimestamp(new Date()),
                            }),
                        }),
                        channel: action.value,
                    }
                },
            };
            break;
        case HEALTH_CHECK_STARTED:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.HEALTH_CHECK_STARTED,
                connectionHealth: ConnectionHealth.CONNECTING,
                details: {
                    type: HYPER_GRPC_CONNECTOR,
                    value: {
                        ...details,
                        proto: buf.create(pb.dashql.connection.HyperConnectionDetailsSchema, {
                            ...details.proto,
                            setupTimings: buf.create(pb.dashql.connection.SetupTimingsSchema, {
                                ...details.proto.setupTimings,
                                healthCheckStartedAt: dateToTimestamp(new Date()),
                            }),
                        }),
                    },

                },
            };
            break;
        case HEALTH_CHECK_FAILED:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.HEALTH_CHECK_FAILED,
                connectionHealth: ConnectionHealth.FAILED,
                details: {
                    type: HYPER_GRPC_CONNECTOR,
                    value: {
                        ...details,
                        proto: buf.create(pb.dashql.connection.HyperConnectionDetailsSchema, {
                            ...details.proto,
                            setupTimings: buf.create(pb.dashql.connection.SetupTimingsSchema, {
                                ...details.proto.setupTimings,
                                healthCheckFailedAt: dateToTimestamp(new Date()),
                            }),
                            healthCheckError: action.value,
                        }),
                    }
                },
            };
            break;
        case HEALTH_CHECK_CANCELLED:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.HEALTH_CHECK_CANCELLED,
                connectionHealth: ConnectionHealth.CANCELLED,
                details: {
                    type: HYPER_GRPC_CONNECTOR,
                    value: {
                        ...details,
                        proto: buf.create(pb.dashql.connection.HyperConnectionDetailsSchema, {
                            ...details.proto,
                            setupTimings: buf.create(pb.dashql.connection.SetupTimingsSchema, {
                                ...details.proto.setupTimings,
                                healthCheckCancelledAt: dateToTimestamp(new Date()),
                            }),
                        }),
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
                    type: HYPER_GRPC_CONNECTOR,
                    value: {
                        ...details,
                        proto: buf.create(pb.dashql.connection.HyperConnectionDetailsSchema, {
                            ...details.proto,
                            setupTimings: buf.create(pb.dashql.connection.SetupTimingsSchema, {
                                ...details.proto.setupTimings,
                                healthCheckSucceededAt: dateToTimestamp(new Date()),
                            }),
                        }),
                    }
                },
            };
            break;
    }
    return next;
}
