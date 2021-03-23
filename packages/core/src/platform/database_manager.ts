import * as webdb from '@dashql/webdb/dist/webdb-async.module';
import * as model from '../model';
import { TableStatisticsResolver, DatabaseTableStatistics } from './table_statistics';
import { Mutex } from '../utils';

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
    _tableStatistics: Map<string, TableStatisticsResolver>;

    constructor(db: webdb.AsyncWebDB, store: model.DerivedReduxStore) {
        this._webdb = db;
        this._store = store;
        this._connection = null;
        this._connectionMutex = new Mutex();
        this._tableStatistics = new Map();
    }

    /// Resolve table statistics
    public resolveTableStatistics(qualifiedTableName: string): TableStatisticsResolver | null {
        const prev = this._tableStatistics.get(qualifiedTableName);
        if (!!prev) return prev;
        const stats = new DatabaseTableStatistics(this, qualifiedTableName);
        this._tableStatistics.set(qualifiedTableName, stats);
        return stats;
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
    ): Promise<webdb.Value[]> {
        let queue = this._tableStatistics.get(qualifiedTableName);
        if (!queue) {
            queue = new DatabaseTableStatistics(this, qualifiedTableName);
            this._tableStatistics.set(qualifiedTableName, queue);
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
        const queue = this._tableStatistics.get(qualifiedTableName);
        if (!queue) return;
        this._tableStatistics.delete(qualifiedTableName);

        /// Build the query text
        const results = await queue.evaluate();
        const stats = tableInfo.statistics.withMutations(stats => {
            for (const [k, vs] of results) {
                stats.set(k, vs);
            }
        });
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
    }
}
