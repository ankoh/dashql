import * as dashql from "../../core/index.js";
import * as connection from '@ankoh/dashql-jsonschema/connection.js';

import type { DetailedError } from '../connection_types.js';

import { ConnectionHealth, ConnectionState, ConnectionStateWithoutId, ConnectionStatus, createConnectionState, DELETE_CONNECTION, HEALTH_CHECK_SUCCEEDED, RESET_CONNECTION } from "../connection_state.js";
import { CONNECTOR_INFOS, ConnectorType, DATALESS_CONNECTOR, createDatalessConnectorInfo } from "../connector_info.js";
import { DemoDatabaseChannel } from "./dataless_demo_channel.js";
import { VariantKind } from '../../utils/variant.js';
import { Hasher } from "../../utils/hash.js";
import { ConnectionSignatureMap } from "../../connection/connection_signature.js";
import { StorageWriter } from "../../platform/storage/storage_writer.js";

export interface DatalessConnectionStateDetails {
    /// The proto
    proto: connection.DatalessConnectionDetails,
    /// The demo channel (only populated when demoMode is enabled)
    channel: DemoDatabaseChannel | null;
}

export function createDatalessConnectionStateDetails(params?: connection.DatalessParams): DatalessConnectionStateDetails {
    return {
        proto: {
            setupParams: params ?? {}
        },
        channel: null,
    };
}

export function isDemoMode(details: DatalessConnectionStateDetails): boolean {
    return details.proto.setupParams?.demoMode === true;
}

export function isEphemeral(details: DatalessConnectionStateDetails): boolean {
    return details.proto.setupParams?.ephemeral === true;
}

export function createDatalessConnectionState(dql: dashql.DashQL, connSigs: ConnectionSignatureMap, opts: { demoMode?: boolean; ephemeral?: boolean } = {}): ConnectionStateWithoutId {
    const { demoMode = false, ephemeral = false } = opts;
    const params: connection.DatalessParams = { demoMode: demoMode || undefined, ephemeral: ephemeral || undefined };
    const details = createDatalessConnectionStateDetails(params);
    const connInfo = createDatalessConnectorInfo(demoMode, ephemeral);
    const state = createConnectionState(dql, connInfo, connSigs, {
        type: DATALESS_CONNECTOR,
        value: details,
    });
    if (!demoMode) {
        // Non-demo dataless connections are immediately online
        state.connectionStatus = ConnectionStatus.CHANNEL_READY;
        state.connectionHealth = ConnectionHealth.ONLINE;
    }
    return state;
}

export function computeDatalessConnectionSignature(details: DatalessConnectionStateDetails, hasher: Hasher) {
    hasher.add("dataless");
    if (isDemoMode(details)) {
        hasher.add("demo");
    }
}

export const DATALESS_CHANNEL_READY = Symbol('DATALESS_CHANNEL_READY');
export const DATALESS_CHANNEL_SETUP_FAILED = Symbol('DATALESS_CHANNEL_SETUP_FAILED');
export const DATALESS_CHANNEL_SETUP_CANCELLED = Symbol('DATALESS_CHANNEL_SETUP_CANCELLED');
export const DATALESS_SET_DEMO_MODE = Symbol('DATALESS_SET_DEMO_MODE');
export const DATALESS_SET_EPHEMERAL = Symbol('DATALESS_SET_EPHEMERAL');

export type DatalessConnectorAction =
    | VariantKind<typeof RESET_CONNECTION, null>
    | VariantKind<typeof DELETE_CONNECTION, null>
    | VariantKind<typeof DATALESS_CHANNEL_READY, DemoDatabaseChannel>
    | VariantKind<typeof DATALESS_CHANNEL_SETUP_CANCELLED, DetailedError>
    | VariantKind<typeof DATALESS_CHANNEL_SETUP_FAILED, DetailedError>
    | VariantKind<typeof HEALTH_CHECK_SUCCEEDED, null>
    | VariantKind<typeof DATALESS_SET_DEMO_MODE, boolean>
    | VariantKind<typeof DATALESS_SET_EPHEMERAL, boolean>
    ;

export function reduceDatalessConnectorState(state: ConnectionState, action: DatalessConnectorAction, _storage: StorageWriter): ConnectionState | null {
    const details = state.details.value as DatalessConnectionStateDetails;
    let next: ConnectionState | null = null;
    switch (action.type) {
        case DELETE_CONNECTION:
        case RESET_CONNECTION:
            next = {
                ...state,
                details: {
                    type: DATALESS_CONNECTOR,
                    value: {
                        ...details,
                        proto: {
                            setupParams: details.proto.setupParams ?? {}
                        }
                    }
                }
            };
            break;
        case DATALESS_CHANNEL_SETUP_FAILED:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.CHANNEL_SETUP_FAILED,
                connectionHealth: ConnectionHealth.FAILED,
                details: {
                    type: DATALESS_CONNECTOR,
                    value: {
                        ...details,
                        proto: {
                            ...details.proto,
                            channelError: action.value,
                        },
                        channel: null
                    }
                },
            };
            break;
        case DATALESS_CHANNEL_SETUP_CANCELLED:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.CHANNEL_SETUP_CANCELLED,
                connectionHealth: ConnectionHealth.CANCELLED,
                details: {
                    type: DATALESS_CONNECTOR,
                    value: {
                        ...details,
                        proto: {
                            ...details.proto,
                            channelError: action.value,
                        },
                        channel: null
                    }
                },
            };
            break;
        case DATALESS_CHANNEL_READY:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.CHANNEL_READY,
                connectionHealth: ConnectionHealth.CONNECTING,
                details: {
                    type: DATALESS_CONNECTOR,
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
                    type: DATALESS_CONNECTOR,
                    value: {
                        ...details,
                    }
                },
            };
            break;
        case DATALESS_SET_DEMO_MODE: {
            const newDemoMode = action.value;
            const ephemeral = isEphemeral(details);
            const newParams: connection.DatalessParams = {
                ...details.proto.setupParams,
                demoMode: newDemoMode || undefined,
            };
            next = {
                ...state,
                connectorInfo: createDatalessConnectorInfo(newDemoMode, ephemeral),
                connectionStatus: newDemoMode ? ConnectionStatus.NOT_STARTED : ConnectionStatus.CHANNEL_READY,
                connectionHealth: newDemoMode ? ConnectionHealth.NOT_STARTED : ConnectionHealth.ONLINE,
                details: {
                    type: DATALESS_CONNECTOR,
                    value: {
                        proto: {
                            setupParams: newParams,
                        },
                        channel: null,
                    }
                },
            };
            break;
        }
        case DATALESS_SET_EPHEMERAL: {
            // Only allowed before the connection has been set up
            if (state.connectionStatus !== ConnectionStatus.NOT_STARTED) {
                return state;
            }
            const newEphemeral = action.value;
            const demoMode = isDemoMode(details);
            const newParams: connection.DatalessParams = {
                ...details.proto.setupParams,
                ephemeral: newEphemeral || undefined,
            };
            next = {
                ...state,
                connectorInfo: createDatalessConnectorInfo(demoMode, newEphemeral),
                details: {
                    type: DATALESS_CONNECTOR,
                    value: {
                        proto: {
                            setupParams: newParams,
                        },
                        channel: details.channel,
                    }
                },
            };
            break;
        }
    }
    return next;
}
