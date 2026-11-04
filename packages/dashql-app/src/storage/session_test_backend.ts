import type {
    AppSettings,
    ConnectionEntry,
    DataFile,
    SessionData,
    SessionEntry,
    SessionRegistryBackend,
    ScriptData,
    StorageBackend,
    StorageManifest,
} from './storage_backend.js';
import { StorageBackendType, validateDataFileName } from './storage_backend.js';
import { SESSION_FORMAT_VERSION } from './migration/versions.js';
import {
    type SessionTreeFolder,
    emptySessionTree,
    flattenSessionTree,
    folderAt,
    folderNameError,
    isFolderPathWithin,
    moveSessionInTree,
    removeSessionFromTree,
    upsertSessionInTree,
} from './session_tree.js';

export class SessionTestBackend implements StorageBackend {
    readonly sessions = new Map<string, SessionData>();
    readonly scripts = new Map<string, Map<string, string>>();
    readonly data = new Map<string, Map<string, Uint8Array>>();
    /// The modification times of the data files, a counter that every save advances
    private readonly dataModified = new Map<string, number>();
    private dataClock = 0;
    readonly calls: string[] = [];
    appSettings: AppSettings | null = null;
    /// The connections of the manifest, undefined before the connections were migrated
    connections: ConnectionEntry[] | undefined = undefined;
    /// The files of the connections, keyed by `<connectionId>/<fileName>`
    readonly connectionFiles = new Map<string, string>();

    constructor(private readonly type = StorageBackendType.OPFS) {}

    getBackendType(): StorageBackendType { return this.type; }
    async listSessions(): Promise<SessionEntry[]> { return [...this.sessions.keys()].map(path => ({ path })); }
    async loadAppSettings(): Promise<AppSettings | null> { return this.appSettings; }
    async saveAppSettings(settings: AppSettings): Promise<void> { this.appSettings = settings; }
    async loadManifest(): Promise<StorageManifest> {
        return {
            ...(this.appSettings ? { appSettings: this.appSettings } : {}),
            ...(this.connections ? { connections: structuredClone(this.connections) } : {}),
        };
    }
    async updateConnections(update: (connections: ConnectionEntry[] | undefined) => ConnectionEntry[] | null): Promise<void> {
        const next = update(this.connections ? structuredClone(this.connections) : undefined);
        if (next != null) {
            this.calls.push('connections');
            this.connections = next;
        }
    }
    async loadConnectionFile(connectionId: string, fileName: string): Promise<string | null> {
        return this.connectionFiles.get(`${connectionId}/${fileName}`) ?? null;
    }
    async saveConnectionFile(connectionId: string, fileName: string, text: string): Promise<void> {
        this.calls.push(`connection-file:${connectionId}/${fileName}`);
        this.connectionFiles.set(`${connectionId}/${fileName}`, text);
    }
    async createConnectionFolder(connectionId: string): Promise<void> {
        this.calls.push(`connection-folder:${connectionId}`);
    }
    async deleteConnectionFiles(connectionId: string): Promise<void> {
        for (const key of [...this.connectionFiles.keys()]) {
            if (key.startsWith(`${connectionId}/`)) this.connectionFiles.delete(key);
        }
    }
    async loadSession(sessionId: string): Promise<SessionData> {
        const session = this.sessions.get(sessionId);
        if (!session) throw new Error(`No session ${sessionId}`);
        return session;
    }
    async saveSessionManifest(sessionId: string, data: SessionData): Promise<void> {
        this.calls.push(`manifest:${sessionId}`);
        this.sessions.set(sessionId, data);
    }
    async deleteSession(sessionId: string): Promise<void> {
        this.calls.push(`delete-session:${sessionId}`);
        this.sessions.delete(sessionId);
        this.scripts.delete(sessionId);
        this.data.delete(sessionId);
    }
    async loadScripts(sessionId: string): Promise<ScriptData[]> {
        return [...(this.scripts.get(sessionId) ?? new Map())]
            .map(([name, sql]) => ({ name, sql }))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    }
    async loadScript(sessionId: string, scriptName: string): Promise<ScriptData> {
        const sql = this.scripts.get(sessionId)?.get(scriptName);
        if (sql == null) throw new Error(`Script not found: ${scriptName}`);
        return { name: scriptName, sql };
    }
    async saveScript(sessionId: string, scriptName: string, sql: string): Promise<void> {
        this.calls.push(`write:${sessionId}/${scriptName}=${sql}`);
        const scripts = this.scripts.get(sessionId) ?? new Map<string, string>();
        scripts.set(scriptName, sql);
        this.scripts.set(sessionId, scripts);
    }
    async deleteScript(sessionId: string, scriptName: string): Promise<void> {
        this.calls.push(`delete:${sessionId}/${scriptName}`);
        this.scripts.get(sessionId)?.delete(scriptName);
    }
    async renameScript(sessionId: string, oldScriptName: string, newScriptName: string): Promise<void> {
        this.calls.push(`rename:${sessionId}/${oldScriptName}->${newScriptName}`);
        const scripts = this.scripts.get(sessionId);
        if (!scripts?.has(oldScriptName)) return;
        const sql = scripts.get(oldScriptName)!;
        scripts.delete(oldScriptName);
        scripts.set(newScriptName, sql);
    }
    async listDataFiles(sessionId: string): Promise<DataFile[]> {
        return [...(this.data.get(sessionId) ?? new Map<string, Uint8Array>())]
            .map(([name, bytes]) => ({ name, sizeBytes: bytes.byteLength, mtimeMs: this.dataModified.get(`${sessionId}/${name}`) ?? 0 }))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    }
    async loadDataFile(sessionId: string, name: string): Promise<Uint8Array> {
        validateDataFileName(name);
        const bytes = this.data.get(sessionId)?.get(name);
        if (!bytes) throw new Error(`Data file not found: ${name}`);
        return bytes.slice();
    }
    async saveDataFile(sessionId: string, name: string, content: Uint8Array | Blob): Promise<void> {
        validateDataFileName(name);
        const data = this.data.get(sessionId) ?? new Map<string, Uint8Array>();
        const bytes = content instanceof Blob ? new Uint8Array(await content.arrayBuffer()) : content;
        data.set(name, bytes.slice());
        this.data.set(sessionId, data);
        this.dataModified.set(`${sessionId}/${name}`, ++this.dataClock);
    }
    async deleteDataFile(sessionId: string, name: string): Promise<void> {
        validateDataFileName(name);
        this.data.get(sessionId)?.delete(name);
    }
    async renameDataFile(sessionId: string, oldName: string, newName: string): Promise<void> {
        validateDataFileName(oldName);
        validateDataFileName(newName);
        const data = this.data.get(sessionId);
        if (!data?.has(oldName) || oldName === newName) return;
        data.set(newName, data.get(oldName)!);
        data.delete(oldName);
    }
}

