import * as dashql from '../core/index.js';
import type * as app_session from '@ankoh/dashql-jsonschema/app_session.js';

import { CATALOG_DEFAULT_DESCRIPTOR_POOL_RANK } from './catalog_update_state.js';
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

// Re-export connection param types from JSON Schema
export type ConnectionParams = app_session.ConnectionParams;
export type HyperConnectionParams = app_session.HyperConnectionParams;
export type SalesforceConnectionParams = app_session.SalesforceConnectionParams;
export type TrinoConnectionParams = app_session.TrinoConnectionParams;
export type DemoParams = app_session.DemoParams;
export type DatalessParams = app_session.DatalessParams;

export function getConnectionInfoFromParams(params: ConnectionParams) {
    if ('dataless' in params) return CONNECTOR_INFOS[ConnectorType.DATALESS];
    if ('demo' in params) return CONNECTOR_INFOS[ConnectorType.DEMO];
    if ('trino' in params) return CONNECTOR_INFOS[ConnectorType.TRINO];
    if ('hyper' in params) return CONNECTOR_INFOS[ConnectorType.HYPER];
    if ('salesforce' in params) return CONNECTOR_INFOS[ConnectorType.SALESFORCE_DATA_CLOUD];
    return undefined;
}

export function getConnectionStateDetailsFromParams(params: ConnectionParams): ConnectionStateDetailsVariant | null {
    if ('dataless' in params) return { type: DATALESS_CONNECTOR, value: {} };
    if ('demo' in params) return { type: DEMO_CONNECTOR, value: createDemoConnectionStateDetails(params.demo) };
    if ('trino' in params) return { type: TRINO_CONNECTOR, value: createTrinoConnectionStateDetails(params.trino as any) };
    if ('hyper' in params) return { type: HYPER_CONNECTOR, value: createHyperConnectionStateDetails(params.hyper as any) };
    if ('salesforce' in params) return { type: SALESFORCE_DATA_CLOUD_CONNECTOR, value: createSalesforceConnectionStateDetails(params.salesforce as any) };
    return null;
}

export function getConnectionParamsFromStateDetails(params: ConnectionStateDetailsVariant): ConnectionParams | null {
    switch (params.type) {
        case DATALESS_CONNECTOR:
            return { dataless: params.value };
        case DEMO_CONNECTOR:
            if (!params.value.proto.setupParams) return null;
            return { demo: params.value.proto.setupParams };
        case TRINO_CONNECTOR:
            if (!params.value.proto.setupParams) return null;
            return { trino: params.value.proto.setupParams };
        case HYPER_CONNECTOR:
            if (!params.value.proto.setupParams) return null;
            return { hyper: params.value.proto.setupParams };
        case SALESFORCE_DATA_CLOUD_CONNECTOR:
            if (!params.value.proto.setupParams) return null;
            return { salesforce: params.value.proto.setupParams };
    }
}

export function createConnectionParamsSignature(params: ConnectionParams): any {
    if ('dataless' in params) return createDatalessConnectionParamsSignature(params.dataless);
    if ('demo' in params) return createDemoConnectionParamsSignature(params.demo);
    if ('trino' in params) return createTrinoConnectionParamsSignature(params.trino);
    if ('hyper' in params) return createHyperConnectionParamsSignature(params.hyper);
    if ('salesforce' in params) return createSalesforceConnectionParamsSignature(params.salesforce);
    return null;
}

export function createConnectionStateFromParams(dql: dashql.DashQL, params: ConnectionParams, connSigs: ConnectionSignatureMap): ConnectionStateWithoutId {
    const info = getConnectionInfoFromParams(params)!;
    const details = getConnectionStateDetailsFromParams(params)!;
    const sig = computeNewConnectionSignatureFromDetails(details);

    const catalog = dql.createCatalog();
    const catalogScript = dql.createScript(catalog);
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
        catalogScript,
        snapshotQueriesActiveFinished: 1,
        queriesActive: new Map(),
        queriesActiveOrdered: [],
        queriesFinished: new Map(),
        queriesFinishedOrdered: [],
    };
}

export function createDefaultConnectionParamsForConnector(connector: ConnectorInfo): ConnectionParams {
    switch (connector.connectorType) {
        case ConnectorType.DATALESS:
            return { dataless: {} };
        case ConnectorType.HYPER:
            return { hyper: { protocol: 'V3_HTTP', endpoint: '', tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' } } };
        case ConnectorType.SALESFORCE_DATA_CLOUD:
            return { salesforce: { hyperProtocol: 'V3_HTTP', instanceUrl: '', appConsumerKey: '', appConsumerSecret: '', login: '' } };
        case ConnectorType.TRINO:
            return { trino: { endpoint: '', catalogName: '', auth: { authType: 'AUTH_BASIC' } } };
        case ConnectorType.DEMO:
            return { demo: {} };
    }
}
