import * as Immutable from 'immutable';
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

    /// Resolve table info
    public resolveTableInfo(qualifiedTableName: string): model.DatabaseTableInfo | null {
        return this._store.getState().core.planDatabaseTables.get(qualifiedTableName) || null;
    }

    /// Request table statistics.
    ///
    /// We invest some effort to eliminate redundant statistics queries.
    /// A very common operation in dashboards is the computation of the value domain or the row count.
    /// We could, in principle, just query DuckDB within every single viz but that's unnecessary overhead
    /// since we can compute all of the associative aggregates at once.
    ///
    /// We therefore untangle these table statistics and create a two-step process.
    /// Every viz logic first requests table statistics in its prepare hook.
    /// The database manager then merges all requests and runs a single query that forwards statistics to all vizzes.
    public async requestTableStatistics(
        qualifiedTableName: string,
        type: model.TableStatisticsType,
        columnId: number = 0,
    ): Promise<webdb.Value> {
        let queue = this._tableStatisticsQueue.get(qualifiedTableName);
        if (!queue) {
            queue = new TableStatisticsQueue(this, qualifiedTableName);
            this._tableStatisticsQueue.set(qualifiedTableName, queue);
        }
        return queue.request(columnId, type);
    }

    /// Evaluate pending table statistics
    public async evaluateTableStatistics(qualifiedTableName: string) {
        // Resolve the table info.
        // If it doesn't exit we have nothing to do.
        const tableInfo = this.resolveTableInfo(qualifiedTableName);
        if (!tableInfo) return;

        // Get the queue.
        // Abort immediatedly if there's none.
        // This happens whenever two viz statements evaluate the same queue simultaneously.
        const queue = this._tableStatisticsQueue.get(qualifiedTableName);
        if (!queue) return;
        this._tableStatisticsQueue.delete(qualifiedTableName);

        /// Build the query text
        const text = queue.buildQuery(tableInfo);
        try {
            // Run the query
            const result = await this.use(async (conn: webdb.AsyncConnection) => {
                return await conn.runQuery(text);
            });

            // Unpack the query result
            const chunkIter = new webdb.ChunkArrayIterator(result);
            chunkIter.nextBlocking();
            if (chunkIter.rowCount == 0) {
                // XXX Received no values
                // -> reject
                console.error('NO RESULTS');
            }

            // Resolve with values
            let values: webdb.Value[] = [];
            for (let i = 0; i < chunkIter.columnCount; ++i) {
                values.push(chunkIter.readValue(0, i));
            }

            // Update the table statistics
            const stats = queue.persist(values, tableInfo.statistics);
            model.mutate(this._store.dispatch, {
                type: model.StateMutationType.UPDATE_TABLE_INFO,
                data: [
                    qualifiedTableName,
                    {
                        ...tableInfo,
                        statistics: stats,
                    },
                ],
            });

            // Resolve the promises
            queue.resolve(values);
        } catch (e) {
            // An error occured, forward to promises
            queue.reject(e);
        }
    }
}

/// A queue for table statistics
export class TableStatisticsQueue {
    /// THe database manager
    _databaseManager: DatabaseManager;
    /// The table
    _qualifiedTableName: string;
    /// The column requests
    _requests: Map<model.TableStatisticsKey, TableStatisticsRequest>;

    /// Constructor
    constructor(dbManager: DatabaseManager, qualifiedTableName: string) {
        this._databaseManager = dbManager;
        this._qualifiedTableName = qualifiedTableName;
        this._requests = new Map();
    }

    /// Build the query text
    public buildQuery(tableInfo: model.DatabaseTableInfo): string {
        let out = 'SELECT ';
        let value_id = 0;
        for (let [_k, req] of this._requests) {
            let column_name = tableInfo.columnNames[req._columnId];
            req._valueId = value_id++;
            if (req._valueId > 0) {
                out += ', ';
            }
            switch (req._statsType) {
                case model.TableStatisticsType.COUNT_STAR:
                    out += `count(*)::INTEGER`;
                    break;
                case model.TableStatisticsType.MINIMUM_VALUE:
                    out += `min(${column_name})`;
                    break;
                case model.TableStatisticsType.MAXIMUM_VALUE:
                    out += `max(${column_name})`;
                    break;
            }
        }
        out += ` FROM ${tableInfo.nameShort};`;
        return out;
    }

    /// Request statistics
    public async request(type: model.TableStatisticsType, columnId: number = 0): Promise<webdb.Value> {
        const key = model.buildTableStatisticsKey(type, columnId);
        const prev = this._requests.get(key);
        if (prev) {
            return new Promise((resolve, reject) => {
                prev._promiseResolvers.push(resolve);
                prev._promiseRejecters.push(reject);
            });
        } else {
            const req = new TableStatisticsRequest(type, columnId);
            this._requests.set(key, req);
            return new Promise((resolve, reject) => {
                req._promiseResolvers.push(resolve);
                req._promiseRejecters.push(reject);
            });
        }
    }

    /// Update statistics map
    public persist(values: webdb.Value[], prev: Immutable.Map<model.TableStatisticsType, webdb.Value>) {
        return prev.withMutations(stats => {
            for (const [k, req] of this._requests) {
                if (req._valueId >= values.length) continue;
                stats.set(k, values[req._valueId]);
            }
        });
    }

    /// Resolve all reqeusts
    public resolve(values: webdb.Value[]) {
        const nullValue = new webdb.Value();
        for (const [_k, req] of this._requests) {
            const v = req._valueId < values.length ? values[req._valueId] : nullValue;
            for (const resolve of req._promiseResolvers) {
                resolve(v);
            }
        }
    }

    /// Reject all requests
    public reject(e: any) {
        const nullValue = new webdb.Value();
        for (const [_k, req] of this._requests) {
            for (const reject of req._promiseRejecters) {
                reject(e);
            }
        }
    }
}

/// A column statistics request
export class TableStatisticsRequest {
    /// The statistics type
    _statsType: model.TableStatisticsType;
    /// The column id
    _columnId: number;
    /// The promise resolvers
    _promiseResolvers: ((value: webdb.Value) => void)[];
    /// The promise rejecters
    _promiseRejecters: ((e: any) => void)[];
    /// The value id
    _valueId: number;

    /// Constructor
    constructor(statsType: model.TableStatisticsType, columnId: number) {
        this._statsType = statsType;
        this._columnId = columnId;
        this._promiseResolvers = [];
        this._promiseRejecters = [];
        this._valueId = 0;
    }
}
