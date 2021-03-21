import * as webdb from '@dashql/webdb/dist/webdb_async';
import * as React from 'react';
import * as platform from '../platform';
import * as proto from '@dashql/proto';

export interface Query {
    before?: string;
    data: string;
    after?: string;
    options?: webdb.QueryRunOptions;
}

function queryEquals(l: Query, r: Query) {
    return (
        l.data == r.data &&
        ((!l.before && !r.before) || l.before == r.before) &&
        ((!l.after && !r.after) || l.after == r.after) &&
        webdb.queryOptionsEqual(l.options, r.options)
    );
}

interface Props {
    /// The log manager
    logger: webdb.Logger;
    /// The database manager
    database: platform.DatabaseManager;
    /// The query
    query: Query;
    /// The error component
    errorComponent?: ((error: string) => React.ReactNode) | null;
    /// The in-flight component
    inFlightComponent?: ((query: Query) => React.ReactNode) | null;
    /// The children
    children: (result: proto.webdb.QueryResult) => React.ReactNode;
}

interface State {
    /// The query
    query: Query | null;
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
    _inFlightQuery: Query | null = null;
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
        if (!!this.state.query && queryEquals(this.props.query, this.state.query)) {
            return;
        }
        const text = this.props.query;
        this._inFlightQuery = this.props.query;
        const query = this.props.query;
        this._queryPromise = this.props.database.use(async conn => {
            let result: proto.webdb.QueryResult;
            try {
                if (query.before) {
                    await conn.runQuery(query.before);
                }
                result = await conn.runQuery(query.data, query.options);
                return result;
            } catch (e) {
                console.error(e);
                throw e;
            } finally {
                try {
                    if (query.after) {
                        await conn.runQuery(query.after);
                    }
                } catch (e) {
                    console.error(e);
                }
            }
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
            return this.props.inFlightComponent(this._inFlightQuery);
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
