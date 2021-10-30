// Copyright (c) 2021 The DashQL Authors

import * as duckdb from '@duckdb/duckdb-wasm/dist/duckdb-esm';
import * as model from './model';
import * as arrow from 'apache-arrow';
import { DatabaseClient } from './database_client';

/// A column statistics request
export class TableStatisticsRequest {
    /// The statistics type
    _key: model.TableStatisticsKey;
    /// The promise resolvers
    _promiseResolvers: ((value: arrow.Column) => void)[];
    /// The promise rejecters
    _promiseRejecters: ((e: any) => void)[];
    /// The value id
    _valueId: number;

    /// Constructor
    constructor(key: model.TableStatisticsKey) {
        this._key = key;
        this._promiseResolvers = [];
        this._promiseRejecters = [];
        this._valueId = 0;
    }

    public get key(): model.TableStatisticsKey {
        return this._key;
    }
    public get type(): model.TableStatisticsType {
        return model.getTableStatisticsType(this._key);
    }
    public get columnId(): number {
        return model.getTableStatisticsColumn(this._key);
    }
}

/// A resolver for table statistics
export interface TableStatisticsResolver {
    /// Resolve the table info
    resolveTableMetadata(): model.TableMetadata | null;
    /// Request table statistics
    request(type: model.TableStatisticsType, columnId: number): Promise<arrow.Column>;
    /// Evaluate table statistics
    evaluate(): Promise<Map<model.TableStatisticsKey, arrow.Column>>;
}

/// A queue for table statistics
export class TableStatistics implements TableStatisticsResolver {
    /// The database manager
    _database: DatabaseClient;
    /// The table name
    _tableName: string;
    /// All statistic requests
    _requests: Map<model.TableStatisticsKey, TableStatisticsRequest>;
    /// The associative aggreagtes
    _associativeAggregates: TableStatisticsRequest[];
    /// The standalone aggreagtes
    _standaloneRequests: TableStatisticsRequest[];

    constructor(database: DatabaseClient, tableName: string) {
        this._database = database;
        this._tableName = tableName;
        this._requests = new Map();
        this._associativeAggregates = [];
        this._standaloneRequests = [];
    }

    /// Resolve the table info
    public resolveTableMetadata(): model.TableMetadata | null {
        return this._database.metadata.tables.get(this._tableName) || null;
    }

    /// Build the associative aggregate query
    protected buildAssociativeAggregateQuery(table: model.TableMetadata): string {
        let out = 'SELECT ';
        let value_id = 0;
        for (const req of this._associativeAggregates) {
            const column_name = table.columnNames[req.columnId];
            req._valueId = value_id++;
            if (req._valueId > 0) {
                out += ', ';
            }
            switch (req.type) {
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
        out += ` FROM ${table.nameQualified};`;
        return out;
    }

    /// Build a standalone query
    protected buildStandaloneQuery(_table: model.TableMetadata, _req: TableStatisticsRequest): string {
        console.assert('There are no standalone table statistics at the moment');
        return '';
    }

    /// Request table statistics
    public async request(type: model.TableStatisticsType, columnId = 0): Promise<arrow.Column> {
        const key = model.buildTableStatisticsKey(type, columnId);
        const prev = this._requests.get(key);
        const table = this._database.metadata.tables.get(this._tableName);
        if (prev) {
            return new Promise((resolve, reject) => {
                prev._promiseResolvers.push(resolve);
                prev._promiseRejecters.push(reject);
            });
        } else if (table != null && table.statistics.has(key)) {
            return Promise.resolve(table.statistics.get(key)!);
        } else {
            const req = new TableStatisticsRequest(key);
            this._requests.set(key, req);
            switch (type) {
                case model.TableStatisticsType.COUNT_STAR:
                case model.TableStatisticsType.MAXIMUM_VALUE:
                case model.TableStatisticsType.MINIMUM_VALUE:
                    this._associativeAggregates.push(req);
                    break;
            }
            return new Promise((resolve, reject) => {
                req._promiseResolvers.push(resolve);
                req._promiseRejecters.push(reject);
            });
        }
    }

    public async evaluate(): Promise<Map<model.TableStatisticsKey, arrow.Column>> {
        // Resolve the table info
        const stats: Map<model.TableStatisticsKey, arrow.Column> = new Map();
        const table = this._database.metadata.tables.get(this._tableName);
        if (!table) return stats;

        // Process the associative aggregates first
        if (this._associativeAggregates.length > 0) {
            try {
                // Query the associative aggregates
                const query = this.buildAssociativeAggregateQuery(table);
                const data = await this._database.use(async (conn: duckdb.AsyncDuckDBConnection) => {
                    return await conn.query(query);
                });
                if (data.count() == 0) {
                    // Received no values, reject all requests
                    for (const req of this._associativeAggregates) {
                        for (const reject of req._promiseRejecters) {
                            // XXX more meaningful error
                            reject('NO RESULTS');
                        }
                    }
                } else {
                    // Update the statistics
                    for (const req of this._associativeAggregates) {
                        if (req._valueId >= data.numCols) continue;
                        const col = data.getColumnAt(req._valueId);
                        if (!col) continue;
                        stats.set(req.key, col);
                    }
                }
            } catch (e) {
                // Reject all promises
                for (const req of this._associativeAggregates) {
                    for (const reject of req._promiseRejecters) {
                        reject(e);
                    }
                }
            }
        }

        // Process all standalone requests
        for (const req of this._standaloneRequests) {
            try {
                // Evaluate the query
                const query = this.buildStandaloneQuery(table, req);
                const result = await this._database.use(async (conn: duckdb.AsyncDuckDBConnection) => {
                    return await conn.query(query);
                });
                stats.set(req.key, result.getColumnAt(0)!);
            } catch (e) {
                // Reject all promises
                for (const reject of req._promiseRejecters) {
                    reject(e);
                }
            }
        }

        // Resolve all values
        for (const [, req] of this._requests) {
            const values = stats.get(req.key)!;
            for (const resolve of req._promiseResolvers) {
                resolve(values);
            }
        }
        return stats;
    }
}
