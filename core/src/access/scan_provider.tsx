import * as React from 'react';
import * as platform from '../platform';
import * as proto from '@dashql/proto';

const OVERSCAN = 1024;

type RequestScanFn = (request: ScanRequest) => void;

export class ScanRequest {
    /// The offset of a range
    offset: number;
    /// The limit of a range
    limit: number;

    constructor(offset: number, limit: number) {
        this.offset = offset;
        this.limit = limit;
    }

    /// Does a scan fully include a given range?
    includes(offset: number, limit: number): boolean {
        const begin = this.offset;
        const end = this.offset + this.limit;
        return begin <= offset && end >= offset + limit;
    }

    /// Does a scan intersect a given range?
    intersects(offset: number, limit: number): boolean {
        const begin = this.offset;
        const end = this.offset + this.limit;
        return (
            (offset >= begin && offset + limit <= end) ||
            (offset <= begin && offset + limit >= begin) ||
            (offset < end && offset + limit >= end)
        );
    }
}

export interface ScanResult {
    /// The scan request
    request: ScanRequest;
    /// The query result buffer
    result: proto.webdb.QueryResult;
}

interface Props {
    /// The database manager
    database: platform.DatabaseManager;
    /// The table name
    targetName: string;
    /// The children
    children: (scanResult: ScanResult | null, requestScan: RequestScanFn) => JSX.Element;
}

interface State {
    /// The current request
    request: ScanRequest;
    /// The current data
    result: ScanResult | null;
}

export class ScanProvider extends React.Component<Props, State> {
    /// Function to request data from the provider
    _requestScan = this.requestScan.bind(this);
    /// The schedule function
    _schedule = this.schedule.bind(this);
    /// The handler to process a query result
    _processQueryResult = this.processQueryResult.bind(this);
    /// The query promise
    _queryPromise: Promise<ScanResult> | null = null;
    /// The in-flight query
    _queryInFlight: ScanRequest | null = null;
    /// The queued query
    _queryQueued: ScanRequest | null = null;

    constructor(props: Props) {
        super(props);
        this.state = {
            request: new ScanRequest(0, 1024),
            result: null,
        };
    }

    /// Request a range
    protected requestScan(request: ScanRequest) {
        if (this.state.result && this.state.result.request.includes(request.offset, request.limit)) {
            return;
        }
        console.log(`request offset ${request.offset} limit ${request.limit}`)
        this.setState({
            ...this.state,
            request,
        });
    }

    /// Run a query
    protected async runQuery(request: ScanRequest): Promise<ScanResult> {
        const result = await this.props.database.use(async conn => {
            const query = `SELECT * FROM ${this.props.targetName} OFFSET ${request.offset} LIMIT ${request.limit}`;
            console.log(query);
            return await conn.runQuery(query);
        });
        return {
            request,
            result,
        };
    }

    /// Process the query result
    protected processQueryResult(result: ScanResult) {
        this._queryPromise = null;
        this._queryInFlight = null;
        setImmediate(this._schedule);
        this.setState({
            result,
        });
    }

    /// Schedule a queued query if no query is in-flight
    protected schedule() {
        if (this._queryInFlight || !this._queryQueued) return;
        this._queryInFlight = this._queryQueued;
        this._queryQueued = null;
        this._queryPromise = this.runQuery(this._queryInFlight);
        this._queryPromise.then(this._processQueryResult).catch(e => console.error(e));
    }

    /// Schedule a query the data cannot be served from the cached results
    protected scheduleIfNecessary(req: ScanRequest) {
        // Included in cached range?
        if (this.state.result && this.state.result.request.includes(req.offset, req.limit)) {
            return;
        }

        // In-flight query includes the range?
        // Wait for the result then.
        if (this._queryInFlight && this._queryInFlight.includes(req.offset, req.limit)) {
            return;
        }

        // Replace the queued query
        const offset = Math.trunc(Math.max(req.offset, OVERSCAN) - OVERSCAN);
        req.limit = Math.trunc(req.offset + req.limit + OVERSCAN - offset);
        req.offset = offset;
        this._queryQueued = req;

        // Schedule the queued query
        this.schedule();
    }

    /// Load initial data
    public componentDidMount() {
        this.scheduleIfNecessary(this.state.request);
    }

    /// Check if we have to query new data
    public componentDidUpdate(_prevProps: Props, prevState: State) {
        // Did limit and offset change?
        if (this.state.request && this.state.request !== prevState.request) {
            this.scheduleIfNecessary(this.state.request);
            return;
        }
    }

    componentWillUnmount() {
        if (this._queryPromise) {
            // XXX cancel the query
        }
    }

    // Pass the scan function to the child
    render() {
        return this.props.children(this.state.result, this._requestScan);
    }
}
