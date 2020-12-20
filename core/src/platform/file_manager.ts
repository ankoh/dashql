import { DerivedReduxStore } from "../model";
import { LRUCache } from "../utils/lru_cache";
import { ObjectURL } from "../model";

const REQUEST_FILE_SIZE = 64;

export interface FileData {
    /// The cache key
    key: string;
    /// The object URL
    objectURL: ObjectURL;
}

/// A file cache
class FileCache extends LRUCache<FileData> {
    /// Constructor
    constructor(size: number) {
        super(size);
    }

    /// Update handler
    onEvict(_slot: number, _next: FileData, _evicted: FileData | null): void {
        // XXX
    }
}

export class FileManager {
    /// The global application state
    _state: DerivedReduxStore;
    /// The file cache
    _file_cache: FileCache;

    /// Constructor
    constructor(state: DerivedReduxStore) {
        this._state = state;
        this._file_cache = new FileCache(REQUEST_FILE_SIZE);
    }

    public findFile(_key: string): File | null {
        return null;
    }

    public addFile(_key: string, _file: File) {
    }
}
