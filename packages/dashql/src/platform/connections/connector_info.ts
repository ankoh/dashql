import { ConnectorType } from '../../core/index.js';

export const SALESFORCE_DATA_CLOUD_CONNECTOR = Symbol('SALESFORCE_DATA_CLOUD_CONNECTOR');
export const HYPER_CONNECTOR = Symbol('HYPER_CONNECTOR');
export const TRINO_CONNECTOR = Symbol('TRINO_CONNECTOR');
export const DBCOM_CONNECTOR = Symbol('DBCOM_CONNECTOR');

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
    /// The query shown in the first script of a new workbook.
    helloWorldScript: string;
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
    /// The connector platforms
    platforms: ConnectorPlatforms;
}

export interface ConnectorPlatforms {
    /// Supports the browser?
    browser: boolean;
    /// Supports the electron app?
    native: boolean;
}

export const CONNECTOR_INFOS: ConnectorInfo[] = [
    {
        connectorType: ConnectorType.HYPER,
        helloWorldScript: 'select version();',
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
        platforms: {
            browser: true,
            native: true,
        },
    },
    {
        connectorType: ConnectorType.SALESFORCE_DATA_CLOUD,
        helloWorldScript: 'select version();',
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
        platforms: {
            browser: true,
            native: true,
        },
    },
    {
        connectorType: ConnectorType.TRINO,
        helloWorldScript: 'select version();',
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
        platforms: {
            browser: true,
            native: true,
        },
    },
    {
        // Database.com connections behave like Salesforce Data Cloud connections for now, but can write to their database
        connectorType: ConnectorType.DBCOM,
        helloWorldScript: 'select version();',
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
        platforms: {
            browser: true,
            native: true,
        },
    },
];

export function getConnectorInfoForParams(params: { hyper?: any; salesforce?: any; dbcom?: any; trino?: any }): ConnectorInfo | null {
    if ("hyper" in params) return CONNECTOR_INFOS[ConnectorType.HYPER];
    if ("salesforce" in params) return CONNECTOR_INFOS[ConnectorType.SALESFORCE_DATA_CLOUD];
    if ("dbcom" in params) return CONNECTOR_INFOS[ConnectorType.DBCOM];
    if ("trino" in params) return CONNECTOR_INFOS[ConnectorType.TRINO];
    return null;
}
