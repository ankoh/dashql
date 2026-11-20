import type {
    AppSettings,
    ConnectionEntry,
    ConnectionParams,
    DataFile,
    WorkbookData,
    WorkbookEntry,
    WorkbookRegistryBackend,
    ScriptData,
    StorageBackend,
    StorageManifest,
} from '../storage/storage_backend.js';
import { StorageBackendType, validateDataFileName } from '../storage/storage_backend.js';
import type * as core from '../../core/index.js';
import {
    type WorkbookTreeFolder,
    emptyWorkbookTree,
    flattenWorkbookTree,
    applyWorkbookTreeChange,
    folderAt,
    isFolderPathWithin,
} from '../storage/workbook_tree.js';

export class WorkbookTestBackend implements StorageBackend {
    readonly workbooks = new Map<string, WorkbookData>();
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
    async listWorkbooks(): Promise<WorkbookEntry[]> { return [...this.workbooks.keys()].map(path => ({ path })); }
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
    async loadWorkbook(workbookId: string): Promise<WorkbookData> {
        const workbook = this.workbooks.get(workbookId);
        if (!workbook) throw new Error(`No workbook ${workbookId}`);
        return workbook;
    }
    async saveWorkbookManifest(workbookId: string, data: WorkbookData): Promise<void> {
        this.calls.push(`manifest:${workbookId}`);
        this.workbooks.set(workbookId, data);
    }
    async deleteWorkbook(workbookId: string): Promise<void> {
        this.calls.push(`delete-workbook:${workbookId}`);
        this.workbooks.delete(workbookId);
        this.scripts.delete(workbookId);
        this.data.delete(workbookId);
    }
    async loadScripts(workbookId: string): Promise<ScriptData[]> {
        return [...(this.scripts.get(workbookId) ?? new Map())]
            .map(([name, sql]) => ({ name, sql }))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    }
    async loadScript(workbookId: string, scriptName: string): Promise<ScriptData> {
        const sql = this.scripts.get(workbookId)?.get(scriptName);
        if (sql == null) throw new Error(`Script not found: ${scriptName}`);
        return { name: scriptName, sql };
    }
    async saveScript(workbookId: string, scriptName: string, sql: string): Promise<void> {
        this.calls.push(`write:${workbookId}/${scriptName}=${sql}`);
        const scripts = this.scripts.get(workbookId) ?? new Map<string, string>();
        scripts.set(scriptName, sql);
        this.scripts.set(workbookId, scripts);
    }
    async deleteScript(workbookId: string, scriptName: string): Promise<void> {
        this.calls.push(`delete:${workbookId}/${scriptName}`);
        this.scripts.get(workbookId)?.delete(scriptName);
    }
    async renameScript(workbookId: string, oldScriptName: string, newScriptName: string): Promise<void> {
        this.calls.push(`rename:${workbookId}/${oldScriptName}->${newScriptName}`);
        const scripts = this.scripts.get(workbookId);
        if (!scripts?.has(oldScriptName)) return;
        const sql = scripts.get(oldScriptName)!;
        scripts.delete(oldScriptName);
        scripts.set(newScriptName, sql);
    }
    async listDataFiles(workbookId: string): Promise<DataFile[]> {
        return [...(this.data.get(workbookId) ?? new Map<string, Uint8Array>())]
            .map(([name, bytes]) => ({ name, sizeBytes: bytes.byteLength, mtimeMs: this.dataModified.get(`${workbookId}/${name}`) ?? 0 }))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    }
    async loadDataFile(workbookId: string, name: string): Promise<Uint8Array> {
        validateDataFileName(name);
        const bytes = this.data.get(workbookId)?.get(name);
        if (!bytes) throw new Error(`Data file not found: ${name}`);
        return bytes.slice();
    }
    async saveDataFile(workbookId: string, name: string, content: Uint8Array | Blob): Promise<void> {
        validateDataFileName(name);
        const data = this.data.get(workbookId) ?? new Map<string, Uint8Array>();
        const bytes = content instanceof Blob ? new Uint8Array(await content.arrayBuffer()) : content;
        data.set(name, bytes.slice());
        this.data.set(workbookId, data);
        this.dataModified.set(`${workbookId}/${name}`, ++this.dataClock);
    }
    async deleteDataFile(workbookId: string, name: string): Promise<void> {
        validateDataFileName(name);
        this.data.get(workbookId)?.delete(name);
    }
    async renameDataFile(workbookId: string, oldName: string, newName: string): Promise<void> {
        validateDataFileName(oldName);
        validateDataFileName(newName);
        const data = this.data.get(workbookId);
        if (!data?.has(oldName) || oldName === newName) return;
        data.set(newName, data.get(oldName)!);
        data.delete(oldName);
    }
}

