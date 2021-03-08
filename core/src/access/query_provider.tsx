import * as webdb from '@dashql/webdb/dist/webdb_async';
import * as React from 'react';
import * as platform from '../platform';
import * as proto from '@dashql/proto';

interface Props {
    /// The log manager
    logger: webdb.Logger;
    /// The database manager
    database: platform.DatabaseManager;
    /// The query
    query: string;
    /// The error component
    errorComponent?: ((error: string) => React.ReactNode) | null;
    /// The in-flight component
    inFlightComponent?: ((query: string) => React.ReactNode) | null;
    /// The children
    children: (result: proto.webdb.QueryResult) => React.ReactNode;
}

interface State {
    /// The query
    queryText: string | null;
    /// The query result
    queryResult: proto.webdb.QueryResult | null;
    /// The error
    error: string | null;
}

export class QueryProvider extends React.Component<Props, State> {
    /// The query succeeded
    _querySucceeded = this.querySucceeded.bind(this);
    /// The query failed
    _queryFailed = this.queryFailed.bind(this);
    /// The evaluation handler
    _evaluate = this.evaluate.bind(this);
    /// The scheduled query
    _inFlightQuery: string | null = null;
    /// The query promise
    _queryPromise: Promise<proto.webdb.QueryResult> | null = null;

    constructor(props: Props) {
        super(props);
        this.state = {
            queryText: null,
            queryResult: null,
            error: null,
        };
    }

    protected querySucceeded(result: proto.webdb.QueryResult) {
        const text = this._inFlightQuery;
        this._inFlightQuery = null;
        this._queryPromise = null;
        setImmediate(this._evaluate);
        this.setState({
            queryText: text,
            queryResult: result,
        });
    }

    protected queryFailed(e: any) {
        console.error(e);
        this._inFlightQuery = null;
        this._queryPromise = null;
        setImmediate(this._evaluate);
    }

    protected evaluate() {
        if (this.props.query == this.state.queryText || this.props.query == this._inFlightQuery) {
            return;
        }
        const text = this.props.query;
        this._inFlightQuery = this.props.query;
        this._queryPromise = this.props.database.use(async conn => {
            return await conn.runQuery(text);
        });
        this._queryPromise.then(this._querySucceeded).catch(this._queryFailed);
    }

    componentDidMount() {
        this.evaluate();
    }

    componentDidUpdate() {
        this.evaluate();
    }

    componentWillUnmount() {
        if (this._queryPromise) {
            // XXX cancel the in-flight query
        }
    }

    // Pass the scan function to the child
    render() {
        // Query in flight?
        if (this._inFlightQuery && this.props.inFlightComponent) {
            return this.props.inFlightComponent(this._inFlightQuery!);
        }
        // Query failed?
        if (this.state.error && this.props.errorComponent) {
            return this.props.errorComponent(this.state.error);
        }
        // Query OK?
        if (this.state.queryResult) {
            return this.props.children(this.state.queryResult);
        }
        return <div />;
    }
}

