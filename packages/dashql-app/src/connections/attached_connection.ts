import * as React from 'react';

import type { ConnectionState } from '@ankoh/dashql-runtime/connections/connection_state';
import { useConnectionAllocator } from './connection_registry.js';
import { createAttachedConnectionParamsForConnector, newConnectionFromParams } from '@ankoh/dashql-runtime/connections/connection_params';
import { CONNECTOR_INFOS, ConnectorType } from '@ankoh/dashql-runtime/connections/connector_info';

/// The connectors of the connections that the user attaches next to the embedded Hyper
export const ATTACHABLE_CONNECTORS = [ConnectorType.HYPER, ConnectorType.DBCOM, ConnectorType.SALESFORCE_DATA_CLOUD, ConnectorType.TRINO] as const;

/// Allocate a new connection that the user attaches, the user configures it in its settings
export function useConnectionAttach(): (connector: ConnectorType) => ConnectionState {
    const allocate = useConnectionAllocator();
    return React.useCallback((connector: ConnectorType) => {
        const params = createAttachedConnectionParamsForConnector(CONNECTOR_INFOS[connector]);
        return allocate(newConnectionFromParams(params, { active: true }));
    }, [allocate]);
}
