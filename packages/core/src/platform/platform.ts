import * as duckdb from '@dashql/duckdb/dist/duckdb.module.js';
import { AnalyzerBindings } from '../analyzer';
import { DatabaseManager } from './database_manager';
import { DerivedReduxStore } from '../model';
import { FileManager } from './file_manager';
import { HTTPManager } from './http_manager';
import { Logger } from './log_manager';

export class Platform {
    /// The global application state
    _store: DerivedReduxStore;
    /// The logger
    _logger: Logger;
    /// The duckdb
    _duckdb: duckdb.AsyncDuckDB;
    /// The analyzer bindings
    _analyzer: AnalyzerBindings;
    /// The database manager
    _databaseManager: DatabaseManager;
    /// The file manager
    _fileManager: FileManager;
    /// The HTTP manager
    _httpManager: HTTPManager;

    constructor(store: DerivedReduxStore, logger: duckdb.Logger, db: duckdb.AsyncDuckDB, analyzer: AnalyzerBindings) {
        this._store = store;
        this._logger = logger;
        this._duckdb = db;
        this._analyzer = analyzer;
        this._databaseManager = new DatabaseManager(this._duckdb, this._store);
        this._fileManager = new FileManager(store);
        this._httpManager = new HTTPManager(store);
    }

    public get store(): DerivedReduxStore {
        return this._store;
    }
    public get analyzer(): AnalyzerBindings {
        return this._analyzer;
    }
    public get database(): DatabaseManager {
        return this._databaseManager;
    }
    public get file(): FileManager {
        return this._fileManager;
    }
    public get http(): HTTPManager {
        return this._httpManager;
    }
    public get logger(): Logger {
        return this._logger;
    }

    public async init(): Promise<void> {
        await this._databaseManager.init();
    }
}
