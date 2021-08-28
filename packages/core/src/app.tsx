import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as duckdb from '@dashql/duckdb/dist/duckdb.module.js';
import { GitHubAuthProvider, GitHubProfileProvider } from './github';
import {
    LogProvider,
    DatabaseMetadataProvider,
    ProgramContextProvider,
    PlanContextProvider,
    LaunchProgressProvider,
    ScriptRegistryProvider,
} from './model';
import { Route, BrowserRouter, Routes, Navigate } from 'react-router-dom';
import { Explorer, Examples, Viewer, NotFound, Account } from './pages';
import { withNavBar, OverlayProvider, withScriptLoader } from './components';
import { AppLauncher } from './app_launcher';

import 'bootstrap/dist/css/bootstrap.min.css';

import './app.module.css';
import '../static/fonts/fonts.module.css';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import 'react-virtualized/styles.css';

import duckdb_wasm from '@dashql/duckdb/dist/duckdb.wasm';
import duckdb_wasm_next from '@dashql/duckdb/dist/duckdb-next.wasm';
import duckdb_wasm_next_coi from '@dashql/duckdb/dist/duckdb-next-coi.wasm';

const DUCKDB_BUNDLES: duckdb.DuckDBBundles = {
    asyncDefault: {
        mainModule: duckdb_wasm,
        mainWorker: new URL('@dashql/duckdb/dist/duckdb-browser-async.worker.js', import.meta.url).toString(),
    },
    asyncNext: {
        mainModule: duckdb_wasm_next,
        mainWorker: new URL('@dashql/duckdb/dist/duckdb-browser-async-next.worker.js', import.meta.url).toString(),
    },
    asyncNextCOI: {
        mainModule: duckdb_wasm_next_coi,
        mainWorker: new URL('@dashql/duckdb/dist/duckdb-browser-async-next-coi.worker.js', import.meta.url).toString(),
        pthreadWorker: new URL(
            '@dashql/duckdb/dist/duckdb-browser-async-next-coi.pthread.worker.js',
            import.meta.url,
        ).toString(),
    },
};

const DataProviders = (props: { children: React.ReactElement }) => (
    <LogProvider>
        <GitHubAuthProvider>
            <GitHubProfileProvider>
                <DatabaseMetadataProvider>
                    <ProgramContextProvider>
                        <PlanContextProvider>
                            <ScriptRegistryProvider>
                                <OverlayProvider>
                                    <LaunchProgressProvider>{props.children}</LaunchProgressProvider>
                                </OverlayProvider>
                            </ScriptRegistryProvider>
                        </PlanContextProvider>
                    </ProgramContextProvider>
                </DatabaseMetadataProvider>
            </GitHubProfileProvider>
        </GitHubAuthProvider>
    </LogProvider>
);

const ViewerPage = withScriptLoader(Viewer);
const ExplorerPage = withNavBar(withScriptLoader(Explorer));
const ExamplesPage = withNavBar(Examples);
const AccountPage = withNavBar(Account);
// const ExplorerPage = withNavBar(withBanner(Explorer));
// const ExamplesPage = withNavBar(withBanner(Examples));

ReactDOM.render(
    <DataProviders>
        <AppLauncher bundles={DUCKDB_BUNDLES}>
            <BrowserRouter>
                <Routes>
                    <Route path="/explorer/*" element={<ExplorerPage />} />
                    <Route path="/examples" element={<ExamplesPage />} />
                    <Route path="/viewer/*" element={<ViewerPage />} />
                    <Route path="/account/*" element={<AccountPage />} />
                    <Route path="/404" element={<NotFound />} />
                    <Route path="/" element={<Navigate to="/explorer" />} />
                    <Navigate to="/404" />
                </Routes>
            </BrowserRouter>
        </AppLauncher>
    </DataProviders>,
    document.getElementById('root'),
);
