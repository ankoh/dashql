import type { ConnectionState } from './connection_state.js';
import { getConnectorInfoForParams, HYPER_CONNECTOR } from './connector_info.js';
import { embeddedCloudDatabases } from './hyper/local_cloud.js';
import type { ConnectionParams } from './connection_params.js';

/// Is the connection the embedded Hyper of the app? A connection of the embedded Hyper that attaches a database of the
/// clouds folder, the local cloud, is a connection of its own like one to a server.
export function isHyperWasmConnection(database: ConnectionState): boolean {
    const setupParams = database.details.type === HYPER_CONNECTOR ? database.details.value.proto.setupParams : null;
    return database.details.type === HYPER_CONNECTOR
        && (setupParams?.protocol ?? 'WASM') === 'WASM'
        && embeddedCloudDatabases(setupParams).length === 0;
}

/// Does a connection offer an operational overview?
export function supportsConnectionOverview(database: ConnectionState): boolean {
    return database.details.type === HYPER_CONNECTOR;
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

/// The parts of the label of a connection.
/// A connection is called by the name the user gave it, otherwise after its connector. The ordinal
/// tells it apart from other connections of the same connector, see `connectionOrdinals`.
export function connectionLabelParts(database: ConnectionState, ordinal: number | null = null): ConnectionLabelParts {
    let detail = 'Http';
    if (database.details.type === HYPER_CONNECTOR) {
        detail = protocolLabel(database.details.value.proto.setupParams?.protocol ?? 'WASM');
    }
    const connector = database.connectorInfo.names.displayLong;
    return { name: database.name ?? (ordinal == null ? connector : `${connector} #${ordinal}`), connector, detail };
}

/// The label of a connection as plain text, e.g. "Hyper #2 Wasm"
export function connectionLabel(database: ConnectionState, ordinal: number | null = null): string {
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
