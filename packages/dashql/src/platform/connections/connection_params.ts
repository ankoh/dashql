import type * as app_workbook from '@akohn/dashql-jsonschema/app_workbook.js';

import * as core from '../../core/index.js';
import { ConnectorType, ConnectorInfo } from './connector_info.js';
import type { ConnectionState, NewConnection } from './connection_state.js';
import { connectionParamsOf, connectorOf, connectorOfParams, connectorParams } from './connector_descriptor.js';

// Re-export connection param types from JSON Schema
export type ConnectionParams = app_workbook.ConnectionParams;
export type HyperConnectionParams = app_workbook.HyperConnectionParams;
export type SalesforceConnectionParams = app_workbook.SalesforceConnectionParams;
export type TrinoConnectionParams = app_workbook.TrinoConnectionParams;

// The defaults, the draft rows and the login hints of connection params come from the core module (`ConnectionParams`
// of `dashql_core_runtime`), the caller passes the core, e.g. the one of its runtime (`Runtime.core`).

/// Raw form rows belong only to the local draft, never to committed/runtime parameters.
export function connectionParamsWithoutDraftRows(core: core.DashQL, params: ConnectionParams): ConnectionParams {
    return core.connectionParamsWithoutDraftRows(params);
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
export function connectionParamsHaveLoginHint(core: core.DashQL, params: ConnectionParams | null): boolean {
    return params != null && core.connectionParamsLoginHint(params) != null;
}

/// The options of a connection that is created with params: whether it is active and its name
export type NewConnectionOptions = Pick<NewConnection, 'active' | 'name'>;

/// A new connection with params, its setup starts with them
export function newConnectionFromParams(params: ConnectionParams, options: NewConnectionOptions = {}): NewConnection {
    const connector = connectorOfParams(params);
    return { connectorType: connector.info.connectorType, setupParams: connectorParams(connector, params), params, ...options };
}

/// A new connection to the embedded Hyper: the runtime gives a connection without setup params the params of a new
/// connection of its connector
export function newDefaultHyperWasmConnection(options: NewConnectionOptions = {}): NewConnection {
    return { connectorType: ConnectorType.HYPER, ...options };
}

/// The params of a new connection of a connector
export function createDefaultConnectionParamsForConnector(core: core.DashQL, info: ConnectorInfo): ConnectionParams {
    return core.defaultConnectionParams<ConnectionParams>(info.connectorType);
}

/// The endpoint that a new connection to a Hyper server starts with
export const DEFAULT_HYPER_ENDPOINT = 'http://localhost:7484';

/// The params of a new connection that the user attaches.
/// The app holds a single connection to the embedded Hyper, an attached Hyper connection speaks to a server.
export function createAttachedConnectionParamsForConnector(core: core.DashQL, info: ConnectorInfo): ConnectionParams {
    const params = createDefaultConnectionParamsForConnector(core, info);
    if (info.connectorType !== ConnectorType.HYPER || !('hyper' in params)) return params;
    return { ...params, hyper: { ...params.hyper, protocol: 'V3_HTTP', endpoint: DEFAULT_HYPER_ENDPOINT } };
}
