import { CacheManager } from "./cache_manager";
import { CoreWasmAPI } from "../wasm/api";
import { DatabaseManager } from "./database_manager";
import { DerivedReduxStore } from "../model";
import { FileManager } from "./file_manager";
import { HTTPManager } from "./http_manager";

export class Platform {
    /// The core wasm api
    _coreWasm: CoreWasmAPI;
    /// The global application state
    _globalState: DerivedReduxStore;
    /// The cache manager
    _cacheManager: CacheManager;
    /// The database manager
    _databaseManager: DatabaseManager;
    /// The file manager
    _fileManager: FileManager;
    /// The HTTP manager
    _httpManager: HTTPManager;

    constructor(coreWasm: CoreWasmAPI, globalState: DerivedReduxStore, cacheManager: CacheManager, databaseManager: DatabaseManager, fileManager: FileManager, httpManager: HTTPManager) {
        this._coreWasm = coreWasm;
        this._globalState = globalState;
        this._cacheManager = cacheManager;
        this._databaseManager = databaseManager;
        this._fileManager = fileManager;
        this._httpManager = httpManager;
    }

    public get coreWasm() { return this._coreWasm; }
    public get state() { return this._globalState; }
    public get cache() { return this._cacheManager; }
    public get database() { return this._databaseManager; }
    public get file() { return this._fileManager; }
    public get http() { return this._httpManager; }
}
