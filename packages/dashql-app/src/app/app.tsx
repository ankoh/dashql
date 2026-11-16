import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Route, Routes, Navigate, BrowserRouter, HashRouter, useLocation } from 'react-router-dom';

import { AppConfigProvider, useAppConfig } from '../config/app_config.js';
import { AppLoader } from './loading/app_loader.js';
import { AppOwnershipGate } from './app_ownership_gate.js';
import { AppSettingsSync, useAppSettingsReady } from '../config/app_settings_sync.js';
import { ComputationScheduler } from '../compute/computation_scheduler.js';
import { ComputeConnectionProvider } from '../compute/compute_connection_provider.js';
import { DashQLCoreProvider } from '../runtime/core_provider.js';
import { RuntimeProvider } from '../runtime/runtime_provider.js';
import { FileDropzone } from './file_dropzone.js';
import { FlavorProvider, FlavorUrlKeeper } from '../config/flavor_provider.js';
import { getRequestedFlavor } from '../config/flavor_resolution.js';
import { GitHubTheme } from '../styles/github_theme.js';
import { HttpClientProvider } from '../platform/http/http_client_provider.js';
import { ChannelConnectorProvider } from '../connections/hyper/hyper_connection_setup.js';
import { CloudStateProvider } from '../cloud/cloud_state.js';
import { CloudPreviewCleanup } from '../cloud/cloud_workbooks.js';
import { HyperLogMetricsProvider } from '../connections/hyper/hyper_log_metrics_provider.js';
import { HyperDatabaseClientProvider } from '../connections/hyper/hyperdb_grpc_client_provider.js';
import { LoggerToast } from '../ui/logger/logger_toast.js';
import { NavBarContainer } from './navbar.js';
import { PlatformEventListenerProvider } from '../platform/events/event_listener_provider.js';
import { RouterReset } from './router/router_reset.js';
import { SalesforceConnector } from '../connections/salesforce/salesforce_connector.js';
import { StorageProvider } from '../storage/storage_provider.js';
import { VersionCheck } from '../platform/version/version_check.js';
import { WorkbookCommands } from '../workbook/scripts/workbook_commands.js';
import { WorkbookViewModeProvider } from '../workbook/workbook_view_mode.js';
import { WorkbookPage } from '../workbook/workbook_page.js';
import { AgentSessionProvider } from '../agent/agent_session_provider.js';
import { QueryResultCacheProvider } from '../storage/query_result_cache_provider.js';
import { getGlobalLogger, LoggerProvider } from '../platform/logger/logger_provider.js';
import { stringifyError } from '@ankoh/dashql-runtime/platform/logger/logger';
import { EmbeddedDatabaseProvider, type EmbeddedDatabaseOptions } from '../platform/database/embedded_database_provider.js';
import { NativeWorkbookSync } from '../workbook/persistence/native_workbook_sync_react.js';
import { WorkbookComputeQueryExecutionProvider } from './workbook_compute_query_execution.js';
import { WorkbookImportProvider } from '../workbook/persistence/workbook_import_provider.js';

import '@ankoh/dashql-ui/fonts/fonts.css';
import '@ankoh/dashql-ui/styles/colors.css';
import '@ankoh/dashql-ui/styles/tokens.css';
import '../styles/globals.css';
import '@ankoh/dashql-ui/styles/flavors/dbcom.css';
import '../connections/clfn/bundled_clfn_specs.js';

const LOG_CTX = 'app';

// The RuntimeProvider creates the runtime of DashQL over the storage, the http client, the core, the embedded database
// and the API of Salesforce of the providers above it. The providers below it bind parts of it to the app:
// - ChannelConnectorProvider gives it the clients that connect the channels of the setups.
// - CloudStateProvider runs its statements through the query executor, the AppLoader shows the cloud setup from it.
const WorkbookProviders = (props: { children: React.ReactElement }) => (
    <SalesforceConnector>
        <RuntimeProvider>
            <HyperLogMetricsProvider>
                <ChannelConnectorProvider>
                    <WorkbookComputeQueryExecutionProvider>
                        <ComputationScheduler />
                        <NativeWorkbookSync />
                        <AgentSessionProvider>
                            <WorkbookImportProvider>
                                <WorkbookViewModeProvider>
                                    <WorkbookCommands>
                                        <CloudStateProvider>
                                            <CloudPreviewCleanup />
                                            <AppLoader>
                                                {props.children}
                                            </AppLoader>
                                        </CloudStateProvider>
                                    </WorkbookCommands>
                                </WorkbookViewModeProvider>
                            </WorkbookImportProvider>
                        </AgentSessionProvider>
                    </WorkbookComputeQueryExecutionProvider>
                </ChannelConnectorProvider>
            </HyperLogMetricsProvider>
        </RuntimeProvider>
    </SalesforceConnector>
);

