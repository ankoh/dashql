import * as webdb from '@dashql/webdb/dist/webdb_async';
import * as proto from '@dashql/proto';
import * as model from '../model';
import { Mutex } from '../utils';
import { Plan } from '../model';

/// An database manager.
///
/// We introduce the database manager to abstract any interaction with the database.
/// This allows us to swap the in-browser wasm database with a native database when
/// bundling as electron app or when connecting to a dedicated accelerator server.
///
export class DatabaseManager {
    /// The async webdb
    _webdb: webdb.AsyncWebDB;
    // The store
    _store: model.DerivedReduxStore;
    /// The connection
    _connection: webdb.AsyncConnection | null;
    /// The connection mutex
    _connectionMutex: Mutex;
    /// The table statistics requests
    _tableStatisticsQueue: Map<string, TableStatisticsQueue>;

    constructor(db: webdb.AsyncWebDB, store: model.DerivedReduxStore) {
        this._webdb = db;
        this._store = store;
        this._connection = null;
        this._connectionMutex = new Mutex();
        this._tableStatisticsQueue = new Map();
    }

    /// Setup the database connection
    public async init() {
        await this.connect();
    }

    /// Use the connection
    public async use<T>(f: (conn: webdb.AsyncConnection) => Promise<T>): Promise<T> {
        return await this._connectionMutex.useAsync(async () => {
            if (!this._connection) {
                throw new Error('not connected');
            }
            return await f(this._connection);
        });
    }

    /// Disconnect the connection
    public async disconnect() {
        return await this._connectionMutex.useAsync(async () => {
            if (!this._connection) return;
            await this._connection.disconnect();
        });
    }

    /// Create a new connection
    public async connect() {
        const conn = await this._connectionMutex.useAsync(async () => {
            if (!!this._connection) return this._connection;
            return await this._webdb.connect();
        });
        this._connection = conn;
        return this._connection;
    }

    /// Request column statistics.
    ///
    /// We invest some effort to eliminate redundant statistics queries.
    /// A very common operation in dashboards is the computation of the value domain or the row count.
    /// We could, in principle, just query DuckDB within every single viz but that's unnecessary overhead
    /// since we can compute all of the associative aggregates at once.
    ///
    /// We therefore untangle these column statistics and create a two-step process.
    /// Every viz logic first requests column statistics in its prepare hook.
    /// The database manager then merges all requests and runs a single query that forwards statistics to all vizzes.
    public async requestColumnStatistics(
        tableInfo: model.DatabaseTableInfo,
        type: ColumnStatisticsType,
        columnId: number = 0,
    ): Promise<webdb.Value> {
        let queue = this._tableStatisticsQueue.get(tableInfo.nameQualified);
        if (!queue) {
            queue = new TableStatisticsQueue(tableInfo);
            this._tableStatisticsQueue.set(tableInfo.nameQualified, queue);
        }
        return queue.request(columnId, type);
    }

    /// Evaluate pending column statistics
    public async evaluateColumnStatistics(tableInfo: model.DatabaseTableInfo) {
        // Get the queue
        const queue = this._tableStatisticsQueue.get(tableInfo.nameQualified);
        if (!queue) return;
        this._tableStatisticsQueue.delete(tableInfo.nameQualified);

        const text = queue.buildQuery();
        try {
            // Run the query
            const result = await this.use(async (conn: webdb.AsyncConnection) => {
                return await conn.runQuery(text);
            });

            // Unpack the query result
            const chunkIter = new webdb.MaterializedQueryResultChunks(result);
            const rowIter = webdb.MaterializedQueryResultRowIterator.iterate(chunkIter);
            if (rowIter.isEnd()) {
                // XXX Received no values
                // -> reject
                console.error('NO RESULTS');
            }

            // Resolve with values
            let values: webdb.Value[] = [];
            for (let i = 0; i < Math.min(queue._requestedValueCount, chunkIter.columnCount); ++i) {
                values.push(rowIter.getValue(i));
            }
            queue.resolve(values);
        } catch (e) {
            // An error occured, forward to promises
            queue.reject(e);
        }
    }
}

