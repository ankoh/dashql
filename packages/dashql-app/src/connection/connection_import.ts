import * as dashql from '@ankoh/dashql-core';
import * as pb from '@ankoh/dashql-protobuf';
import * as buf from "@bufbuild/protobuf";

import { computeConnectionSignatureFromDetails, ConnectionStateDetailsVariant } from './connection_state_details.js';
import { LoggableException } from '../platform/logger.js';
import { CONNECTOR_INFOS, ConnectorInfo, ConnectorType, DATALESS_CONNECTOR, DEMO_CONNECTOR, HYPER_CONNECTOR, SALESFORCE_DATA_CLOUD_CONNECTOR, TRINO_CONNECTOR } from './connector_info.js';
import { ConnectionHealth, ConnectionState, ConnectionStatus } from './connection_state.js';
import { DefaultHasher } from '../utils/hash_default.js';
import { ConnectionSignatureMap, newConnectionSignature } from './connection_signature.js';
import { QueryExecutionState } from './query_execution_state.js';
import { CATALOG_DEFAULT_DESCRIPTOR_POOL, CATALOG_DEFAULT_DESCRIPTOR_POOL_RANK } from './catalog_update_state.js';

const LOG_CTX = "connection";

export function decodeConnectionFromProto(conn: pb.dashql.connection.Connection, connId: number): [ConnectorInfo, ConnectionStateDetailsVariant] {
    switch (conn.details.case) {
        case "dataless": {
            const info: ConnectorInfo = CONNECTOR_INFOS[ConnectorType.DATALESS];
            const details: ConnectionStateDetailsVariant = {
                type: DATALESS_CONNECTOR,
                value: buf.create(pb.google_protobuf.empty.EmptySchema),
            };
            return [info, details];
        }
        case "demo": {
            const info: ConnectorInfo = CONNECTOR_INFOS[ConnectorType.DEMO];
            const details: ConnectionStateDetailsVariant = {
                type: DEMO_CONNECTOR,
                value: {
                    proto: conn.details.value,
                    channel: null,
                }
            };
            return [info, details];
        }
        case "salesforce": {
            const info: ConnectorInfo = CONNECTOR_INFOS[ConnectorType.SALESFORCE_DATA_CLOUD];
            const details: ConnectionStateDetailsVariant = {
                type: SALESFORCE_DATA_CLOUD_CONNECTOR,
                value: {
                    proto: conn.details.value,
                    openAuthWindow: null,
                    channel: null,
                }
            };
            return [info, details];
        }
        case "hyper": {
            const info: ConnectorInfo = CONNECTOR_INFOS[ConnectorType.HYPER];
            const details: ConnectionStateDetailsVariant = {
                type: HYPER_CONNECTOR,
                value: {
                    proto: conn.details.value,
                    channel: null,
                }
            };
            return [info, details];
        }
        case "trino": {
            const info: ConnectorInfo = CONNECTOR_INFOS[ConnectorType.TRINO];
            const details: ConnectionStateDetailsVariant = {
                type: TRINO_CONNECTOR,
                value: {
                    proto: conn.details.value,
                    channel: null,
                }
            };
            return [info, details];
        }
        default:
            throw new LoggableException("unsupported connection details", { id: connId.toString() }, LOG_CTX);
    }
}

export function restoreConnectionState(instance: dashql.DashQL, cid: number, info: ConnectorInfo, details: ConnectionStateDetailsVariant, connSigs: ConnectionSignatureMap): ConnectionState {
    const hasher = new DefaultHasher();
    computeConnectionSignatureFromDetails(details, hasher);
    const sig = newConnectionSignature(hasher, connSigs, null);

    const catalog = instance.createCatalog();
    catalog.addDescriptorPool(CATALOG_DEFAULT_DESCRIPTOR_POOL, CATALOG_DEFAULT_DESCRIPTOR_POOL_RANK);

    const state: ConnectionState = {
        connectionId: cid,
        instance,
        connectionStatus: ConnectionStatus.NOT_STARTED,
        connectionHealth: ConnectionHealth.NOT_STARTED,
        connectorInfo: info,
        connectionSignature: sig,
        details: details,
        metrics: buf.create(pb.dashql.connection.ConnectionMetricsSchema),
        catalog,
        catalogUpdates: {
            tasksRunning: new Map(),
            tasksFinished: new Map(),
            lastFullRefresh: null,
            restoredAt: null,
        },
        queriesActive: new Map(),
        queriesActiveOrdered: [],
        queriesFinished: new Map<number, QueryExecutionState>(),
        queriesFinishedOrdered: [],
        snapshotQueriesActiveFinished: 0,
    };
    return state;
}
