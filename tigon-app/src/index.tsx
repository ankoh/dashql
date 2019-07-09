import * as React from 'react';
import * as ReactDOM from 'react-dom';
import Router from './components/Router';
import { Provider as ReduxProvider } from 'react-redux';
import { Controller, Logger } from './controller';
import { AppContextProvider, IAppContext } from './AppContext';
import { configureStore } from './configureStore';

import './fonts.css';
import './index.css';

const store = configureStore();
const logger = new Logger(store);
const controller = new Controller(store, logger);

controller.init();

const appContext: IAppContext = {
    controller
};

ReactDOM.render(
    <ReduxProvider store={store}>
        <AppContextProvider value={appContext}>
            <Router />
        </AppContextProvider>
    </ReduxProvider>,
    document.getElementById('root') as HTMLElement
);
