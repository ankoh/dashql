import {access, mkdir, readFile, readdir, rename, rm, stat} from "node:fs/promises";
import {createServer} from "node:http";
import path from "node:path";
import {promisify} from "node:util";
import {fileURLToPath} from "node:url";
import {brotliDecompress} from "node:zlib";

import {app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, protocol, shell, utilityProcess, type IpcMainEvent, type WebContents} from "electron";

import {AgentHost, type AgentPage, type AgentQuestion} from "./agent/agent_host.js";
import {HARNESSES} from "./agent/harness.js";
import {APP_ORIGIN, APP_RESPONSE_HEADERS, contentHeadersFor, isBrotliWasm, isTrustedRendererUrl, parseRendererDevOrigin, resolveAppRequest} from "./app_protocol.js";
import {DeepLinkQueue, parseDeepLink, parseDeepLinksFromCommandLine} from "./deep_link.js";
import {writeFileAtomically} from "./atomic_write.js";
import {FolderGrants} from "./folder_grants.js";
import {adoptLegacyUserData, USER_DATA_FOLDER} from "./legacy_user_data.js";
import {GrpcTestServer, GRPC_TEST_REQUEST, GRPC_TEST_STREAM_BODY, GRPC_TEST_UNARY_RESPONSE} from "./grpc_test_server.js";
import {NativeProxyService, type NativeProxyRequest} from "./native_proxy.js";
import {OAuthLoopbackServer} from "./oauth_loopback.js";
import {createElectronUpdater, type ElectronUpdater} from "./updater.js";

protocol.registerSchemesAsPrivileged([
    {
        scheme: "app",
        privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
        },
    },
]);

// Electron names the user data folder after the package, which was renamed, so the app pins it and starts from a copy
// of the newest earlier folder (docs/design/electron.md). Tests and runs that pass --user-data-dir keep their folder.
if (!app.commandLine.hasSwitch("user-data-dir")) {
    const userData = path.join(app.getPath("appData"), USER_DATA_FOLDER);
    try {
        const adopted = adoptLegacyUserData(app.getPath("appData"), userData);
        if (adopted !== null) console.log("Copied the user data of an earlier version", {source: adopted});
    } catch (error) {
        console.error("Failed to copy the user data of an earlier version", error);
    }
    app.setPath("userData", userData);
}

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const rendererRoot = process.env.DASHQL_ELECTRON_RENDERER ?? path.join(process.resourcesPath, "renderer");
const rendererDevOrigin = parseRendererDevOrigin(process.env.DASHQL_ELECTRON_RENDERER_URL);
const decompressBrotli = promisify(brotliDecompress);
const deepLinks = new DeepLinkQueue();
let deepLinkSender: WebContents | null = null;
let nativeProxy: NativeProxyService | null = null;
let mainWindow: BrowserWindow | null = null;
let updater: ElectronUpdater | null = null;
const oauthLoopbacks = new Map<number, OAuthLoopbackServer>();
let nextOAuthLoopbackId = 1;
/// The agents of the app, null without a `dashql` command for them
let agentHost: AgentHost | null = null;
/// The page of a window for the agents, its turns stop when it reloads or closes
const agentPages = new WeakMap<WebContents, AgentPage>();
const watchedAgentContents = new WeakSet<WebContents>();

if (process.argv.includes("--native-addon-test") || process.argv.includes("--startup-smoke-test")) {
    app.disableHardwareAcceleration();
}

