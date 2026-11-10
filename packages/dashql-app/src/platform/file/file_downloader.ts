
export interface FileDownloader {
    /// Download bytes as file. A Blob is handed to the browser as it is, a large one is never copied into memory.
    downloadBufferAsFile(data: Uint8Array | Blob, filename: string): Promise<void>;
}
