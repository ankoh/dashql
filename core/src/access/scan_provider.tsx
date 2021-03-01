import * as webdb from '@dashql/webdb/dist/webdb_async';
import * as React from 'react';
import * as platform from '../platform';
import * as proto from '@dashql/proto';

type RequestScanFn = (request: ScanRequest) => void;

export class ScanRequest {
    /// The offset of a range
    offset: number = 0;
    /// The limit of a range
    limit: number = 0;
    /// The sample size
    sample: number = 0;
    /// The overscan
    overscan: number = 0;

    /// Configure range
    public withRange(offset: number, limit: number, overscan: number = 0): ScanRequest {
        this.offset = offset;
        this.limit = limit;
        this.overscan = overscan;
        return this;
    }

    /// Configure sample
    public withSample(sample: number): ScanRequest {
        this.sample = sample;
        return this;
    }

    /// Get begin of scan range
    get begin() {
        return Math.max(this.offset, this.overscan) - this.overscan;
    }
    /// Get end of scan range
    get end() {
        return this.offset + this.limit + this.overscan;
    }

    /// Does a scan fully include a given range?
    includesRequest(other: ScanRequest): boolean {
        return this.includesRange(other.offset, other.limit) && this.sample == other.sample;
    }

    /// Does a scan fully include a given range?
    public includesRange(offset: number, limit: number): boolean {
        if (this.limit == 0 || limit == 0) {
            return this.limit == 0 && this.begin <= offset;
        } else {
            return this.begin <= offset && this.end >= offset + limit;
        }
    }

    /// Does intersect with a range
    public intersectsRange(offset: number, limit: number): boolean {
        if (limit == 0) return true;
        if (this.limit == 0) {
            return offset + limit > this.begin;
        } else {
            const b = this.begin;
            const e = this.end;
            return (
                (offset >= b && offset + limit <= e) ||
                (offset <= b && offset + limit >= b) ||
                (offset < e && offset + limit >= e)
            );
        }
    }
}

export interface ScanResult {
    /// The scan request
    request: ScanRequest;
    /// The query result buffer
    result: proto.webdb.QueryResult;
}

interface Props {
    /// The log manager
    logger: webdb.Logger;
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
            request: new ScanRequest().withRange(0, 1024, 1024),
            result: null,
        };
    }

    /// Request a range
    protected requestScan(request: ScanRequest) {
        console.log(request);
        if (this.state.result && this.state.result.request.includesRequest(request)) {
            return;
        }
        this.setState({
            ...this.state,
            request,
        });
    }

    /// Run a query
    protected async runQuery(request: ScanRequest): Promise<ScanResult> {
        const offset = request.begin;
        const limit = request.end - offset;
        let query = `SELECT * FROM ${this.props.targetName} OFFSET ${offset} LIMIT ${limit}`;
        if (request.sample > 0) {
            query += ` USING SAMPLE RESERVOIR (${Math.trunc(request.sample)} ROWS)`;
        }
        console.log(query);
        const result = await this.props.database.use(async conn => {
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
        if (this.state.result && this.state.result.request.includesRequest(req)) {
            return;
        }
        // In-flight query includes the range?
        // Wait for the result then.
        if (this._queryInFlight && this._queryInFlight.includesRequest(req)) {
            return;
        }
        // Replace the queued query
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
