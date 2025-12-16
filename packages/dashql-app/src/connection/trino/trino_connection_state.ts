import * as dashql from "@ankoh/dashql-core";
import * as buf from "@bufbuild/protobuf";
import * as pb from "@ankoh/dashql-protobuf";

import { VariantKind } from '../../utils/variant.js';
import { ConnectorType, CONNECTOR_INFOS, TRINO_CONNECTOR } from '../connector_info.js';
import {
    ConnectionHealth,
    ConnectionStatus,
    ConnectionState,
    ConnectionStateWithoutId,
    createConnectionState,
    HEALTH_CHECK_CANCELLED,
    HEALTH_CHECK_FAILED,
    HEALTH_CHECK_STARTED,
    HEALTH_CHECK_SUCCEEDED,
    RESET_CONNECTION,
    DELETE_CONNECTION,
} from '../connection_state.js';
import { TrinoChannelInterface } from "./trino_channel.js";
import { Hasher } from "../../utils/hash.js";
import { ConnectionSignatureMap, updateConnectionSignature } from "../../connection/connection_signature.js";
import { DefaultHasher } from "../../utils/hash_default.js";
import { dateToTimestamp } from "../../connection/proto_helper.js";
import { StorageWriter } from "../../storage/storage_writer.js";

export interface TrinoConnectionStateDetails {
    /// The proto
    proto: pb.dashql.connection.TrinoConnectionDetails;
    /// The channel
    channel: TrinoChannelInterface | null;
}

export function createTrinoConnectionStateDetails(params?: pb.dashql.connection.TrinoConnectionParams): TrinoConnectionStateDetails {
    return {
        proto: buf.create(pb.dashql.connection.TrinoConnectionDetailsSchema, {
            setupTimings: buf.create(pb.dashql.connection.SetupTimingsSchema),
            setupParams: params ?? buf.create(pb.dashql.connection.TrinoConnectionParamsSchema),
        }),
        channel: null
    };
}

export function createTrinoConnectionState(dql: dashql.DashQL, connSigs: ConnectionSignatureMap): ConnectionStateWithoutId {
    return createConnectionState(dql, CONNECTOR_INFOS[ConnectorType.TRINO], connSigs, {
        type: TRINO_CONNECTOR,
        value: createTrinoConnectionStateDetails(),
    });
}

export function getTrinoConnectionDetails(state: ConnectionState | null): TrinoConnectionStateDetails | null {
    if (state == null) return null;
    switch (state.details.type) {
        case TRINO_CONNECTOR: return state.details.value;
        default: return null;
    }
}

export function computeTrinoConnectionSignature(details: TrinoConnectionStateDetails, hasher: Hasher) {
    hasher.add("trino");
    hasher.add(details.proto.setupParams?.endpoint ?? "");
    hasher.add(details.proto.setupParams?.catalogName ?? "");
    hasher.add((details.proto.setupParams?.schemaNames ?? []).toString());
}

export const TRINO_CHANNEL_SETUP_CANCELLED = Symbol('TRINO_CHANNEL_SETUP_CANCELLED');
export const TRINO_CHANNEL_SETUP_FAILED = Symbol('TRINO_CHANNEL_SETUP_FAILED');
export const TRINO_CHANNEL_SETUP_STARTED = Symbol('TRINO_CHANNEL_SETUP_STARTED');
export const TRINO_CHANNEL_READY = Symbol('TRINO_CHANNEL_READY');

export type TrinoConnectorAction =
    | VariantKind<typeof RESET_CONNECTION, null>
    | VariantKind<typeof DELETE_CONNECTION, null>
    | VariantKind<typeof TRINO_CHANNEL_SETUP_STARTED, pb.dashql.connection.TrinoConnectionParams>
    | VariantKind<typeof TRINO_CHANNEL_SETUP_CANCELLED, pb.dashql.error.DetailedError>
    | VariantKind<typeof TRINO_CHANNEL_SETUP_FAILED, pb.dashql.error.DetailedError>
    | VariantKind<typeof TRINO_CHANNEL_READY, TrinoChannelInterface>
    | VariantKind<typeof HEALTH_CHECK_CANCELLED, pb.dashql.error.DetailedError>
    | VariantKind<typeof HEALTH_CHECK_FAILED, pb.dashql.error.DetailedError>
    | VariantKind<typeof HEALTH_CHECK_STARTED, null>
    | VariantKind<typeof HEALTH_CHECK_SUCCEEDED, null>
    ;

