import * as React from "react";
import * as ReactDOM from "react-dom";
import * as Store from './store';
import { Route, BrowserRouter, Switch, Redirect } from 'react-router-dom';
import { Provider as ReduxProvider } from 'react-redux';
import { HelloWorld, NotFound } from "./pages";

import "./app.module.css";
import "./fonts/fonts.module.css";

const store = Store.createStore();

ReactDOM.render(
    <ReduxProvider store={store}>
        <BrowserRouter>
            <Switch>
                <Route exact path="/explorer" component={HelloWorld} />
                <Route path="/404" component={NotFound} />
                <Redirect to="/explorer" />
            </Switch>
        </BrowserRouter>
    </ReduxProvider>,
    document.getElementById("root")
);
