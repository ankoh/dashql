const {contextBridge, ipcRenderer} = require("electron");

// The main process asks for the pending writes before a window closes, a renderer without a handler answers right away
let flushHandler = null;
ipcRenderer.on("dashql:flush", async (_event, requestId) => {
    try {
        if (flushHandler !== null) await flushHandler();
    } catch (error) {
        console.error("Failed to flush before closing", error);
    } finally {
        ipcRenderer.send("dashql:flushed", requestId);
    }
});

/// Listen to a channel of the main process, returns the function that stops listening
function listen(channel, listener) {
    const handler = (_event, value) => listener(value);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld("dashqlElectron", {
    // The agents, see docs/design/agent_integration.md: the page passes a harness of a fixed set and the prompt
    agent: {
        info: async () => await ipcRenderer.invoke("dashql:agent-info"),
        ask: async (request) => await ipcRenderer.invoke("dashql:agent-ask", {
            workbookId: request.workbookId,
            harness: request.harness,
            prompt: request.prompt,
        }),
        stop: async (workbookId) => await ipcRenderer.invoke("dashql:agent-stop", workbookId),
        forget: async (workbookId) => await ipcRenderer.invoke("dashql:agent-forget", workbookId),
        readConversation: async (workbookId) => await ipcRenderer.invoke("dashql:agent-read-conversation", workbookId),
        writeConversation: async (workbookId, conversation) => await ipcRenderer.invoke("dashql:agent-write-conversation", workbookId, conversation),
        onEvent: (listener) => listen("dashql:agent-event", listener),
        onCall: (listener) => listen("dashql:agent-call", listener),
        onCallCancel: (listener) => listen("dashql:agent-call-cancel", listener),
        reply: (reply) => ipcRenderer.send("dashql:agent-reply", {callId: reply.callId, out: reply.out, err: reply.err, exit: reply.exit}),
        writeFile: async (file) => await ipcRenderer.invoke("dashql:agent-write-file", {
            workbookId: file.workbookId,
            kind: file.kind,
            name: file.name,
            data: new Uint8Array(file.data),
        }),
    },
    claimWorkbookFolder: async (path) => await ipcRenderer.invoke("dashql:claim-workbook-folder", path),
    confirm: async (options) => await ipcRenderer.invoke("dashql:confirm", options),
    fs: {
        exists: async (path) => await ipcRenderer.invoke("dashql:fs", "exists", path),
        fileStamp: async (path) => await ipcRenderer.invoke("dashql:fs", "fileStamp", path),
        listFiles: async (path) => await ipcRenderer.invoke("dashql:fs", "listFiles", path),
        mkdir: async (path, options) => await ipcRenderer.invoke("dashql:fs", "mkdir", path, options),
        readDir: async (path) => await ipcRenderer.invoke("dashql:fs", "readDir", path),
        readFile: async (path) => new Uint8Array(await ipcRenderer.invoke("dashql:fs", "readFile", path)),
        readTextFile: async (path) => await ipcRenderer.invoke("dashql:fs", "readTextFile", path),
        remove: async (path, options) => await ipcRenderer.invoke("dashql:fs", "remove", path, options),
        rename: async (from, to) => await ipcRenderer.invoke("dashql:fs", "rename", from, to),
        stat: async (path) => await ipcRenderer.invoke("dashql:fs", "stat", path),
        writeFile: async (path, data) => await ipcRenderer.invoke("dashql:fs", "writeFile", path, new Uint8Array(data)),
        writeTextFile: async (path, data) => await ipcRenderer.invoke("dashql:fs", "writeTextFile", path, data),
    },
    getInitialDeepLinks: async () => await ipcRenderer.invoke("dashql:get-initial-deep-links"),
    getRuntimeCapabilities: async () => {
        const versions = await ipcRenderer.invoke("dashql:runtime-capabilities");
        return {
            ...versions,
            crossOriginIsolated: globalThis.crossOriginIsolated,
            secureContext: globalThis.isSecureContext,
            sharedArrayBuffer: typeof globalThis.SharedArrayBuffer === "function",
        };
    },
    nativeProxyRequest: async (request) => await ipcRenderer.invoke("dashql:native-proxy-request", {
        body: new Uint8Array(request.body),
        headers: request.headers.map((header) => [header[0], header[1]]),
        method: request.method,
        url: request.url,
    }),
    openExternal: async (url) => await ipcRenderer.invoke("dashql:open-external", url),
    oauthLoopback: {
        listen: async (callbackUrl) => await ipcRenderer.invoke("dashql:oauth-loopback-listen", callbackUrl),
        wait: async (loopbackId) => await ipcRenderer.invoke("dashql:oauth-loopback-wait", loopbackId),
        close: async (loopbackId) => await ipcRenderer.invoke("dashql:oauth-loopback-close", loopbackId),
    },
    updates: {
        check: async (channel) => await ipcRenderer.invoke("dashql:check-for-updates", channel),
        download: async (channel) => await ipcRenderer.invoke("dashql:download-update", channel),
        getStatus: async () => await ipcRenderer.invoke("dashql:update-status"),
        install: async () => await ipcRenderer.invoke("dashql:install-update"),
        onStatus: (listener) => listen("dashql:update-status", listener),
    },
    onFlush: (handler) => {
        flushHandler = handler;
        return () => {
            if (flushHandler === handler) flushHandler = null;
        };
    },
    onDeepLink: (listener) => listen("dashql:deep-link", listener),
    openDirectory: async (title) => await ipcRenderer.invoke("dashql:open-directory", title),
    setColorScheme: async (scheme) => await ipcRenderer.invoke("dashql:set-color-scheme", scheme),
});
