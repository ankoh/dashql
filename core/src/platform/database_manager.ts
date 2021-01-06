import * as webdb from '@dashql/webdb/dist/webdb_async';
import { Mutex } from '../utils';

export class DatabaseManager {
    /// The async webdb
    _webdb: webdb.AsyncWebDB;
    /// The connection
    _connection: webdb.AsyncWebDBConnection | null;
    /// The mutex
    _connectionMutex: Mutex;

    constructor(db: webdb.AsyncWebDB) {
        this._webdb = db;
        this._connection = null;
        this._connectionMutex = new Mutex();
    }

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
}