function startNativeProxy(): NativeProxyService {
    const workerPath = process.env.DASHQL_NATIVE_UTILITY_WORKER ?? path.join(moduleDirectory, "native_utility_worker.js");
    const addonPath = process.env.DASHQL_NATIVE_ADDON ?? path.join(process.resourcesPath, "dashql_native_napi.node");
    const child = utilityProcess.fork(workerPath, [], {
        env: {...process.env, DASHQL_NATIVE_ADDON: addonPath},
        serviceName: "DashQL Native Proxy",
        stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (chunk) => process.stdout.write(chunk));
    child.stderr?.on("data", (chunk) => process.stderr.write(chunk));
    return new NativeProxyService(child);
}

async function handleAppRequest(request: Request): Promise<Response> {
    const filePath = resolveAppRequest(rendererRoot, request.url);
    if (filePath === null) {
        return new Response("Not found", {status: 404, headers: APP_RESPONSE_HEADERS});
    }

    try {
        const encodedBody = await readFile(filePath);
        const body = isBrotliWasm(filePath) ? await decompressBrotli(encodedBody) : encodedBody;
        return new Response(body, {
            headers: {
                ...APP_RESPONSE_HEADERS,
                ...contentHeadersFor(filePath),
            },
        });
    } catch (error) {
        const code = error instanceof Error && "code" in error ? String(error.code) : "UNKNOWN";
        const status = code === "ENOENT" || code === "EISDIR" ? 404 : 500;
        return new Response(status === 404 ? "Not found" : "Internal error", {
            status,
            headers: APP_RESPONSE_HEADERS,
        });
    }
}

type RendererTestMode = "startup" | null;

function rendererTestMode(): RendererTestMode {
    if (process.argv.includes("--startup-smoke-test")) return "startup";
    return null;
}

/// The page backgrounds of the light and the dark color scheme of the app, --color_bg of the theme in
/// @akohn/dashql-react/styles/tokens.css. The main process cannot read the stylesheets, keep them in sync.
const WINDOW_BACKGROUND_LIGHT = "#f6f8fa";
const WINDOW_BACKGROUND_DARK = "#22262b";

function windowBackground(): string {
    return nativeTheme.shouldUseDarkColors ? WINDOW_BACKGROUND_DARK : WINDOW_BACKGROUND_LIGHT;
}

async function createWindow(testMode: RendererTestMode): Promise<BrowserWindow> {
    const preload = process.env.DASHQL_ELECTRON_PRELOAD ?? path.resolve(moduleDirectory, "../preload.cjs");
    const window = new BrowserWindow({
        width: 1500,
        height: 900,
        // The background while the app loads, in the color scheme of the app, see dashql:set-color-scheme
        backgroundColor: windowBackground(),
        titleBarStyle: "hiddenInset",
        // Centers the traffic lights in the dark stripe at the top of the app, see .top_bar of navbar.module.css
        trafficLightPosition: { x: 12, y: 10 },
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload,
            sandbox: true,
            webSecurity: true,
        },
    });
    window.webContents.setWindowOpenHandler(() => ({action: "deny"}));
    if (rendererDevOrigin !== null) {
        window.webContents.on("context-menu", (_event, params) => {
            Menu.buildFromTemplate([
                {
                    label: "Reload",
                    click: () => window.webContents.reload(),
                },
                {
                    label: "Inspect Element",
                    click: () => window.webContents.inspectElement(params.x, params.y),
                },
            ]).popup({window});
        });
    }
    if (testMode !== null) {
        window.webContents.on("console-message", (_event, level, message) => {
            console.error(`[renderer:${level}] ${message}`);
        });
        window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
            console.error(`Renderer load failed: ${errorCode} ${errorDescription} ${validatedURL}`);
        });
        window.webContents.on("render-process-gone", (_event, details) => {
            console.error(`Renderer process exited: ${details.reason} (${details.exitCode})`);
        });
    }
    window.webContents.on("will-navigate", (event, target) => {
        if (!isTrustedRendererUrl(target, rendererDevOrigin)) {
            event.preventDefault();
        }
    });
    await window.loadURL(`${rendererDevOrigin ?? APP_ORIGIN}/index.html`);
    // The renderer writes its pending changes first, the quit already waited for them
    let flushed = false;
    window.on("close", (event) => {
        if (flushed || quitState === "quitting") return;
        event.preventDefault();
        void flushRenderer(window).finally(() => {
            flushed = true;
            if (!window.isDestroyed()) window.close();
        });
    });
    window.on("closed", () => {
        if (mainWindow === window) mainWindow = null;
        deepLinks.detach();
    });
    mainWindow = window;
    return window;
}