/// A queue for table statistics
export class TableStatisticsQueue {
    /// The table
    _tableInfo: model.DatabaseTableInfo;
    /// The column requests
    _requestsByColumn: ColumnStatisticsRequest[][];
    /// The requested column count
    _requestedValueCount: number;

    /// Constructor
    constructor(tableInfo: model.DatabaseTableInfo) {
        this._tableInfo = tableInfo;
        this._requestsByColumn = [];
        this._requestedValueCount = 0;
    }

    /// Build the query text
    public buildQuery(): string {
        let out = 'SELECT ';
        let value_id = 0;
        for (let column_id = 0; column_id < this._requestsByColumn.length; ++column_id) {
            let column_name = this._tableInfo.columnNames[column_id];
            if (value_id++ > 0) {
                out += ', ';
            }
            for (const req of this._requestsByColumn[column_id]) {
                switch (req._statsType) {
                    case ColumnStatisticsType.ROW_COUNT:
                        out += `count(*)::INTEGER`;
                        break;
                    case ColumnStatisticsType.MINIMUM_VALUE:
                        out += `min(${column_name})`;
                        break;
                    case ColumnStatisticsType.MAXIMUM_VALUE:
                        out += `max(${column_name})`;
                        break;
                }
            }
        }
        out += ` FROM ${this._tableInfo.nameShort};`;
        return out;
    }

    /// Request statistics
    public async request(columnId: number, type: ColumnStatisticsType): Promise<webdb.Value> {
        let prevLen = this._requestsByColumn.length;
        for (let i = prevLen; i <= columnId; ++i) {
            this._requestsByColumn.push([]);
        }
        let reqs = this._requestsByColumn[columnId];
        let req: ColumnStatisticsRequest | null = null;
        for (const r of reqs) {
            if (r._statsType != type) continue;
            req = r;
            break;
        }
        if (req == null) {
            req = new ColumnStatisticsRequest(type);
            reqs.push(req);
            ++this._requestedValueCount;
        }
        const r = req;
        return new Promise((resolve, reject) => {
            r._promiseResolvers.push(resolve);
            r._promiseRejecters.push(reject);
        });
    }

    /// Resolve all reqeusts
    public resolve(values: webdb.Value[]) {
        let out_id = 0;
        for (let column_id = 0; column_id < this._tableInfo.columnNames.length; ++column_id) {
            for (let req_id = 0; req_id < this._requestsByColumn[column_id].length; ++req_id) {
                const o = out_id++;
                const v = o < values.length ? values[o] : new webdb.Value();
                const req = this._requestsByColumn[column_id][req_id];
                for (const resolve of req._promiseResolvers) {
                    resolve(v);
                }
            }
        }
    }

    /// Reject all requests
    public reject(e: any) {
        for (let column_id = 0; column_id < this._requestsByColumn.length; ++column_id) {
            for (let req_id = 0; req_id < this._requestsByColumn[column_id].length; ++req_id) {
                const req = this._requestsByColumn[column_id][req_id];
                for (const reject of req._promiseRejecters) {
                    reject(e);
                }
            }
        }
    }
}

/// A column statistics type
export enum ColumnStatisticsType {
    ROW_COUNT,
    MINIMUM_VALUE,
    MAXIMUM_VALUE,
}

/// A column statistics request
export class ColumnStatisticsRequest {
    /// The statistics type
    _statsType: ColumnStatisticsType;
    /// The promise resolvers
    _promiseResolvers: ((value: webdb.Value) => void)[];
    /// The promise rejecters
    _promiseRejecters: ((e: any) => void)[];
    /// The value (if resolved)
    _value: webdb.Value | null;

    /// Constructor
    constructor(statsType: ColumnStatisticsType) {
        this._statsType = statsType;
        this._promiseResolvers = [];
        this._promiseRejecters = [];
        this._value = null;
    }
}
