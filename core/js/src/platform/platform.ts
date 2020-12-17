import { BlobManager } from "./blob_manager";
import { CoreWasmAPI } from "../wasm/api";
import { DatabaseManager } from "./database_manager";
import { DerivedReduxStore } from "../model";
import { FileManager } from "./file_manager";
import { HTTPManager } from "./http_manager";

export class Platform {
    /// The core wasm api
    _core_wasm_api: CoreWasmAPI;
    /// The global application state
    _global_state: DerivedReduxStore;
    /// The cache manager
    _blob_manager: BlobManager;
    /// The database manager
    _database_manager: DatabaseManager;
    /// The file manager
    _file_manager: FileManager;
    /// The HTTP manager
    _http_manager: HTTPManager;

    constructor(core_wasm_api: CoreWasmAPI, global_state: DerivedReduxStore, blob_manager: BlobManager, database_manager: DatabaseManager, file_manager: FileManager, http_manager: HTTPManager) {
        this._core_wasm_api = core_wasm_api;
        this._global_state = global_state;
        this._blob_manager = blob_manager;
        this._database_manager = database_manager;
        this._file_manager = file_manager;
        this._http_manager = http_manager;
    }

    public get core_wasm() { return this._core_wasm_api; }
    public get state() { return this._global_state; }
    public get blobs() { return this._blob_manager; }
    public get database() { return this._database_manager; }
    public get file() { return this._file_manager; }
    public get http() { return this._http_manager; }
}
