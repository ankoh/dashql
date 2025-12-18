import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Route, Routes, Navigate, BrowserRouter, HashRouter } from 'react-router-dom';

import { AppConfigProvider } from './app_config.js';
import { AppLoader } from './app_loader.js';
import { CatalogLoaderProvider } from './connection/catalog_loader.js';
import { ComputationRegistry } from './compute/computation_registry.js';
import { ConnectionRegistry } from './connection/connection_registry.js';
import { ConnectionSettingsPage } from './view/connection/connection_settings_page.js';
import { DashQLComputeProvider } from './compute/compute_provider.js';
import { DashQLCoreProvider } from './core_provider.js';
import { FileDownloaderProvider } from './platform/file_downloader_provider.js';
import { FileDropzone } from './view/file_dropzone.js';
import { GitHubTheme } from './github_theme.js';
import { HttpClientProvider } from './platform/http_client_provider.js';
import { HyperDatabaseClientProvider } from './connection/hyper/hyperdb_client_provider.js';
import { HyperConnector } from './connection/hyper/hyper_connector.js';
import { HyperConnectorSettingsStateProvider } from './view/connection/hyper_connection_settings.js';
import { HyperPlanDemoPage } from './view/experiments/hyper_plan_experiment.js';
import { IdentExperimentPage } from './view/experiments/ident_experiment_page.js';
import { getGlobalLogger, LoggerProvider } from './platform/logger_provider.js';
import { NavBarContainer } from './view/navbar.js';
import { OllamaClientProvider } from './platform/ollama_client_provider.js';
import { PlatformEventListenerProvider } from './platform/event_listener_provider.js';
import { PlatformTypeProvider } from './platform/platform_type.js';
import { ProcessProvider } from './platform/process.js';
import { QueryExecutorProvider } from './connection/query_executor.js';
import { RouterReset } from './router_reset.js';
import { SalesforceConnector } from './connection/salesforce/salesforce_connector.js';
import { SalesforceConnectorSettingsStateProvider } from './view/connection/salesforce_connection_settings.js';
import { SchemaGraphDemoPage } from './view/experiments/schema_graph_experiment.js';
import { StorageProvider } from './storage/storage_provider.js';
import { TrinoConnector } from './connection/trino/trino_connector.js';
import { TrinoConnectorSettingsStateProvider } from './view/connection/trino_connection_settings.js';
import { UIExperimentPage } from './view/experiments/ui_experiment_page.js';
import { VersionCheck } from './platform/version_check.js';
import { WorkbookCommands } from './workbook/workbook_commands.js';
import { WorkbookPage } from './view/workbook/workbook_page.js';
import { WorkbookStateRegistry } from './workbook/workbook_state_registry.js';
import { isDebugBuild } from './globals.js';

import './../static/fonts/fonts.css';
import './colors.css';
import './globals.css';

const LOG_CTX = 'app';

// We decouple (some) page states from the actual page views to remember user input
const PageStateProviders = (props: { children: React.ReactElement }) => (
    <SalesforceConnectorSettingsStateProvider>
        <HyperConnectorSettingsStateProvider>
            <TrinoConnectorSettingsStateProvider>
                {props.children}
            </TrinoConnectorSettingsStateProvider>
        </HyperConnectorSettingsStateProvider>
    </SalesforceConnectorSettingsStateProvider>
);

// Note that the order among connection providers is important and non-obvious.
// For example:
// - CatalogLoaderProvider requires the WorkbookStateRegistry to mark connection workbooks as outdated.
const WorkbookProviders = (props: { children: React.ReactElement }) => (
    <ConnectionRegistry>
        <SalesforceConnector>
            <HyperConnector>
                <TrinoConnector>
                    <ComputationRegistry>
                        <QueryExecutorProvider>
                            <WorkbookStateRegistry>
                                <CatalogLoaderProvider>
                                    <WorkbookCommands>
                                        <AppLoader>
                                            {props.children}
                                        </AppLoader>
                                    </WorkbookCommands>
                                </CatalogLoaderProvider>
                            </WorkbookStateRegistry>
                        </QueryExecutorProvider>
                    </ComputationRegistry>
                </TrinoConnector>
            </HyperConnector>
        </SalesforceConnector>
    </ConnectionRegistry>
);

const AppProviders = (props: { children: React.ReactElement }) => (
    <GitHubTheme>
        <PlatformTypeProvider>
            <LoggerProvider>
                <FileDownloaderProvider>
                    <AppConfigProvider>
                        <PlatformEventListenerProvider>
                            <ProcessProvider>
                                <VersionCheck>
                                    <StorageProvider>
                                        <HttpClientProvider>
                                            <OllamaClientProvider>
                                                <HyperDatabaseClientProvider>
                                                    <DashQLCoreProvider>
                                                        <DashQLComputeProvider>
                                                            <WorkbookProviders>
                                                                <PageStateProviders>
                                                                    {props.children}
                                                                </PageStateProviders>
                                                            </WorkbookProviders>
                                                        </DashQLComputeProvider>
                                                    </DashQLCoreProvider>
                                                </HyperDatabaseClientProvider>
                                            </OllamaClientProvider>
                                        </HttpClientProvider>
                                    </StorageProvider>
                                </VersionCheck>
                            </ProcessProvider>
                        </PlatformEventListenerProvider>
                    </AppConfigProvider>
                </FileDownloaderProvider>
            </LoggerProvider>
        </PlatformTypeProvider>
    </GitHubTheme>
);

const Router = process.env.DASHQL_RELATIVE_IMPORTS ? HashRouter : BrowserRouter;

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
    logger.warn("React encountered a recoverable error", {
        error: error?.toString(),
        stack: errorInfo.componentStack,
    }, LOG_CTX, true);

}

const element = document.getElementById('root');
const root = createRoot(element!, {
    onRecoverableError: logRecoverableReactError
});
root.render(
    <Router>
        <RouterReset />
        <AppProviders>
            <FileDropzone>
                <NavBarContainer>
                    <Routes>
                        <Route index Component={WorkbookPage} />
                        <Route path="/workbook" Component={WorkbookPage} />
                        <Route path="/connection" Component={ConnectionSettingsPage} />
                        {isDebugBuild() && (
                            <>
                                <Route path="/experiments/ui" Component={UIExperimentPage} />
                                <Route path="/experiments/ident" Component={IdentExperimentPage} />
                                <Route path="/experiments/schema" Component={SchemaGraphDemoPage} />
                                <Route path="/experiments/hyperplan" Component={HyperPlanDemoPage} />
                            </>
                        )}
                        <Route path="*" element={<Navigate to="/" />} />
                    </Routes>
                </NavBarContainer>
            </FileDropzone>
        </AppProviders>
    </Router>
);
