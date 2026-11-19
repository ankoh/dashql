import * as core from '../../core/index.js';
import { ConnectionHealth, ConnectionStatus } from '../../core/index.js';

import { CONNECTOR_INFOS, type ConnectorInfo, type ConnectorType } from './connector_info.js';
import type { ConnectionParams } from './connection_params.js';

/// A connection, the view of the slice `connection` of the runtime (docs/design/dashql_runtime.md). The params are the
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

/// Create a connection, with a fixed id or a new one, e.g. `Runtime.createConnection`
export type ConnectionAllocator = (connection: NewConnection, connectionId?: string) => ConnectionState;

/// The queries a workbook issued on a connection, active ones first
export function findWorkbookQueries(
    connection: Pick<ConnectionState, 'queriesActiveOrdered' | 'queriesFinishedOrdered'>,
    workbookId: string,
    queryOf: (queryId: number) => Pick<core.QueryView, 'queryMetadata'> | null,
    includeFinished: boolean = true,
): number[] {
    const ofWorkbook = (queryId: number) => queryOf(queryId)?.queryMetadata.workbookId === workbookId;
    const active = connection.queriesActiveOrdered.filter(ofWorkbook);
    if (!includeFinished) return active;
    return [...active, ...connection.queriesFinishedOrdered.filter(ofWorkbook)];
}

/// The action of the runtime that creates a connection, with a fixed id or a new one
export function createConnectionAction(connection: NewConnection, connectionId?: string): core.AppAction {
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
