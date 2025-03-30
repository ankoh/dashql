import * as dashql from "@ankoh/dashql-core";

import { ConnectionHealth, ConnectionState, ConnectionStateWithoutId, ConnectionStatus, RESET } from "../connection_state.js";
import { CONNECTOR_INFOS, ConnectorType, DEMO_CONNECTOR } from "../connector_info.js";
import { createConnectionState } from "../connection_statistics.js";
import { DemoDatabaseChannel } from "./demo_database_channel.js";
import { VariantKind } from '../../utils/variant.js';

export interface DemoConnectionParams {
    channel: DemoDatabaseChannel;
}

export function createDemoConnectionStateDetails(): DemoConnectionParams {
    return {
        channel: new DemoDatabaseChannel()
    };
}

export function createDemoConnectionState(dql: dashql.DashQL): ConnectionStateWithoutId {
    const details = createDemoConnectionStateDetails();
    const state = createConnectionState(dql, CONNECTOR_INFOS[ConnectorType.DEMO], {
        type: DEMO_CONNECTOR,
        value: details,
    });
    state.connectionHealth = ConnectionHealth.ONLINE;
    state.connectionStatus = ConnectionStatus.HEALTH_CHECK_SUCCEEDED;
    return state;
}

export type DemoConnectorAction =
    | VariantKind<typeof RESET, null>
    ;

/// XXX Preparing for a setting page for the demo connector
export function reduceDemoConnectorState(state: ConnectionState, action: DemoConnectorAction): ConnectionState | null {
    let next: ConnectionState | null = null;
    switch (action.type) {
        case RESET:
            next = {
                ...state,
                details: {
                    type: DEMO_CONNECTOR,
                    value: {
                        channel: new DemoDatabaseChannel()
                    }
                }
            };
            break;
    }
    return next;
}
