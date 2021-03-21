import { LRUCache } from '../utils/lru_cache';
import { ObjectURL } from '../model';
import { DerivedReduxStore, StateMutationType, CachedFileData } from '../model';
import { mutate } from '../model';

const FILE_CACHE_SIZE = 64;

export interface FileData {
    /// The cache key
    key: string;
    /// The object URL
    objectURL: ObjectURL;
}

/// A file cache
class FileCache extends LRUCache<FileData> {
    /// The redux store
    _store: DerivedReduxStore;
    /// Constructor
    constructor(store: DerivedReduxStore, size: number) {
        super(size);
        this._store = store;
    }

    /// Insert handler
    onInsert(_slot: number, next: FileData, evicted: FileData | null): void {
        mutate(this._store.dispatch, {
            type: StateMutationType.CACHE_FILE_DATA,
            data: [{ objectURL: next.objectURL} as CachedFileData, evicted?.key || null]
        });
    }

    /// Hit handler
    onHit(_slot: number, next: FileData): void {
        mutate(this._store.dispatch, {
            type: StateMutationType.HIT_CACHED_FILE_DATA,
            data: next.key
        });
    }
}

export class FileManager {
    /// The global application store
    _store: DerivedReduxStore;
    /// The file cache
    _file_cache: FileCache;

    /// Constructor
    constructor(store: DerivedReduxStore, cache_size: number = FILE_CACHE_SIZE) {
        this._store = store;
        this._file_cache = new FileCache(store, cache_size);
    }

    /// Find a file
    public findFile(key: string): ObjectURL | null {
        const cached = this._file_cache.find(key);
        return cached?.objectURL || null;
    }

    /// Add a file
    public addFile(key: string, file: File): ObjectURL {
        return this._file_cache.insert({
            key: key,
            objectURL: URL.createObjectURL(file) as string
        }).objectURL;
    }
}
