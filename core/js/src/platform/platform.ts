import { DatabaseManager } from "./database_manager";
import { FileManager } from "./file_manager";
import { HTTPManager } from "./http_manager";
import { DerivedReduxStore } from "../model";

export class Platform {
    /// The global application state
    _global_state: DerivedReduxStore;
    /// The database manager
    _database_manager: DatabaseManager;
    /// The file manager
    _file_manager: FileManager;
    /// The HTTP manager
    _http_manager: HTTPManager;

    constructor(global_state: DerivedReduxStore, database_manager: DatabaseManager, file_manager: FileManager, http_manager: HTTPManager) {
        this._global_state = global_state;
        this._database_manager = database_manager;
        this._file_manager = file_manager;
        this._http_manager = http_manager;
    }
}
