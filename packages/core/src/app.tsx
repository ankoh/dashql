import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { GitHubAuthProvider, GitHubProfileProvider } from './github';
import {
    LogProvider,
    DatabaseMetadataProvider,
    ProgramContextProvider,
    PlanContextProvider,
    ScriptRegistryProvider,
} from './model';
import { Route, BrowserRouter, Routes, Navigate } from 'react-router-dom';
import { Explorer, Examples, Viewer, NotFound, Account, Cloud } from './pages';
import { withNavBar, OverlayProvider, withScriptLoader } from './components';
import { AppLauncher } from './app_launcher';
import { AppConfigResolver } from './app_config';

import 'bootstrap/dist/css/bootstrap.min.css';

import './vars.module.css';
import './app.module.css';
import '../static/fonts/fonts.module.css';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import 'react-virtualized/styles.css';

const DataProviders = (props: { children: React.ReactElement }) => (
    <LogProvider>
        <GitHubAuthProvider>
            <GitHubProfileProvider>
                <DatabaseMetadataProvider>
                    <ProgramContextProvider>
                        <PlanContextProvider>
                            <ScriptRegistryProvider>
                                <OverlayProvider>{props.children}</OverlayProvider>
                            </ScriptRegistryProvider>
                        </PlanContextProvider>
                    </ProgramContextProvider>
                </DatabaseMetadataProvider>
            </GitHubProfileProvider>
        </GitHubAuthProvider>
    </LogProvider>
);

const ViewerPage = withNavBar(withScriptLoader(Viewer));
const ExplorerPage = withNavBar(withScriptLoader(Explorer));
const ExamplesPage = withNavBar(Examples);
const AccountPage = withNavBar(Account);
const CloudPage = withNavBar(Cloud);
// const ExplorerPage = withNavBar(withBanner(Explorer));
// const ExamplesPage = withNavBar(withBanner(Examples));

ReactDOM.render(
    <DataProviders>
        <AppConfigResolver>
            <AppLauncher>
                <BrowserRouter>
                    <Routes>
                        <Route path="/explorer/*" element={<ExplorerPage />} />
                        <Route path="/examples" element={<ExamplesPage />} />
                        <Route path="/viewer/*" element={<ViewerPage />} />
                        <Route path="/account/*" element={<AccountPage />} />
                        <Route path="/cloud/*" element={<CloudPage />} />
                        <Route path="/404" element={<NotFound />} />
                        <Route path="/" element={<Navigate to="/explorer" />} />
                        <Route path="*" element={<Navigate to="/404" />} />
                    </Routes>
                </BrowserRouter>
            </AppLauncher>
        </AppConfigResolver>
    </DataProviders>,
    document.getElementById('root'),
);
