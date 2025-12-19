import * as dashql from '@ankoh/dashql-core';
import * as buf from "@bufbuild/protobuf";
import * as pb from '@ankoh/dashql-protobuf';

import { CATALOG_DEFAULT_DESCRIPTOR_POOL, CATALOG_DEFAULT_DESCRIPTOR_POOL_RANK } from './catalog_update_state.js';
import { CONNECTOR_INFOS, ConnectorType, DEMO_CONNECTOR, HYPER_CONNECTOR, SALESFORCE_DATA_CLOUD_CONNECTOR, DATALESS_CONNECTOR, TRINO_CONNECTOR, ConnectorInfo } from './connector_info.js';
import { ConnectionHealth, ConnectionStateWithoutId, ConnectionStatus, createConnectionMetrics } from './connection_state.js';
import { computeNewConnectionSignatureFromDetails, ConnectionStateDetailsVariant } from './connection_state_details.js';
import { createDemoConnectionStateDetails } from './demo/demo_connection_state.js';
import { createDemoConnectionParamsSignature } from './demo/demo_connection_params.js';
import { createHyperConnectionParamsSignature } from './hyper/hyper_connection_params.js';
import { createHyperConnectionStateDetails } from './hyper/hyper_connection_state.js';
import { createSalesforceConnectionParamsSignature } from './salesforce/salesforce_connection_params.js';
import { createSalesforceConnectionStateDetails } from './salesforce/salesforce_connection_state.js';
import { createDatalessConnectionParamsSignature } from './dataless/dataless_connection_params.js';
import { createTrinoConnectionParamsSignature } from './trino/trino_connection_params.js';
import { createTrinoConnectionStateDetails } from './trino/trino_connection_state.js';
import { newConnectionSignature, ConnectionSignatureMap } from './connection_signature.js';

export function getConnectionInfoFromParams(params: pb.dashql.connection.ConnectionParams) {
    switch (params.connection.case) {
        case "dataless":
            return CONNECTOR_INFOS[ConnectorType.DATALESS];
        case "demo":
            return CONNECTOR_INFOS[ConnectorType.DEMO];
        case "trino":
            return CONNECTOR_INFOS[ConnectorType.TRINO];
        case "hyper":
            return CONNECTOR_INFOS[ConnectorType.HYPER];
        case "salesforce":
            return CONNECTOR_INFOS[ConnectorType.SALESFORCE_DATA_CLOUD];
    }
}

export function getConnectionStateDetailsFromParams(params: pb.dashql.connection.ConnectionParams): ConnectionStateDetailsVariant | null {
    switch (params.connection.case) {
        case "dataless":
            return { type: DATALESS_CONNECTOR, value: {} };
        case "demo":
            return { type: DEMO_CONNECTOR, value: createDemoConnectionStateDetails(params.connection.value) };
        case "trino":
            return { type: TRINO_CONNECTOR, value: createTrinoConnectionStateDetails(params.connection.value) };
        case "hyper":
            return { type: HYPER_CONNECTOR, value: createHyperConnectionStateDetails(params.connection.value) };
        case "salesforce":
            return { type: SALESFORCE_DATA_CLOUD_CONNECTOR, value: createSalesforceConnectionStateDetails(params.connection.value) };
    }
    return null;
}

export function getConnectionParamsFromStateDetails(params: ConnectionStateDetailsVariant): pb.dashql.connection.ConnectionParams | null {
    switch (params.type) {
        case DATALESS_CONNECTOR:
            return buf.create(pb.dashql.connection.ConnectionParamsSchema, {
                connection: {
                    case: "dataless",
                    value: params.value
                }
            });
        case DEMO_CONNECTOR:
            return buf.create(pb.dashql.connection.ConnectionParamsSchema, {
                connection: {
                    case: "demo",
                    value: params.value.proto.setupParams!
                }
            });
        case TRINO_CONNECTOR:
            return buf.create(pb.dashql.connection.ConnectionParamsSchema, {
                connection: {
                    case: "trino",
                    value: params.value.proto.setupParams!
                }
            });
        case HYPER_CONNECTOR:
            return buf.create(pb.dashql.connection.ConnectionParamsSchema, {
                connection: {
                    case: "hyper",
                    value: params.value.proto.setupParams!
                }
            });
        case SALESFORCE_DATA_CLOUD_CONNECTOR:
            return buf.create(pb.dashql.connection.ConnectionParamsSchema, {
                connection: {
                    case: "salesforce",
                    value: params.value.proto.setupParams!
                }
            });
    }
}

