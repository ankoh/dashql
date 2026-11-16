import type { ConnectionDetailsView } from '../../core/index.js';

import type { ConnectionParams, HyperConnectionParams, SalesforceConnectionParams, TrinoConnectionParams } from './connection_params.js';
import { ConnectorType, type ConnectorInfo } from './connector_info.js';
import type { ClientFunctionSpec } from './clfn/clfn_spec.js';
import { HYPER_CONNECTOR_DESCRIPTOR } from './hyper/hyper_connector_descriptor.js';
import { SALESFORCE_CONNECTOR_DESCRIPTOR, DBCOM_CONNECTOR_DESCRIPTOR } from './salesforce/salesforce_connector_descriptor.js';
import { TRINO_CONNECTOR_DESCRIPTOR } from './trino/trino_connector_descriptor.js';

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

/// The client functions that a connector enables on its connections. The runtime of the core resolves their hosts and
/// variables (`dashql_core_runtime::clfn`).
export interface ClientFunctionBinding {
    /// Load the spec, only when a connection needs it
    loadSpec(): Promise<ClientFunctionSpec>;
}

/// What the connection layer knows about a connector.
///
/// Every connector describes itself once, operations on connections look up the connector instead
/// of switching on its type. The params and details of the connection state always hold the params
/// of the connector under its key, generic operations convert between them through `paramsKey`.
export interface ConnectorDescriptor<K extends ConnectorParamsKey = ConnectorParamsKey> {
    /// The connector info
    info: ConnectorInfo;
    /// The field of the connection params that holds the params of the connector
    paramsKey: K;
    /// The params of a new connection
    defaultParams(): ConnectorParamsMap[K];
    /// Remove the raw form rows, they belong only to the local draft
    withoutDraftRows(params: ConnectorParamsMap[K]): ConnectorParamsMap[K];
    /// Strip the secrets before the params are shared, the login hint only if `withLoginHint` is false
    sanitizeForSharing(params: ConnectorParamsMap[K], withLoginHint: boolean): ConnectorParamsMap[K];
    /// The login hint (the account username or login) of the params, null if there is none
    loginHint(params: ConnectorParamsMap[K]): string | null;
    /// The number of statements of a workbook run that a connection executes at once, the details are the ones of the
    /// view of the connection
    maxConcurrentQueries(details: ConnectionDetailsView): number;
    /// Does the catalog of a connection outlive the page? The relations of a database that is created anew with
    /// every page load and the catalog changes of its statements are neither persisted nor restored.
    catalogIsDurable(params: ConnectorParamsMap[K]): boolean;
    /// Can the queries of a connection read the data files that are attached to a workbook?
    readsAttachments(details: ConnectionDetailsView): boolean;
    /// The client functions of the connections, undefined if they have none
    clientFunctions?: ClientFunctionBinding;
}

/// The connectors by connector type
export const CONNECTOR_DESCRIPTORS: Record<ConnectorType, ConnectorDescriptor> = {
    [ConnectorType.HYPER]: HYPER_CONNECTOR_DESCRIPTOR,
    [ConnectorType.SALESFORCE_DATA_CLOUD]: SALESFORCE_CONNECTOR_DESCRIPTOR,
    [ConnectorType.TRINO]: TRINO_CONNECTOR_DESCRIPTOR,
    [ConnectorType.DBCOM]: DBCOM_CONNECTOR_DESCRIPTOR,
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

/// Can the queries of a connection read the data files that are attached to a workbook?
export function connectionReadsAttachments(connection: { connectorType: number; details: ConnectionDetailsView } | null | undefined): boolean {
    return connection != null && connectorOf(connection).readsAttachments(connection.details);
}

/// The number of statements of a workbook run that a connection executes at once
export function connectionMaxConcurrentQueries(connection: { connectorType: number; details: ConnectionDetailsView } | null | undefined): number {
    return connection == null ? 1 : connectorOf(connection).maxConcurrentQueries(connection.details);
}
