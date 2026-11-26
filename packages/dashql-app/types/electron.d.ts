interface DashQLStartupResult {
    embeddedDatabase: 'hyperdb-wasm' | null;
    error?: string;
    host: 'electron' | 'web';
    status: 'failed' | 'ready';
}

/// The size and modification time of a file, they change whenever the file is written
type DashQLFileStamp = import('@akohn/dashql/platform/electron_fs').FileStamp;

interface DashQLElectronBridge {
    /// The agents of the app: harnesses of the machine that the main process runs headless for a question, and the
    /// calls of their `dashql` commands, see docs/design/agent_integration.md
    agent?: DashQLAgentBridge;
    /// Claim the access to a workbook folder that the storage registered before the app granted folders.
    /// Accepted once, on the first start with folder grants, for a folder that holds a workbook file.
    claimWorkbookFolder(path: string): Promise<boolean>;
    confirm(options: {message: string; title: string}): Promise<boolean>;
    /// The file system, see packages/dashql/src/platform/electron_fs.ts
    fs: import('@akohn/dashql/platform/electron_fs').ElectronFsBridge;
    getInitialDeepLinks(): Promise<Array<{type: "event" | "workbook" | "zip"; value: string}>>;
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

/// A harness that the app can run
type DashQLAgentHarness = 'claude' | 'codex' | 'opencode';

/// What a turn of a harness did, in the order of the turn, Stop last. The page opens the turn itself when it asks.
type DashQLAgentEvent =
    | {event: 'PreToolUse'; status: string; toolUseId: string | null}
    | {event: 'PostToolUse'; status: string; toolUseId: string | null; error?: string | null}
    | {event: 'Say'; text: string}
    | {event: 'Stop'; message?: string | null; error?: string | null; interrupted?: boolean};

/// A call of a `dashql` command of the agent, the page answers it with reply
interface DashQLAgentCall {
    callId: number;
    workbookId: string;
    command: string;
    args: Record<string, unknown>;
    input: string | null;
}

/// A part of the answer of a call: text for stdout or stderr, the exit code ends the call
interface DashQLAgentReply {
    callId: number;
    out?: string;
    err?: string;
    exit?: number;
}

interface DashQLAgentBridge {
    /// The harnesses and whether the machine has them
    info(): Promise<{harnesses: Array<{id: DashQLAgentHarness; label: string; available: boolean}>}>;
    /// Start a turn on a workbook with the prompt that the harness gets, the page opened the turn with the question
    ask(request: {workbookId: string; harness: DashQLAgentHarness; prompt: string}): Promise<void>;
    /// Stop the turn of a workbook
    stop(workbookId: string): Promise<void>;
    /// Stop the turn of a workbook and forget its conversations, the kept one and the sessions of the harnesses
    forget(workbookId: string): Promise<void>;
    /// The conversation of a workbook as the page kept it, null without one
    readConversation(workbookId: string): Promise<unknown>;
    /// Keep the conversation of a workbook in its folder, plain JSON
    writeConversation(workbookId: string, conversation: unknown): Promise<void>;
    onEvent(listener: (event: {workbookId: string; event: DashQLAgentEvent}) => void): () => void;
    onCall(listener: (call: DashQLAgentCall) => void): () => void;
    onCallCancel(listener: (callId: number) => void): () => void;
    reply(reply: DashQLAgentReply): void;
    /// Write a file of a call into the folder of the workbook, returns its path relative to the folder
    writeFile(file: {workbookId: string; kind: 'chart' | 'result'; name: string; data: Uint8Array}): Promise<string>;
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
