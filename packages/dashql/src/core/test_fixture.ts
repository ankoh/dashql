import { wasmUrl as coreWasmUrl } from '@akohn/dashql-wasm/dashql_core.js';
import { wasmUrl as dataflowWasmUrl } from '@akohn/dashql-wasm/dashql_dataflow.js';
import type { RuntimeOAuth, RuntimePlatform, RuntimeStorage } from './runtime.js';

let wasmBinary: Promise<Uint8Array> | undefined;

export function loadCoreWasm(): Promise<Uint8Array> {
    return wasmBinary ??= (async () => {
        const url = coreWasmUrl;
        if (url.protocol === 'file:') {
            const { readFile } = await import('node:fs/promises');
            return new Uint8Array(await readFile(url));
        }
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to load Core Wasm: ${response.status}`);
        return new Uint8Array(await response.arrayBuffer());
    })();
}

let dataflowWasmBinary: Promise<Uint8Array> | undefined;

export function loadDataflowWasm(): Promise<Uint8Array> {
    return dataflowWasmBinary ??= (async () => {
        const url = dataflowWasmUrl;
        if (url.protocol === 'file:') {
            const { readFile } = await import('node:fs/promises');
            return new Uint8Array(await readFile(url));
        }
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to load Dataflow Wasm: ${response.status}`);
        return new Uint8Array(await response.arrayBuffer());
    })();
}

/// The OAuth flows of a platform without any
export const NO_OAUTH: RuntimeOAuth = {
    pkce: () => Promise.reject(new Error('no OAuth')),
    flowInfo: () => ({ redirectVariant: 'WEB_OPENER_FLOW', redirectCallbackUrl: null, debugMode: false, flavor: null }),
    authorizeWithLoopback: () => Promise.reject(new Error('no OAuth')),
    authorizeWithRedirectPage: () => Promise.reject(new Error('no OAuth')),
    abort: () => { },
};

/// A storage of a platform in memory: the workbook files, the scripts by workbook and the connection entries
export class MemoryStorage implements RuntimeStorage {
    readonly workbooks = new Map<string, unknown>();
    readonly scripts = new Map<string, Map<string, string>>();
    connections: unknown[] | null = [];
    readonly connectionFiles = new Map<string, string>();
    /// The attachments of the workbooks
    readonly dataFiles = new Map<string, Map<string, Uint8Array>>();
    /// The workbooks of the workbook tree in order
    order: string[] = [];

    private scriptsOf(workbookId: string): Map<string, string> {
        let scripts = this.scripts.get(workbookId);
        if (scripts == null) {
            scripts = new Map();
            this.scripts.set(workbookId, scripts);
        }
        return scripts;
    }

