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
    /// The query options
    queryOptions?: webdb.QueryRunOptions;
    /// The error component
    errorComponent?: ((error: string) => React.ReactNode) | null;
    /// The in-flight component
    inFlightComponent?: ((query: string, queryOptions: webdb.QueryRunOptions) => React.ReactNode) | null;
    /// The children
    children: (result: proto.webdb.QueryResult) => React.ReactNode;
}

interface State {
    /// The query
    query: [string, webdb.QueryRunOptions] | null;
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
    _inFlightQuery: [string, webdb.QueryRunOptions] | null = null;
    /// The query promise
    _queryPromise: Promise<proto.webdb.QueryResult> | null = null;

    constructor(props: Props) {
        super(props);
        this.state = {
            query: null,
            queryResult: null,
            error: null,
        };
    }

    protected querySucceeded(result: proto.webdb.QueryResult) {
        const query = this._inFlightQuery;
        this._inFlightQuery = null;
        this._queryPromise = null;
        this.setState({
            query: query,
            queryResult: result,
            error: null,
        });
    }

    protected queryFailed(e: any) {
        console.error(e);
        const query = this._inFlightQuery;
        this._inFlightQuery = null;
        this._queryPromise = null;
        this.setState({
            query: query,
            queryResult: null,
            error: e,
        });
    }

    protected evaluate() {
        if (this._inFlightQuery != null) return;
        if (this.props.query == this.state.query?.[0] && webdb.queryOptionsEqual(this.props.queryOptions, this.state.query?.[1])) {
            return;
        }
        const text = this.props.query;
        this._inFlightQuery = [this.props.query, this.props.queryOptions || {}];
        const options = this.props.queryOptions;
        this._queryPromise = this.props.database.use(async conn => {
            return await conn.runQuery(text, options);
        });
        this._queryPromise.then(this._querySucceeded).catch(this._queryFailed);
    }

    componentDidMount() {
        this.evaluate();
    }

    componentDidUpdate(prevProps: Props, prevState: State) {
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
            return this.props.inFlightComponent(this._inFlightQuery![0], this._inFlightQuery![1]);
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
