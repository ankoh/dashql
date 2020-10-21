import * as React from "react";
import * as ReactDOM from "react-dom";
import { Route, BrowserRouter, Switch, Redirect } from 'react-router-dom';

import { HelloWorld, NotFound } from "./pages";

ReactDOM.render(
    <BrowserRouter>
        <Switch>
            <Route exact path="/" component={HelloWorld} />
            <Route path="/404" component={NotFound} />
            <Redirect to="/404" />
        </Switch>
    </BrowserRouter>,
    document.getElementById("root")
);
