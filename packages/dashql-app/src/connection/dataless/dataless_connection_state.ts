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
    /// The demo channel (only populated when demoConnector is enabled)
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

export function isDemoConnector(details: DatalessConnectionStateDetails): boolean {
    return details.proto.setupParams?.demoConnector === true;
}

export function createDatalessConnectionState(dql: dashql.DashQL, connSigs: ConnectionSignatureMap, opts: { demoConnector?: boolean } = {}): ConnectionStateWithoutId {
    const { demoConnector = false } = opts;
    const params: connection.DatalessParams = { demoConnector: demoConnector || undefined };
    const details = createDatalessConnectionStateDetails(params);
    const connInfo = createDatalessConnectorInfo(demoConnector);
    const state = createConnectionState(dql, connInfo, connSigs, {
        type: DATALESS_CONNECTOR,
        value: details,
    });
    if (demoConnector) {
        // Give the demo session a friendly default label so it reads as "Demo" in the session bar
        // and selector rather than falling back to its opaque storage path.
        state.name = "Demo";
    } else {
        // Non-demo dataless connections are immediately online
        state.connectionStatus = ConnectionStatus.CHANNEL_READY;
        state.connectionHealth = ConnectionHealth.ONLINE;
        state.active = true;
    }
    return state;
}

export function computeDatalessConnectionSignature(details: DatalessConnectionStateDetails, hasher: Hasher) {
    hasher.add("dataless");
    if (isDemoConnector(details)) {
        hasher.add("demo");
    }
}

export const DATALESS_CHANNEL_READY = Symbol('DATALESS_CHANNEL_READY');
export const DATALESS_CHANNEL_SETUP_FAILED = Symbol('DATALESS_CHANNEL_SETUP_FAILED');
export const DATALESS_CHANNEL_SETUP_CANCELLED = Symbol('DATALESS_CHANNEL_SETUP_CANCELLED');
export const DATALESS_SET_DEMO_MODE = Symbol('DATALESS_SET_DEMO_MODE');

export type DatalessConnectorAction =
    | VariantKind<typeof RESET_CONNECTION, null>
    | VariantKind<typeof DELETE_CONNECTION, null>
    | VariantKind<typeof DATALESS_CHANNEL_READY, DemoDatabaseChannel>
    | VariantKind<typeof DATALESS_CHANNEL_SETUP_CANCELLED, DetailedError>
    | VariantKind<typeof DATALESS_CHANNEL_SETUP_FAILED, DetailedError>
    | VariantKind<typeof HEALTH_CHECK_SUCCEEDED, null>
    | VariantKind<typeof DATALESS_SET_DEMO_MODE, boolean>
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
            const newDemoConnector = action.value;
            const newParams: connection.DatalessParams = {
                ...details.proto.setupParams,
                demoConnector: newDemoConnector || undefined,
            };
            next = {
                ...state,
                connectorInfo: createDatalessConnectorInfo(newDemoConnector),
                connectionStatus: newDemoConnector ? ConnectionStatus.NOT_STARTED : ConnectionStatus.CHANNEL_READY,
                connectionHealth: newDemoConnector ? ConnectionHealth.NOT_STARTED : ConnectionHealth.ONLINE,
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
    }
    return next;
}