export function createConnectionParamsSignature(params: pb.dashql.connection.ConnectionParams): any {
    switch (params.connection.case) {
        case "dataless":
            return createDatalessConnectionParamsSignature(params.connection.value);
        case "demo":
            return createDemoConnectionParamsSignature(params.connection.value);
        case "trino":
            return createTrinoConnectionParamsSignature(params.connection.value);
        case "hyper":
            return createHyperConnectionParamsSignature(params.connection.value);
        case "salesforce":
            return createSalesforceConnectionParamsSignature(params.connection.value);
    }
}

export function createConnectionStateFromParams(dql: dashql.DashQL, params: pb.dashql.connection.ConnectionParams, connSigs: ConnectionSignatureMap): ConnectionStateWithoutId {
    const info = getConnectionInfoFromParams(params)!;
    const details = getConnectionStateDetailsFromParams(params)!;
    const sig = computeNewConnectionSignatureFromDetails(details);

    const catalog = dql.createCatalog();
    catalog.addDescriptorPool(CATALOG_DEFAULT_DESCRIPTOR_POOL, CATALOG_DEFAULT_DESCRIPTOR_POOL_RANK);
    return {
        instance: dql,
        connectionStatus: ConnectionStatus.NOT_STARTED,
        connectionHealth: ConnectionHealth.NOT_STARTED,
        connectorInfo: info,
        connectionSignature: newConnectionSignature(sig, connSigs, null),
        metrics: createConnectionMetrics(),
        details,
        catalog,
        catalogUpdates: {
            tasksRunning: new Map(),
            tasksFinished: new Map(),
            lastFullRefresh: null,
            restoredAt: null,
        },
        snapshotQueriesActiveFinished: 1,
        queriesActive: new Map(),
        queriesActiveOrdered: [],
        queriesFinished: new Map(),
        queriesFinishedOrdered: [],
    };
}

export function createDefaultConnectionParamsForConnector(connector: ConnectorInfo): pb.dashql.connection.ConnectionParams {
    switch (connector.connectorType) {
        case ConnectorType.DATALESS:
            return buf.create(pb.dashql.connection.ConnectionParamsSchema, {
                connection: {
                    case: "dataless",
                    value: buf.create(pb.dashql.connection.DatalessParamsSchema)
                }
            });
        case ConnectorType.HYPER:
            return buf.create(pb.dashql.connection.ConnectionParamsSchema, {
                connection: {
                    case: "hyper",
                    value: buf.create(pb.dashql.connection.HyperConnectionParamsSchema)
                }
            });
        case ConnectorType.SALESFORCE_DATA_CLOUD:
            return buf.create(pb.dashql.connection.ConnectionParamsSchema, {
                connection: {
                    case: "salesforce",
                    value: buf.create(pb.dashql.connection.SalesforceConnectionParamsSchema)
                }
            });
        case ConnectorType.TRINO:
            return buf.create(pb.dashql.connection.ConnectionParamsSchema, {
                connection: {
                    case: "trino",
                    value: buf.create(pb.dashql.connection.TrinoConnectionParamsSchema)
                }
            });
        case ConnectorType.DEMO:
            return buf.create(pb.dashql.connection.ConnectionParamsSchema, {
                connection: {
                    case: "demo",
                    value: buf.create(pb.dashql.connection.DemoParamsSchema)
                }
            });
    }
}
