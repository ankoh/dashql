import * as React from 'react';
import * as platform from '../platform';
import { ScanRange, PartialScanResult, scanRangeIncludes } from './partial_scan_result';

const OVERSCAN = 1024;

interface Props {
    /// The database manager
    database: platform.DatabaseManager;
    /// The table name
    targetName: string;
    /// The requested offset
    offset: number;
    /// The requested limit
    limit: number;
    /// The children
    children: (result: PartialScanResult | null) => JSX.Element;
}

interface State {
    /// The current data
    data: PartialScanResult | null;
}

export class PartialScanProvider extends React.Component<Props, State> {
    /// The schedule function
    _schedule = this.schedule.bind(this);
    /// The handler to process a query result
    _processQueryResult = this.processQueryResult.bind(this);
    /// The query promise
    _queryPromise: Promise<PartialScanResult> | null = null;
    /// The in-flight query
    _queryInFlight: ScanRange | null = null;
    /// The queued query
    _queryQueued: ScanRange | null = null;

    constructor(props: Props) {
        super(props);
        this.state = {
            data: null,
        };
    }

    /// Run a query
    public async runQuery(range: ScanRange): Promise<PartialScanResult> {
        const result = await this.props.database.use(async conn => {
            return await conn.runQuery(
                `SELECT * FROM ${this.props.targetName} LIMIT ${range.limit} OFFSET ${range.offset}`,
            );
        });
        return {
            range,
            result,
        };
    }

    /// Process the query result
    public processQueryResult(result: PartialScanResult) {
        this._queryPromise = null;
        this._queryInFlight = null;
        setImmediate(this._schedule)
        console.log(result);
        this.setState({
            data: result,
        });
    }

    /// Schedule a queued query if no query is in-flight
    protected schedule() {
        if (this._queryInFlight || !this._queryQueued)
            return;
        this._queryInFlight = this._queryQueued;
        this._queryQueued = null;
        this._queryPromise = this.runQuery(this._queryInFlight);
        this._queryPromise
            .then(this._processQueryResult)
            .catch(e => console.error(e));
    }

    /// Schedule a query the data cannot be served from the cached results
    protected scheduleIfNecessary() {
        // Included in cached range?
        // Nothing to do.
        if (this.state.data && scanRangeIncludes(this.state.data.range, this.props.offset, this.props.limit)) {
            return;
        }
        const offset = Math.trunc(Math.max(this.props.offset, OVERSCAN) - OVERSCAN);
        const limit = Math.trunc(this.props.limit + this.props.offset + OVERSCAN - offset);

        // In-flight query includes the range?
        // Wait for the result then.
        if (this._queryInFlight && scanRangeIncludes(this._queryInFlight, this.props.offset, this.props.limit)) {
            return;
        }
        // Replace the queued query
        if (this._queryQueued) {
            this._queryQueued.offset = offset;
            this._queryQueued.limit = limit;
        } else {
            this._queryQueued = { offset, limit };
        }

        // Schedule the queued query
        this.schedule();
    }

    /// Load initial data
    public componentDidMount() {
        this.scheduleIfNecessary();
    }

    /// Check if we have to query new data
    public componentDidUpdate(prevProps: Props, _prevState: State) {
        // Did limit and offset change?
        if (prevProps.offset != this.props.limit || prevProps.limit != this.props.limit) {
            this.scheduleIfNecessary();
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
        return this.props.children(this.state.data);
    }
}
