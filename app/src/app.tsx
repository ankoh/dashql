import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { createStore } from './store';
import { AppController } from './controller';
import { Route, BrowserRouter, Switch, Redirect } from 'react-router-dom';
import { Provider as ReduxProvider } from 'react-redux';
import { Studio, NotFound } from './pages';
import { withNavBar } from './components';
import { AppContextProvider, IAppContext } from './app_context';

import './app.module.css';
import './fonts/fonts.module.css';
import '../node_modules/react-grid-layout/css/styles.css';
import '../node_modules/react-resizable/css/styles.css';

const store = createStore();
const controller = new AppController(store);
controller.init();

const appContext: IAppContext = {
    controller: controller,
};

ReactDOM.render(
    <ReduxProvider store={store}>
        <AppContextProvider value={appContext}>
            <BrowserRouter>
                <Switch>
                    <Route
                        exact
                        path="/studio"
                        component={withNavBar(Studio)}
                    />
                    <Route path="/404" component={NotFound} />
                    <Redirect to="/404" />
                </Switch>
            </BrowserRouter>
        </AppContextProvider>
    </ReduxProvider>,
    document.getElementById('root'),
);
