import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as model from './model';
import { Route, BrowserRouter, Routes, Navigate } from 'react-router-dom';
import { Studio, Examples, Viewer, NotFound } from './pages';
import { withNavBar, withMinimalNavBar, withBanner } from './components';
import { LaunchProgressProvider } from './model/launch_progress';
import { AppLauncher } from './app_launcher';

import 'bootstrap/dist/css/bootstrap.min.css';

import './app.module.css';
import './fonts/fonts.module.css';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import 'react-virtualized/styles.css';

const StudioPage = withNavBar(withBanner(Studio));
const ExamplesPage = withNavBar(withBanner(Examples));
const ViewerPage = withBanner(withMinimalNavBar(Viewer));

const DataProviders = (props: { children: React.ReactElement }) => (
    <model.LogProvider>
        <model.DatabaseMetadataProvider>
            <model.ProgramContextProvider>
                <model.PlanContextProvider>
                    <LaunchProgressProvider>{props.children}</LaunchProgressProvider>
                </model.PlanContextProvider>
            </model.ProgramContextProvider>
        </model.DatabaseMetadataProvider>
    </model.LogProvider>
);

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
