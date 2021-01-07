import * as webdb from '@dashql/webdb/dist/webdb_async';
import { TableScanRange, TableScanBuffer } from '../access';
import { Mutex } from '../utils';

export class DatabaseManager {
    /// The async webdb
    _webdb: webdb.AsyncWebDB;
    /// The connection
    _connection: webdb.AsyncWebDBConnection | null;
    /// The connection mutex
    _connectionMutex: Mutex;
    /// The table scan buffers
    _tableScanBuffers: Map<string, TableScanBuffer>;

    constructor(db: webdb.AsyncWebDB) {
        this._webdb = db;
        this._connection = null;
        this._connectionMutex = new Mutex();
        this._tableScanBuffers = new Map();
    }

    /// Setup the database connection
    public async init() {
        await this.connect();
    }

    /// Use the connection
    public async use<T>(f: (conn: webdb.AsyncWebDBConnection) => Promise<T>): Promise<T | null> {
        return await this._connectionMutex.useAsync(async () => {
            if (!this._connection) return null;
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

    /// Drop a database table
    public async dropTable(tableName: string) {
        this._tableScanBuffers.delete(tableName);
    }

    /// Drop a database view
    public async dropView(tableName: string) {
        this._tableScanBuffers.delete(tableName);
    }

    /// Scan a number column
    public async scanNumberColumn(
        tableName: string,
        tableRange: TableScanRange,
        column: number,
        fn: (row: number, v: number | null) => void,
    ) {
        let scan = this._tableScanBuffers.get(tableName);
        if (!scan) {
            scan = new TableScanBuffer(this, tableName);
            this._tableScanBuffers.set(tableName, scan);
        }
        await scan.iterateNumberColumnRange(tableRange, column, fn);
    }
}
