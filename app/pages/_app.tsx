import React from 'react';
import { Provider as ReduxProvider } from 'react-redux';
import NextApp from 'next/app';
import Head from 'next/head';
import withRedux from 'next-redux-wrapper';
import { createStore, ReduxStore } from '../store';
import { AppContextProvider, IAppContext } from '../app_context';
import { RootController } from '../controller';

import '../view/index.scss';

const store = createStore();

const controller = new RootController(store);
controller.init();

const appContext: IAppContext = {
    controller,
};

class App extends NextApp<{ store: ReduxStore }> {
    render() {
        const { Component, pageProps, store } = this.props;

        return (
            <div>
                <Head>
                    <script type="text/javascript" src="/core/dashql_core.js"></script>
                </Head>

                <ReduxProvider store={store}>
                    <AppContextProvider value={appContext}>
                        <Component {...pageProps} />
                    </AppContextProvider>
                </ReduxProvider>
            </div>
        );
    }
}

export default withRedux(() => store)(App);
