import * as React from 'react';
import * as dashql from '@ankoh/dashql-core';

import type { ConnectionState } from './connection_state.js';
import { useConnectionAllocator } from './connection_registry.js';
import { createAttachedConnectionParamsForConnector, createConnectionStateFromParams } from './connection_params.js';
import { CONNECTOR_INFOS, ConnectorType } from './connector_info.js';

/// The connectors of the connections that the user attaches next to the embedded Hyper
export const ATTACHABLE_CONNECTORS = [ConnectorType.HYPER, ConnectorType.TRINO, ConnectorType.SALESFORCE_DATA_CLOUD] as const;

/// Allocate a new connection that the user attaches, the user configures it in its settings
export function useConnectionAttach(): (dql: dashql.DashQL, connector: ConnectorType) => ConnectionState {
    const allocate = useConnectionAllocator();
    return React.useCallback((dql: dashql.DashQL, connector: ConnectorType) => {
        const params = createAttachedConnectionParamsForConnector(CONNECTOR_INFOS[connector]);
        return allocate({ ...createConnectionStateFromParams(dql, params), active: true });
    }, [allocate]);
}
