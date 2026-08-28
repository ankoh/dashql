import {contextBridge, ipcRenderer} from "electron";

export interface RuntimeCapabilities {
    chrome: string;
    electron: string;
    node: string;
    crossOriginIsolated: boolean;
    secureContext: boolean;
    sharedArrayBuffer: boolean;
}

export interface NativeProxyRequest {
    body: Uint8Array;
    headers: string[][];
    method: string;
    url: string;
}

export interface NativeProxyResponse {
    body: Uint8Array;
    headers: string[][];
    status: number;
    statusText: string;
}

contextBridge.exposeInMainWorld("dashqlElectron", {
    getInitialDeepLinks: async (): Promise<string[]> => {
        return await ipcRenderer.invoke("dashql:get-initial-deep-links") as string[];
    },
    getRuntimeCapabilities: async (): Promise<RuntimeCapabilities> => {
        const versions = await ipcRenderer.invoke("dashql:runtime-capabilities") as Pick<
            RuntimeCapabilities,
            "chrome" | "electron" | "node"
        >;
        return {
            ...versions,
            crossOriginIsolated: globalThis.crossOriginIsolated,
            secureContext: globalThis.isSecureContext,
            sharedArrayBuffer: typeof globalThis.SharedArrayBuffer === "function",
        };
    },
    nativeProxyRequest: async (request: NativeProxyRequest): Promise<NativeProxyResponse> => {
        return await ipcRenderer.invoke("dashql:native-proxy-request", {
            body: new Uint8Array(request.body),
            headers: request.headers.map((header) => [header[0], header[1]]),
            method: request.method,
            url: request.url,
        }) as NativeProxyResponse;
    },
    onDeepLink: (listener: (data: string) => void): (() => void) => {
        const handler = (_event: Electron.IpcRendererEvent, data: string) => listener(data);
        ipcRenderer.on("dashql:deep-link", handler);
        return () => ipcRenderer.removeListener("dashql:deep-link", handler);
    },
});
