import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { LogProvider } from './model/log';
import { Explorer } from './pages/explorer';
import { Examples } from './pages/examples';
import { NotFound } from './pages/not_found';
import { Route, BrowserRouter, Routes, Navigate, HashRouter } from 'react-router-dom';
import { AppLauncher } from './app_launcher';
import { AppConfigResolver } from './model/app_config';
import { isElectron } from './utils';
// import { GitHubAuthProvider, GitHubProfileProvider } from '../github';

import './globals.module.css';
import './app.module.css';
import './vendor/virtualized/styles.css';
import '../static/fonts/fonts.module.css';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import 'bootstrap/dist/css/bootstrap.min.css';

import { OverlayProvider } from './components/overlay';
import { withNavBar } from './components/navbar';
import { WasmBackendProvider } from './backend/wasm_backend_provider';
import { WorkflowSessionProvider } from './backend/workflow_session';
import { WorkflowDriver } from './backend/workflow_driver';
import { withScriptLoader } from './components/script_loader';

const Router = isElectron ? HashRouter : BrowserRouter;

const ExplorerPage = withNavBar(withScriptLoader(Explorer));
const ExamplesPage = withNavBar(Examples);

const root = createRoot(document.getElementById('root'));
root.render(
    <React.StrictMode>
        <AppConfigResolver>
            <LogProvider>
                <WasmBackendProvider>
                    <AppLauncher>
                        <WorkflowSessionProvider>
                            <WorkflowDriver>
                                <OverlayProvider>
                                    <Router>
                                        <Routes>
                                            <Route path="/explorer/*" element={<ExplorerPage />} />
                                            <Route path="/examples/*" element={<ExamplesPage />} />
                                            <Route path="/404" element={<NotFound />} />
                                            <Route path="/" element={<Navigate to="/explorer" />} />
                                            <Route path="*" element={<Navigate to="/404" />} />
                                        </Routes>
                                    </Router>
                                </OverlayProvider>
                            </WorkflowDriver>
                        </WorkflowSessionProvider>
                    </AppLauncher>
                </WasmBackendProvider>
            </LogProvider>
        </AppConfigResolver>
    </React.StrictMode>,
);
