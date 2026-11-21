import { ConnectorType } from '../../core/index.js';
import type { ConnectionParams } from './connection_params.js';

/// The connectors, a numeric enum of the module
export { ConnectorType };
export const CONNECTOR_TYPES: ConnectorType[] = [
    ConnectorType.HYPER,
    ConnectorType.SALESFORCE_DATA_CLOUD,
    ConnectorType.TRINO,
    ConnectorType.DBCOM,
];

/// The field of the connection params that holds the params of a connector, e.g. `{ hyper: ... }`. Database.com
/// connections share the params of Salesforce Data Cloud connections.
export type ConnectorParamsKey = 'hyper' | 'salesforce' | 'dbcom' | 'trino';

/// What the connection layer knows about a connector.
///
/// The params and details of the connection state always hold the params of the connector under its key, generic
/// operations convert between them through `paramsKey`. The defaults, the draft rows and the login hint of the params
/// are in the core module (`ConnectionParams` of `dashql_core_runtime`).
export interface ConnectorInfo {
    /// The connector type
    connectorType: ConnectorType;
    /// The field of the connection params that holds the params of the connector
    paramsKey: ConnectorParamsKey;
    /// The connector name
    names: {
        displayLong: string;
        displayShort: string;
        fileShort: string;
    };
    /// The icons
    icons: {
        colored: string,
        uncolored: string,
        outlines: string,
    }
}

export const CONNECTOR_INFOS: ConnectorInfo[] = [
    {
        connectorType: ConnectorType.HYPER,
        paramsKey: 'hyper',
        names: {
            displayShort: 'Hyper',
            displayLong: 'Hyper',
            fileShort: 'hyper',
        },
        icons: {
            colored: "hyper",
            uncolored: "hyper_nocolor",
            outlines: "hyper_outlines",
        },
    },
    {
        connectorType: ConnectorType.SALESFORCE_DATA_CLOUD,
        paramsKey: 'salesforce',
        names: {
            displayShort: 'Salesforce',
            displayLong: 'Salesforce Data Cloud',
            fileShort: 'sfdc',
        },
        icons: {
            colored: "salesforce_notext",
            uncolored: "salesforce_notext_nocolor",
            outlines: "salesforce_outlines",
        },
    },
    {
        connectorType: ConnectorType.TRINO,
        paramsKey: 'trino',
        names: {
            displayShort: 'Trino',
            displayLong: 'Trino',
            fileShort: 'trino',
        },
        icons: {
            colored: "trino",
            uncolored: "trino_nocolor",
            outlines: "trino_outlines",
        },
    },
    {
        // Database.com connections behave like Salesforce Data Cloud connections for now, but can write to their database
        connectorType: ConnectorType.DBCOM,
        paramsKey: 'dbcom',
        names: {
            displayShort: 'Database.com',
            displayLong: 'Database.com',
            fileShort: 'dbcom',
        },
        icons: {
            colored: "hyper_nocolor",
            uncolored: "hyper_nocolor",
            outlines: "hyper_outlines",
        },
    },
];

/// The connector of connection params
export function connectorInfoOfParams(params: ConnectionParams): ConnectorInfo {
    const connector = CONNECTOR_INFOS.find(connector => connector.paramsKey in params);
    if (connector == null) {
        throw new Error(`Unknown connector of the connection params with the keys [${Object.keys(params).join(', ')}]`);
    }
    return connector;
}