export const TEST_SESSION_ID = '11111111-2222-4333-8444-555555555555';
export const TEST_CONNECTION_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

/// The connection fields of a test session
export function testConnections(...connections: SessionData['connections']): Pick<SessionData, 'connections'> {
    return { connections };
}

export function testSession(overrides: Partial<SessionData> = {}): SessionData {
    return {
        formatVersion: SESSION_FORMAT_VERSION,
        sessionId: TEST_SESSION_ID,
        name: 'V2 Session',
        connections: [{ connectionId: TEST_CONNECTION_ID, params: { hyper: {} } as any }],
        scripts: [],
        attachments: [],
        metadata: {},
        ...overrides,
    };
}

/// A test backend that owns a session registry in memory, the backend of the composite storage
export class SessionTestRegistry extends SessionTestBackend implements SessionRegistryBackend {
    tree: SessionTreeFolder = emptySessionTree();

    /// The registered sessions in tree order
    get manifest(): SessionEntry[] { return flattenSessionTree(this.tree); }

    override async listSessions(): Promise<SessionEntry[]> { return this.manifest; }
    override async saveSessionManifest(id: string, data: SessionData): Promise<void> {
        await super.saveSessionManifest(id, data);
        await this.upsertSessionEntry({ path: id, storageType: StorageBackendType.OPFS });
    }
    async loadSessionTree(): Promise<SessionTreeFolder> { return structuredClone(this.tree); }
    async upsertSessionEntry(entry: SessionEntry, folderPath?: readonly string[]): Promise<void> {
        this.tree = upsertSessionInTree(this.tree, entry, folderPath);
    }
    async removeSessionEntry(id: string): Promise<void> { this.tree = removeSessionFromTree(this.tree, id); }
    async moveSession(id: string, folderPath: string[], index: number): Promise<void> {
        this.tree = moveSessionInTree(this.tree, id, folderPath, index);
    }
    async createFolder(path: string[]): Promise<void> {
        const parent = folderAt(this.tree, path.slice(0, -1));
        const name = path[path.length - 1];
        if (parent == null || name == null) throw new Error('There is no parent folder');
        const error = folderNameError(name, parent.folders.map(folder => folder.name));
        if (error != null) throw new Error(error);
        this.tree = this.mapFolder(path.slice(0, -1), folder => ({
            ...folder,
            folders: [...folder.folders, { name, path, folders: [], sessions: [] }]
                .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true })),
        }));
    }
    async moveFolder(path: string[], parentPath: string[], name: string = path[path.length - 1] ?? ''): Promise<void> {
        const folder = folderAt(this.tree, path);
        if (folder == null || isFolderPathWithin(parentPath, path)) throw new Error('Cannot move the folder');
        const rebase = (current: SessionTreeFolder, base: string[]): SessionTreeFolder => ({
            ...current,
            name: base[base.length - 1],
            path: base,
            folders: current.folders.map(child => rebase(child, [...base, child.name])),
        });
        this.tree = this.mapFolder(path.slice(0, -1), parent => ({ ...parent, folders: parent.folders.filter(child => child.name !== folder.name) }));
        this.tree = this.mapFolder(parentPath, parent => ({ ...parent, folders: [...parent.folders, rebase(folder, [...parentPath, name])] }));
    }
    async deleteFolder(path: string[]): Promise<void> {
        const folder = folderAt(this.tree, path);
        if (folder == null || path.length === 0) throw new Error('There is no folder');
        const moved = flattenSessionTree(folder);
        this.tree = this.mapFolder(path.slice(0, -1), parent => ({
            ...parent,
            folders: parent.folders.filter(child => child.name !== folder.name),
            sessions: [...parent.sessions, ...moved],
        }));
    }
    async deleteSessionFiles(id: string): Promise<void> { await super.deleteSession(id); }
    /// Delete the files and the registry entry, like the OPFS backend
    override async deleteSession(id: string): Promise<void> {
        await this.deleteSessionFiles(id);
        await this.removeSessionEntry(id);
    }

    private mapFolder(path: string[], map: (folder: SessionTreeFolder) => SessionTreeFolder): SessionTreeFolder {
        const visit = (folder: SessionTreeFolder, rest: string[]): SessionTreeFolder => rest.length === 0
            ? map(folder)
            : { ...folder, folders: folder.folders.map(child => child.name === rest[0] ? visit(child, rest.slice(1)) : child) };
        return visit(this.tree, path);
    }
}
