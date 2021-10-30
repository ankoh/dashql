// Copyright (c) 2020 The DashQL Authors

import Immutable from 'immutable';
import React from 'react';
import * as duckdb from '@duckdb/duckdb-wasm/dist/duckdb-esm';
import * as arrow from 'apache-arrow';
import { TableStatisticsResolver, TableStatistics } from './table_statistics';
import { Mutex } from './utils';
import {
    ADD_TABLE_METADATA,
    ADD_TABLE_STATS,
    DatabaseMetadata,
    DatabaseMetadataAction,
    Dispatch,
    initialDatabaseMetadata,
    reduceDatabaseMetadata,
    TableMetadata,
    TableStatisticsType,
    TableType,
    useDatabaseMetadata,
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
    _connection: duckdb.AsyncDuckDBConnection | null;
    /// The connection mutex
    _connectionCtrlMutex: Mutex;
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
        this._connectionCtrlMutex = new Mutex();
        this._statisticsQueues = new Map();
        this._metadata = metadata;
        this._metadataDispatch = metadataDispatch;
    }

    /// Get the raw instance
    public get instance(): duckdb.AsyncDuckDB {
        return this._duckdb;
    }
    /// Get the metadata
    public get metadata(): DatabaseMetadata {
        return this._metadata;
    }

    /// Resolve table statistics
    public resolveTableStatistics(qualifiedTableName: string): TableStatisticsResolver | null {
        const prev = this._statisticsQueues.get(qualifiedTableName);
        if (prev) return prev;
        const stats = new TableStatistics(this, qualifiedTableName);
        this._statisticsQueues.set(qualifiedTableName, stats);
        return stats;
    }

    /// Use the duckdb directly
    public useUnsafe(): duckdb.AsyncDuckDB {
        return this._duckdb;
    }
    /// Use the connection
    public use<T>(f: (conn: duckdb.AsyncDuckDBConnection) => Promise<T>): Promise<T> {
        if (!this._connection) {
            throw new Error('not connected');
        }
        return f(this._connection);
    }

    /// Disconnect the connection
    public async disconnect(): Promise<void> {
        return await this._connectionCtrlMutex.useAsync(async () => {
            if (!this._connection) return;
            await this._connection.close();
        });
    }
    /// Create a new connection
    public async connect(): Promise<duckdb.AsyncDuckDBConnection> {
        const conn = await this._connectionCtrlMutex.useAsync(async () => {
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

    /// Collect table info
    async collectTableMetadata(
        conn: duckdb.AsyncDuckDBConnection,
        info: Partial<TableMetadata> & { nameQualified: string },
    ): Promise<TableMetadata> {
        const columnNames: string[] = [];
        const columnNameMapping: Map<string, number> = new Map();
        const columnTypes: arrow.DataType[] = [];
        const describe = await conn.query<{ Field: arrow.Utf8; Type: arrow.Utf8 }>(`DESCRIBE ${info.nameQualified}`);
        let column = 0;
        for (const row of describe) {
            columnNames.push(row.Field!);
            columnNameMapping.set(row.Field!, column++);
            const mapType = (type: string): arrow.DataType => {
                switch (type) {
                    case 'BOOLEAN':
                        return new arrow.Bool();
                    case 'TINYINT':
                        return new arrow.Int8();
                    case 'SMALLINT':
                        return new arrow.Int16();
                    case 'INTEGER':
                        return new arrow.Int32();
                    case 'BIGINT':
                        return new arrow.Int64();
                    case 'UTINYINT':
                        return new arrow.Uint8();
                    case 'USMALLINT':
                        return new arrow.Uint16();
                    case 'UINTEGER':
                        return new arrow.Uint32();
                    case 'UBIGINT':
                        return new arrow.Uint64();
                    case 'FLOAT':
                        return new arrow.Float32();
                    case 'HUGEINT':
                        return new arrow.Decimal(32, 0);
                    case 'DOUBLE':
                        return new arrow.Float64();
                    case 'VARCHAR':
                        return new arrow.Utf8();
                    case 'DATE':
                        return new arrow.DateDay();
                    case 'TIME':
                        return new arrow.Time(arrow.TimeUnit.MILLISECOND, 32);
                    case 'TIMESTAMP':
                        return new arrow.TimeNanosecond();
                    default:
                        return new arrow.Null();
                }
            };
            columnTypes.push(mapType(row.Type!));
        }
        /// Build the query text
        const metadata: TableMetadata = {
            tableType: TableType.TABLE,
            tableID: null,
            script: null,
            statistics: Immutable.Map<TableStatisticsType, arrow.Column>(),
            ...info,
            columnNames,
            columnTypes,
            columnNameMapping,
        };
        this._metadataDispatch({
            type: ADD_TABLE_METADATA,
            data: [info.nameQualified, metadata],
        });
        return this._metadata.tables.get(info.nameQualified)!;
    }

    /// Create standalone database client
    static createWired(db: duckdb.AsyncDuckDB): DatabaseClient {
        const state = initialDatabaseMetadata;
        const client = new DatabaseClient(db, state, () => {});
        const dispatch = (action: DatabaseMetadataAction) => {
            client._metadata = reduceDatabaseMetadata(client._metadata, action);
        };
        client._metadataDispatch = dispatch;
        return client;
    }
}

type Props = {
    children: React.ReactElement;
    database: DatabaseClient;
};

const dbCtx = React.createContext<DatabaseClient | null>(null);

export const DatabaseClientProvider: React.FC<Props> = (props: Props) => {
    const meta = useDatabaseMetadata();
    props.database._metadata = meta;
    return <dbCtx.Provider value={props.database}>{props.children}</dbCtx.Provider>;
};
export const useDatabaseClient = (): DatabaseClient => React.useContext(dbCtx)!;
