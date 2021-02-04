import * as webdb from '@dashql/webdb/dist/webdb_async';
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
    /// The connection
    _connection: webdb.AsyncConnection | null;
    /// The connection mutex
    _connectionMutex: Mutex;

    constructor(db: webdb.AsyncWebDB) {
        this._webdb = db;
        this._connection = null;
        this._connectionMutex = new Mutex();
    }

    /// Setup the database connection
    public async init() {
        await this.connect();
    }

    /// Use the connection
    public async use<T>(f: (conn: webdb.AsyncConnection) => Promise<T>): Promise<T> {
        return await this._connectionMutex.useAsync(async () => {
            if (!this._connection) {
                throw new Error("not connected");
            };
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
