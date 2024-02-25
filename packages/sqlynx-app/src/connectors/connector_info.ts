export const BRAINSTORM_MODE = Symbol('BRAINSTORM_MODE');
export const SALESFORCE_DATA_CLOUD = Symbol('SCALESFORCE_DATA_CLOUD');
export const HYPER_DATABASE = Symbol('HYPER_DATABASE');

export enum ConnectorType {
    BRAINSTORM_MODE = 0,
    SALESFORCE_DATA_CLOUD = 1,
    HYPER_DATABASE = 2,
}

export interface ConnectorInfo {
    /// The connector type
    connectorType: ConnectorType;
    /// The connector title
    displayName: {
        long: string;
        short: string;
    };
    /// The connector features
    features: ConnectorFeatures;
    /// The connector platforms
    platforms: ConnectorPlatforms;
}

export interface ConnectorPlatforms {
    /// Supports the browser?
    browser: boolean;
    /// Supports the electron app?
    native: boolean;
}

export interface ConnectorFeatures {
    /// User-editable schema script?
    schemaScript: boolean;
    /// Can execute queries?
    executeQueryAction: boolean;
    /// Can refresh a schema?
    refreshSchemaAction: boolean;
}

export const CONNECTOR_INFOS: ConnectorInfo[] = [
    {
        connectorType: ConnectorType.BRAINSTORM_MODE,
        displayName: {
            short: 'Brainstorm',
            long: 'Draft Mode',
        },
        features: {
            schemaScript: true,
            executeQueryAction: false,
            refreshSchemaAction: false,
        },
        platforms: {
            browser: true,
            native: true,
        },
    },
    {
        connectorType: ConnectorType.SALESFORCE_DATA_CLOUD,
        displayName: {
            short: 'Salesforce',
            long: 'Salesforce Data Cloud',
        },
        features: {
            schemaScript: false,
            executeQueryAction: true,
            refreshSchemaAction: true,
        },
        platforms: {
            browser: false,
            native: true,
        },
    },
    {
        connectorType: ConnectorType.HYPER_DATABASE,
        displayName: {
            short: 'Hyper',
            long: 'Hyper Database',
        },
        features: {
            schemaScript: false,
            executeQueryAction: true,
            refreshSchemaAction: true,
        },
        platforms: {
            browser: true,
            native: true,
        },
    },
];

export enum ConnectorAuthCheck {
    UNKNOWN,
    AUTHENTICATED,
    AUTHENTICATION_FAILED,
    AUTHENTICATION_IN_PROGRESS,
    AUTHENTICATION_NOT_STARTED,
    CLIENT_ID_MISMATCH,
}

export const useConnectorList = () => CONNECTOR_INFOS;
