import * as React from "react";
import * as ReactDOM from "react-dom";
import * as Store from './store';
import { Route, BrowserRouter, Switch, Redirect } from 'react-router-dom';
import { Provider as ReduxProvider } from 'react-redux';
import { HelloWorld, NotFound } from "./pages";

const store = Store.createStore();

ReactDOM.render(
    <ReduxProvider store={store}>
        <BrowserRouter>
            <Switch>
                <Route exact path="/" component={HelloWorld} />
                <Route path="/404" component={NotFound} />
                <Redirect to="/404" />
            </Switch>
        </BrowserRouter>
    </ReduxProvider>,
    document.getElementById("root")
);