async function waitForRendererResult<T>(window: BrowserWindow, expression: string): Promise<T> {
    return await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
        const deadline = Date.now() + 120000;
        const poll = () => {
            const result = ${expression};
            if (result !== undefined) resolve(result);
            else if (Date.now() >= deadline) reject(new Error("Timed out waiting for renderer result"));
            else setTimeout(poll, 100);
        };
        poll();
    })`) as T;
}

async function runStartupSmokeTest(window: BrowserWindow): Promise<void> {
    const result = await waitForRendererResult<{
        embeddedDatabase: string | null;
        error?: string;
        host: string;
        status: string;
    }>(window, "globalThis.__DASHQL_STARTUP__");
    const runtime = await window.webContents.executeJavaScript(`({
        crossOriginIsolated: globalThis.crossOriginIsolated,
        electronBridge: typeof globalThis.dashqlElectron === "object",
    })`) as {crossOriginIsolated: boolean; electronBridge: boolean};
    const output = {...result, ...runtime};
    console.log(JSON.stringify(output));
    const passed = result.status === "ready" && result.host === "electron" &&
        result.embeddedDatabase === "hyperdb-wasm" && runtime.crossOriginIsolated &&
        runtime.electronBridge;
    app.exit(passed ? 0 : 1);
}

async function runNativeAddonTest(): Promise<void> {
    const received = {body: Buffer.alloc(0), method: "", url: ""};
    const server = createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
            received.body = Buffer.concat(chunks);
            received.method = request.method ?? "";
            received.url = request.url ?? "";
            response.writeHead(206, {
                "content-type": "application/octet-stream",
                "x-test-header": "loopback",
            });
            response.write(Buffer.from([1, 2, 3, 4]));
            response.end(Buffer.from([5, 6, 7, 8]));
        });
    });
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Loopback server did not bind a TCP port");
    const grpcServer = new GrpcTestServer();
    await grpcServer.start();
    if (grpcServer.endpoint === null) throw new Error("gRPC loopback server did not start");

    const proxy = startNativeProxy();
    try {
        const requestBody = new Uint8Array([0, 1, 2, 127, 128, 255]);
        const started = await proxy.request({
            body: requestBody,
            headers: [
                ["dashql-method", "POST"],
                ["dashql-endpoint", `http://127.0.0.1:${address.port}`],
                ["dashql-path", "/stream-test"],
                ["dashql-search-params", "token=loopback"],
                ["dashql-read-timeout", "10000"],
                ["content-type", "application/octet-stream"],
                ["x-dashql-forwarded-test", "native-utility"],
            ],
            method: "POST",
            url: "dashql-native://localhost/http/streams",
        });
        const streamId = started.headers.find(([name]) => name === "dashql-stream-id")?.[1];
        if (streamId === undefined) throw new Error("HTTP proxy did not return a stream ID");
        const streamed = await proxy.request({
            body: new Uint8Array(),
            headers: [
                ["dashql-read-timeout", "10000"],
                ["dashql-batch-timeout", "10000"],
                ["dashql-batch-bytes", "10000"],
            ],
            method: "GET",
            url: `dashql-native://localhost/http/stream/${streamId}`,
        });
        const removed = await proxy.request({
            body: new Uint8Array(),
            headers: [],
            method: "DELETE",
            url: `dashql-native://localhost/http/stream/${streamId}`,
        });
        const headers = new Map(streamed.headers.map((header) => [header[0], header[1]] as const));
        const grpcChannel = await proxy.request({
            body: new Uint8Array(),
            headers: [["dashql-endpoint", grpcServer.endpoint]],
            method: "POST",
            url: "dashql-native://localhost/grpc/channels",
        });
        const grpcChannelId = grpcChannel.headers.find(([name]) => name === "dashql-channel-id")?.[1];
        if (grpcChannelId === undefined) throw new Error("gRPC proxy did not return a channel ID");
        const grpcUnary = await proxy.request({
            body: GRPC_TEST_REQUEST,
            headers: [
                ["dashql-path", "/dashql.test.TestService/TestUnary"],
                ["x-test-request", "unary"],
            ],
            method: "POST",
            url: `dashql-native://localhost/grpc/channel/${grpcChannelId}/unary`,
        });
        const grpcUnaryHeaders = new Map(grpcUnary.headers.map((header) => [header[0], header[1]] as const));
        const grpcStreamStarted = await proxy.request({
            body: GRPC_TEST_REQUEST,
            headers: [
                ["dashql-path", "/dashql.test.TestService/TestServerStreaming"],
                ["x-test-request", "stream"],
            ],
            method: "POST",
            url: `dashql-native://localhost/grpc/channel/${grpcChannelId}/streams`,
        });
        const grpcStreamId = grpcStreamStarted.headers.find(([name]) => name === "dashql-stream-id")?.[1];
        if (grpcStreamId === undefined) throw new Error("gRPC proxy did not return a stream ID");
        const grpcStream = await proxy.request({
            body: new Uint8Array(),
            headers: [
                ["dashql-read-timeout", "10000"],
                ["dashql-batch-timeout", "10000"],
                ["dashql-batch-bytes", "10000"],
            ],
            method: "GET",
            url: `dashql-native://localhost/grpc/channel/${grpcChannelId}/stream/${grpcStreamId}`,
        });
        const grpcStreamHeaders = new Map(grpcStream.headers.map((header) => [header[0], header[1]] as const));
        const grpcStreamRemoved = await proxy.request({
            body: new Uint8Array(),
            headers: [],
            method: "DELETE",
            url: `dashql-native://localhost/grpc/channel/${grpcChannelId}/stream/${grpcStreamId}`,
        });
        const grpcChannelRemoved = await proxy.request({
            body: new Uint8Array(),
            headers: [],
            method: "DELETE",
            url: `dashql-native://localhost/grpc/channel/${grpcChannelId}`,
        });
        grpcServer.assertHealthy();
        const output = {
            grpcChannelRemovedStatus: grpcChannelRemoved.status,
            grpcRequestCount: grpcServer.requests.length,
            grpcStreamBody: [...grpcStream.body],
            grpcStreamEvent: grpcStreamHeaders.get("dashql-batch-event"),
            grpcStreamMessages: grpcStreamHeaders.get("dashql-batch-messages"),
            grpcStreamRemovedStatus: grpcStreamRemoved.status,
            grpcStreamTrailer: grpcStreamHeaders.get("x-test-trailer"),
            grpcUnaryBody: [...grpcUnary.body],
            grpcUnaryInitial: grpcUnaryHeaders.get("x-test-initial"),
            receivedBody: [...received.body],
            receivedMethod: received.method,
            receivedUrl: received.url,
            removedStatus: removed.status,
            streamBody: [...streamed.body],
            streamEvent: headers.get("dashql-batch-event"),
            streamHeader: headers.get("x-test-header"),
            streamStatus: streamed.status,
        };
        console.log(JSON.stringify(output));
        const passed = output.receivedMethod === "POST" &&
            output.receivedUrl === "/stream-test?token=loopback" &&
            Buffer.compare(received.body, requestBody) === 0 && streamed.status === 206 &&
            Buffer.compare(Buffer.from(streamed.body), Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])) === 0 &&
            headers.get("x-test-header") === "loopback" &&
            headers.get("dashql-batch-event") === "StreamFinished" && removed.status === 200 &&
            grpcServer.requests.length === 2 &&
            grpcServer.requests[0]?.headers["x-test-request"] === "unary" &&
            grpcServer.requests[1]?.headers["x-test-request"] === "stream" &&
            grpcUnary.status === 200 && Buffer.compare(Buffer.from(grpcUnary.body), GRPC_TEST_UNARY_RESPONSE) === 0 &&
            grpcUnaryHeaders.get("x-test-initial") === "unary" && grpcStream.status === 200 &&
            Buffer.compare(Buffer.from(grpcStream.body), GRPC_TEST_STREAM_BODY) === 0 &&
            grpcStreamHeaders.get("dashql-batch-event") === "StreamFinished" &&
            grpcStreamHeaders.get("dashql-batch-messages") === "2" &&
            grpcStreamHeaders.get("dashql-batch-bytes") === "6" &&
            grpcStreamHeaders.get("x-test-trailer") === "stream-done" &&
            grpcStreamRemoved.status === 200 && grpcChannelRemoved.status === 200;
        await grpcServer.close();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        app.exit(passed ? 0 : 1);
    } finally {
        proxy.close();
        server.closeAllConnections();
        if (server.listening) server.close();
        if (grpcServer.endpoint !== null) await grpcServer.close();
    }
}

