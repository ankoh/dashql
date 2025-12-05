import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Route, Routes, Navigate, BrowserRouter, HashRouter } from 'react-router-dom';

import { AppConfigProvider } from './app_config.js';
import { AppSetupListener } from './app_setup_listener.js';
import { CatalogLoaderProvider } from './connection/catalog_loader.js';
import { ComputationRegistry } from './compute/computation_registry.js';
import { ConnectionRegistry } from './connection/connection_registry.js';
import { ConnectionSettingsPage } from './view/connection/connection_settings_page.js';
import { DashQLComputeProvider } from './compute/compute_provider.js';
import { DashQLCoreProvider } from './core_provider.js';
import { DefaultConnectionProvider } from './connection/default_connections.js';
import { DefaultWorkbookProvider } from './workbook/default_workbooks.js';
import { FileDownloaderProvider } from './platform/file_downloader_provider.js';
import { FileDropzone } from './view/file_dropzone.js';
import { GitHubTheme } from './github_theme.js';
import { HttpClientProvider } from './platform/http_client_provider.js';
import { HyperDatabaseClientProvider } from './connection/hyper/hyperdb_client_provider.js';
import { HyperGrpcConnector } from './connection/hyper/hyper_connector.js';
import { HyperGrpcConnectorSettingsStateProvider } from './view/connection/hyper_connection_settings.js';
import { HyperPlanDemoPage } from './view/internals/hyper_plan_demo.js';
import { IdentInternalsPage } from './view/internals/ident_internals_page.js';
import { LoggerProvider } from './platform/logger_provider.js';
import { NavBarContainer } from './view/navbar.js';
import { OllamaClientProvider } from './platform/ollama_client_provider.js';
import { PlatformEventListenerProvider } from './platform/event_listener_provider.js';
import { PlatformTypeProvider } from './platform/platform_type.js';
import { ProcessProvider } from './platform/process.js';
import { QueryExecutorProvider } from './connection/query_executor.js';
import { SalesforceConnector } from './connection/salesforce/salesforce_connector.js';
import { SalesforceConnectorSettingsStateProvider } from './view/connection/salesforce_connection_settings.js';
import { SchemaGraphDemoPage } from './view/internals/schema_graph_demo.js';
import { ScriptLoader } from './workbook/script_loader.js';
import { StorageProvider } from './platform/storage_provider.js';
import { TrinoConnector } from './connection/trino/trino_connector.js';
import { TrinoConnectorSettingsStateProvider } from './view/connection/trino_connection_settings.js';
import { UIInternalsPage } from './view/internals/ui_internals_page.js';
import { VersionCheck } from './platform/version_check.js';
import { WorkbookCommands } from './workbook/workbook_commands.js';
import { WorkbookPage } from './view/workbook/workbook_page.js';
import { WorkbookStateRegistry } from './workbook/workbook_state_registry.js';
import { isDebugBuild } from './globals.js';

import './../static/fonts/fonts.css';
import './colors.css';
import './globals.css';

// We decouple (some) page states from the actual page views to remember user input
const PageStateProviders = (props: { children: React.ReactElement }) => (
    <SalesforceConnectorSettingsStateProvider>
        <HyperGrpcConnectorSettingsStateProvider>
            <TrinoConnectorSettingsStateProvider>
                {props.children}
            </TrinoConnectorSettingsStateProvider>
        </HyperGrpcConnectorSettingsStateProvider>
    </SalesforceConnectorSettingsStateProvider>
);

// Note that the order among connection providers is important and non-obvious.
// For example:
// - CatalogLoaderProvider requires the WorkbookStateRegistry to mark connection workbooks as outdated.
const WorkbookProviders = (props: { children: React.ReactElement }) => (
    <ConnectionRegistry>
        <SalesforceConnector>
            <HyperGrpcConnector>
                <TrinoConnector>
                    <ComputationRegistry>
                        <QueryExecutorProvider>
                            <WorkbookStateRegistry>
                                <CatalogLoaderProvider>
                                    <DefaultConnectionProvider>
                                        <DefaultWorkbookProvider>
                                            <>
                                                <ScriptLoader />
                                                <WorkbookCommands>
                                                    <AppSetupListener>
                                                        {props.children}
                                                    </AppSetupListener>
                                                </WorkbookCommands>
                                            </>
                                        </DefaultWorkbookProvider>
                                    </DefaultConnectionProvider>
                                </CatalogLoaderProvider>
                            </WorkbookStateRegistry>
                        </QueryExecutorProvider>
                    </ComputationRegistry>
                </TrinoConnector>
            </HyperGrpcConnector>
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

const element = document.getElementById('root');
const root = createRoot(element!);
root.render(
    <Router>
        <AppProviders>
            <FileDropzone>
                <NavBarContainer>
                    <Routes>
                        <Route index Component={WorkbookPage} />
                        <Route path="/workbook" Component={WorkbookPage} />
                        <Route path="/connection" Component={ConnectionSettingsPage} />
                        {isDebugBuild() && (
                            <>
                                <Route path="/internals/ui" Component={UIInternalsPage} />
                                <Route path="/internals/ident" Component={IdentInternalsPage} />
                                <Route path="/internals/schema" Component={SchemaGraphDemoPage} />
                                <Route path="/internals/hyperplan" Component={HyperPlanDemoPage} />
                            </>
                        )}
                        <Route path="*" element={<Navigate to="/" />} />
                    </Routes>
                </NavBarContainer>
            </FileDropzone>
        </AppProviders>
    </Router>
);
