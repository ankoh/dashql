import * as React from "react";
import { NavigationBar } from "../components";

export interface HelloWorldProps { }

export class HelloWorld extends React.Component<HelloWorldProps, {}> {
    render() {
        return <div>
            <NavigationBar />
            <h1>Hi there from React!</h1>
        </div>;
    }
}
