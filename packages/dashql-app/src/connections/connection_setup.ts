import * as React from 'react';
import type * as core from '@ankoh/dashql-core';
import type * as connection from '@ankoh/dashql-jsonschema/connection.js';

import type { ConnectionParams } from '@ankoh/dashql-runtime/connections/connection_params';
import { ConnectorType } from '@ankoh/dashql-runtime/connections/connector_info';
import { setupSalesforceConnectionMock } from '@ankoh/dashql-runtime/connections/salesforce/salesforce_connection_setup_mock';
import { useSaveBeforeConnect } from './connection_persistence.js';
import { useSalesforceMock } from './salesforce/salesforce_connector.js';
import { useAppConfig } from '../config/app_config.js';
import { useLogger } from '../platform/logger/logger_provider.js';
import { useOptionalRuntime } from '../runtime/runtime_hooks.js';

/// The setup of a connection from its settings. The runtime sets the connection up (`setupConnection`), its view shows
/// how far the setup got, how it ended and whether one runs.
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
    const logger = useLogger();
    const salesforceMock = useSalesforceMock();
    const mockRef = React.useRef<AbortController | null>(null);
    const forceRelogin = config?.settings?.forceReLogin ?? false;
    const oauthRedirect = config?.connectors?.salesforce?.auth?.oauthRedirect;

    const run = React.useCallback(async (params?: ConnectionParams) => {
        if (runtime == null || connectionId == null) return;
        // Connections are set up with saved settings, unsaved edits are saved first
        if (!await saveBeforeConnect()) return;
        const connector = runtime.connection(connectionId)?.connectorType;
        // The mock of Salesforce that the config chose sets up without an OAuth flow and without requests
        if (salesforceMock != null && (connector === ConnectorType.SALESFORCE_DATA_CLOUD || connector === ConnectorType.DBCOM)) {
            mockRef.current?.abort(new DOMException('Connection setup replaced', 'AbortError'));
            const abort = new AbortController();
            mockRef.current = abort;
            const sfParams = params == null ? runtime.connection(connectionId)?.params : params;
            const inner = (sfParams != null && ('salesforce' in sfParams ? sfParams.salesforce : 'dbcom' in sfParams ? sfParams.dbcom : null)) as connection.SalesforceConnectionParams | null;
            await setupSalesforceConnectionMock(runtime, connectionId, inner ?? {} as connection.SalesforceConnectionParams, salesforceMock.config, salesforceMock.api, logger, abort.signal);
            if (mockRef.current === abort) mockRef.current = null;
            return;
        }
        await runtime.setupConnection(connectionId, {
            params: params as unknown as core.JsonParams | undefined,
            forceRelogin,
            oauthRedirect: oauthRedirect ?? undefined,
        });
    }, [connectionId, forceRelogin, logger, oauthRedirect, runtime, salesforceMock, saveBeforeConnect]);

    const cancel = React.useCallback(() => {
        if (connectionId != null) runtime?.module?.cancelSetup(connectionId);
        mockRef.current?.abort(new DOMException('Connection setup cancelled', 'AbortError'));
        mockRef.current = null;
    }, [connectionId, runtime]);

    const reset = React.useCallback(() => {
        if (connectionId != null) runtime?.dispatch({ connection: connectionId }, { kind: 'resetConnection' });
    }, [connectionId, runtime]);

    return React.useMemo(() => ({ run, cancel, reset }), [run, cancel, reset]);
}
