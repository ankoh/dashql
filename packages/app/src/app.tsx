import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as model from './model';
import * as core from '@dashql/core';
import { launchApp } from './app_launcher';
import { Route, BrowserRouter, Routes, Navigate } from 'react-router-dom';
import { Provider as ReduxProvider } from 'react-redux';
import { Launcher, Studio, Examples, Viewer, NotFound } from './pages';
import { withNavBar, withMinimalNavBar, withBanner } from './components';
import { AppContextProvider, IAppContext } from './app_context';

import 'bootstrap/dist/css/bootstrap.min.css';

import './app.module.css';
import './fonts/fonts.module.css';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import 'react-virtualized/styles.css';

const store = model.createStore();
const logger = new core.platform.LogManager(store);

const ctx: IAppContext = {
    store,
    logger,
    platform: null,
};

launchApp(ctx).catch(e => {
    console.error(e);
});

const StudioPage = withNavBar(withBanner(Studio));
const ExamplesPage = withNavBar(withBanner(Examples));
const ViewerPage = withBanner(withMinimalNavBar(Viewer));

ReactDOM.render(
    <AppContextProvider value={ctx}>
        <ReduxProvider store={ctx.store}>
            <Launcher>
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
            </Launcher>
        </ReduxProvider>
    </AppContextProvider>,
    document.getElementById('root'),
);