/// The `dashql` command that the agents call: in the bundle of the app, or the one that an unpackaged app was started
/// with, `--dashql-cli=<path>` (scripts/run_electron.sh). Without it, the agents are unavailable.
function dashqlBinary(): string | null {
    if (app.isPackaged) return path.join(process.resourcesPath, "bin", "dashql");
    const arg = process.argv.find((value) => value.startsWith("--dashql-cli="));
    return arg === undefined ? null : path.resolve(arg.slice("--dashql-cli=".length));
}

function requireAgentHost(): AgentHost {
    if (agentHost === null) throw new Error("This build of DashQL runs no agents");
    return agentHost;
}

/// The page of a window for the agents: it gets the events of its turns and the calls of their agents
function agentPageOf(contents: WebContents): AgentPage {
    const page = agentPages.get(contents);
    if (page !== undefined) return page;
    const send = (channel: string, value: unknown) => {
        if (!contents.isDestroyed()) contents.send(channel, value);
    };
    const created: AgentPage = {
        event: (workbookId, event) => send("dashql:agent-event", {workbookId, event}),
        call: (call) => send("dashql:agent-call", call),
        cancelCall: (callId) => send("dashql:agent-call-cancel", callId),
    };
    agentPages.set(contents, created);
    // A page that reloads or closes stops its turns, the new page knows nothing of them
    if (!watchedAgentContents.has(contents)) {
        watchedAgentContents.add(contents);
        const detach = () => {
            const current = agentPages.get(contents);
            agentPages.delete(contents);
            if (current !== undefined) void agentHost?.detach(current);
        };
        contents.once("destroyed", detach);
        contents.on("render-process-gone", detach);
        contents.on("did-start-navigation", (details) => {
            if (details.isMainFrame && !details.isSameDocument) detach();
        });
    }
    return created;
}

