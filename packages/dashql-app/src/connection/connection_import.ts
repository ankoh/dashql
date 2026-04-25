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
        // Handle both ConnectionParams format ({ demoMode }) and Connection/Details format ({ setupParams: { demoMode } })
        const demoMode = dl?.setupParams?.demoMode ?? dl?.demoMode ?? false;
        const info: ConnectorInfo = createDatalessConnectorInfo(demoMode);
        // Normalize to DatalessConnectionDetails format (with setupParams wrapper).
        // Storage uses ConnectionParams format ({ demoMode }), not ConnectionDetails ({ setupParams: { demoMode } }).
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
        const details: ConnectionStateDetailsVariant = {
            type: SALESFORCE_DATA_CLOUD_CONNECTOR,
            value: {
                proto: conn.salesforce,
                openAuthWindow: null,
                channel: null,
            }
        };
        return [info, details];
    } else if ('hyper' in conn) {
        const info: ConnectorInfo = CONNECTOR_INFOS[ConnectorType.HYPER];
        const details: ConnectionStateDetailsVariant = {
            type: HYPER_CONNECTOR,
            value: {
                proto: conn.hyper,
                channel: null,
            }
        };
        return [info, details];
    } else if ('trino' in conn) {
        const info: ConnectorInfo = CONNECTOR_INFOS[ConnectorType.TRINO];
        const details: ConnectionStateDetailsVariant = {
            type: TRINO_CONNECTOR,
            value: {
                proto: conn.trino,
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
