import * as React from 'react';

import { useConnectionById } from '../connections/connection_registry.js';
import { connectionParamsWithoutDraftRows } from '@ankoh/dashql-runtime/connections/connection_params';
import { ConnectionHealth, type ConnectionState } from '@ankoh/dashql-runtime/connections/connection_state';
import { isLocalCloud } from '../connections/cloud_connection.js';
import { useConnectionSetup } from '../connections/connection_setup.js';
import { ConnectorType } from '@ankoh/dashql-runtime/connections/connector_info';
import { useAppConfig } from '../config/app_config.js';
import { connectorInfoOf } from '@ankoh/dashql-runtime/connections/connection_state';

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
    const [connectionState] = useConnectionById(connectionId);
    const connectionSetup = useConnectionSetup(connectionId);
    const config = useAppConfig();

    const connector = connectionState?.connectorType;
    const available = connector === ConnectorType.HYPER ? config?.connectors?.hyper != null
        : connector === ConnectorType.DBCOM ? config?.connectors?.salesforce != null
        : false;

    const login = React.useCallback(async () => {
        if (connectionState == null || !available) return;
        // The runtime sets up the connection and checks its health, the view of the connection keeps a failure
        if (connectionState.connectionHealth !== ConnectionHealth.NOT_STARTED) connectionSetup.reset();
        await connectionSetup.run(connectionParamsWithoutDraftRows(connectionState.params));
    }, [available, connectionSetup, connectionState]);

    return React.useMemo(() => ({ login, cancel: connectionSetup.cancel, available }), [available, connectionSetup.cancel, login]);
}


/// The error of the last login of a connection
export function connectionError(connection: ConnectionState): string | null {
    const setupError = connection.details.connector.kind === 'salesforce' ? connection.details.connector.setupError : null;
    return setupError?.message ?? connection.details.healthCheckError?.message ?? null;
}

/// Log in to the local cloud without a click, it needs no credentials. Once per connection.
export function useLocalCloudAutoLogin(cloud: ConnectionState | null, login: CloudLogin): void {
    const loggedIn = React.useRef<string | null>(null);
    React.useEffect(() => {
        if (cloud == null || !isLocalCloud(cloud.params) || cloud.connectionHealth !== ConnectionHealth.NOT_STARTED) return;
        if (loggedIn.current === cloud.connectionId) return;
        loggedIn.current = cloud.connectionId;
        void login.login();
    }, [cloud, login]);
}
