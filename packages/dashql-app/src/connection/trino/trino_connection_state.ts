import * as dashql from "@ankoh/dashql-core";

import { VariantKind } from '../../utils/variant.js';
import { TrinoConnectionParams } from './trino_connection_params.js';
import { ConnectorType, CONNECTOR_INFOS, TRINO_CONNECTOR } from '../connector_info.js';
import {
    ConnectionHealth,
    ConnectionStatus,
    ConnectionState,
    ConnectionStateWithoutId,
    createConnectionState,
    RESET,
    HEALTH_CHECK_CANCELLED,
    HEALTH_CHECK_FAILED,
    HEALTH_CHECK_STARTED,
    HEALTH_CHECK_SUCCEEDED,
} from '../connection_state.js';
import { TrinoChannelInterface } from "./trino_channel.js";
import { DetailedError } from "../../utils/error.js";
import { Hasher } from "../../utils/hash.js";
import { ConnectionSignatureMap, updateConnectionSignature } from "../../connection/connection_signature.js";
import { DefaultHasher } from "../../utils/hash_default.js";

export interface TrinoSetupTimings {
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

export interface TrinoConnectionStateDetails {
    /// The setup timings
    setupTimings: TrinoSetupTimings;
    /// The auth params
    channelParams: TrinoConnectionParams;
    /// The authentication error
    channelError: DetailedError | null;
    /// The channel
    channel: TrinoChannelInterface | null;
    /// The health check error
    healthCheckError: DetailedError | null;
    /// The health check error
    schemaResolutionError: DetailedError | null;
}

export function createTrinoConnectionStateDetails(params?: TrinoConnectionParams): TrinoConnectionStateDetails {
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
        channelParams: params ?? {
            channelArgs: {
                endpoint: ""
            },
            authParams: {
                username: "",
                secret: "",
            },
            metadata: [],
            catalogName: "",
            schemaNames: [],
        },
        channelError: null,
        channel: null,
        healthCheckError: null,
        schemaResolutionError: null,
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
    hasher.add(details.channelParams.channelArgs.endpoint);
    hasher.add(details.channelParams.catalogName);
    hasher.addN(details.channelParams.schemaNames);
}

export const TRINO_CHANNEL_SETUP_CANCELLED = Symbol('TRINO_CHANNEL_SETUP_CANCELLED');
export const TRINO_CHANNEL_SETUP_FAILED = Symbol('TRINO_CHANNEL_SETUP_FAILED');
export const TRINO_CHANNEL_SETUP_STARTED = Symbol('TRINO_CHANNEL_SETUP_STARTED');
export const TRINO_CHANNEL_READY = Symbol('TRINO_CHANNEL_READY');

export type TrinoConnectorAction =
    | VariantKind<typeof RESET, null>
    | VariantKind<typeof TRINO_CHANNEL_SETUP_STARTED, TrinoConnectionParams>
    | VariantKind<typeof TRINO_CHANNEL_SETUP_CANCELLED, DetailedError>
    | VariantKind<typeof TRINO_CHANNEL_SETUP_FAILED, DetailedError>
    | VariantKind<typeof TRINO_CHANNEL_READY, TrinoChannelInterface>
    | VariantKind<typeof HEALTH_CHECK_CANCELLED, DetailedError>
    | VariantKind<typeof HEALTH_CHECK_FAILED, DetailedError>
    | VariantKind<typeof HEALTH_CHECK_STARTED, null>
    | VariantKind<typeof HEALTH_CHECK_SUCCEEDED, null>
    ;

export function reduceTrinoConnectorState(state: ConnectionState, action: TrinoConnectorAction): ConnectionState | null {
    const details = state.details.value as TrinoConnectionStateDetails;
    let next: ConnectionState | null = null;
    switch (action.type) {
        case RESET:
            if (details.channel) {
                details.channel.close();
            }
            next = {
                ...state,
                details: {
                    type: TRINO_CONNECTOR,
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
                        channelParams: details.channelParams,
                        channelError: null,
                        channel: null,
                        healthCheckError: null,
                        schemaResolutionError: null,
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
        case TRINO_CHANNEL_SETUP_FAILED:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.CHANNEL_SETUP_FAILED,
                connectionHealth: ConnectionHealth.FAILED,
                details: {
                    type: TRINO_CONNECTOR,
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
        case TRINO_CHANNEL_SETUP_STARTED: {
            const details: TrinoConnectionStateDetails = {
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
                channelParams: action.value,
                channelError: null,
                channel: null,
                schemaResolutionError: null,
                healthCheckError: null,
            };
            const sig = new DefaultHasher();
            computeTrinoConnectionSignature(details, sig);
            next = {
                ...state,
                connectionStatus: ConnectionStatus.CHANNEL_SETUP_STARTED,
                connectionHealth: ConnectionHealth.CONNECTING,
                details: {
                    type: TRINO_CONNECTOR,
                    value: details,
                },
                connectionSignature: updateConnectionSignature(state.connectionSignature, sig, state.connectionId)
            };
            break;
        }
        case TRINO_CHANNEL_READY:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.CHANNEL_READY,
                connectionHealth: ConnectionHealth.CONNECTING,
                details: {
                    type: TRINO_CONNECTOR,
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
                    type: TRINO_CONNECTOR,
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
                    type: TRINO_CONNECTOR,
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
                    type: TRINO_CONNECTOR,
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
                    type: TRINO_CONNECTOR,
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
