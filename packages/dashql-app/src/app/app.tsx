import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Route, Routes, Navigate, BrowserRouter, HashRouter, useLocation } from 'react-router-dom';

import { AppConfigProvider, useAppConfig } from '../config/app_config.js';
import { AppLoader } from './loading/app_loader.js';
import { AppLoadingPage } from './app_loading_page.js';
import { IndicatorStatus } from '@akohn/dashql-react/components/status_indicator';
import { AppOwnershipGate } from './app_ownership_gate.js';
import { AppSettingsSync, useAppSettingsReady } from '../config/app_settings_sync.js';
import { DashQLCoreProvider } from '../host/core_provider.js';
import { RuntimeProvider } from '../host/runtime_provider.js';
import { FileDropzone } from './file_dropzone.js';
import { FlavorProvider, FlavorUrlKeeper } from '../config/flavor_provider.js';
import { getRequestedFlavor } from '../config/flavor_resolution.js';
import { GitHubTheme } from '../styles/github_theme.js';
import { HttpClientProvider } from '../host/http/http_client_provider.js';
import { CloudStateProvider } from '../cloud/cloud_state.js';
import { CloudPreviewCleanup } from '../cloud/cloud_workbooks.js';
import { LoggerToast } from '../diagnostics/logger_toast.js';
import { NavBarContainer } from './navbar.js';
import { PlatformEventListenerProvider } from '../host/events/event_listener_provider.js';
import { RouterReset } from './router_reset.js';
import { StorageProvider } from '../storage/storage_provider.js';
import { VersionCheck } from '../host/version/version_check.js';
import { WorkbookCommands } from '../workbook/scripts/workbook_commands.js';
import { WorkbookViewModeProvider } from '../workbook/workbook_view_mode.js';
import { WorkbookPage } from '../workbook/workbook_page.js';
import { AgentProvider } from '../agent/agent_provider.js';
import { WorkbookResultsProvider } from '../storage/workbook_results_provider.js';
import { getGlobalLogger, LoggerProvider } from '../host/logger_provider.js';
import { stringifyError } from '@akohn/dashql/platform/logger/logger';
import { perfMarks } from '@akohn/dashql';
import { EmbeddedDatabaseProvider, type EmbeddedDatabaseOptions } from '../host/embedded_database_provider.js';
import { NativeWorkbookSync } from '../workbook/persistence/native_workbook_sync_react.js';
import { WorkbookImportProvider } from '../workbook/persistence/workbook_import_provider.js';

import '@akohn/dashql-react/fonts/fonts.css';
import '@akohn/dashql-react/styles/colors.css';
import '@akohn/dashql-react/styles/tokens.css';
import '../styles/globals.css';
import '@akohn/dashql-react/styles/flavors/dbcom.css';
import '../connections/bundled_clfn_specs.js';

const LOG_CTX = 'app';

// The RuntimeProvider creates the runtime of DashQL once the core is there, over the storage, the http client, the
// clients of the channels, the embedded database and the mock of Salesforce of the providers above it, and provides
// the extracts of the Hyper logs that its channels feed. The loading page shows until then. The providers below it bind
// parts of it to the app, e.g. the CloudStateProvider runs its statements through the query executor and the AppLoader
// shows the cloud setup from it.
const WorkbookProviders = (props: { children: React.ReactElement }) => (
    <RuntimeProvider loading={<AppLoadingPage pauseAfterSetup={false} progress={null} embeddedDatabaseStatus={IndicatorStatus.None} />}>
        <NativeWorkbookSync />
        <AgentProvider>
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
        </AgentProvider>
    </RuntimeProvider>
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
                                            <AppEmbeddedDatabaseProvider>
                                                <WorkbookResultsProvider>
                                                    <WorkbookProviders>
                                                        {props.children}
                                                    </WorkbookProviders>
                                                </WorkbookResultsProvider>
                                            </AppEmbeddedDatabaseProvider>
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
    logger.info("React encountered a recoverable error", {
        error: stringifyError(error),
        stack: errorInfo.componentStack,
    }, LOG_CTX);

}

// `?perf` records the perf marks from the start, see "Perf marks" in docs/design/dashql_runtime.md
if (new URLSearchParams(window.location.search).has('perf')) perfMarks.setEnabled(true);

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
                            <Route path="/workbooks/:workbookId" Component={WorkbookPage} />
                            <Route path="*" element={<NavigateWithState to="/" />} />
                        </Routes>
                    </NavBarContainer>
                </FileDropzone>
            </AppProviders>
        </Router>
    </FlavorProvider>
);
