import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { createStore } from './model';
import { launchApp } from './app_launcher';
import { Route, BrowserRouter, Switch, Redirect } from 'react-router-dom';
import { Provider as ReduxProvider } from 'react-redux';
import { Launcher, Studio, NotFound } from './pages';
import { withNavBar } from './components';
import { AppContextProvider, IAppContext } from './app_context';

import './app.module.css';
import './fonts/fonts.module.css';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const store = createStore();
const appContext: IAppContext = {
    store: store,
    platform: null
};

launchApp(appContext)
    .catch((e) => { console.error(e); });

ReactDOM.render(
    <AppContextProvider value={appContext}>
        <ReduxProvider store={store}>
            <Launcher>
                <BrowserRouter>
                    <Switch>
                        <Route exact path="/studio" component={withNavBar(Studio)} />
                        <Route path="/404" component={NotFound} />
                        <Redirect to="/404" />
                    </Switch>
                </BrowserRouter>
            </Launcher>
        </ReduxProvider>
    </AppContextProvider>,
    document.getElementById('root'),
);
