// Copyright (c) 2020 The DashQL Authors

import * as duckdb from '@dashql/duckdb/dist/duckdb.module.js';
import * as model from '../model';
import * as arrow from 'apache-arrow';
import { TableStatisticsResolver, TableStatistics } from './table_statistics';
import { Mutex } from '../utils';

/// An database manager.
///
/// We introduce the database manager to abstract any interaction with the database.
/// This allows us to swap the in-browser wasm database with a native database when
/// bundling as electron app or when connecting to a dedicated accelerator server.
///
export class DatabaseManager {
    /// The async duckdb
    _duckdb: duckdb.AsyncDuckDB;
    // The store
    _store: model.DerivedReduxStore;
    /// The connection
    _connection: duckdb.AsyncConnection | null;
    /// The connection mutex
    _connectionMutex: Mutex;
    /// The table statistics requests
    _tableStatistics: Map<string, TableStatisticsResolver>;

    constructor(db: duckdb.AsyncDuckDB, store: model.DerivedReduxStore) {
        this._duckdb = db;
        this._store = store;
        this._connection = null;
        this._connectionMutex = new Mutex();
        this._tableStatistics = new Map();
    }

    /// Resolve table statistics
    public resolveTableStatistics(qualifiedTableName: string): TableStatisticsResolver | null {
        const prev = this._tableStatistics.get(qualifiedTableName);
        if (prev) return prev;
        const stats = new TableStatistics(this, qualifiedTableName);
        this._tableStatistics.set(qualifiedTableName, stats);
        return stats;
    }

    /// Setup the database connection
    public async init(): Promise<void> {
        await this.connect();
    }

    /// Use the duckdb directly
    public useUnsafe(): duckdb.AsyncDuckDB {
        return this._duckdb;
    }

    /// Use the connection
    public async use<T>(f: (conn: duckdb.AsyncConnection) => Promise<T>): Promise<T> {
        return await this._connectionMutex.useAsync(async () => {
            if (!this._connection) {
                throw new Error('not connected');
            }
            return await f(this._connection);
        });
    }

    /// Disconnect the connection
    public async disconnect(): Promise<void> {
        return await this._connectionMutex.useAsync(async () => {
            if (!this._connection) return;
            await this._connection.disconnect();
        });
    }

    /// Create a new connection
    public async connect(): Promise<duckdb.AsyncConnection> {
        const conn = await this._connectionMutex.useAsync(async () => {
            if (this._connection) return this._connection;
            return await this._duckdb.connect();
        });
        this._connection = conn;
        return this._connection;
    }

    /// Resolve a table name
    public resolveTableName(qualifiedName: string): model.TableSummary | null {
        const state = this._store.getState().core.planState;
        return model.resolveTableByName(state, qualifiedName);
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
        qualifiedName: string,
        type: model.TableStatisticsType,
        columnId = 0,
    ): Promise<arrow.Column> {
        let queue = this._tableStatistics.get(qualifiedName);
        if (!queue) {
            queue = new TableStatistics(this, qualifiedName);
            this._tableStatistics.set(qualifiedName, queue);
        }
        return queue.request(columnId, type);
    }

    /// Evaluate pending table statistics
    public async evaluateTableStatistics(qualifiedName: string): Promise<void> {
        // Resolve the table info.
        // If it doesn't exit we have nothing to do.
        const state = this._store.getState().core.planState;
        const table = model.resolveTableByName(state, qualifiedName);
        if (!table) return;

        // Get the queue.
        // Abort immediatedly if there's none.
        // This happens whenever two viz statements evaluate the same queue simultaneously.
        const queue = this._tableStatistics.get(qualifiedName);
        if (!queue) return;
        this._tableStatistics.delete(qualifiedName);

        /// Build the query text
        const results = await queue.evaluate();
        const stats = table.statistics.withMutations(s => {
            for (const [k, vs] of results) {
                s.set(k, vs);
            }
        });
        model.mutate(this._store.dispatch, {
            type: model.StateMutationType.UPDATE_TABLE_INFO,
            data: [
                qualifiedName,
                {
                    ...table,
                    statistics: stats,
                },
            ],
        });
    }
}
