import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { Explorer } from './pages/explorer';
import { NotFound } from './pages/not_found';
import { Route, BrowserRouter, Routes, Navigate, HashRouter } from 'react-router-dom';
import { AppLauncher } from './app_launcher';
import { AppConfigResolver } from './model/app_config';
import { isElectron } from './utils';
// import { GitHubAuthProvider, GitHubProfileProvider } from '../github';

import './globals.module.css';
import './app.module.css';
import '../static/fonts/fonts.module.css';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import 'react-virtualized/styles.css';
import 'bootstrap/dist/css/bootstrap.min.css';
import { withNavBar } from './components/navbar';
import { WasmBackendProvider } from './backend/wasm_backend_provider';
import { WorkflowDataProvider, WorkflowSessionProvider } from './backend/workflow_data_provider';

const Router = isElectron ? HashRouter : BrowserRouter;

const ExplorerPage = withNavBar(Explorer);

ReactDOM.render(
    <AppConfigResolver>
        <WasmBackendProvider>
            <AppLauncher>
                <WorkflowDataProvider>
                    <WorkflowSessionProvider>
                        <Router>
                            <Routes>
                                <Route path="/explorer/*" element={<ExplorerPage />} />
                                <Route path="/404" element={<NotFound />} />
                                <Route path="/" element={<Navigate to="/explorer" />} />
                                <Route path="*" element={<Navigate to="/404" />} />
                            </Routes>
                        </Router>
                    </WorkflowSessionProvider>
                </WorkflowDataProvider>
            </AppLauncher>
        </WasmBackendProvider>
    </AppConfigResolver>,
    document.getElementById('root'),
);
