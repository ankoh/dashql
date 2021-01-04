import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as core from '@dashql/core';
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

import dashql_analyzer_wasm from '@dashql/core/dist/dashql_analyzer.wasm';

const analyzer = new core.analyzer.Analyzer({}, dashql_analyzer_wasm);
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
