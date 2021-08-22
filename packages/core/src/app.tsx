import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { GitHubAuthProvider, GitHubProfileProvider } from './github';
import { LogProvider, DatabaseMetadataProvider, ProgramContextProvider, PlanContextProvider } from './model';
import { Route, BrowserRouter, Routes, Navigate } from 'react-router-dom';
import { Studio, Examples, Viewer, NotFound } from './pages';
import { withNavBar, withMinimalNavBar, withBanner, PageOverlayProvider } from './components';
import { LaunchProgressProvider } from './model/launch_progress';
import { AppLauncher } from './app_launcher';

import 'bootstrap/dist/css/bootstrap.min.css';

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
                            <PageOverlayProvider>
                                <LaunchProgressProvider>{props.children}</LaunchProgressProvider>
                            </PageOverlayProvider>
                        </PlanContextProvider>
                    </ProgramContextProvider>
                </DatabaseMetadataProvider>
            </GitHubProfileProvider>
        </GitHubAuthProvider>
    </LogProvider>
);

const StudioPage = withNavBar(withBanner(Studio));
const ExamplesPage = withNavBar(withBanner(Examples));
const ViewerPage = withBanner(withMinimalNavBar(Viewer));

ReactDOM.render(
    <DataProviders>
        <AppLauncher>
            <BrowserRouter>
                <Routes>
                    <Route path="/studio/*" element={<StudioPage />} />
                    <Route path="/examples" element={<ExamplesPage />} />
                    <Route path="/viewer" element={<ViewerPage />} />
                    <Route path="/404" element={<NotFound />} />
                    <Route path="/" element={<Navigate to="/studio" />} />
                    <Navigate to="/404" />
                </Routes>
            </BrowserRouter>
        </AppLauncher>
    </DataProviders>,
    document.getElementById('root'),
);
