import * as React from 'react';

import type { ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import { useOptionalRuntime } from '@akohn/dashql-react/hooks';
import { createAttachedConnectionParamsForConnector, newConnectionFromParams } from '@akohn/dashql/platform/connections/connection_params';
import { CONNECTOR_INFOS, ConnectorType } from '@akohn/dashql/platform/connections/connector_info';

/// The connectors of the connections that the user attaches next to the embedded Hyper
export const ATTACHABLE_CONNECTORS = [ConnectorType.HYPER, ConnectorType.DBCOM, ConnectorType.SALESFORCE_DATA_CLOUD, ConnectorType.TRINO] as const;

/// Allocate a new connection that the user attaches, the user configures it in its settings
export function useConnectionAttach(): (connector: ConnectorType) => ConnectionState {
    const runtime = useOptionalRuntime();
    return React.useCallback((connector: ConnectorType) => {
        if (runtime == null) throw new Error('the connections need a RuntimeProvider');
        const params = createAttachedConnectionParamsForConnector(runtime.core, CONNECTOR_INFOS[connector]);
        return runtime.createConnection(newConnectionFromParams(params, { active: true }));
    }, [runtime]);
}
