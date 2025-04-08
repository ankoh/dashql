import * as dashql from "@ankoh/dashql-core";

import { VariantKind } from '../../utils/variant.js';
import { HyperGrpcConnectionParams } from './hyper_connection_params.js';
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
import { DetailedError } from "../../utils/error.js";

export interface HyperGrpcSetupTimings {
    /// The time when the channel setup started
    channelSetupStartedAt: Date | null;
    /// The time when the channel setup got cancelled
    channelSetupCancelledAt: Date | null;
    /// The time when the channel setup failed
    channelSetupFailedAt: Date | null;
    /// The time when the channel was marked ready
    channelReadyAt: Date | null;
    /// The time when the health check started
    healthCheckStartedAt: Date | null;
    /// The time when the health check got cancelled
    healthCheckCancelledAt: Date | null;
    /// The time when the health check failed
    healthCheckFailedAt: Date | null;
    /// The time when the health check succeeded
    healthCheckSucceededAt: Date | null;
}

export interface HyperGrpcConnectionDetails {
    /// The setup timings
    setupTimings: HyperGrpcSetupTimings;
    /// The setup params
    channelSetupParams: HyperGrpcConnectionParams;
    /// The setup error
    channelError: DetailedError | null;
    /// The hyper channel
    channel: HyperDatabaseChannel | null;
    /// The health check error
    healthCheckError: DetailedError | null;
}

export function createHyperGrpcConnectionStateDetails(params?: HyperGrpcConnectionParams): HyperGrpcConnectionDetails {
    return {
        setupTimings: {
            channelSetupStartedAt: null,
            channelSetupCancelledAt: null,
            channelSetupFailedAt: null,
            channelReadyAt: null,
            healthCheckStartedAt: null,
            healthCheckCancelledAt: null,
            healthCheckFailedAt: null,
            healthCheckSucceededAt: null,
        },
        channelSetupParams: params ?? {
            channelArgs: {
                endpoint: ""
            },
            attachedDatabases: [],
            gRPCMetadata: [],
        },
        channelError: null,
        channel: null,
        healthCheckError: null,
    };
}

export function createHyperGrpcConnectionState(dql: dashql.DashQL): ConnectionStateWithoutId {
    return createConnectionState(dql, CONNECTOR_INFOS[ConnectorType.HYPER_GRPC], {
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

export const HYPER_CHANNEL_SETUP_CANCELLED = Symbol('HYPER_CHANNEL_SETUP_CANCELLED');
export const HYPER_CHANNEL_SETUP_FAILED = Symbol('HYPER_CHANNEL_SETUP_FAILED');
export const HYPER_CHANNEL_SETUP_STARTED = Symbol('HYPER_CHANNEL_SETUP_STARTED');
export const HYPER_CHANNEL_READY = Symbol('HYPER_CHANNEL_READY');

export type HyperGrpcConnectorAction =
    | VariantKind<typeof RESET, null>
    | VariantKind<typeof HYPER_CHANNEL_SETUP_STARTED, HyperGrpcConnectionParams>
    | VariantKind<typeof HYPER_CHANNEL_SETUP_CANCELLED, DetailedError>
    | VariantKind<typeof HYPER_CHANNEL_SETUP_FAILED, DetailedError>
    | VariantKind<typeof HYPER_CHANNEL_READY, HyperDatabaseChannel>
    | VariantKind<typeof HEALTH_CHECK_STARTED, null>
    | VariantKind<typeof HEALTH_CHECK_CANCELLED, null>
    | VariantKind<typeof HEALTH_CHECK_FAILED, DetailedError>
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
                        setupTimings: {
                            channelSetupStartedAt: new Date(),
                            channelSetupCancelledAt: null,
                            channelSetupFailedAt: null,
                            channelReadyAt: null,
                            healthCheckStartedAt: null,
                            healthCheckCancelledAt: null,
                            healthCheckFailedAt: null,
                            healthCheckSucceededAt: null,
                        },
                        channelSetupParams: details.channelSetupParams,
                        channelError: null,
                        channel: null,
                        healthCheckError: null,
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
                        setupTimings: {
                            ...details.setupTimings,
                            channelSetupCancelledAt: new Date(),
                        },
                        channelError: action.value,
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
                        setupTimings: {
                            ...details.setupTimings,
                            channelSetupFailedAt: new Date(),
                        },
                        channelError: action.value,
                        channel: null
                    }
                },
            };
            break;
        case HYPER_CHANNEL_SETUP_STARTED:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.CHANNEL_SETUP_STARTED,
                connectionHealth: ConnectionHealth.CONNECTING,
                details: {
                    type: HYPER_GRPC_CONNECTOR,
                    value: {
                        ...details,
                        setupTimings: {
                            channelSetupStartedAt: new Date(),
                            channelSetupCancelledAt: null,
                            channelSetupFailedAt: null,
                            channelReadyAt: null,
                            healthCheckStartedAt: null,
                            healthCheckCancelledAt: null,
                            healthCheckFailedAt: null,
                            healthCheckSucceededAt: null,
                        },
                        channelSetupParams: action.value,
                        channelError: null,
                        channel: null,
                        healthCheckError: null,
                    }
                },
            };
            break;
        case HYPER_CHANNEL_READY:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.CHANNEL_READY,
                connectionHealth: ConnectionHealth.CONNECTING,
                details: {
                    type: HYPER_GRPC_CONNECTOR,
                    value: {
                        ...details,
                        setupTimings: {
                            ...details.setupTimings,
                            channelReadyAt: new Date(),
                        },
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
                    type: HYPER_GRPC_CONNECTOR,
                    value: {
                        ...details,
                        setupTimings: {
                            ...details.setupTimings,
                            healthCheckStartedAt: new Date(),
                        },
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
                    type: HYPER_GRPC_CONNECTOR,
                    value: {
                        ...details,
                        setupTimings: {
                            ...details.setupTimings,
                            healthCheckFailedAt: new Date(),
                        },
                        healthCheckError: action.value,
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
                        setupTimings: {
                            ...details.setupTimings,
                            healthCheckCancelledAt: new Date(),
                        },
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
                        setupTimings: {
                            ...details.setupTimings,
                            healthCheckSucceededAt: new Date(),
                        },
                    }
                },
            };
            break;
    }
    return next;
}
