interface DashQLStartupResult {
    embeddedDatabase: 'hyperdb-wasm' | null;
    error?: string;
    host: 'electron' | 'web';
    status: 'failed' | 'ready';
}

/// The size and modification time of a file, they change whenever the file is written
interface DashQLFileStamp {
    size: number;
    mtimeMs: number;
}

interface DashQLElectronBridge {
    /// Claim the access to a session folder that the storage registered before the app granted folders.
    /// Accepted once, on the first start with folder grants, for a folder that holds a session file.
    claimSessionFolder(path: string): Promise<boolean>;
    confirm(options: {message: string; title: string}): Promise<boolean>;
    fs: {
        exists(path: string): Promise<boolean>;
        /// The stamp of a file, null if it does not exist
        fileStamp(path: string): Promise<DashQLFileStamp | null>;
        /// The files of a directory with their stamps, empty if the directory does not exist
        listFiles(path: string): Promise<Array<DashQLFileStamp & {name: string}>>;
        mkdir(path: string, options?: {recursive?: boolean}): Promise<void>;
        readDir(path: string): Promise<Array<{name: string; isFile: boolean; isDirectory: boolean; isSymlink: boolean}>>;
        readFile(path: string): Promise<Uint8Array>;
        readTextFile(path: string): Promise<string>;
        remove(path: string, options?: {recursive?: boolean}): Promise<void>;
        rename(from: string, to: string): Promise<void>;
        stat(path: string): Promise<{size: number; mtime: string | null; isFile: boolean; isDirectory: boolean; isSymlink: boolean}>;
        writeFile(path: string, data: Uint8Array): Promise<void>;
        /// Write a text file, resolves with its new stamp
        writeTextFile(path: string, data: string): Promise<DashQLFileStamp>;
    };
    getInitialDeepLinks(): Promise<Array<{type: "event" | "session"; value: string}>>;
    getRuntimeCapabilities(): Promise<unknown>;
    nativeProxyRequest(request: unknown): Promise<unknown>;
    onDeepLink(listener: (link: {type: "event" | "session"; value: string}) => void): () => void;
    /// Write the pending changes before a window closes, the main process waits until the handler resolves
    onFlush(handler: () => Promise<void>): () => void;
    openExternal(url: string): Promise<void>;
    oauthLoopback: {
        listen(callbackUrl: string): Promise<number>;
        wait(loopbackId: number): Promise<DashQLOAuthLoopbackResult>;
        close(loopbackId: number): Promise<void>;
    };
    openDirectory(title: string): Promise<string | null>;
    updates: {
        check(channel?: DashQLUpdateChannel): Promise<DashQLElectronUpdateStatus>;
        download(channel: DashQLUpdateChannel): Promise<void>;
        getStatus(): Promise<DashQLElectronUpdateStatus>;
        install(): Promise<void>;
        onStatus(listener: (status: DashQLElectronUpdateStatus) => void): () => void;
    };
}

interface DashQLOAuthLoopbackResult {
    code?: string;
    state?: string;
    error?: string;
    errorDescription?: string;
}

type DashQLUpdateChannel = 'canary' | 'stable';

type DashQLElectronUpdateStatus =
    | {status: 'disabled'}
    | {status: 'checking'; channel: DashQLUpdateChannel}
    | {status: 'up-to-date'; channel: DashQLUpdateChannel; version: string}
    | {status: 'available'; channel: DashQLUpdateChannel; version: string}
    | {status: 'downloading'; channel: DashQLUpdateChannel; version: string; transferred: number; total: number}
    | {status: 'downloaded'; channel: DashQLUpdateChannel; version: string}
    | {status: 'error'; channel: DashQLUpdateChannel; message: string};

declare var __DASHQL_STARTUP__: DashQLStartupResult | undefined;
declare var dashqlElectron: DashQLElectronBridge | undefined;
