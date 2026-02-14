import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Route, Routes, Navigate, BrowserRouter, HashRouter } from 'react-router-dom';

import { AppConfigProvider } from './app_config.js';
import { AppLoader } from './app_loader.js';
import { CatalogLoaderProvider } from './connection/catalog_loader.js';
import { ComputationRegistry } from './compute/computation_registry.js';
import { ComputationScheduler } from './compute/computation_scheduler.js';
import { ConnectionRegistry } from './connection/connection_registry.js';
import { ConnectionSettingsPage } from './view/connection/connection_settings_page.js';
import { DashQLComputeProvider } from './compute/compute_provider.js';
import { DashQLCoreProvider } from './core_provider.js';
import { FileDownloaderProvider } from './platform/file_downloader_provider.js';
import { FileDropzone } from './view/file_dropzone.js';
import { GitHubTheme } from './github_theme.js';
import { HttpClientProvider } from './platform/http_client_provider.js';
import { HyperConnector } from './connection/hyper/hyper_connector.js';
import { HyperConnectorSettingsStateProvider } from './view/connection/hyper_connection_settings.js';
import { HyperDatabaseClientProvider } from './connection/hyper/hyperdb_client_provider.js';
import { HyperPlanDemoPage } from './view/demos/plan_demo.js';
import { IdentExperimentPage } from './view/demos/ident_demo.js';
import { JsonViewerExperimentPage } from './view/demos/json_demo.js';
import { LoggerToast } from './view/logger_toast.js';
import { NavBarContainer } from './view/navbar.js';
import { OllamaClientProvider } from './platform/ollama_client_provider.js';
import { PlatformEventListenerProvider } from './platform/event_listener_provider.js';
import { PlatformTypeProvider } from './platform/platform_type.js';
import { ProcessProvider } from './platform/process.js';
import { PromptDemoPage } from './view/demos/prompt_demo.js';
import { QueryExecutorProvider } from './connection/query_executor.js';
import { RouterReset } from './router_reset.js';
import { SalesforceConnector } from './connection/salesforce/salesforce_connector.js';
import { SalesforceConnectorSettingsStateProvider } from './view/connection/salesforce_connection_settings.js';
import { StorageProvider } from './storage/storage_provider.js';
import { TrinoConnector } from './connection/trino/trino_connector.js';
import { TrinoConnectorSettingsStateProvider } from './view/connection/trino_connection_settings.js';
import { UIExperimentPage } from './view/demos/ui_demo.js';
import { VersionCheck } from './platform/version_check.js';
import { NotebookCommands } from './notebook/notebook_commands.js';
import { NotebookPage } from './view/notebook/notebook_page.js';
import { NotebookStateRegistry } from './notebook/notebook_state_registry.js';
import { getGlobalLogger, LoggerProvider } from './platform/logger_provider.js';
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
// - CatalogLoaderProvider requires the NotebookStateRegistry to mark connection notebooks as outdated.
const NotebookProviders = (props: { children: React.ReactElement }) => (
    <ConnectionRegistry>
        <SalesforceConnector>
            <HyperConnector>
                <TrinoConnector>
                    <ComputationRegistry>
                        <ComputationScheduler />
                        <QueryExecutorProvider>
                            <NotebookStateRegistry>
                                <CatalogLoaderProvider>
                                    <NotebookCommands>
                                        <AppLoader>
                                            {props.children}
                                        </AppLoader>
                                    </NotebookCommands>
                                </CatalogLoaderProvider>
                            </NotebookStateRegistry>
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
                <LoggerToast />
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
                                                            <NotebookProviders>
                                                                <PageStateProviders>
                                                                    {props.children}
                                                                </PageStateProviders>
                                                            </NotebookProviders>
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
    logger.info("React encountered a recoverable error", {
        error: error?.toString(),
        stack: errorInfo.componentStack,
    }, LOG_CTX);

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
                        <Route index Component={NotebookPage} />
                        <Route path="/notebook" Component={NotebookPage} />
                        <Route path="/connection" Component={ConnectionSettingsPage} />
                        {isDebugBuild() && (
                            <>
                                <Route path="/demo/ui" Component={UIExperimentPage} />
                                <Route path="/demo/ident" Component={IdentExperimentPage} />
                                <Route path="/demo/plan" Component={HyperPlanDemoPage} />
                                <Route path="/demo/json" Component={JsonViewerExperimentPage} />
                                <Route path="/demo/prompt" Component={PromptDemoPage} />
                            </>
                        )}
                        <Route path="*" element={<Navigate to="/" />} />
                    </Routes>
                </NavBarContainer>
            </FileDropzone>
        </AppProviders>
    </Router>
);
