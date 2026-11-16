import * as React from 'react';
import type * as core from '@akohn/dashql';

import type { ConnectionParams } from '@akohn/dashql/platform/connections/connection_params';
import { useSaveBeforeConnect } from './connection_persistence.js';
import { useAppConfig } from '../config/app_config.js';
import { useOptionalRuntime } from '../runtime/runtime_hooks.js';

/// The setup of a connection from its settings. The runtime sets the connection up (`setupConnection`), also against
/// the mock of Salesforce that the config chose, its view shows how far the setup got, how it ended and whether one
/// runs.
export interface ConnectionSetup {
    /// Set up the connection with the params, those of the connection without. Unsaved edits are saved first.
    run: (params?: ConnectionParams) => Promise<void>;
    /// Cancel the setup that runs, also one that the startup started
    cancel: () => void;
    /// Disconnect the connection
    reset: () => void;
}

export function useConnectionSetup(connectionId: string | null): ConnectionSetup {
    const saveBeforeConnect = useSaveBeforeConnect(connectionId);
    const runtime = useOptionalRuntime();
    const config = useAppConfig();
    const forceRelogin = config?.settings?.forceReLogin ?? false;
    const oauthRedirect = config?.connectors?.salesforce?.auth?.oauthRedirect;

    const run = React.useCallback(async (params?: ConnectionParams) => {
        if (runtime == null || connectionId == null) return;
        // Connections are set up with saved settings, unsaved edits are saved first
        if (!await saveBeforeConnect()) return;
        await runtime.setupConnection(connectionId, {
            params: params as unknown as core.JsonParams | undefined,
            forceRelogin,
            oauthRedirect: oauthRedirect ?? undefined,
        });
    }, [connectionId, forceRelogin, oauthRedirect, runtime, saveBeforeConnect]);

    const cancel = React.useCallback(() => {
        if (connectionId != null) runtime?.cancelSetup(connectionId);
    }, [connectionId, runtime]);

    const reset = React.useCallback(() => {
        if (connectionId != null) runtime?.dispatch({ connection: connectionId }, { kind: 'resetConnection' });
    }, [connectionId, runtime]);

    return React.useMemo(() => ({ run, cancel, reset }), [run, cancel, reset]);
}