export const TEST_WORKBOOK_ID = '11111111-2222-4333-8444-555555555555';
export const TEST_CONNECTION_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

export function testWorkbook(overrides: Partial<WorkbookData> = {}): WorkbookData {
    return {
        // The current version of the schema of the workbook file, the core writes the same (`storageVersions`)
        formatVersion: 11,
        workbookId: TEST_WORKBOOK_ID,
        name: 'V2 Workbook',
        connections: [{ connectionId: TEST_CONNECTION_ID, params: { hyper: {} } as ConnectionParams }],
        scripts: [],
        attachments: [],
        metadata: {},
        ...overrides,
    };
}

/// A test backend that owns a workbook registry in memory, the backend of the composite storage
export class WorkbookTestRegistry extends WorkbookTestBackend implements WorkbookRegistryBackend {
    tree: WorkbookTreeFolder = emptyWorkbookTree();

    /// The core changes the tree like it changes the tree of the OPFS
    constructor(private readonly core: core.DashQL) {
        super();
    }

    /// The registered workbooks in tree order
    get manifest(): WorkbookEntry[] { return flattenWorkbookTree(this.tree); }

    override async listWorkbooks(): Promise<WorkbookEntry[]> { return this.manifest; }
    override async saveWorkbookManifest(id: string, data: WorkbookData): Promise<void> {
        await super.saveWorkbookManifest(id, data);
        await this.upsertWorkbookEntry({ path: id, storageType: StorageBackendType.OPFS });
    }
    async loadWorkbookTree(): Promise<WorkbookTreeFolder> { return structuredClone(this.tree); }
    async upsertWorkbookEntry(entry: WorkbookEntry, folderPath?: readonly string[]): Promise<void> {
        this.tree = applyWorkbookTreeChange(this.core, this.tree, { kind: 'upsert', entry, folderPath });
    }
    async removeWorkbookEntry(id: string): Promise<void> { this.tree = applyWorkbookTreeChange(this.core, this.tree, { kind: 'remove', workbookId: id }); }
    async moveWorkbook(id: string, folderPath: string[], index: number): Promise<void> {
        if (folderAt(this.tree, folderPath) == null) return;
        this.tree = applyWorkbookTreeChange(this.core, this.tree, { kind: 'move', workbookId: id, folderPath, index });
    }
    async createFolder(path: string[]): Promise<void> {
        const parent = folderAt(this.tree, path.slice(0, -1));
        const name = path[path.length - 1];
        if (parent == null || name == null) throw new Error('There is no parent folder');
        const error = this.core.folderNameError(name, parent.folders.map(folder => folder.name));
        if (error != null) throw new Error(error);
        this.tree = this.mapFolder(path.slice(0, -1), folder => ({
            ...folder,
            folders: [...folder.folders, { name, path, folders: [], workbooks: [] }]
                .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true })),
        }));
    }
    async moveFolder(path: string[], parentPath: string[], name: string = path[path.length - 1] ?? ''): Promise<void> {
        const folder = folderAt(this.tree, path);
        if (folder == null || isFolderPathWithin(parentPath, path)) throw new Error('Cannot move the folder');
        const rebase = (current: WorkbookTreeFolder, base: string[]): WorkbookTreeFolder => ({
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
        const moved = flattenWorkbookTree(folder);
        this.tree = this.mapFolder(path.slice(0, -1), parent => ({
            ...parent,
            folders: parent.folders.filter(child => child.name !== folder.name),
            workbooks: [...parent.workbooks, ...moved],
        }));
    }
    async deleteWorkbookFiles(id: string): Promise<void> { await super.deleteWorkbook(id); }
    /// Delete the files and the registry entry, like the OPFS backend
    override async deleteWorkbook(id: string): Promise<void> {
        await this.deleteWorkbookFiles(id);
        await this.removeWorkbookEntry(id);
    }

    private mapFolder(path: string[], map: (folder: WorkbookTreeFolder) => WorkbookTreeFolder): WorkbookTreeFolder {
        const visit = (folder: WorkbookTreeFolder, rest: string[]): WorkbookTreeFolder => rest.length === 0
            ? map(folder)
            : { ...folder, folders: folder.folders.map(child => child.name === rest[0] ? visit(child, rest.slice(1)) : child) };
        return visit(this.tree, path);
    }
}