/// The embedded database with the startup options of the app settings.
/// It waits until the persisted settings are loaded, a change of the options applies with a restart of the app.
const AppEmbeddedDatabaseProvider = (props: { children: React.ReactElement }) => {
    const config = useAppConfig();
    const settingsReady = useAppSettingsReady();
    const experimentalWasmBackend = config?.settings?.experimental_wasm_backend === true;
    const options = React.useMemo<EmbeddedDatabaseOptions | null>(
        () => (settingsReady ? { experimentalWasmBackend } : null),
        [settingsReady, experimentalWasmBackend],
    );
    return <EmbeddedDatabaseProvider options={options}>{props.children}</EmbeddedDatabaseProvider>;
};

const AppProviders = (props: { children: React.ReactElement }) => (
    <GitHubTheme>
        <LoggerProvider>
            <LoggerToast />
            <AppConfigProvider>
                <PlatformEventListenerProvider>
                    <VersionCheck>
                        <AppOwnershipGate>
                            <DashQLCoreProvider>
                                <StorageProvider>
                                    <HttpClientProvider>
                                        <AppSettingsSync>
                                            <HyperDatabaseClientProvider>
                                                <AppEmbeddedDatabaseProvider>
                                                    <ComputeConnectionProvider>
                                                        <QueryResultCacheProvider>
                                                            <WorkbookProviders>
                                                                {props.children}
                                                            </WorkbookProviders>
                                                        </QueryResultCacheProvider>
                                                    </ComputeConnectionProvider>
                                                </AppEmbeddedDatabaseProvider>
                                            </HyperDatabaseClientProvider>
                                        </AppSettingsSync>
                                    </HttpClientProvider>
                                </StorageProvider>
                            </DashQLCoreProvider>
                        </AppOwnershipGate>
                    </VersionCheck>
                </PlatformEventListenerProvider>
            </AppConfigProvider>
        </LoggerProvider>
    </GitHubTheme>
);

const Router = process.env.DASHQL_RELATIVE_IMPORTS ? HashRouter : BrowserRouter;

const NavigateWithState = (props: { to: string }): React.ReactElement => {
    const location = useLocation();
    return <Navigate to={props.to} replace state={location.state} />;
};

function logRecoverableReactError(error: unknown, errorInfo: React.ErrorInfo) {
    // We're not part of the provider tree.
    // Access the logger globally.
    const logger = getGlobalLogger();
    // Do nothing if it's not existing yet
    if (logger == null) {
        return;
    }
    console.log(error);
    console.log(errorInfo.componentStack);
    logger.info("React encountered a recoverable error", {
        error: stringifyError(error),
        stack: errorInfo.componentStack,
    }, LOG_CTX);

}

const element = document.getElementById('root');
const root = createRoot(element!, {
    onRecoverableError: logRecoverableReactError
});
root.render(
    <FlavorProvider requested={getRequestedFlavor()}>
        <Router>
            <RouterReset />
            <FlavorUrlKeeper />
            <AppProviders>
                <FileDropzone>
                    <NavBarContainer>
                        <Routes>
                            <Route index Component={WorkbookPage} />
                            <Route path="/workbook" Component={WorkbookPage} />
                            <Route path="/workbooks/:workbookId" Component={WorkbookPage} />
                            <Route path="*" element={<NavigateWithState to="/" />} />
                        </Routes>
                    </NavBarContainer>
                </FileDropzone>
            </AppProviders>
        </Router>
    </FlavorProvider>
);
