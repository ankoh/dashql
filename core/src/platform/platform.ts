import { AnalyzerBindings } from "../analyzer";
import { DatabaseManager } from "./database_manager";
import { DerivedReduxStore } from "../model";
import { FileManager } from "./file_manager";
import { HTTPManager } from "./http_manager";

export class Platform {
    /// The global application state
    _globalState: DerivedReduxStore;
    /// The analyzer bindings
    _analyzer: AnalyzerBindings;
    /// The database manager
    _databaseManager: DatabaseManager;
    /// The file manager
    _fileManager: FileManager;
    /// The HTTP manager
    _httpManager: HTTPManager;

    constructor(globalState: DerivedReduxStore, analyzer: AnalyzerBindings) {
        this._globalState = globalState;
        this._analyzer = analyzer;
        this._databaseManager = new DatabaseManager();
        this._fileManager = new FileManager(globalState);
        this._httpManager = new HTTPManager(globalState);
    }

    public get state() { return this._globalState; }
    public get analyzer() { return this._analyzer; }
    public get database() { return this._databaseManager; }
    public get file() { return this._fileManager; }
    public get http() { return this._httpManager; }
}
