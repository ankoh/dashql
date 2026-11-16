import type * as app_workbook from '@ankoh/dashql-jsonschema/app_workbook.js';

import { CONNECTOR_INFOS, ConnectorType, ConnectorInfo } from './connector_info.js';
import type { ConnectionState, NewConnection } from './connection_state.js';
import { CONNECTOR_DESCRIPTORS, connectionParamsOf, connectorOf, connectorOfParams, connectorParams } from './connector_descriptor.js';

// Re-export connection param types from JSON Schema
export type ConnectionParams = app_workbook.ConnectionParams;
export type HyperConnectionParams = app_workbook.HyperConnectionParams;
export type SalesforceConnectionParams = app_workbook.SalesforceConnectionParams;
export type TrinoConnectionParams = app_workbook.TrinoConnectionParams;

/// Raw form rows belong only to the local draft, never to committed/runtime parameters.
export function connectionParamsWithoutDraftRows(params: ConnectionParams): ConnectionParams {
    const connector = connectorOfParams(params);
    return connectionParamsOf(connector, connector.withoutDraftRows(connectorParams(connector, params)));
}

/// Sort the keys of an object so that its encoding doesn't depend on their order
function sortObjectKeys(value: unknown): unknown {
    return value != null && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value;
}

/// A canonical encoding of connection params that doesn't depend on the order of object keys
export function connectionParamsKey(params: ConnectionParams | undefined): string {
    return JSON.stringify(params, (_key, value) => sortObjectKeys(value)) ?? '';
}

/// The params of the setup of a connection, null before a setup
export function getConnectionSetupParams(connection: Pick<ConnectionState, 'connectorType' | 'details'>): ConnectionParams | null {
    const setupParams = connection.details.setupParams;
    return setupParams ? connectionParamsOf(connectorOf(connection), setupParams as never) : null;
}

/// Whether the connection params carry a login hint (the resolved account username / login) that
/// could be shared. Used to decide if the "share login hint" toggle should be offered at all.
export function connectionParamsHaveLoginHint(params: ConnectionParams | null): boolean {
    if (!params) return false;
    const connector = connectorOfParams(params);
    return connector.loginHint(connectorParams(connector, params)) != null;
}

/// The options of a connection that is created with params: whether it is active and its name
export type NewConnectionOptions = Pick<NewConnection, 'active' | 'name'>;

/// A new connection with params, its setup starts with them
export function newConnectionFromParams(params: ConnectionParams, options: NewConnectionOptions = {}): NewConnection {
    const connector = connectorOfParams(params);
    return { connectorType: connector.info.connectorType, setupParams: connectorParams(connector, params), params, ...options };
}

/// A new connection to the embedded Hyper
export function newDefaultHyperWasmConnection(options: NewConnectionOptions = {}): NewConnection {
    return newConnectionFromParams(createDefaultConnectionParamsForConnector(CONNECTOR_INFOS[ConnectorType.HYPER]), options);
}

export function createDefaultConnectionParamsForConnector(info: ConnectorInfo): ConnectionParams {
    const connector = CONNECTOR_DESCRIPTORS[info.connectorType];
    return connectionParamsOf(connector, connector.defaultParams());
}

/// The endpoint that a new connection to a Hyper server starts with
export const DEFAULT_HYPER_ENDPOINT = 'http://localhost:7484';

/// The params of a new connection that the user attaches.
/// The app holds a single connection to the embedded Hyper, an attached Hyper connection speaks to a server.
export function createAttachedConnectionParamsForConnector(info: ConnectorInfo): ConnectionParams {
    const params = createDefaultConnectionParamsForConnector(info);
    if (info.connectorType !== ConnectorType.HYPER || !('hyper' in params)) return params;
    return { ...params, hyper: { ...params.hyper, protocol: 'V3_HTTP', endpoint: DEFAULT_HYPER_ENDPOINT } };
}
