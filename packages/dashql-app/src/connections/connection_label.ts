import type * as core from '@ankoh/dashql-core';

import type { ConnectionState } from '@ankoh/dashql-platform/connections/connection_state';
import { CONNECTOR_INFOS, ConnectorType, getConnectorInfoForParams } from '@ankoh/dashql-platform/connections/connector_info';
import { embeddedCloudDatabases } from '@ankoh/dashql-platform/connections/hyper/local_cloud';
import type { ConnectionParams } from '@ankoh/dashql-platform/connections/connection_params';

/// Is the connection the embedded Hyper of the app? A connection of the embedded Hyper that attaches a database of the
/// clouds folder, the local cloud, is a connection of its own like one to a server.
export function isHyperWasmConnection(database: Pick<ConnectionState, 'connectorType' | 'details'>): boolean {
    const setupParams = database.connectorType === ConnectorType.HYPER ? database.details.setupParams as HyperSetupParams | null : null;
    return database.connectorType === ConnectorType.HYPER
        && (setupParams?.protocol ?? 'WASM') === 'WASM'
        && embeddedCloudDatabases(setupParams).length === 0;
}

/// The setup params of a Hyper connection
type HyperSetupParams = Parameters<typeof embeddedCloudDatabases>[0] & { protocol?: string };

/// Does a connection offer an operational overview?
export function supportsConnectionOverview(database: Pick<ConnectionState, 'connectorType'>): boolean {
    return database.connectorType === ConnectorType.HYPER;
}

/// The label of a connection, its name and the protocol it speaks
export interface ConnectionLabelParts {
    /// The name of the connection, e.g. "Hyper", "Hyper #2" or the name the user gave it
    name: string;
    /// The name of the connector, e.g. "Hyper"
    connector: string;
    /// The protocol, e.g. "Wasm" or "Http"
    detail: string;
}

/// The protocol of a connection as the label shows it
function protocolLabel(protocol: string | undefined): string {
    return protocol === 'V3_GRPC' ? 'gRPC' : protocol === 'V3_HTTP' ? 'Http' : protocol === 'V3_HTTP_LINK' ? 'Link' : 'Wasm';
}

/// The ordinals that tell the listed connections of a connector apart, 1-based in the order they were registered, from
/// the list of the connections (`connectionList` of the runtime). A connector with a single listed connection has none.
export function connectionOrdinals(list: Pick<core.ConnectionListView, 'connections'> | null | undefined): Map<string, number> {
    const ordinals = new Map<string, number>();
    for (const entry of list?.connections ?? []) {
        if (entry.ordinal != null) ordinals.set(entry.connectionId, entry.ordinal);
    }
    return ordinals;
}

/// Is a connection listed next to the workbooks? Connections that workbooks use are, as are active ones.
export function isListedConnection(list: Pick<core.ConnectionListView, 'connections'> | null | undefined, connectionId: string): boolean {
    return list?.connections.some(entry => entry.connectionId === connectionId && entry.listed) ?? false;
}

/// The parts of the label of a connection.
/// A connection is called by the name the user gave it, otherwise after its connector. The ordinal
/// tells it apart from other connections of the same connector, see `connectionOrdinals`.
export function connectionLabelParts(database: Pick<ConnectionState, 'connectorType' | 'details' | 'name'>, ordinal: number | null = null): ConnectionLabelParts {
    let detail = 'Http';
    if (database.connectorType === ConnectorType.HYPER) {
        detail = protocolLabel((database.details.setupParams?.protocol as string | undefined) ?? 'WASM');
    }
    const connector = CONNECTOR_INFOS[database.connectorType as ConnectorType].names.displayLong;
    return { name: database.name ?? (ordinal == null ? connector : `${connector} #${ordinal}`), connector, detail };
}

/// The label of a connection as plain text, e.g. "Hyper #2 Wasm"
export function connectionLabel(database: Pick<ConnectionState, 'connectorType' | 'details' | 'name'>, ordinal: number | null = null): string {
    return connectionLabelText(connectionLabelParts(database, ordinal));
}

/// The plain text of the parts of a label
export function connectionLabelText(parts: ConnectionLabelParts): string {
    return `${parts.name} ${parts.detail}`;
}

/// A label for connection params, e.g. when the connection state is not restored.
/// It names the connector and the location of the database that the params describe.
export function connectionParamsLabel(params: ConnectionParams): string {
    const name = getConnectorInfoForParams(params)?.names.displayLong ?? 'Connection';
    if ('hyper' in params) {
        const protocol = params.hyper.protocol ?? 'WASM';
        return protocol === 'WASM' ? `${name} Wasm` : `${name} / ${params.hyper.endpoint ?? ''}`;
    }
    if ('trino' in params) return `${name} / ${params.trino.endpoint ?? ''}`;
    if ('salesforce' in params) return `${name} / ${params.salesforce.instanceUrl ?? ''}`;
    if ('dbcom' in params) return `${name} / ${params.dbcom.instanceUrl ?? ''}`;
    return name;
}
