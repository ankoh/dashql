import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as core from '@dashql/core';
import * as webdb from '@dashql/webdb/dist/webdb_async';
import { createStore } from './model';
import { BrowserPlatform } from './platform';
import { AppController } from './controller';
import { Route, BrowserRouter, Switch, Redirect } from 'react-router-dom';
import { Provider as ReduxProvider } from 'react-redux';
import { Studio, NotFound } from './pages';
import { withNavBar } from './components';
import { AppContextProvider, IAppContext } from './app_context';

import './app.module.css';
import './fonts/fonts.module.css';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

import webdb_wasm from '@dashql/webdb/dist/webdb.wasm';
import webdb_worker from '@dashql/webdb/dist/webdb_async.worker.js';
import analyzer_wasm from '@dashql/core/dist/dashql_analyzer.wasm';

const dbWorker = webdb.spawnWorker(webdb_worker);
const db = new webdb.AsyncWebDB(dbWorker);
db.open(webdb_wasm);

const analyzer = new core.analyzer.Analyzer({}, analyzer_wasm);
const store = createStore();
const platform = new BrowserPlatform(store, analyzer);

const controller = new AppController(platform);
controller.init();

const appContext: IAppContext = {
    controller: controller,
};

ReactDOM.render(
    <ReduxProvider store={store}>
        <AppContextProvider value={appContext}>
            <BrowserRouter>
                <Switch>
                    <Route exact path="/studio" component={withNavBar(Studio)} />
                    <Route path="/404" component={NotFound} />
                    <Redirect to="/404" />
                </Switch>
            </BrowserRouter>
        </AppContextProvider>
    </ReduxProvider>,
    document.getElementById('root'),
);