    loadWorkbook = async (workbookId: string) => {
        const workbook = this.workbooks.get(workbookId);
        if (workbook == null) throw new Error(`no workbook ${workbookId}`);
        return structuredClone(workbook);
    };
    saveWorkbook = async (workbookId: string, workbook: unknown) => {
        if (!this.order.includes(workbookId)) this.order.push(workbookId);
        this.workbooks.set(workbookId, structuredClone(workbook));
    };
    saveScript = async (workbookId: string, fileName: string, text: string) => {
        this.scriptsOf(workbookId).set(fileName, text);
    };
    deleteScript = async (workbookId: string, fileName: string) => {
        this.scriptsOf(workbookId).delete(fileName);
    };
    renameScript = async (workbookId: string, from: string, to: string) => {
        const scripts = this.scriptsOf(workbookId);
        const text = scripts.get(from);
        scripts.delete(from);
        if (text != null) scripts.set(to, text);
    };
    listAttachments = async (workbookId: string) => [...(this.dataFiles.get(workbookId)?.keys() ?? [])];
    updateConnections = async (update: (connections: unknown[] | null) => unknown[] | null) => {
        const next = update(this.connections);
        if (next != null) this.connections = next;
    };
    saveConnectionFile = async (connectionId: string, fileName: string, text: string) => {
        this.connectionFiles.set(`${connectionId}/${fileName}`, text);
    };
    deleteConnectionFiles = async (connectionId: string) => {
        for (const key of [...this.connectionFiles.keys()]) if (key.startsWith(`${connectionId}/`)) this.connectionFiles.delete(key);
    };
    deleteWorkbook = async (workbookId: string) => {
        await this.deleteWorkbookFiles(workbookId);
        this.order = this.order.filter(id => id !== workbookId);
    };
    deleteWorkbookFiles = async (workbookId: string) => {
        this.workbooks.delete(workbookId);
        this.scripts.delete(workbookId);
        this.dataFiles.delete(workbookId);
    };
    ownsConnections = () => true;
    listWorkbooks = async () => this.order.map(path => ({ path, storageType: 'opfs' }));
    loadManifestConnections = async () => this.connections;
    loadScripts = async (workbookId: string) => [...this.scriptsOf(workbookId)].map(([name, sql]) => ({ name, sql }));
    listDataFiles = async (workbookId: string) => [...(this.dataFiles.get(workbookId) ?? [])].map(([name, bytes]) => ({ name, sizeBytes: bytes.byteLength }));
    loadConnectionFile = async (connectionId: string, fileName: string) => this.connectionFiles.get(`${connectionId}/${fileName}`) ?? null;
    loadDataFile = async (workbookId: string, name: string) => {
        const bytes = this.dataFiles.get(workbookId)?.get(name);
        if (bytes == null) throw new Error(`no attachment ${name} of ${workbookId}`);
        return bytes;
    };
    saveDataFile = async (workbookId: string, name: string, file: Blob | Uint8Array) => {
        const bytes = file instanceof Uint8Array ? file : new Uint8Array(await file.arrayBuffer());
        let files = this.dataFiles.get(workbookId);
        if (files == null) {
            files = new Map();
            this.dataFiles.set(workbookId, files);
        }
        files.set(name, bytes);
    };
    renameDataFile = async (workbookId: string, from: string, to: string) => {
        const files = this.dataFiles.get(workbookId);
        const bytes = files?.get(from);
        if (files == null || bytes == null) throw new Error(`no attachment ${from} of ${workbookId}`);
        files.delete(from);
        files.set(to, bytes);
    };
    upsertWorkbookEntry = async (entry: unknown) => {
        const path = (entry as { path: string }).path;
        if (!this.order.includes(path)) this.order.push(path);
    };
    registerNativeWorkbook = async () => {
        throw new Error('the storage of the test has no native folders');
    };
}

/// A platform of a test: the handle table, the storage in memory, timers of the event loop and no other I/O
export function testPlatform(storage: MemoryStorage = new MemoryStorage()): { platform: RuntimePlatform; storage: MemoryStorage; changed: boolean[]; logs: string[] } {
    const changed: boolean[] = [];
    const logs: string[] = [];
    const objects = new Map<number, unknown>();
    let next = 1;
    let uuid = 0;
    const none = () => { throw new Error('the platform of the test has none'); };
    const platform: RuntimePlatform = {
        clock: { now: () => Date.now(), sleep: ms => new Promise(resolve => setTimeout(resolve, ms)) },
        log: (level, message, details) => {
            if (level !== 'debug') logs.push(`${level}: ${message} ${JSON.stringify(Object.fromEntries(details))}`);
        },
        handles: {
            register: object => {
                objects.set(next, object);
                return next++;
            },
            release: handle => {
                objects.delete(handle);
            },
            get: handle => objects.get(handle),
            duplicate: handle => {
                objects.set(next, objects.get(handle));
                return next++;
            },
        },
        tables: { begin: none, append: none, finish: none, read: none, open: none, push: none },
        compute: null,
        http: { fetch: () => Promise.reject(new Error('no http')), abort: () => { } },
        channels: {
            connect: () => Promise.reject(new Error('no channels')),
            hyperLinkToken: () => null,
            describe: () => Promise.reject(new Error('no channels')),
            forget: () => { },
            open: () => Promise.reject(new Error('no channels')),
            next: () => Promise.reject(new Error('no channels')),
            cancel: async () => { },
            profileDetail: () => { },
        },
        resultCache: null,
        crypto: {
            randomUuid: () => `00000000-0000-4000-8000-${(++uuid).toString().padStart(12, '0')}`,
            sha256: async bytes => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)),
        },
        oauth: NO_OAUTH,
        extensions: { loadSpec: () => Promise.reject(new Error('no extensions')) },
        storage,
        archives: null,
        changed: urgent => {
            changed.push(urgent);
        },
    };
    return { platform, storage, changed, logs };
}
