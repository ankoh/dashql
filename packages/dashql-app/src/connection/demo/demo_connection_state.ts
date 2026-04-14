import * as dashql from "../../core/index.js";
import * as connection from '@ankoh/dashql-jsonschema/connection.js';


import type { DetailedError } from '../connection_types.js';

import { ConnectionHealth, ConnectionState, ConnectionStateWithoutId, ConnectionStatus, createConnectionState, DELETE_CONNECTION, HEALTH_CHECK_SUCCEEDED, RESET_CONNECTION } from "../connection_state.js";
import { CONNECTOR_INFOS, ConnectorType, DEMO_CONNECTOR } from "../connector_info.js";
import { DemoDatabaseChannel } from "./demo_database_channel.js";
import { VariantKind } from '../../utils/variant.js';
import { Hasher } from "../../utils/hash.js";
import { ConnectionSignatureMap } from "../../connection/connection_signature.js";
import { StorageWriter } from "../../platform/storage/storage_writer.js";

export interface DemoConnectionStateDetails {
    /// The proto
    proto: connection.DemoConnectionDetails,
    /// The demo channel
    channel: DemoDatabaseChannel | null;
}

export function createDemoConnectionStateDetails(params?: connection.DemoParams): DemoConnectionStateDetails {
    return {
        proto: {
            setupParams: params ?? {}
        },
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
    | VariantKind<typeof RESET_CONNECTION, null>
    | VariantKind<typeof DELETE_CONNECTION, null>
    | VariantKind<typeof DEMO_CHANNEL_READY, DemoDatabaseChannel>
    | VariantKind<typeof DEMO_CHANNEL_SETUP_CANCELLED, DetailedError>
    | VariantKind<typeof DEMO_CHANNEL_SETUP_FAILED, DetailedError>
    | VariantKind<typeof HEALTH_CHECK_SUCCEEDED, null>
    ;

export function reduceDemoConnectorState(state: ConnectionState, action: DemoConnectorAction, _storage: StorageWriter): ConnectionState | null {
    const details = state.details.value as DemoConnectionStateDetails;
    let next: ConnectionState | null = null;
    switch (action.type) {
        case DELETE_CONNECTION:
        case RESET_CONNECTION:
            next = {
                ...state,
                details: {
                    type: DEMO_CONNECTOR,
                    value: {
                        ...details,
                        proto: {
                            setupParams: {}
                        }
                    }
                }
            };
            break;
        case DEMO_CHANNEL_SETUP_FAILED:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.CHANNEL_SETUP_FAILED,
                connectionHealth: ConnectionHealth.FAILED,
                details: {
                    type: DEMO_CONNECTOR,
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
        case DEMO_CHANNEL_SETUP_CANCELLED:
            next = {
                ...state,
                connectionStatus: ConnectionStatus.CHANNEL_SETUP_CANCELLED,
                connectionHealth: ConnectionHealth.CANCELLED,
                details: {
                    type: DEMO_CONNECTOR,
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
    }
    return next;
}
