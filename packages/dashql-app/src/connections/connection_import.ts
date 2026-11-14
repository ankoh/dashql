import * as dashql from '@ankoh/dashql-core';
import * as connection from '@ankoh/dashql-jsonschema/connection.js';

import { ConnectionStateDetailsVariant } from '@ankoh/dashql-sdk/connections/connection_state_details';
import { LoggableException } from '@ankoh/dashql-sdk/platform/logger/logger';
import { CONNECTOR_INFOS, ConnectorInfo, ConnectorType, HYPER_CONNECTOR, SALESFORCE_DATA_CLOUD_CONNECTOR, DBCOM_CONNECTOR, TRINO_CONNECTOR } from '@ankoh/dashql-sdk/connections/connector_info';
import { ConnectionState, createConnectionState } from '@ankoh/dashql-sdk/connections/connection_state';
import type { ConnectionParams } from '@ankoh/dashql-sdk/connections/connection_params';
const LOG_CTX = "connection";

export function decodeConnectionFromProto(conn: connection.Connection, workbookId: string): [ConnectorInfo, ConnectionStateDetailsVariant] {
    if ('salesforce' in conn) {
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
    } else if ('dbcom' in conn) {
        const info: ConnectorInfo = CONNECTOR_INFOS[ConnectorType.DBCOM];
        const dbcom = conn.dbcom as any;
        const proto = dbcom?.setupParams
            ? dbcom
            : { setupTimings: {}, setupParams: dbcom ?? {} };
        const details: ConnectionStateDetailsVariant = {
            type: DBCOM_CONNECTOR,
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
        throw new LoggableException("unsupported connection details", { workbookId }, LOG_CTX);
    }
}

export function restoreConnectionState(instance: dashql.DashQL, connectionId: string, info: ConnectorInfo, details: ConnectionStateDetailsVariant, paramsDraft?: ConnectionParams): ConnectionState {
    return { ...createConnectionState(instance, info, details, { active: true, paramsDraft }), connectionId };
}
