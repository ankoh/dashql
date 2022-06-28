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

const Router = isElectron ? HashRouter : BrowserRouter;

ReactDOM.render(
    <AppConfigResolver>
        <AppLauncher>
            <Router>
                <Routes>
                    <Route path="/explorer/*" element={<Explorer />} />
                    <Route path="/404" element={<NotFound />} />
                    <Route path="/" element={<Navigate to="/explorer" />} />
                    <Route path="*" element={<Navigate to="/404" />} />
                </Routes>
            </Router>
        </AppLauncher>
    </AppConfigResolver>,
    document.getElementById('root'),
);
