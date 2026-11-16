import type { ConnectionParams, HyperConnectionParams, SalesforceConnectionParams, TrinoConnectionParams } from './connection_params.js';
import { CONNECTOR_INFOS, ConnectorType, type ConnectorInfo } from './connector_info.js';

/// The params of the connectors by the field of the connection params that holds them
export interface ConnectorParamsMap {
    /// Direct-to-Hyper connections
    hyper: HyperConnectionParams;
    /// Salesforce Data Cloud connections
    salesforce: SalesforceConnectionParams;
    /// Database.com connections, they share the params of Salesforce Data Cloud connections
    dbcom: SalesforceConnectionParams;
    /// Trino connections
    trino: TrinoConnectionParams;
}
/// The field of the connection params that holds the params of a connector, e.g. `{ hyper: ... }`
export type ConnectorParamsKey = keyof ConnectorParamsMap;

/// What the connection layer knows about a connector.
///
/// The params and details of the connection state always hold the params of the connector under its key, generic
/// operations convert between them through `paramsKey`. The defaults, the draft rows and the login hint of the params
/// are in the core module (`ConnectionParams` of `dashql_core_runtime`).
export interface ConnectorDescriptor<K extends ConnectorParamsKey = ConnectorParamsKey> {
    /// The connector info
    info: ConnectorInfo;
    /// The field of the connection params that holds the params of the connector
    paramsKey: K;
}

/// The connectors by connector type
export const CONNECTOR_DESCRIPTORS: Record<ConnectorType, ConnectorDescriptor> = {
    [ConnectorType.HYPER]: { info: CONNECTOR_INFOS[ConnectorType.HYPER], paramsKey: 'hyper' },
    [ConnectorType.SALESFORCE_DATA_CLOUD]: { info: CONNECTOR_INFOS[ConnectorType.SALESFORCE_DATA_CLOUD], paramsKey: 'salesforce' },
    [ConnectorType.TRINO]: { info: CONNECTOR_INFOS[ConnectorType.TRINO], paramsKey: 'trino' },
    [ConnectorType.DBCOM]: { info: CONNECTOR_INFOS[ConnectorType.DBCOM], paramsKey: 'dbcom' },
};
const DESCRIPTORS = Object.values(CONNECTOR_DESCRIPTORS);

/// The connector of connection params
export function connectorOfParams(params: ConnectionParams): ConnectorDescriptor {
    const connector = DESCRIPTORS.find(connector => connector.paramsKey in params);
    if (connector == null) {
        throw new Error(`Unknown connector of the connection params with the keys [${Object.keys(params).join(', ')}]`);
    }
    return connector;
}

/// The connector of a connection
export function connectorOf(connection: { connectorType: number }): ConnectorDescriptor {
    return CONNECTOR_DESCRIPTORS[connection.connectorType as ConnectorType];
}

/// The params of the connector of connection params
export function connectorParams(connector: ConnectorDescriptor, params: ConnectionParams): ConnectorParamsMap[ConnectorParamsKey] {
    return (params as Partial<ConnectorParamsMap>)[connector.paramsKey]!;
}

/// The connection params that hold the params of a connector
export function connectionParamsOf(connector: ConnectorDescriptor, params: ConnectorParamsMap[ConnectorParamsKey]): ConnectionParams {
    return { [connector.paramsKey]: params } as unknown as ConnectionParams;
}