export function reduceTrinoConnectorState(state: ConnectionState, action: TrinoConnectorAction, _storage: StorageWriter): ConnectionState | null {
    const details = state.details.value as TrinoConnectionStateDetails;
    let next: ConnectionState | null = null;
    switch (action.type) {
        case DELETE_CONNECTION:
        case RESET_CONNECTION:
            details.channel?.close();
            next = {
                ...state,
                details: {
                    type: TRINO_CONNECTOR,
                    value: {
                        ...details,
                        proto: buf.create(pb.dashql.connection.TrinoConnectionDetailsSchema, {
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
        case TRINO_CHANNEL_SETUP_CANCELLED:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.CHANNEL_SETUP_CANCELLED,
                connectionHealth: ConnectionHealth.CANCELLED,
                details: {
                    type: TRINO_CONNECTOR,
                    value: {
                        ...details,
                        proto: buf.create(pb.dashql.connection.TrinoConnectionDetailsSchema, {
                            ...details.proto,
                            setupTimings: buf.create(pb.dashql.connection.SetupTimingsSchema, {
                                ...details.proto.setupTimings,
                                channelSetupCancelledAt: dateToTimestamp(new Date()),
                            }),
                        }),
                        channel: null
                    }
                },
            };
            break;
        case TRINO_CHANNEL_SETUP_STARTED: {
            const newDetails: TrinoConnectionStateDetails = {
                ...details,
                proto: buf.create(pb.dashql.connection.TrinoConnectionDetailsSchema, {
                    ...details.proto,
                    setupTimings: buf.create(pb.dashql.connection.SetupTimingsSchema, {
                        channelSetupStartedAt: dateToTimestamp(new Date()),
                    }),
                    setupParams: action.value,
                    channelError: undefined,
                    schemaResolutionError: undefined,
                    healthCheckError: undefined,
                }),
                channel: null
            };
            const sig = new DefaultHasher();
            computeTrinoConnectionSignature(newDetails, sig);
            next = {
                ...state,
                connectionStatus: ConnectionStatus.CHANNEL_SETUP_STARTED,
                connectionHealth: ConnectionHealth.CONNECTING,
                details: {
                    type: TRINO_CONNECTOR,
                    value: newDetails,
                },
                connectionSignature: updateConnectionSignature(state.connectionSignature, sig, state.connectionId)
            };
            break;
        }
        case TRINO_CHANNEL_SETUP_FAILED:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.CHANNEL_SETUP_FAILED,
                connectionHealth: ConnectionHealth.FAILED,
                details: {
                    type: TRINO_CONNECTOR,
                    value: {
                        ...details,
                        proto: buf.create(pb.dashql.connection.TrinoConnectionDetailsSchema, {
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
        case TRINO_CHANNEL_READY:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.CHANNEL_READY,
                connectionHealth: ConnectionHealth.CONNECTING,
                details: {
                    type: TRINO_CONNECTOR,
                    value: {
                        ...details,
                        proto: buf.create(pb.dashql.connection.TrinoConnectionDetailsSchema, {
                            ...details.proto,
                            setupTimings: buf.create(pb.dashql.connection.SetupTimingsSchema, {
                                ...details.proto.setupTimings,
                                channelReadyAt: dateToTimestamp(new Date()),
                            }),
                        }),
                        channel: action.value
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
                    type: TRINO_CONNECTOR,
                    value: {
                        ...details,
                        proto: buf.create(pb.dashql.connection.TrinoConnectionDetailsSchema, {
                            ...details.proto,
                            setupTimings: buf.create(pb.dashql.connection.SetupTimingsSchema, {
                                ...details.proto.setupTimings,
                                healthCheckStartedAt: dateToTimestamp(new Date()),
                            }),
                        }),
                    }
                },
            };
            break;
        case HEALTH_CHECK_FAILED:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.HEALTH_CHECK_FAILED,
                connectionHealth: ConnectionHealth.FAILED,
                details: {
                    type: TRINO_CONNECTOR,
                    value: {
                        ...details,
                        proto: buf.create(pb.dashql.connection.TrinoConnectionDetailsSchema, {
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
                    type: TRINO_CONNECTOR,
                    value: {
                        ...details,
                        proto: buf.create(pb.dashql.connection.TrinoConnectionDetailsSchema, {
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
                    type: TRINO_CONNECTOR,
                    value: {
                        ...details,
                        proto: buf.create(pb.dashql.connection.TrinoConnectionDetailsSchema, {
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
