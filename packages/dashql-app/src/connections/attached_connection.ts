import * as React from 'react';

import type { ConnectionState } from '@ankoh/dashql/platform/connections/connection_state';
import { useOptionalRuntime } from '../runtime/runtime_hooks.js';
import { createAttachedConnectionParamsForConnector, newConnectionFromParams } from '@ankoh/dashql/platform/connections/connection_params';
import { CONNECTOR_INFOS, ConnectorType } from '@ankoh/dashql/platform/connections/connector_info';

/// The connectors of the connections that the user attaches next to the embedded Hyper
export const ATTACHABLE_CONNECTORS = [ConnectorType.HYPER, ConnectorType.DBCOM, ConnectorType.SALESFORCE_DATA_CLOUD, ConnectorType.TRINO] as const;

/// Allocate a new connection that the user attaches, the user configures it in its settings
export function useConnectionAttach(): (connector: ConnectorType) => ConnectionState {
    const runtime = useOptionalRuntime();
    return React.useCallback((connector: ConnectorType) => {
        if (runtime == null) throw new Error('the connections need a RuntimeProvider');
        const params = createAttachedConnectionParamsForConnector(CONNECTOR_INFOS[connector]);
        return runtime.createConnection(newConnectionFromParams(params, { active: true }));
    }, [runtime]);
}
