interface DashQLStartupResult {
    embeddedDatabase: 'hyperdb-wasm' | null;
    error?: string;
    host: 'electron' | 'web';
    status: 'failed' | 'ready';
}

/// The size and modification time of a file, they change whenever the file is written
type DashQLFileStamp = import('@akohn/dashql/platform/electron_fs').FileStamp;

interface DashQLElectronBridge {
    /// Claim the access to a workbook folder that the storage registered before the app granted folders.
    /// Accepted once, on the first start with folder grants, for a folder that holds a workbook file.
    claimWorkbookFolder(path: string): Promise<boolean>;
    confirm(options: {message: string; title: string}): Promise<boolean>;
    /// The file system, see packages/dashql/src/platform/electron_fs.ts
    fs: import('@akohn/dashql/platform/electron_fs').ElectronFsBridge;
    getInitialDeepLinks(): Promise<Array<{type: "event" | "workbook" | "zip"; value: string}>>;
    /// The storage of the earlier profiles of the app, copied out of their user data folders and not merged yet, oldest
    /// first. Resolves once the main process copied them. See docs/design/electron.md.
    legacyProfiles?(): Promise<Array<{name: string; path: string}>>;
    /// The storage of an earlier profile merged, the main process removes its copy
    legacyProfileMerged(name: string): Promise<void>;
    getRuntimeCapabilities(): Promise<unknown>;
    nativeProxyRequest(request: unknown): Promise<unknown>;
    onDeepLink(listener: (link: {type: "event" | "workbook" | "zip"; value: string}) => void): () => void;
    /// Write the pending changes before a window closes, the main process waits until the handler resolves
    onFlush(handler: () => Promise<void>): () => void;
    openExternal(url: string): Promise<void>;
    oauthLoopback: {
        listen(callbackUrl: string): Promise<number>;
        wait(loopbackId: number): Promise<DashQLOAuthLoopbackResult>;
        close(loopbackId: number): Promise<void>;
    };
    openDirectory(title: string): Promise<string | null>;
    /// Follow the color scheme of the app in the native window: its background while loading and its controls
    setColorScheme?(scheme: 'light' | 'dark' | 'system'): Promise<void>;
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

type DashQLUpdateChannel = 'latest' | 'stable';

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
