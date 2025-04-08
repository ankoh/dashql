import * as dashql from '@ankoh/dashql-core';
import * as pb from '@ankoh/dashql-protobuf';

import { CATALOG_DEFAULT_DESCRIPTOR_POOL, CATALOG_DEFAULT_DESCRIPTOR_POOL_RANK } from './catalog_update_state.js';
import { CONNECTOR_INFOS, ConnectorType, DEMO_CONNECTOR, HYPER_GRPC_CONNECTOR, SALESFORCE_DATA_CLOUD_CONNECTOR, SERVERLESS_CONNECTOR, TRINO_CONNECTOR } from './connector_info.js';
import { ConnectionHealth, ConnectionStateWithoutId, ConnectionStatus } from './connection_state.js';
import { ConnectionStateDetailsVariant } from './connection_state_details.js';
import { createDemoConnectionStateDetails, DemoConnectionParams } from './demo/demo_connection_state.js';
import { VariantKind } from '../utils/variant.js';
import { WorkbookExportSettings } from 'workbook/workbook_export_settings.js';
import { createConnectionMetrics } from './connection_statistics.js';
import { createDemoConnectionParamsSignature, encodeDemoConnectionParamsAsProto, readDemoConnectionParamsFromProto } from './demo/demo_connection_params.js';
import { createHyperConnectionParamsSignature, encodeHyperConnectionParamsAsProto, HyperGrpcConnectionParams, readHyperConnectionParamsFromProto } from './hyper/hyper_connection_params.js';
import { createHyperGrpcConnectionStateDetails } from './hyper/hyper_connection_state.js';
import { createSalesforceConnectionParamsSignature, encodeSalesforceConnectionParamsAsProto, readSalesforceConnectionParamsFromProto, SalesforceConnectionParams } from './salesforce/salesforce_connection_params.js';
import { createSalesforceConnectionStateDetails } from './salesforce/salesforce_connection_state.js';
import { createServerlessConnectionParamsSignature, encodeServerlessConnectionParamsAsProto, readServerlessConnectionParamsFromProto } from './serverless/serverless_connection_params.js';
import { createTrinoConnectionParamsSignature, encodeTrinoConnectionParamsAsProto, readTrinoConnectionParamsFromProto, TrinoConnectionParams } from './trino/trino_connection_params.js';
import { createTrinoConnectionStateDetails } from './trino/trino_connection_state.js';

export type ConnectionParamsVariant =
    | VariantKind<typeof SERVERLESS_CONNECTOR, {}>
    | VariantKind<typeof DEMO_CONNECTOR, DemoConnectionParams>
    | VariantKind<typeof TRINO_CONNECTOR, TrinoConnectionParams>
    | VariantKind<typeof HYPER_GRPC_CONNECTOR, HyperGrpcConnectionParams>
    | VariantKind<typeof SALESFORCE_DATA_CLOUD_CONNECTOR, SalesforceConnectionParams>;

export function getConnectionInfoFromParams(params: ConnectionParamsVariant) {
    switch (params.type) {
        case SERVERLESS_CONNECTOR:
            return CONNECTOR_INFOS[ConnectorType.SERVERLESS];
        case DEMO_CONNECTOR:
            return CONNECTOR_INFOS[ConnectorType.DEMO];
        case TRINO_CONNECTOR:
            return CONNECTOR_INFOS[ConnectorType.TRINO];
        case HYPER_GRPC_CONNECTOR:
            return CONNECTOR_INFOS[ConnectorType.HYPER_GRPC];
        case SALESFORCE_DATA_CLOUD_CONNECTOR:
            return CONNECTOR_INFOS[ConnectorType.SALESFORCE_DATA_CLOUD];
    }
}

export function getConnectionStateDetailsFromParams(params: ConnectionParamsVariant): ConnectionStateDetailsVariant {
    switch (params.type) {
        case SERVERLESS_CONNECTOR:
            return { type: SERVERLESS_CONNECTOR, value: {} };
        case DEMO_CONNECTOR:
            return { type: DEMO_CONNECTOR, value: createDemoConnectionStateDetails(params.value) };
        case TRINO_CONNECTOR:
            return { type: TRINO_CONNECTOR, value: createTrinoConnectionStateDetails(params.value) };
        case HYPER_GRPC_CONNECTOR:
            return { type: HYPER_GRPC_CONNECTOR, value: createHyperGrpcConnectionStateDetails(params.value) };
        case SALESFORCE_DATA_CLOUD_CONNECTOR:
            return { type: SALESFORCE_DATA_CLOUD_CONNECTOR, value: createSalesforceConnectionStateDetails(params.value) };
    }
}

