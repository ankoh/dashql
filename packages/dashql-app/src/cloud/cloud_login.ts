import * as React from 'react';
import type * as connection from '@ankoh/dashql-jsonschema/connection.js';

import { useConnectionById } from '../connections/connection_registry.js';
import { connectionParamsWithoutDraftRows } from '../connections/connection_params.js';
import { ConnectionHealth } from '../connections/connection_state.js';
import { useConnectionSetup } from '../connections/connection_setup.js';
import { ConnectorType } from '../connections/connector_info.js';
import { performHealthCheck } from '../connections/health_check.js';
import { useHyperSetup } from '../connections/hyper/hyper_connection_setup.js';
import { useQueryExecutor } from '../connections/query_executor.js';
import { useSalesforceSetup } from '../connections/salesforce/salesforce_connector.js';

// The login to the cloud connection with its saved settings, the same setup that Connect of its settings runs.
// Database.com logs in with OAuth in a popup, so the login runs on a click. A Hyper server connects with the endpoint and
// the metadata of its settings, the local cloud attaches its database on the embedded Hyper.

export interface CloudLogin {
    /// Log in to the cloud connection with its saved settings, a connection that was set up before is reset first. The
    /// connection state tells how it went.
    login: () => Promise<void>;
    /// Cancel a running login
    cancel: () => void;
    /// Can the connection log in, does it have a connector that the app can set up?
    available: boolean;
}

export function useCloudLogin(connectionId: string | null): CloudLogin {
    const [connectionState, dispatch] = useConnectionById(connectionId);
    const connectionSetup = useConnectionSetup(connectionId);
    const hyperSetup = useHyperSetup();
    const salesforceSetup = useSalesforceSetup();
    const executor = useQueryExecutor();

    const connector = connectionState?.connectorInfo.connectorType;
    const available = connector === ConnectorType.HYPER ? hyperSetup != null
        : connector === ConnectorType.DBCOM ? salesforceSetup != null
        : false;

    const login = React.useCallback(async () => {
        if (connectionState == null || !available) return;
        const params = connectionParamsWithoutDraftRows(connectionState.params);
        await connectionSetup.run(async signal => {
            try {
                if (connectionState.connectionHealth !== ConnectionHealth.NOT_STARTED) {
                    if ('hyper' in params) await hyperSetup!.reset(dispatch);
                    else if ('dbcom' in params) await salesforceSetup!.reset(dispatch);
                }
                if ('hyper' in params) {
                    const hyperParams = structuredClone(params.hyper) as connection.HyperConnectionParams;
                    const channel = await hyperSetup!.setup(dispatch, hyperParams, signal, connectionState.connectionId);
                    if (channel != null && (hyperParams.protocol ?? 'WASM') !== 'WASM') {
                        await performHealthCheck(executor, connectionState.connectionId, { type: 'hyper', channel }, dispatch, signal);
                    }
                } else if ('dbcom' in params) {
                    const channel = await salesforceSetup!.setup(dispatch, ConnectorType.DBCOM, structuredClone(params.dbcom) as connection.SalesforceConnectionParams, signal);
                    await performHealthCheck(executor, connectionState.connectionId, { type: 'salesforce', channel }, dispatch, signal);
                }
            } catch {
                // The setup and the health check keep the failure in the connection state
            }
        });
    }, [available, connectionSetup, connectionState, dispatch, executor, hyperSetup, salesforceSetup]);

    return React.useMemo(() => ({ login, cancel: connectionSetup.cancel, available }), [available, connectionSetup.cancel, login]);
}