function isTrustedRenderer(url: string | undefined): boolean {
    return isTrustedRendererUrl(url, rendererDevOrigin);
}

/// Show the window, or open one
async function openWindow(): Promise<void> {
    if (mainWindow === null) {
        await createWindow(null);
        return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
}

let quitState: "running" | "quitting" = "running";

/// The folders that the renderer may access, in the user data folder
const FOLDER_GRANTS_FILE = "folder-grants.json";

/// How long a closing window waits for the renderer to write its pending changes
const RENDERER_FLUSH_TIMEOUT_MS = 5000;
let nextFlushRequestId = 1;

/// Ask the renderer of a window to write its pending changes, the storage writer of the app debounces them.
/// Resolves when the renderer is done, or after a timeout so that a hanging renderer cannot block the close.
async function flushRenderer(window: BrowserWindow): Promise<void> {
    if (window.isDestroyed()) return;
    const contents = window.webContents;
    const requestId = nextFlushRequestId++;
    await new Promise<void>((resolve) => {
        const done = () => {
            clearTimeout(timer);
            ipcMain.removeListener("dashql:flushed", onFlushed);
            contents.removeListener("destroyed", done);
            resolve();
        };
        const onFlushed = (event: IpcMainEvent, flushedId: unknown) => {
            if (event.sender === contents && flushedId === requestId) done();
        };
        const timer = setTimeout(done, RENDERER_FLUSH_TIMEOUT_MS);
        ipcMain.on("dashql:flushed", onFlushed);
        contents.once("destroyed", done);
        contents.send("dashql:flush", requestId);
    });
}

/// Write what the windows hold and stop the native proxy, then quit or install the downloaded update
async function quitDashQL(install: boolean): Promise<void> {
    if (quitState !== "running") return;
    quitState = "quitting";
    await Promise.all(BrowserWindow.getAllWindows().map(flushRenderer));
    // No harness outlives the app
    await agentHost?.close().catch((error) => console.error("Failed to stop the agents", error));
    nativeProxy?.close();
    nativeProxy = null;
    if (install && updater !== null) updater.install();
    else app.quit();
}

async function installUpdate(): Promise<void> {
    if (updater === null) throw new Error("Updates are unavailable");
    if (updater.getStatus().status !== "downloaded") throw new Error("No downloaded update is ready");
    await quitDashQL(true);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
    app.quit();
} else {
    if (process.defaultApp && process.argv[1] !== undefined) {
        app.setAsDefaultProtocolClient("dashql", process.execPath, [path.resolve(process.argv[1])]);
    } else {
        app.setAsDefaultProtocolClient("dashql");
    }
    for (const data of parseDeepLinksFromCommandLine(process.argv)) deepLinks.push(data);

    app.on("open-url", (event, link) => {
        event.preventDefault();
        const data = parseDeepLink(link);
        if (data !== null) deepLinks.push(data);
    });

    app.on("second-instance", (_event, commandLine) => {
        for (const data of parseDeepLinksFromCommandLine(commandLine)) deepLinks.push(data);
        // The menu bar app may run without a window
        if (app.isReady()) void openWindow();
    });

    ipcMain.handle("dashql:get-initial-deep-links", (event) => {
        if (!isTrustedRenderer(event.senderFrame?.url)) {
            throw new Error("Rejected deep-link request from an untrusted frame");
        }
        const sender = event.sender;
        const initial = deepLinks.attach((link) => {
            if (!sender.isDestroyed()) sender.send("dashql:deep-link", link);
        });
        if (deepLinkSender !== sender) {
            deepLinkSender = sender;
            sender.once("destroyed", () => {
                if (deepLinkSender === sender) {
                    deepLinkSender = null;
                    deepLinks.detach();
                }
            });
        }
        return initial;
    });

    // The renderer reaches the folders that the user picked, see FolderGrants
    const folderGrants = FolderGrants.load(path.join(app.getPath("userData"), FOLDER_GRANTS_FILE));

    ipcMain.handle("dashql:open-directory", async (event, title: unknown) => {
        if (!isTrustedRenderer(event.senderFrame?.url) || typeof title !== "string") throw new Error("Rejected directory request");
        const result = await dialog.showOpenDialog({properties: ["openDirectory", "createDirectory"], title});
        const folder = result.canceled ? null : result.filePaths[0] ?? null;
        if (folder !== null) await (await folderGrants).grant(folder);
        return folder;
    });

    ipcMain.handle("dashql:claim-workbook-folder", async (event, folder: unknown) => {
        if (!isTrustedRenderer(event.senderFrame?.url) || typeof folder !== "string") throw new Error("Rejected folder claim");
        return await (await folderGrants).claimWorkbookFolder(folder);
    });

    // The app pins its color scheme or follows the OS, the windows follow the app.
    // Electron does not keep the theme source, the app sets it again on every start.
    ipcMain.handle("dashql:set-color-scheme", (event, scheme: unknown) => {
        if (!isTrustedRenderer(event.senderFrame?.url) || (scheme !== "light" && scheme !== "dark" && scheme !== "system")) {
            throw new Error("Rejected color scheme request");
        }
        nativeTheme.themeSource = scheme;
        for (const window of BrowserWindow.getAllWindows()) window.setBackgroundColor(windowBackground());
    });

    ipcMain.handle("dashql:confirm", async (event, options: unknown) => {
        if (!isTrustedRenderer(event.senderFrame?.url) || options === null || typeof options !== "object") throw new Error("Rejected confirmation request");
        const {message, title} = options as {message?: unknown; title?: unknown};
        if (typeof message !== "string" || typeof title !== "string") throw new Error("Rejected confirmation request");
        const result = await dialog.showMessageBox({buttons: ["Keep current", "Reload"], cancelId: 0, defaultId: 1, message, title, type: "warning"});
        return result.response === 1;
    });

    ipcMain.handle("dashql:fs", async (event, operation: unknown, ...args: unknown[]) => {
        if (!isTrustedRenderer(event.senderFrame?.url) || typeof operation !== "string") throw new Error("Rejected filesystem request");
        const requirePath = (value: unknown): string => {
            if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0")) throw new Error("Rejected filesystem path");
            return value;
        };
        const grants = await folderGrants;
        const resolved = await grants.resolve(requirePath(args[0]));
        if (resolved === null) {
            // Folders that were not granted look missing to the probes, the app shows their workbooks as unreadable
            switch (operation) {
                case "exists": return false;
                case "fileStamp": return null;
                case "listFiles": return [];
            }
            throw new Error("Rejected filesystem path");
        }
        const target = resolved;
        const requireGranted = async (value: unknown): Promise<string> => {
            const granted = await grants.resolve(requirePath(value));
            if (granted === null || grants.isRoot(granted)) throw new Error("Rejected filesystem path");
            return granted;
        };
        // A stamp changes whenever anybody writes the file, the renderer compares stamps instead of contents
        const stampOf = async (file: string) => { const value = await stat(file); return {size: value.size, mtimeMs: value.mtimeMs}; };
        const isMissing = (error: unknown) => (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
        switch (operation) {
            case "exists": try { await access(target); return true; } catch { return false; }
            case "fileStamp": try { return await stampOf(target); } catch (error) { if (isMissing(error)) return null; throw error; }
            case "listFiles": {
                let entries;
                try { entries = await readdir(target, {withFileTypes: true}); } catch (error) { if (isMissing(error)) return []; throw error; }
                const files = [];
                for (const entry of entries.filter(entry => entry.isFile())) {
                    try { files.push({name: entry.name, ...await stampOf(path.join(target, entry.name))}); } catch (error) { if (!isMissing(error)) throw error; }
                }
                return files;
            }
            case "mkdir": return await mkdir(target, {recursive: (args[1] as {recursive?: boolean} | undefined)?.recursive ?? false});
            case "readDir": return (await readdir(target, {withFileTypes: true})).map(entry => ({name: entry.name, isFile: entry.isFile(), isDirectory: entry.isDirectory(), isSymlink: entry.isSymbolicLink()}));
            case "readFile": return new Uint8Array(await readFile(target));
            case "readTextFile": return await readFile(target, "utf8");
            case "remove": {
                // The app never deletes a folder the user picked, only what it wrote into it
                if (grants.isRoot(target)) throw new Error("Rejected filesystem path");
                return await rm(target, {recursive: (args[1] as {recursive?: boolean} | undefined)?.recursive ?? false, force: false});
            }
            case "rename": {
                if (grants.isRoot(target)) throw new Error("Rejected filesystem path");
                return await rename(target, await requireGranted(args[1]));
            }
            case "stat": { const value = await stat(target); return {size: value.size, mtime: value.mtime.toISOString(), isFile: value.isFile(), isDirectory: value.isDirectory(), isSymlink: value.isSymbolicLink()}; }
            // Writes are atomic, a reader of the folder (git, an editor, a sync client) never sees a part of a file
            case "writeFile": await writeFileAtomically(target, typeof args[1] === "string" ? args[1] : Buffer.from(args[1] as Uint8Array)); return;
            // The stamp of the write itself, a stamp taken after it could be the one of another program
            case "writeTextFile": if (typeof args[1] === "string") return await writeFileAtomically(target, args[1]); break;
        }
        throw new Error("Rejected filesystem operation");
    });

    ipcMain.handle("dashql:runtime-capabilities", (event) => {
        if (!isTrustedRenderer(event.senderFrame?.url)) {
            throw new Error("Rejected runtime capability request from an untrusted frame");
        }
        return {
            chrome: process.versions.chrome,
            electron: process.versions.electron,
            node: process.versions.node,
        };
    });

    ipcMain.handle("dashql:open-external", async (event, requestedUrl: unknown) => {
        if (!isTrustedRenderer(event.senderFrame?.url) || typeof requestedUrl !== "string") {
            throw new Error("Rejected external URL request");
        }
        const url = new URL(requestedUrl);
        if (url.protocol !== "https:") throw new Error("Rejected external URL request");
        await shell.openExternal(url.toString());
    });

    ipcMain.handle("dashql:oauth-loopback-listen", async (event, callbackUrl: unknown) => {
        if (!isTrustedRenderer(event.senderFrame?.url) || typeof callbackUrl !== "string") throw new Error("Rejected OAuth loopback request");
        const server = await OAuthLoopbackServer.listen(callbackUrl);
        const loopbackId = nextOAuthLoopbackId++;
        oauthLoopbacks.set(loopbackId, server);
        return loopbackId;
    });
    ipcMain.handle("dashql:oauth-loopback-wait", async (event, loopbackId: unknown) => {
        if (!isTrustedRenderer(event.senderFrame?.url) || typeof loopbackId !== "number") throw new Error("Rejected OAuth loopback request");
        const server = oauthLoopbacks.get(loopbackId);
        if (server === undefined) throw new Error("Unknown OAuth loopback server");
        try {
            return await server.result;
        } finally {
            oauthLoopbacks.delete(loopbackId);
        }
    });
    ipcMain.handle("dashql:oauth-loopback-close", (event, loopbackId: unknown) => {
        if (!isTrustedRenderer(event.senderFrame?.url) || typeof loopbackId !== "number") throw new Error("Rejected OAuth loopback request");
        oauthLoopbacks.get(loopbackId)?.close();
        oauthLoopbacks.delete(loopbackId);
    });

    ipcMain.handle("dashql:update-status", (event) => {
        if (!isTrustedRenderer(event.senderFrame?.url)) throw new Error("Rejected update request from an untrusted frame");
        return updater?.getStatus() ?? {status: "disabled"};
    });
    ipcMain.handle("dashql:check-for-updates", async (event, channel?: "latest" | "stable") => {
        if (!isTrustedRenderer(event.senderFrame?.url)) throw new Error("Rejected update request from an untrusted frame");
        if (channel !== undefined && channel !== "latest" && channel !== "stable") throw new Error("Rejected invalid update channel");
        return await updater?.check(channel) ?? {status: "disabled"};
    });
    ipcMain.handle("dashql:download-update", async (event, channel: unknown) => {
        if (!isTrustedRenderer(event.senderFrame?.url)) throw new Error("Rejected update request from an untrusted frame");
        if (channel !== "latest" && channel !== "stable") throw new Error("Rejected invalid update channel");
        if (updater === null) throw new Error("Updates are unavailable");
        await updater.download(channel);
    });
    ipcMain.handle("dashql:install-update", async (event) => {
        if (!isTrustedRenderer(event.senderFrame?.url)) throw new Error("Rejected update request from an untrusted frame");
        await installUpdate();
    });

    // The agents, see docs/design/agent_integration.md. The page names a harness of a fixed set and passes the
    // question, never a command.
    const binary = dashqlBinary();
    if (binary !== null) agentHost = new AgentHost({root: path.join(app.getPath("userData"), "agent"), dashqlBinary: binary});
    ipcMain.handle("dashql:agent-info", async (event) => {
        if (!isTrustedRenderer(event.senderFrame?.url)) throw new Error("Rejected agent request");
        return await agentHost?.info() ?? {harnesses: HARNESSES.map(({id}) => ({id, available: false}))};
    });
    ipcMain.handle("dashql:agent-ask", async (event, request: unknown) => {
        if (!isTrustedRenderer(event.senderFrame?.url) || request === null || typeof request !== "object") throw new Error("Rejected agent request");
        // The agent host checks the fields of the question
        await requireAgentHost().ask(request as AgentQuestion, agentPageOf(event.sender));
    });
    ipcMain.handle("dashql:agent-stop", async (event, workbookId: unknown) => {
        if (!isTrustedRenderer(event.senderFrame?.url) || typeof workbookId !== "string") throw new Error("Rejected agent request");
        await agentHost?.stop(workbookId);
    });
    ipcMain.handle("dashql:agent-forget", async (event, workbookId: unknown) => {
        if (!isTrustedRenderer(event.senderFrame?.url) || typeof workbookId !== "string") throw new Error("Rejected agent request");
        await agentHost?.forget(workbookId);
    });
    ipcMain.handle("dashql:agent-read-conversation", async (event, workbookId: unknown) => {
        if (!isTrustedRenderer(event.senderFrame?.url) || typeof workbookId !== "string") throw new Error("Rejected agent request");
        return await agentHost?.readConversation(workbookId) ?? null;
    });
    ipcMain.handle("dashql:agent-write-conversation", async (event, workbookId: unknown, conversation: unknown) => {
        if (!isTrustedRenderer(event.senderFrame?.url) || typeof workbookId !== "string") throw new Error("Rejected agent request");
        await requireAgentHost().writeConversation(workbookId, conversation);
    });
    ipcMain.on("dashql:agent-reply", (event, reply: unknown) => {
        if (!isTrustedRenderer(event.senderFrame?.url) || reply === null || typeof reply !== "object") return;
        agentHost?.reply(agentPageOf(event.sender), reply as {callId: unknown});
    });
    ipcMain.handle("dashql:agent-write-file", async (event, file: unknown) => {
        if (!isTrustedRenderer(event.senderFrame?.url) || file === null || typeof file !== "object") throw new Error("Rejected agent request");
        return await requireAgentHost().writeFile(agentPageOf(event.sender), file as {workbookId: unknown; kind: unknown; name: unknown; data: unknown});
    });

    ipcMain.handle("dashql:native-proxy-request", async (event, request: NativeProxyRequest) => {
        if (!isTrustedRenderer(event.senderFrame?.url)) {
            throw new Error("Rejected native proxy request from an untrusted frame");
        }
        if (nativeProxy === null) throw new Error("Native proxy is unavailable");
        return await nativeProxy.request(request);
    });

    app.whenReady().then(async () => {
        protocol.handle("app", handleAppRequest);
        if (process.argv.includes("--native-addon-test")) {
            await runNativeAddonTest();
            return;
        }
        const testMode = rendererTestMode();
        if (app.isPackaged || process.env.DASHQL_ENABLE_DEV_UPDATES) {
            updater = createElectronUpdater(app.getVersion(), () => mainWindow);
        }
        nativeProxy = startNativeProxy();
        await nativeProxy.ready();
        const window = await createWindow(testMode);
        if (testMode === null) void updater?.check().catch((error) => console.error("Update check failed", error));
        if (testMode === "startup") {
            await runStartupSmokeTest(window);
        }
    }).catch((error) => {
        console.error(error);
        app.exit(1);
    });

    app.on("window-all-closed", () => {
        if (process.platform !== "darwin") {
            app.quit();
        }
    });

    app.on("before-quit", (event) => {
        if (quitState === "quitting") return;
        // Write what the windows hold and stop the agents first, quitDashQL quits again
        event.preventDefault();
        void quitDashQL(false);
    });

    app.on("activate", async () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            await createWindow(null);
        }
    });
}
