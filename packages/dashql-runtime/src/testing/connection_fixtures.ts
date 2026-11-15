import type * as core from '@ankoh/dashql-core';

import { createConnectionState, HEALTH_CHECK_SUCCEEDED, reduceConnectionState, type ConnectionAction, type ConnectionState } from '../connections/connection_state.js';
import type { ConnectionParams } from '../connections/connection_params.js';
import { connectionStateDetailsOf, connectorOfParams, connectorParams } from '../connections/connector_descriptor.js';
import { ConnectorType } from '../connections/connector_info.js';
import { HYPER_CHANNEL_READY } from '../connections/hyper/hyper_connection_state.js';
import { SF_CHANNEL_READY } from '../connections/salesforce/salesforce_connection_state.js';
import { TRINO_CHANNEL_READY } from '../connections/trino/trino_connection_state.js';
import { TestLogger } from './test_logger.js';

/// The options of a connection of a test
export interface TestConnectionOptions {
    /// The id, `test` by default
    connectionId?: string;
    /// The params
    params: ConnectionParams;
    /// Does the connection belong to a committed workbook or was it connected once?
    active?: boolean;
    /// The name
    name?: string;
    /// A channel of the connection, e.g. one with a fake `executeQuery`. The connection is ready with it and online
    /// unless `online` is false.
    channel?: object;
    /// Is the connection with a channel online? True by default.
    online?: boolean;
}

/// Apply an action to a connection of a test
export function reduceTestConnection(state: ConnectionState, action: ConnectionAction): ConnectionState {
    return reduceConnectionState(state, action, new TestLogger());
}

/// A connection of a test on the Rust connection of the core. A test that only reads a connection may still use a
/// plain object, the actions need the Rust connection.
export function createTestConnection(dql: core.DashQL, options: TestConnectionOptions): ConnectionState {
    const connector = connectorOfParams(options.params);
    const setupParams = connectorParams(connector, options.params);
    const details = connectionStateDetailsOf(connector, setupParams);
    let state: ConnectionState = {
        ...createConnectionState(dql, connector.info, details, { params: options.params, active: options.active, name: options.name }),
        connectionId: options.connectionId ?? 'test',
    };
    if (options.channel == null) return state;
    const channel = options.channel as any;
    switch (connector.info.connectorType) {
        case ConnectorType.HYPER:
            state = reduceTestConnection(state, { type: HYPER_CHANNEL_READY, value: [channel, setupParams as any] });
            break;
        case ConnectorType.TRINO:
            state = reduceTestConnection(state, { type: TRINO_CHANNEL_READY, value: channel });
            break;
        case ConnectorType.SALESFORCE_DATA_CLOUD:
        case ConnectorType.DBCOM:
            state = reduceTestConnection(state, { type: SF_CHANNEL_READY, value: channel });
            break;
    }
    if (options.online === false) return state;
    return reduceTestConnection(state, { type: HEALTH_CHECK_SUCCEEDED, value: null });
}
