import * as dashql from '../core/index.js';
import * as connection from '@ankoh/dashql-jsonschema/connection.js';

import { computeConnectionSignatureFromDetails, ConnectionStateDetailsVariant } from './connection_state_details.js';
import { LoggableException } from '../platform/logger/logger.js';
import { CONNECTOR_INFOS, ConnectorInfo, ConnectorType, DATALESS_CONNECTOR, HYPER_CONNECTOR, SALESFORCE_DATA_CLOUD_CONNECTOR, TRINO_CONNECTOR, createDatalessConnectorInfo } from './connector_info.js';
import { ConnectionHealth, ConnectionState, ConnectionStatus, createConnectionMetrics } from './connection_state.js';
import { DefaultHasher } from '../utils/hash_default.js';
import { ConnectionSignatureMap, newConnectionSignature } from './connection_signature.js';
import { QueryExecutionState } from './query_execution_state.js';
const LOG_CTX = "connection";

export function decodeConnectionFromProto(conn: connection.Connection, sessionId: string): [ConnectorInfo, ConnectionStateDetailsVariant] {
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
        throw new LoggableException("unsupported connection details", { session: sessionId }, LOG_CTX);
    }
}

export function restoreConnectionState(instance: dashql.DashQL, sessionId: string, info: ConnectorInfo, details: ConnectionStateDetailsVariant, connSigs: ConnectionSignatureMap): ConnectionState {
    const hasher = new DefaultHasher();
    computeConnectionSignatureFromDetails(details, hasher);
    const sig = newConnectionSignature(hasher, connSigs, null);

    const catalog = instance.createCatalog();
    const catalogScript = instance.createScript(catalog);

    const state: ConnectionState = {
        sessionId: sessionId,
        instance,
        active: true,
        connectionStatus: ConnectionStatus.NOT_STARTED,
        connectionHealth: ConnectionHealth.NOT_STARTED,
        connectorInfo: info,
        connectionSignature: sig,
        details: details,
        metrics: createConnectionMetrics(),
        catalog,
        catalogUpdates: {
            tasksRunning: new Map(),
            tasksFinished: new Map(),
            currentFullRefresh: null,
            lastFullRefresh: null,
            restoredAt: null,
        },
        catalogScript,
        queriesActive: new Map(),
        queriesActiveOrdered: [],
        queriesFinished: new Map<number, QueryExecutionState>(),
        queriesFinishedOrdered: [],
        snapshotQueriesActiveFinished: 0,
    };
    return state;
}
