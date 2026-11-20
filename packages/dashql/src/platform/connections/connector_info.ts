import { ConnectorType } from '../../core/index.js';

/// The connectors, a numeric enum of the module
export { ConnectorType };
export const CONNECTOR_TYPES: ConnectorType[] = [
    ConnectorType.HYPER,
    ConnectorType.SALESFORCE_DATA_CLOUD,
    ConnectorType.TRINO,
    ConnectorType.DBCOM,
];

export interface ConnectorInfo {
    /// The connector type
    connectorType: ConnectorType;
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

export function getConnectorInfoForParams(params: { hyper?: unknown; salesforce?: unknown; dbcom?: unknown; trino?: unknown }): ConnectorInfo | null {
    if ("hyper" in params) return CONNECTOR_INFOS[ConnectorType.HYPER];
    if ("salesforce" in params) return CONNECTOR_INFOS[ConnectorType.SALESFORCE_DATA_CLOUD];
    if ("dbcom" in params) return CONNECTOR_INFOS[ConnectorType.DBCOM];
    if ("trino" in params) return CONNECTOR_INFOS[ConnectorType.TRINO];
    return null;
}
