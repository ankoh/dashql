
export interface PlatformFile {
    /// The file path
    readonly path: string;

    /// The file size in bytes, when known without reading the file
    readonly size?: number;

    /// The browser Blob backing the file, when available
    readonly blob?: Blob;

    /// Open a stream for reading the file
    stream(): ReadableStream<Uint8Array>;

    /// Read the file as array buffer
    readAsArrayBuffer(): Promise<Uint8Array>;
}
