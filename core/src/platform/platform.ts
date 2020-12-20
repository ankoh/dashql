import { CoreWasmAPI } from "./core_wasm_api";
import { DatabaseManager } from "./database_manager";
import { DerivedReduxStore } from "../model";
import { FileManager } from "./file_manager";
import { HTTPManager } from "./http_manager";

export class Platform {
    /// The global application state
    _globalState: DerivedReduxStore;
    /// The core wasm api
    _coreWasm: CoreWasmAPI;
    /// The database manager
    _databaseManager: DatabaseManager;
    /// The file manager
    _fileManager: FileManager;
    /// The HTTP manager
    _httpManager: HTTPManager;

    constructor(globalState: DerivedReduxStore, coreWasm: CoreWasmAPI, databaseManager: DatabaseManager, fileManager: FileManager, httpManager: HTTPManager) {
        this._globalState = globalState;
        this._coreWasm = coreWasm;
        this._databaseManager = databaseManager;
        this._fileManager = fileManager;
        this._httpManager = httpManager;
    }

    public get state() { return this._globalState; }
    public get coreWasm() { return this._coreWasm; }
    public get database() { return this._databaseManager; }
    public get file() { return this._fileManager; }
    public get http() { return this._httpManager; }
}
