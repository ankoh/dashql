import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as Model from './model';
import Router from './view/router';
import { AppContextProvider, IAppContext } from './app_context';
import { Provider as ReduxProvider } from 'react-redux';
import { RootController } from './ctrl';

import './fonts/fonts.css';
import './index.scss';

const store = Model.createStore();
const controller = new RootController(store);

controller.init();

const appContext: IAppContext = {
    ctrl: controller,
};

ReactDOM.render(
    <ReduxProvider store={store}>
        <AppContextProvider value={appContext}>
            <Router />
        </AppContextProvider>
    </ReduxProvider>,
    document.getElementById('root') as HTMLElement
);
