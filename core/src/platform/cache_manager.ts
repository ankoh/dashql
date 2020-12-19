import { BlobKey, CacheKey, CachedFileData, CachedHTTPData } from "../model";

export abstract class CacheManager {
    /// The blobs
    _blobs: Map<BlobKey, Blob>;

    /// The constructor
    constructor() {
        this._blobs = new Map();
    }

    /// Knows a blob?
    public abstract cachesBlob(key: BlobKey): boolean;
    /// Set a blob
    public abstract setBlob(key: BlobKey, blob: Blob): Promise<boolean>;
    /// Get a blob
    public abstract getBlob(key: BlobKey): Promise<Blob | null>;


    /// Cache file data
    public cacheFileData(fileName: string, _file: File) {
    }

    /// Cache http data
    public cacheHTTPData(_req: Request, _resp: Response) {
    
    }
}
