import * as React from "react";

export interface HelloWorldProps { }

export class HelloWorld extends React.Component<HelloWorldProps, {}> {
    render() {
        return <h1>Hi there from React!</h1>;
    }
}
