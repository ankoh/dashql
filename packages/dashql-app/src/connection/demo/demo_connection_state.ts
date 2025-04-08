import * as dashql from "@ankoh/dashql-core";

import { ConnectionHealth, ConnectionState, ConnectionStateWithoutId, ConnectionStatus, HEALTH_CHECK_SUCCEEDED, RESET } from "../connection_state.js";
import { CONNECTOR_INFOS, ConnectorType, DEMO_CONNECTOR } from "../connector_info.js";
import { createConnectionState } from "../connection_statistics.js";
import { DemoDatabaseChannel } from "./demo_database_channel.js";
import { VariantKind } from '../../utils/variant.js';
import { DetailedError } from "../../utils/error.js";

export interface DemoConnectionParams {
    // XXX Could also just setup with a data spec
    channel: DemoDatabaseChannel;
}

export interface DemoConnectionStateDetails {
    channelParams: DemoConnectionParams;
    channel: DemoDatabaseChannel | null;
    channelError: DetailedError | null;
}

export function createDemoConnectionStateDetails(params?: DemoConnectionParams): DemoConnectionStateDetails {
    return {
        channelParams: params ?? {
            channel: new DemoDatabaseChannel(),
        },
        channel: null,
        channelError: null,
    };
}

export function createDemoConnectionState(dql: dashql.DashQL): ConnectionStateWithoutId {
    const details = createDemoConnectionStateDetails();
    const state = createConnectionState(dql, CONNECTOR_INFOS[ConnectorType.DEMO], {
        type: DEMO_CONNECTOR,
        value: details,
    });
    return state;
}

export const DEMO_CHANNEL_READY = Symbol('DEMO_CHANNEL_READY');
export const DEMO_CHANNEL_SETUP_FAILED = Symbol('DEMO_CHANNEL_SETUP_FAILED');
export const DEMO_CHANNEL_SETUP_CANCELLED = Symbol('DEMO_CHANNEL_SETUP_CANCELLED');

export type DemoConnectorAction =
    | VariantKind<typeof RESET, null>
    | VariantKind<typeof DEMO_CHANNEL_READY, DemoDatabaseChannel>
    | VariantKind<typeof DEMO_CHANNEL_SETUP_CANCELLED, DetailedError>
    | VariantKind<typeof DEMO_CHANNEL_SETUP_FAILED, DetailedError>
    | VariantKind<typeof HEALTH_CHECK_SUCCEEDED, null>
    ;

export function reduceDemoConnectorState(state: ConnectionState, action: DemoConnectorAction): ConnectionState | null {
    const details = state.details.value as DemoConnectionStateDetails;
    let next: ConnectionState | null = null;
    switch (action.type) {
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
                        channelError: null,
                    }
                },
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
                        channelError: action.value,
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
                        channelError: action.value,
                        channel: null
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
                        channel: null,
                        channelError: null,
                    }
                }
            };
            break;
    }
    return next;
}
