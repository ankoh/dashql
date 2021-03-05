import * as Immutable from 'immutable';
import * as webdb from '@dashql/webdb/dist/webdb_async';
import * as model from '../model';
import * as platform from '../platform';
import { DatabaseManager } from './database_manager';

/// A column statistics request
export class TableStatisticsRequest {
    /// The statistics type
    _key: model.TableStatisticsKey;
    /// The promise resolvers
    _promiseResolvers: ((value: webdb.Value[]) => void)[];
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

    public get key() {
        return this._key;
    }
    public get type() {
        return model.getTableStatisticsType(this._key);
    }
    public get columnId() {
        return model.getTableStatisticsColumn(this._key);
    }
}

/// A queue for table statistics
export class TableStatisticsQueue {
    /// The database manager
    _databaseManager: platform.DatabaseManager;
    /// The table name
    _qualifiedTableName: string;
    /// All statistic requests
    _requests: Map<model.TableStatisticsKey, TableStatisticsRequest>;
    /// The associative aggreagtes
    _associativeAggregates: TableStatisticsRequest[];
    /// The standalone aggreagtes
    _standaloneRequests: TableStatisticsRequest[];

    constructor(dbManager: platform.DatabaseManager, qualifiedTableName: string) {
        this._databaseManager = dbManager;
        this._qualifiedTableName = qualifiedTableName;
        this._requests = new Map();
        this._associativeAggregates = [];
        this._standaloneRequests = [];
    }

    /// Build the associative aggregate query
    public buildAssociativeAggregateQuery(tableInfo: model.DatabaseTableInfo): string {
        let out = 'SELECT ';
        let value_id = 0;
        for (let req of this._associativeAggregates) {
            let column_name = tableInfo.columnNames[req.columnId];
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
        out += ` FROM ${tableInfo.nameShort};`;
        return out;
    }

    /// Build a standalone query
    public buildStandaloneQuery(tableInfo: model.DatabaseTableInfo, req: TableStatisticsRequest): string {
        let columnName = tableInfo.columnNames[req.columnId];
        switch (req.type) {
            case model.TableStatisticsType.DISTINCT_VALUES:
                return `SELECT DISTINCT ${columnName} FROM ${tableInfo.nameShort} LIMIT 1024;`;
        }
        return "";
    }

    /// Request table statistics
    public async request(type: model.TableStatisticsType, columnId: number = 0): Promise<webdb.Value[]> {
        const key = model.buildTableStatisticsKey(type, columnId);
        const prev = this._requests.get(key);
        if (prev) {
            return new Promise((resolve, reject) => {
                prev._promiseResolvers.push(resolve);
                prev._promiseRejecters.push(reject);
            });
        } else {
            const req = new TableStatisticsRequest(key);
            this._requests.set(key, req);
            switch (type) {
                case model.TableStatisticsType.DISTINCT_VALUES:
                    this._standaloneRequests.push(req);
                    break;
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

    public async evaluate(db: DatabaseManager): Promise<Map<model.TableStatisticsKey, webdb.Value[]>> {
        // Resolve the table info
        const stats: Map<model.TableStatisticsKey, webdb.Value[]> = new Map();
        const tableInfo = db.resolveTableInfo(this._qualifiedTableName);
        if (!tableInfo) return stats;

        // Process the associative aggregates first
        if (this._associativeAggregates.length > 0) {
            try {
                // Query the associative aggregates
                const query = this.buildAssociativeAggregateQuery(tableInfo);
                const result = await db.use(async (conn: webdb.AsyncConnection) => {
                    return await conn.runQuery(query);
                });
                const iter = new webdb.ChunkArrayIterator(result);
                if (!iter.nextBlocking() || iter.rowCount == 0) {
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
                        if (req._valueId >= iter.columnCount) continue;
                        stats.set(req.key, [iter.readValue(0, req._valueId)]);
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
                const query = this.buildStandaloneQuery(tableInfo, req);
                const result = await db.use(async (conn: webdb.AsyncConnection) => {
                    return await conn.runQuery(query);
                });
                // Collect the values
                let v = [];
                const iter = new webdb.ChunkArrayIterator(result);
                while (iter.nextBlocking()) {
                    for (let i = 0; i < iter.rowCount; ++i) {
                        v.push(iter.readValue(i, 0));
                    }
                }
                stats.set(req.key, v);
            } catch (e) {
                // Reject all promises
                for (const reject of req._promiseRejecters) {
                    reject(e);
                }
            }
        }

        // Resolve all values
        for (const [_key, req] of this._requests) {
            const values = stats.get(req.key)!;
            for (const resolve of req._promiseResolvers) {
                resolve(values);
            }
        }
        return stats;
    }
}