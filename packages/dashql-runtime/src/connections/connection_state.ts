import * as core from '@ankoh/dashql-core';
import { ConnectionHealth, ConnectionStatus } from '@ankoh/dashql-core';

import { CONNECTOR_INFOS, type ConnectorInfo, type ConnectorType } from './connector_info.js';
import type { HandleTable } from '../store/handles.js';
import type { ConnectionParams } from './connection_params.js';

/// A connection, the view of the slice `connection` of the runtime (docs/wip/runtime_api.md). The params are the
/// connection params of the app.
export type ConnectionState = Omit<core.ConnectionView, 'params' | 'paramsDraft' | 'setupAttemptParams' | 'setupAttemptDraft'> & {
    /// The params of the last successful setup, the initial ones until then
    params: ConnectionParams;
    /// The local settings of the form, independent of the channel and the OAuth state
    paramsDraft: ConnectionParams | null;
    /// The input of the running setup, never saved
    setupAttemptParams: ConnectionParams | null;
    /// The draft when the running setup started, with the raw form rows
    setupAttemptDraft: ConnectionParams | null;
};

/// How far the setup of a connection got and its health, numeric enums of the module
export { ConnectionHealth, ConnectionStatus };

/// The info of the connector of a connection
export function connectorInfoOf(connection: Pick<ConnectionState, 'connectorType'>): ConnectorInfo {
    return CONNECTOR_INFOS[connection.connectorType as ConnectorType];
}

/// The channel of a connection, an object of the handle table of the runtime
export function channelOf<T>(connection: Pick<ConnectionState, 'details'> | null | undefined, handles: HandleTable): T | null {
    return handles.get<T>(connection?.details.channel) ?? null;
}

/// Is a connection connected or connecting? An open connection keeps its protocol and can't be merged.
export function isConnectionOpen(health: ConnectionHealth | undefined): boolean {
    return health === ConnectionHealth.CONNECTING || health === ConnectionHealth.ONLINE;
}

export function printConnectionHealth(health: ConnectionHealth) {
    switch (health) {
        case ConnectionHealth.NOT_STARTED:
            return "Not Started";
        case ConnectionHealth.CONNECTING:
            return "Connecting";
        case ConnectionHealth.CANCELLED:
            return "Cancelled";
        case ConnectionHealth.ONLINE:
            return "Online";
        case ConnectionHealth.FAILED:
            return "Failed";
    }
}

/// Does a connection cache query results? The connector decides unless the user chose.
export function connectionCachesQueryResults(state: Pick<ConnectionState, 'cacheQueryResults' | 'connectorType'>): boolean {
    return state.cacheQueryResults ?? connectorInfoOf(state).features.queryResultCaching;
}

/// A new connection: its connector, the params its setup starts with and what it is created with
export interface NewConnection {
    connectorType: ConnectorType;
    /// The params of the connector without its field, the details of the setup start with them
    setupParams: unknown;
    /// Does the connection belong to a committed workbook or was it connected once?
    active?: boolean;
    /// The params, derived from the setup params by default
    params?: ConnectionParams;
    /// The draft of the params
    paramsDraft?: ConnectionParams;
    /// The name the user gave the connection
    name?: string;
    /// Does the connection cache query results? The default of the connector without.
    cacheQueryResults?: boolean;
}

/// The action of the runtime that creates a connection, with a fixed id or a new one
export function createConnectionAction(connection: NewConnection, connectionId?: string): core.RuntimeAction {
    return {
        kind: 'createConnection',
        value: {
            connectionId,
            connectorType: connection.connectorType,
            setupParams: (connection.setupParams ?? undefined) as core.JsonParams | undefined,
            active: connection.active,
            params: connection.params as core.JsonParams | undefined,
            paramsDraft: connection.paramsDraft as core.JsonParams | undefined,
            name: connection.name,
            cacheQueryResults: connection.cacheQueryResults,
        },
    };
}

/// A step of a setup that the host runs itself, e.g. the mock of a setup, by the name of the action of the connector
/// (`setup_action_from_json` of the runtime). The channel of a ready step is a handle that the connection takes.
export function setupStepAction(step: string, value?: unknown, channel?: number): core.RuntimeAction {
    return { kind: 'setupStep', value: { step, value, channel } };
}
