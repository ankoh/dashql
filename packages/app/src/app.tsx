import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as model from './model';
import * as core from '@dashql/core';
import { launchApp } from './app_launcher';
import { Route, BrowserRouter, Switch, Redirect } from 'react-router-dom';
import { Provider as ReduxProvider } from 'react-redux';
import { Launcher, Studio, Examples, Viewer, NotFound } from './pages';
import { withNavBar } from './components';
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

ReactDOM.render(
    <AppContextProvider value={ctx}>
        <ReduxProvider store={ctx.store}>
            <Launcher>
                <BrowserRouter>
                    <Switch>
                        <Route exact path="/studio" component={withNavBar(Studio)} />
                        <Route exact path="/examples" component={withNavBar(Examples)} />
                        <Route exact path="/viewer" component={Viewer} />
                        <Route path="/404" component={NotFound} />
                        <Redirect path="/" to="/studio" />
                        <Redirect to="/404" />
                    </Switch>
                </BrowserRouter>
            </Launcher>
        </ReduxProvider>
    </AppContextProvider>,
    document.getElementById('root'),
);
