import { AnalyzerBindings } from "../analyzer";
import { DatabaseManager } from "./database_manager";
import { DerivedReduxStore } from "../model";
import { FileManager } from "./file_manager";
import { HTTPManager } from "./http_manager";
import { LogManager } from "./log_manager";

export class Platform {
    /// The global application state
    _store: DerivedReduxStore;
    /// The analyzer bindings
    _analyzer: AnalyzerBindings;
    /// The database manager
    _databaseManager: DatabaseManager;
    /// The file manager
    _fileManager: FileManager;
    /// The HTTP manager
    _httpManager: HTTPManager;
    /// The log manager
    _logManager: LogManager;

    constructor(store: DerivedReduxStore, analyzer: AnalyzerBindings) {
        this._store = store;
        this._analyzer = analyzer;
        this._databaseManager = new DatabaseManager();
        this._fileManager = new FileManager(store);
        this._httpManager = new HTTPManager(store);
        this._logManager = new LogManager(store);
    }

    public get store() { return this._store; }
    public get analyzer() { return this._analyzer; }
    public get database() { return this._databaseManager; }
    public get file() { return this._fileManager; }
    public get http() { return this._httpManager; }
    public get log() { return this._logManager; }
}
