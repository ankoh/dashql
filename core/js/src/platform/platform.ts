import { DatabaseManager } from "./database_manager";
import { FileManager } from "./file_manager";
import { HTTPManager } from "./http_manager";

export class Platform {
    /// The database manager
    _database_manager: DatabaseManager;
    /// The file manager
    _file_manager: FileManager;
    /// The HTTP manager
    _http_manager: HTTPManager;

    constructor(database_manager: DatabaseManager, file_manager: FileManager, http_manager: HTTPManager) {
        this._database_manager = database_manager;
        this._file_manager = file_manager;
        this._http_manager = http_manager;
    }
}
