import * as Immutable from "immutable";
import * as webdb from '@dashql/webdb/dist/webdb_async';
import * as React from 'react';
import * as platform from '../platform';
import * as proto from '@dashql/proto';

type RequestQueryFn = (request: QueryRequest) => void;

export class QueryRequest {
    /// The query key.
    /// Results with the same key are overwritten.
    queryKey: number;
    /// The query
    queryText: string;
    /// The targets
    targets: string[];

    constructor(key: number, text: string, targets: string[]) {
        this.queryKey = key;
        this.queryText = text;
        this.targets = targets;
    }

    public equals(other: QueryRequest): boolean {
        return this.queryKey == other.queryKey && this.queryText == other.queryText;
    }
}

export interface QueryResult {
    /// The scan request
    request: QueryRequest;
    /// The query result buffer
    result: proto.webdb.QueryResult;
}

interface Props {
    /// The log manager
    logger: webdb.Logger;
    /// The database manager
    database: platform.DatabaseManager;
    /// The children
    children: (queryResults: Immutable.Map<number, QueryResult>, requestQuery: RequestQueryFn) => React.ReactNode;
}

interface State {
    /// The results
    results: Immutable.Map<number, QueryResult>;
}

export class QueryProvider extends React.Component<Props, State> {
    /// Function to request data from the provider
    _requestQuery = this.requestQuery.bind(this);
    /// The schedule function
    _schedule = this.schedule.bind(this);
    /// The handler to process a query result
    _processQueryResult = this.processQueryResult.bind(this);

    /// The query queue
    _queryQueue: number[] = [];
    /// The currently queued requests
    _queuedRequests: Map<number, QueryRequest> = new Map();
    /// The in-flight query
    _queryInFlight: QueryRequest | null = null;
    /// The query promise
    _queryPromise: Promise<QueryResult> | null = null;

    constructor(props: Props) {
        super(props);
        this.state = {
            results: Immutable.Map(),
        };
    }

    /// Request a query
    protected requestQuery(request: QueryRequest) {
        if (this.state.results.has(request.queryKey) && this.state.results.get(request.queryKey)!.request.equals(request)) {
            return;
        }
        this.scheduleIfNecessary(request);
    }

    /// Run a query
    protected async runQuery(request: QueryRequest): Promise<QueryResult> {
        const result = await this.props.database.use(async conn => {
            return await conn.runQuery(request.queryText);
        });
        return {
            request,
            result,
        };
    }

    /// Process the query result
    protected processQueryResult(result: QueryResult) {
        this._queryPromise = null;
        this._queryInFlight = null;
        setImmediate(this._schedule);
        this.setState({
            results: this.state.results.set(result.request.queryKey, result),
        });
    }

    /// Schedule a queued query if no query is in-flight
    protected schedule() {
        if (this._queryInFlight || this._queryQueue.length == 0) return;
        const key = this._queryQueue.shift()!;
        this._queryInFlight = this._queuedRequests.get(key)!;
        this._queuedRequests.delete(key);
        this._queryPromise = this.runQuery(this._queryInFlight);
        this._queryPromise.then(this._processQueryResult).catch(e => console.error(e));
    }

    /// Schedule a query the data cannot be served from the cached results
    protected scheduleIfNecessary(req: QueryRequest) {
        // In-flight query equals our request?
        // Wait for the result then.
        if (this._queryInFlight && this._queryInFlight.equals(req)) {
            return;
        }

        // Replace the queued query if there is one.
        // Note that this may lead to queries overtaking each other if a previous query with the same key exists.
        // We accept that here for simplicity reasons.
        // The query provider is FIFO "most of the time".
        if (!this._queuedRequests.has(req.queryKey)) {
            this._queryQueue.push(req.queryKey);
        }
        this._queuedRequests.set(req.queryKey, req);

        // Schedule the queued query
        this.schedule();
    }

    componentWillUnmount() {
        if (this._queryPromise) {
            // XXX cancel the in-flight query
        }
    }

    // Pass the scan function to the child
    render() {
        return this.props.children(this.state.results, this._requestQuery);
    }
}
