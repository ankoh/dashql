import * as dashql from '../../../shared/core/index.js';
import * as connection from '@ankoh/dashql-jsonschema/connection.js';

import { computeConnectionSignatureFromDetails, ConnectionStateDetailsVariant } from './connection_state_details.js';
import { LoggableException } from '../../../shared/platform/logger/logger.js';
import { CONNECTOR_INFOS, ConnectorInfo, ConnectorType, DATALESS_CONNECTOR, HYPER_CONNECTOR, SALESFORCE_DATA_CLOUD_CONNECTOR, TRINO_CONNECTOR, createDatalessConnectorInfo } from './connector_info.js';
import { ConnectionHealth, ConnectionState, ConnectionStatus, createConnectionMetrics } from './connection_state.js';
import { generateCatalogScriptHeader, CatalogSource } from './catalog_sql_generator.js';
import { generateFunctionScriptHeader } from './catalog_function_sql_generator.js';
import { DefaultHasher } from '../../../shared/utils/hash_default.js';
import { ConnectionSignatureMap, newConnectionSignature } from './connection_signature.js';
import { QueryExecutionState } from './query_execution_state.js';
const LOG_CTX = "connection";

export function decodeConnectionFromProto(conn: connection.Connection, notebookId: string): [ConnectorInfo, ConnectionStateDetailsVariant] {
    if ('dataless' in conn) {
        const dl = conn.dataless as any;
        // Handle both ConnectionParams format ({ demoConnector }) and Connection/Details format ({ setupParams: { demoConnector } })
        const demoConnector = dl?.setupParams?.demoConnector ?? dl?.demoConnector ?? false;
        const info: ConnectorInfo = createDatalessConnectorInfo(demoConnector);
        // Normalize to DatalessConnectionDetails format (with setupParams wrapper).
        // Storage uses ConnectionParams format ({ demoConnector }), not ConnectionDetails ({ setupParams: { demoConnector } }).
        const proto = dl?.setupParams
            ? (conn.dataless ?? { setupParams: {} })
            : { setupParams: conn.dataless ?? {} } as any;
        const details: ConnectionStateDetailsVariant = {
            type: DATALESS_CONNECTOR,
            value: {
                proto,
                channel: null,
            }
        };
        return [info, details];
    } else if ('salesforce' in conn) {
        const info: ConnectorInfo = CONNECTOR_INFOS[ConnectorType.SALESFORCE_DATA_CLOUD];
        // Storage persists ConnectionParams (flat SalesforceConnectionParams),
        // not the Details wrapper. Normalize so proto.setupParams is populated.
        const sf = conn.salesforce as any;
        const proto = sf?.setupParams
            ? sf
            : { setupTimings: {}, setupParams: sf ?? {} };
        const details: ConnectionStateDetailsVariant = {
            type: SALESFORCE_DATA_CLOUD_CONNECTOR,
            value: {
                proto,
                channel: null,
            }
        };
        return [info, details];
    } else if ('hyper' in conn) {
        const info: ConnectorInfo = CONNECTOR_INFOS[ConnectorType.HYPER];
        const hy = conn.hyper as any;
        const proto = hy?.setupParams
            ? hy
            : { setupTimings: {}, setupParams: hy ?? {} };
        const details: ConnectionStateDetailsVariant = {
            type: HYPER_CONNECTOR,
            value: {
                proto,
                channel: null,
            }
        };
        return [info, details];
    } else if ('trino' in conn) {
        const info: ConnectorInfo = CONNECTOR_INFOS[ConnectorType.TRINO];
        const tr = conn.trino as any;
        const proto = tr?.setupParams
            ? tr
            : { setupTimings: {}, setupParams: tr ?? {} };
        const details: ConnectionStateDetailsVariant = {
            type: TRINO_CONNECTOR,
            value: {
                proto,
                channel: null,
            }
        };
        return [info, details];
    } else {
        throw new LoggableException("unsupported connection details", { notebookId }, LOG_CTX);
    }
}

export function restoreConnectionState(instance: dashql.DashQL, notebookId: string, info: ConnectorInfo, details: ConnectionStateDetailsVariant, connSigs: ConnectionSignatureMap, name: string | null = null): ConnectionState {
    const hasher = new DefaultHasher();
    computeConnectionSignatureFromDetails(details, hasher);
    const sig = newConnectionSignature(hasher, connSigs, null);

    let catalog: ReturnType<dashql.DashQL['createCatalog']> | null = null;
    let catalogRelationScript: ReturnType<dashql.DashQL['createScript']> | null = null;
    let catalogFunctionScript: ReturnType<dashql.DashQL['createScript']> | null = null;
    try {
        catalog = instance.createCatalog();
        catalogRelationScript = instance.createScript(catalog);
        catalogRelationScript.replaceText(generateCatalogScriptHeader(CatalogSource.Unknown));
        catalogFunctionScript = instance.createScript(catalog);
        catalogFunctionScript.replaceText(generateFunctionScriptHeader(CatalogSource.Unknown));
    } catch (error) {
        catalogFunctionScript?.destroy();
        catalogRelationScript?.destroy();
        catalog?.destroy();
        connSigs.delete(sig.signatureString);
        throw error;
    }
    const restoredCatalog = catalog;
    const restoredCatalogRelationScript = catalogRelationScript;
    const restoredCatalogFunctionScript = catalogFunctionScript;

    const state: ConnectionState = {
        notebookId,
        name,
        instance,
        active: true,
        connectionStatus: ConnectionStatus.NOT_STARTED,
        connectionHealth: ConnectionHealth.NOT_STARTED,
        connectorInfo: info,
        connectionSignature: sig,
        details: details,
        metrics: createConnectionMetrics(),
        catalog: restoredCatalog,
        catalogUpdates: {
            tasksRunning: new Map(),
            tasksFinished: new Map(),
            currentFullRefresh: null,
            lastFullRefresh: null,
            restoredAt: null,
        },
        catalogRelationScript: restoredCatalogRelationScript,
        catalogFunctionScript: restoredCatalogFunctionScript,
        queriesActive: new Map(),
        queriesActiveOrdered: [],
        queriesFinished: new Map<number, QueryExecutionState>(),
        queriesFinishedOrdered: [],
        snapshotQueriesActiveFinished: 0,
    };
    return state;
}
