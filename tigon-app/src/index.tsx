import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as Model from './model';
import Router from './view/Router';
import { AppContextProvider, IAppContext } from './AppContext';
import { FluidBackground } from './svg/Background';
import { Provider as ReduxProvider } from 'react-redux';
import { RootController, Logger } from './ctrl';

import './fonts/fonts.css';
import './index.css';

const store = Model.createStore();
const logger = new Logger(store);
const controller = new RootController(store, logger);

controller.init();

const appContext: IAppContext = {
    ctrl: controller,
};

ReactDOM.render(
    <ReduxProvider store={store}>
        <div className="Background">
            <FluidBackground />
        </div>
        <AppContextProvider value={appContext}>
            <Router />
        </AppContextProvider>
    </ReduxProvider>,
    document.getElementById('root') as HTMLElement
);
