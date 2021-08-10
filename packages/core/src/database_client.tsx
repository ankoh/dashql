// Copyright (c) 2020 The DashQL Authors

import React from 'react';
import * as duckdb from '@dashql/duckdb/dist/duckdb.module.js';
import * as arrow from 'apache-arrow';
import { TableStatisticsResolver, TableStatistics } from './table_statistics';
import { Mutex } from './utils';
import {
    TableStatisticsType,
    DatabaseMetadata,
    DatabaseMetadataAction,
    ADD_TABLE_STATS,
    useDatabaseMetadata,
    useDatabaseMetadataDispatch,
    Dispatch,
} from './model';

/// An database manager.
///
/// We introduce the database manager to abstract any interaction with the database.
/// This allows us to swap the in-browser wasm database with a native database when
/// bundling as electron app or when connecting to a dedicated accelerator server.
///
export class DatabaseClient {
    /// The async duckdb
    _duckdb: duckdb.AsyncDuckDB;
    /// The connection
    _connection: duckdb.AsyncConnection | null;
    /// The connection mutex
    _connectionMutex: Mutex;
    /// The table statistics requests
    _statisticsQueues: Map<string, TableStatisticsResolver>;
    /// The database metadata
    _metadata: DatabaseMetadata;
    /// The database metadata
    _metadataDispatch: Dispatch<DatabaseMetadataAction>;

    constructor(
        db: duckdb.AsyncDuckDB,
        metadata: DatabaseMetadata,
        metadataDispatch: Dispatch<DatabaseMetadataAction>,
    ) {
        this._duckdb = db;
        this._connection = null;
        this._connectionMutex = new Mutex();
        this._statisticsQueues = new Map();
        this._metadata = metadata;
        this._metadataDispatch = metadataDispatch;
    }

    /// Resolve table statistics
    public resolveTableStatistics(qualifiedTableName: string): TableStatisticsResolver | null {
        const prev = this._statisticsQueues.get(qualifiedTableName);
        if (prev) return prev;
        const stats = new TableStatistics(this, qualifiedTableName);
        this._statisticsQueues.set(qualifiedTableName, stats);
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
        type: TableStatisticsType,
        columnId = 0,
    ): Promise<arrow.Column> {
        let queue = this._statisticsQueues.get(qualifiedName);
        if (!queue) {
            queue = new TableStatistics(this, qualifiedName);
            this._statisticsQueues.set(qualifiedName, queue);
        }
        return queue.request(type, columnId);
    }

    /// Evaluate pending table statistics
    public async evaluateTableStatistics(qualifiedName: string): Promise<void> {
        // Resolve the table info.
        // If it doesn't exit we have nothing to do.
        const table = this._metadata.tables.get(qualifiedName);
        if (!table) return;

        // Get the queue.
        // Abort immediatedly if there's none.
        // This happens whenever two viz statements evaluate the same queue simultaneously.
        const queue = this._statisticsQueues.get(qualifiedName);
        if (!queue) return;
        this._statisticsQueues.delete(qualifiedName);

        // Evaluate all statistics
        const results = await queue.evaluate();
        /// Build the query text
        this._metadataDispatch({
            type: ADD_TABLE_STATS,
            data: [qualifiedName, results.entries()],
        });
    }
}

type Props = {
    children: React.ReactElement;
    duckdb: duckdb.AsyncDuckDB;
};

const dbCtx = React.createContext<DatabaseClient | null>(null);

export const DatabaseClientProvider: React.FC<Props> = (props: Props) => {
    const meta = useDatabaseMetadata();
    const metaDispatch = useDatabaseMetadataDispatch();
    const db = React.useRef<DatabaseClient>(new DatabaseClient(props.duckdb, meta, metaDispatch));
    React.useEffect(() => {
        db.current._metadata = meta;
    }, [meta]);
    return <dbCtx.Provider value={db.current}>{props.children}</dbCtx.Provider>;
};
export const useDatabaseClient = (): DatabaseClient => React.useContext(dbCtx);
