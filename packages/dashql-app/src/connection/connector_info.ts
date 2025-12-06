import * as pb from '@ankoh/dashql-protobuf';

import { isNativePlatform } from "../platform/native_globals.js";

export const DEMO_CONNECTOR = Symbol('DEMO_CONNECTOR');
export const SERVERLESS_CONNECTOR = Symbol('SERVERLESS_CONNECTOR');
export const SALESFORCE_DATA_CLOUD_CONNECTOR = Symbol('SALESFORCE_DATA_CLOUD_CONNECTOR');
export const HYPER_GRPC_CONNECTOR = Symbol('HYPER_GRPC_CONNECTOR');
export const TRINO_CONNECTOR = Symbol('TRINO_CONNECTOR');

export enum ConnectorType {
    SERVERLESS = 0,
    HYPER_GRPC = 1,
    SALESFORCE_DATA_CLOUD = 2,
    TRINO = 3,
    DEMO = 4,
}
export const CONNECTOR_TYPES: ConnectorType[] = [
    ConnectorType.SERVERLESS,
    ConnectorType.HYPER_GRPC,
    ConnectorType.SALESFORCE_DATA_CLOUD,
    ConnectorType.TRINO,
    ConnectorType.DEMO,
];

export enum CatalogResolver {
    SQL_SCRIPT = 0,
    SQL_INFORMATION_SCHEMA = 1,
    SQL_PG_ATTRIBUTE = 2,
    SALESFORCE_METDATA_API = 3,
}

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
    /// The catalog resolution type
    catalogResolver: CatalogResolver;
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
    /// Can manually set up connector? (vs. static / preloaded)
    manualSetup: boolean;
    /// Has health checks?
    healthChecks: boolean;
    /// User-editable schema script?
    schemaScript: boolean;
    /// Can execute queries?
    executeQueryAction: boolean;
    /// Can refresh a schema?
    refreshSchemaAction: boolean;
}

export const CONNECTOR_INFOS: ConnectorInfo[] = [
    {
        connectorType: ConnectorType.SERVERLESS,
        names: {
            displayShort: 'Dataless',
            displayLong: 'Dataless',
            fileShort: 'dataless',
        },
        icons: {
            colored: "cloud_offline",
            uncolored: "cloud_offline",
            outlines: "cloud_offline",
        },
        catalogResolver: CatalogResolver.SQL_SCRIPT,
        features: {
            manualSetup: false,
            healthChecks: false,
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
        connectorType: ConnectorType.HYPER_GRPC,
        names: {
            displayShort: 'Hyper gRPC',
            displayLong: 'Hyper gRPC',
            fileShort: 'hyper_grpc',
        },
        icons: {
            colored: "hyper",
            uncolored: "hyper_nocolor",
            outlines: "hyper_outlines",
        },
        catalogResolver: CatalogResolver.SQL_PG_ATTRIBUTE,
        features: {
            manualSetup: true,
            healthChecks: true,
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
        catalogResolver: CatalogResolver.SALESFORCE_METDATA_API,
        features: {
            manualSetup: true,
            healthChecks: true,
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
        catalogResolver: CatalogResolver.SQL_INFORMATION_SCHEMA,
        features: {
            manualSetup: true,
            healthChecks: true,
            schemaScript: false,
            executeQueryAction: true,
            refreshSchemaAction: true,
        },
        platforms: {
            browser: true,
            native: true,
        },
    },
    {
        connectorType: ConnectorType.DEMO,
        names: {
            displayShort: 'Demo',
            displayLong: 'Demo',
            fileShort: 'demo',
        },
        icons: {
            colored: "code",
            uncolored: "code",
            outlines: "code",
        },
        catalogResolver: CatalogResolver.SQL_INFORMATION_SCHEMA,
        features: {
            manualSetup: true,
            healthChecks: true,
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

export function getConnectorInfoForParams(params: pb.dashql.connection.ConnectionParams): ConnectorInfo | null {
    switch (params.connection.case) {
        case "demo": return CONNECTOR_INFOS[ConnectorType.DEMO];
        case "hyper": return CONNECTOR_INFOS[ConnectorType.HYPER_GRPC];
        case "salesforce": return CONNECTOR_INFOS[ConnectorType.SALESFORCE_DATA_CLOUD];
        case "dataless": return CONNECTOR_INFOS[ConnectorType.SERVERLESS];
        case "trino": return CONNECTOR_INFOS[ConnectorType.TRINO];
        default: return null;
    }
}

export function requiresSwitchingToNative(info: ConnectorInfo) {
    return !info.platforms.browser && !isNativePlatform();
}

export const useConnectorList = () => CONNECTOR_INFOS;
