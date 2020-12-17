import { BlobKey } from "../model";

export abstract class BlobManager {
    /// The cache entries
    _entries: Map<BlobKey, Blob>;

    /// The constructor
    constructor() {
        this._entries = new Map();
    }

    /// Is a blob cached?
    abstract isCached(key: BlobKey): boolean;
    /// Set a blob
    abstract setBlob(key: BlobKey, blob: Blob): Promise<boolean>;
    /// Get a blob
    abstract getBlob(key: BlobKey): Promise<Blob | null>;
}
