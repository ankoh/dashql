declare module '@wasmer/wasi' {
    function init(): Promise<void>;

    export class WASI {
        constructor(config: any);
        readonly fs: MemFS;

        instantiate(module: any, imports: object): WebAssembly.Instance;
        // Start the WASI Instance, it returns the status code when calling the start
        // function
        start(): number;
        // Get the stdout buffer
        // Note: this method flushes the stdout
        getStdoutBuffer(): Uint8Array;
        // Get the stdout data as a string
        // Note: this method flushes the stdout
        getStdoutString(): string;
        // Get the stderr buffer
        // Note: this method flushes the stderr
        getStderrBuffer(): Uint8Array;
        // Get the stderr data as a string
        // Note: this method flushes the stderr
        getStderrString(): string;
        // Set the stdin buffer
        setStdinBuffer(buf: Uint8Array): void;
        // Set the stdin data as a string
        setStdinString(input: string): void;
    }

    export class MemFS {
        constructor();
        readDir(path: string): Array<any>;
        createDir(path: string): void;
        removeDir(path: string): void;
        removeFile(path: string): void;
        rename(path: string, to: string): void;
        metadata(path: string): object;
        open(path: string, options: any): JSVirtualFile;
    }

    export class JSVirtualFile {
        lastAccessed(): BigInt;
        lastModified(): BigInt;
        createdTime(): BigInt;
        size(): BigInt;
        setLength(new_size: BigInt): void;
        read(): Uint8Array;
        readString(): string;
        write(buf: Uint8Array): number;
        writeString(buf: string): number;
        flush(): void;
        seek(position: number): number;
    }
}
