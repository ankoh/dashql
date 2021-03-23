import * as webdb from '@dashql/webdb/dist/webdb-async.module';
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
    /// The webdb
    _webdb: webdb.AsyncWebDB;
    /// The analyzer bindings
    _analyzer: AnalyzerBindings;
    /// The database manager
    _databaseManager: DatabaseManager;
    /// The file manager
    _fileManager: FileManager;
    /// The HTTP manager
    _httpManager: HTTPManager;

    constructor(store: DerivedReduxStore, logger: webdb.Logger, webdb: webdb.AsyncWebDB, analyzer: AnalyzerBindings) {
        this._store = store;
        this._logger = logger;
        this._webdb = webdb;
        this._analyzer = analyzer;
        this._databaseManager = new DatabaseManager(this._webdb, this._store);
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
