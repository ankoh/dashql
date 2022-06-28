import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { Route, BrowserRouter, Routes, Navigate } from 'react-router-dom';
import { AppLauncher } from './app_launcher';
import { NotFound } from './pages/not_found';
import { AppConfigResolver } from './model/app_config';
// import { GitHubAuthProvider, GitHubProfileProvider } from '../github';

import './globals.module.css';
import './app.module.css';
import '../static/fonts/fonts.module.css';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import 'react-virtualized/styles.css';
import 'bootstrap/dist/css/bootstrap.min.css';

ReactDOM.render(<div>Hello World 2</div>, document.getElementById('root'));

ReactDOM.render(
    <AppConfigResolver>
        <AppLauncher>
            <BrowserRouter>
                <Routes>
                    <Route path="/explorer/*" element={<div>Explorer</div>} />
                    <Route path="/404" element={<NotFound />} />
                    <Route path="/" element={<Navigate to="/explorer" />} />
                    <Route path="*" element={<Navigate to="/404" />} />
                </Routes>
            </BrowserRouter>
        </AppLauncher>
    </AppConfigResolver>,
    document.getElementById('root'),
);
