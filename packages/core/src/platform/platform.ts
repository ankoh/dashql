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

    constructor(
        store: DerivedReduxStore,
        logger: duckdb.Logger,
        duckdb: duckdb.AsyncDuckDB,
        analyzer: AnalyzerBindings,
    ) {
        this._store = store;
        this._logger = logger;
        this._duckdb = duckdb;
        this._analyzer = analyzer;
        this._databaseManager = new DatabaseManager(this._duckdb, this._store);
        this._fileManager = new FileManager(store);
        this._httpManager = new HTTPManager(store);
    }

    public get store() {
        return this._store;
    }
    public get analyzer() {
        return this._analyzer;
    }
    public get database() {
        return this._databaseManager;
    }
    public get file() {
        return this._fileManager;
    }
    public get http() {
        return this._httpManager;
    }
    public get logger() {
        return this._logger;
    }

    public async init() {
        await this._databaseManager.init();
    }
}
