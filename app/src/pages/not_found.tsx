import * as React from "react";

export interface NotFoundProps { }

export class NotFound extends React.Component<NotFoundProps, {}> {
    render() {
        return <h1>Page not found!</h1>;
    }
}
