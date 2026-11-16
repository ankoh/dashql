import type * as core from '@ankoh/dashql-core';

import { setupStepAction as setupStep, type ConnectionState } from '@ankoh/dashql-platform/connections/connection_state';
import { newConnectionFromParams, type ConnectionParams } from '@ankoh/dashql-platform/connections/connection_params';
import { connectorOfParams, connectorParams } from '@ankoh/dashql-platform/connections/connector_descriptor';
import { ConnectorType } from '@ankoh/dashql-platform/connections/connector_info';
import type { Runtime } from '../runtime.js';

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

/// Apply an action to a connection of a test, returns the connection as the runtime holds it now
export function reduceTestConnection(runtime: Runtime, state: Pick<ConnectionState, 'connectionId'>, action: core.RuntimeAction): ConnectionState {
    runtime.dispatch({ connection: state.connectionId }, action);
    runtime.flush();
    const next = runtime.connection(state.connectionId);
    if (next == null) throw new Error(`the runtime has no connection ${state.connectionId}`);
    return next;
}

/// A connection of a test in a runtime, with a channel ready and online if the options have one
export function createTestConnection(runtime: Runtime, options: TestConnectionOptions): ConnectionState {
    const connector = connectorOfParams(options.params);
    const setupParams = connectorParams(connector, options.params);
    let state = runtime.createConnection(newConnectionFromParams(options.params, { active: options.active, name: options.name }), options.connectionId ?? 'test');
    if (options.channel == null) return state;
    const channel = runtime.handles.register(options.channel);
    switch (connector.info.connectorType) {
        case ConnectorType.HYPER:
            state = reduceTestConnection(runtime, state, setupStep('HYPER_CHANNEL_READY', setupParams, channel));
            break;
        case ConnectorType.TRINO:
            state = reduceTestConnection(runtime, state, setupStep('TRINO_CHANNEL_READY', null, channel));
            break;
        case ConnectorType.SALESFORCE_DATA_CLOUD:
        case ConnectorType.DBCOM:
            state = reduceTestConnection(runtime, state, setupStep('SF_CHANNEL_READY', null, channel));
            break;
    }
    if (options.online === false) return state;
    return reduceTestConnection(runtime, state, setupStep('HEALTH_CHECK_SUCCEEDED'));
}
