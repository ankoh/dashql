import * as connection from '@ankoh/dashql-jsonschema/connection.js';

import { LoggableException } from '../platform/logger/logger.js';
import { ConnectorType } from './connector_info.js';
import type { NewConnection } from './connection_state.js';
const LOG_CTX = "connection";

/// The connector and the setup params of a stored connection. Storage persists the params of the connector, older
/// files the details with the params of the setup.
export function decodeConnectionFromProto(conn: connection.Connection, workbookId: string): Pick<NewConnection, 'connectorType' | 'setupParams'> {
    const setupParams = (stored: any) => stored?.setupParams ?? stored ?? {};
    if ('salesforce' in conn) {
        return { connectorType: ConnectorType.SALESFORCE_DATA_CLOUD, setupParams: setupParams(conn.salesforce) };
    } else if ('dbcom' in conn) {
        return { connectorType: ConnectorType.DBCOM, setupParams: setupParams(conn.dbcom) };
    } else if ('hyper' in conn) {
        return { connectorType: ConnectorType.HYPER, setupParams: setupParams(conn.hyper) };
    } else if ('trino' in conn) {
        return { connectorType: ConnectorType.TRINO, setupParams: setupParams(conn.trino) };
    } else {
        throw new LoggableException("unsupported connection details", { workbookId }, LOG_CTX);
    }
}