export function getConnectionParamsFromStateDetails(params: ConnectionStateDetailsVariant): ConnectionParamsVariant | null {
    switch (params.type) {
        case SERVERLESS_CONNECTOR:
            return {
                type: SERVERLESS_CONNECTOR,
                value: params.value,
            }
        case DEMO_CONNECTOR:
            return {
                type: DEMO_CONNECTOR,
                value: params.value.channelParams,
            };
        case TRINO_CONNECTOR:
            return {
                type: TRINO_CONNECTOR,
                value: params.value.channelParams,
            };
        case HYPER_GRPC_CONNECTOR: {
            return {
                type: HYPER_GRPC_CONNECTOR,
                value: params.value.channelSetupParams
            };
        }
        case SALESFORCE_DATA_CLOUD_CONNECTOR: {
            return {
                type: SALESFORCE_DATA_CLOUD_CONNECTOR,
                value: params.value.setupParams
            };
        }
    }
    return null;
}

export function encodeConnectionParamsAsProto(params: ConnectionParamsVariant, settings: WorkbookExportSettings | null = null): pb.dashql.connection.ConnectionParams {
    switch (params.type) {
        case SERVERLESS_CONNECTOR:
            return encodeServerlessConnectionParamsAsProto(settings);
        case DEMO_CONNECTOR:
            return encodeDemoConnectionParamsAsProto(settings);
        case TRINO_CONNECTOR:
            return encodeTrinoConnectionParamsAsProto(params.value, settings);
        case HYPER_GRPC_CONNECTOR:
            return encodeHyperConnectionParamsAsProto(params.value, settings);
        case SALESFORCE_DATA_CLOUD_CONNECTOR:
            return encodeSalesforceConnectionParamsAsProto(params.value, settings);
    }
}

export function readConnectionParamsFromProto(pb: pb.dashql.connection.ConnectionParams): ConnectionParamsVariant | null {
    switch (pb.connection.case) {
        case "serverless":
            return {
                type: SERVERLESS_CONNECTOR,
                value: readServerlessConnectionParamsFromProto(pb.connection.value),
            }
        case "demo":
            return {
                type: DEMO_CONNECTOR,
                value: readDemoConnectionParamsFromProto(pb.connection.value),
            }
        case "salesforce":
            return {
                type: SALESFORCE_DATA_CLOUD_CONNECTOR,
                value: readSalesforceConnectionParamsFromProto(pb.connection.value)
            }
        case "hyper":
            return {
                type: HYPER_GRPC_CONNECTOR,
                value: readHyperConnectionParamsFromProto(pb.connection.value)
            }
        case "trino":
            return {
                type: TRINO_CONNECTOR,
                value: readTrinoConnectionParamsFromProto(pb.connection.value)
            }
    }
    return null;
}

export function createConnectionParamsSignature(params: ConnectionParamsVariant): any {
    switch (params.type) {
        case SERVERLESS_CONNECTOR:
            return createServerlessConnectionParamsSignature(params.value);
        case DEMO_CONNECTOR:
            return createDemoConnectionParamsSignature(params.value);
        case TRINO_CONNECTOR:
            return createTrinoConnectionParamsSignature(params.value);
        case HYPER_GRPC_CONNECTOR:
            return createHyperConnectionParamsSignature(params.value);
        case SALESFORCE_DATA_CLOUD_CONNECTOR:
            return createSalesforceConnectionParamsSignature(params.value);
    }
}

export function createConnectionStateFromParams(dql: dashql.DashQL, params: ConnectionParamsVariant): ConnectionStateWithoutId {
    const info = getConnectionInfoFromParams(params);
    const details = getConnectionStateDetailsFromParams(params);

    const catalog = dql.createCatalog();
    catalog.addDescriptorPool(CATALOG_DEFAULT_DESCRIPTOR_POOL, CATALOG_DEFAULT_DESCRIPTOR_POOL_RANK);
    return {
        instance: dql,
        connectionStatus: ConnectionStatus.NOT_STARTED,
        connectionHealth: ConnectionHealth.NOT_STARTED,
        connectorInfo: info,
        metrics: createConnectionMetrics(),
        details,
        catalog,
        catalogUpdates: {
            tasksRunning: new Map(),
            tasksFinished: new Map(),
            lastFullRefresh: null,
        },
        snapshotQueriesActiveFinished: 1,
        queriesActive: new Map(),
        queriesActiveOrdered: [],
        queriesFinished: new Map(),
        queriesFinishedOrdered: [],
    };
}
