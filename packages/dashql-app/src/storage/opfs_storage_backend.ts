import { type WorkbookRegistryBackend, type ConnectionEntry, STORAGE_CONNECTIONS_FOLDER, type WorkbookData, type ScriptData, type WorkbookEntry, type StorageManifest, type AppSettings, StorageBackendType, STORAGE_MANIFEST_FILE, STORAGE_WORKBOOKS_FOLDER, STORAGE_WORKBOOK_FILE, STORAGE_SCRIPTS_FOLDER, STORAGE_SHELL_FOLDER } from '@ankoh/dashql/platform/storage/storage_backend';
import { type DataFile, type DataFileContent, STORAGE_ATTACHMENTS_FOLDER, isAttachmentFileName, validateDataFileName } from '@ankoh/dashql/platform/storage/storage_backend';
import { sleep } from '@ankoh/dashql/platform/utils/sleep';
import { getOPFSRoot } from '@ankoh/dashql/platform/platform/opfs_root';
import { HYPER_CLOUDS_DIRECTORY } from '@ankoh/dashql/platform/platform/hyperdb/hyperdb_opfs_instance';
import {
    INITIAL_WORKBOOK_FOLDER,
    STORAGE_FOLDER_FILE,
    STORAGE_WORKBOOK_TREE_FOLDER,
    type WorkbookTreeFolder,
    dropDuplicateWorkbooks,
    emptyWorkbookTree,
    flattenWorkbookTree,
    folderAt,
    folderNameError,
    folderPathKey,
    isFolderPathWithin,
    listFolders,
    moveWorkbookInTree,
    readWorkbookTreeDirectory,
    removeWorkbookFromTree,
    sameFolderPath,
    upsertWorkbookInTree,
} from '@ankoh/dashql/platform/storage/workbook_tree';

/// The name of the web lock that guards the manifest
export const OPFS_MANIFEST_LOCK = 'dashql-manifest';
/// The name of the web lock that guards the workbook tree
export const OPFS_WORKBOOK_TREE_LOCK = 'dashql-workbook-tree';

/// The attempts to delete the files of a connection while one of them is in use, and the delay between them
const DELETE_IN_USE_ATTEMPTS = 20;
const DELETE_IN_USE_RETRY_MS = 100;

/// Origin Private File System storage backend.
///
/// This backend owns the workbook registry (the workbook tree `workbooktree/`), which lists *every*
/// workbook regardless of where its files physically live. Workbooks stored in OPFS keep their files under
/// `workbooks/<uuid>/…`; workbooks relocated to a native directory keep only a registry entry here
/// (their files live on disk, managed by `NativeStorageBackend`).
///
/// Every per-workbook method is keyed by the bare workbook UUID.
export class OPFSStorageBackend implements WorkbookRegistryBackend {
    private rootHandle: FileSystemDirectoryHandle | null = null;
    /// The latest manifest mutation, every read-modify-write of the manifest chains onto it
    private manifestChain: Promise<void> = Promise.resolve();
    /// The latest change of the workbook tree, every change of the tree chains onto it
    private treeChain: Promise<void> = Promise.resolve();

    constructor(private readonly getRoot: () => Promise<FileSystemDirectoryHandle> = getOPFSRoot) {}

    getBackendType(): StorageBackendType {
        return StorageBackendType.OPFS;
    }

    async initialize(): Promise<void> {
        this.rootHandle = await this.getRoot();
        await this.createWorkbookTree();
    }

    /// A storage without a workbook tree starts with the folder My Workbooks.
    /// The tree is only created once, a deleted folder stays deleted.
    private async createWorkbookTree(): Promise<void> {
        const root = this.ensureInitialized();
        await this.withTreeLock(async () => {
            try {
                await root.getDirectoryHandle(STORAGE_WORKBOOK_TREE_FOLDER, { create: false });
            } catch (error) {
                if ((error as DOMException).name !== 'NotFoundError') throw error;
                await this.writeFolderFile([], []);
                await this.writeFolderFile(INITIAL_WORKBOOK_FOLDER, []);
            }
        });
    }

    /// Run a manifest operation exclusively.
    ///
    /// Every write of the manifest is a read-modify-write, so concurrent writers (workbook registry
    /// updates, app settings, connections) would otherwise lose each other's updates. The chain
    /// serializes the writers of this backend, the web lock serializes them across tabs that share
    /// the same OPFS root.
    private withManifestLock<T>(fn: () => Promise<T>): Promise<T> {
        const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
        const run = locks != null ? () => locks.request(OPFS_MANIFEST_LOCK, fn) : fn;
        const result = this.manifestChain.then(run, run);
        this.manifestChain = result.then(() => { }, () => { });
        return result;
    }

    /// Run an operation on the workbook tree exclusively, within this backend and across tabs.
    /// Changes of the workbook tree read and write several folder files, the lock keeps them consistent.
    private withTreeLock<T>(fn: () => Promise<T>): Promise<T> {
        const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
        const run = locks != null ? () => locks.request(OPFS_WORKBOOK_TREE_LOCK, fn) : fn;
        const result = this.treeChain.then(run, run);
        this.treeChain = result.then(() => { }, () => { });
        return result;
    }

    /// Mutate the manifest exclusively. The mutation returns false when nothing changed.
    private mutateManifest(fn: (manifest: StorageManifest) => boolean | void): Promise<void> {
        return this.withManifestLock(async () => {
            const root = this.ensureInitialized();
            const manifest = await this.readManifest(root);
            if (fn(manifest) === false) {
                return;
            }
            await this.writeManifest(root, manifest);
        });
    }

    private ensureInitialized(): FileSystemDirectoryHandle {
        if (!this.rootHandle) {
            throw new Error('OPFSStorageBackend not initialized. Call initialize() first.');
        }
        return this.rootHandle;
    }

    /// The relative folder that holds a workbook's files, e.g. "workbooks/<uuid>"
    private workbookRelPath(workbookId: string): string {
        return `${STORAGE_WORKBOOKS_FOLDER}/${workbookId}`;
    }

    /// Natural sort for strings with numeric components (e.g., "page-1" < "page-2" < "page-10")
    private naturalSort(a: string, b: string): number {
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    }

    /// The workbooks of the workbook tree, in the order of the sidebar
    async listWorkbooks(): Promise<WorkbookEntry[]> {
        return flattenWorkbookTree(await this.loadWorkbookTree());
    }

    async loadWorkbook(workbookId: string): Promise<WorkbookData> {
        const workbookDir = await this.getWorkbookDir(this.workbookRelPath(workbookId), false);
        const metaFile = await workbookDir.getFileHandle(STORAGE_WORKBOOK_FILE);
        const file = await metaFile.getFile();
        const text = await file.text();
        const data: WorkbookData = JSON.parse(text);

        // workbookId is required - will throw if missing
        if (!data.workbookId) {
            throw new Error(`Workbook ${workbookId} is missing required workbookId field. Please migrate the workbook or regenerate it.`);
        }

        return data;
    }

    async saveWorkbookManifest(workbookId: string, data: WorkbookData): Promise<void> {
        const workbookDir = await this.getWorkbookDir(this.workbookRelPath(workbookId), true);
        const metaFile = await workbookDir.getFileHandle(STORAGE_WORKBOOK_FILE, { create: true });
        const writable = await metaFile.createWritable();
        await writable.write(JSON.stringify(data, null, 2));
        await writable.close();

        await this.upsertWorkbookEntry({ path: workbookId, storageType: StorageBackendType.OPFS });
    }



    async deleteWorkbook(workbookId: string): Promise<void> {
        await this.deleteWorkbookFiles(workbookId);
        // Always try to update the manifest even if the workbook files weren't found
        // (in case the manifest still has a stale reference).
        await this.removeWorkbookEntry(workbookId);
    }

    /// Delete a workbook's files only, leaving the registry entry intact.
    async deleteWorkbookFiles(workbookId: string): Promise<void> {
        const relativePath = this.workbookRelPath(workbookId);
        const root = this.ensureInitialized();

        try {
            // Navigate to the parent directory, then remove the workbook entry
            const parts = relativePath.split('/').filter(p => p);
            if (parts.length > 0) {
                let parentDir: FileSystemDirectoryHandle = root;
                for (let i = 0; i < parts.length - 1; i++) {
                    parentDir = await parentDir.getDirectoryHandle(parts[i], { create: false });
                }
                await parentDir.removeEntry(parts[parts.length - 1], { recursive: true });
            }
        } catch (error) {
            // If workbooks folder or workbook doesn't exist, that's fine - it's already deleted
            if ((error as any).name !== 'NotFoundError') {
                throw error;
            }
        }
    }

    async loadScripts(workbookId: string): Promise<ScriptData[]> {
        const workbookDir = await this.getWorkbookDir(this.workbookRelPath(workbookId), false).catch((error) => {
            if ((error as any).name === 'NotFoundError') return null;
            throw error;
        });
        if (!workbookDir) {
            return [];
        }
        let scriptsDir: FileSystemDirectoryHandle;
        try {
            scriptsDir = await workbookDir.getDirectoryHandle(STORAGE_SCRIPTS_FOLDER, { create: false });
        } catch (error) {
            if ((error as any).name === 'NotFoundError') {
                return [];
            }
            throw error;
        }
        const scripts: ScriptData[] = [];

        for await (const [name, handle] of scriptsDir.entries()) {
            if (handle.kind === 'directory') {
                throw new Error(`Invalid V2 workbook layout: nested scripts directory ${name}`);
            }
            if (name.toLowerCase() === 'dashql-draft.sql') {
                throw new Error('Invalid V2 workbook layout: dashql-draft.sql is not supported');
            }
            if (handle.kind === 'file' && name.toLowerCase().endsWith('.sql')) {
                const file = await (handle as FileSystemFileHandle).getFile();
                scripts.push({ name, sql: await file.text() });
            }
        }
        scripts.sort((a, b) => this.naturalSort(a.name, b.name));
        return scripts;
    }

    /// Move a single file between (or within) OPFS directories, preserving its contents byte-for-byte.
    ///
    /// Prefers the non-standard `FileSystemFileHandle.move()` (Chromium) for a true in-place move, and
    /// falls back to copy-then-delete where it is unavailable (Safari/Firefox). The same-directory case
    /// (`srcDir === destDir`) is a pure rename.
    private async moveFile(
        srcDir: FileSystemDirectoryHandle,
        srcName: string,
        destDir: FileSystemDirectoryHandle,
        destName: string,
    ): Promise<void> {
        if (srcDir === destDir && srcName === destName) {
            return;
        }
        const srcHandle = await srcDir.getFileHandle(srcName, { create: false });
        const move = (srcHandle as any).move as ((...args: any[]) => Promise<void>) | undefined;
        if (typeof move === 'function') {
            // move(name) renames in place; move(destDir, name) relocates across directories.
            await (srcDir === destDir ? move.call(srcHandle, destName) : move.call(srcHandle, destDir, destName));
            return;
        }
        // Fallback: stream the source File (a Blob, so this is binary-safe) into the new handle, then
        // drop the original.
        const file = await srcHandle.getFile();
        const destHandle = await destDir.getFileHandle(destName, { create: true });
        const writable = await destHandle.createWritable();
        await writable.write(file);
        await writable.close();
        await srcDir.removeEntry(srcName);
    }


    async loadScript(workbookId: string, scriptName: string): Promise<ScriptData> {
        const workbookDir = await this.getWorkbookDir(this.workbookRelPath(workbookId), false);
        const scriptsDir = await workbookDir.getDirectoryHandle(STORAGE_SCRIPTS_FOLDER, { create: false });

        try {
            const fileHandle = await scriptsDir.getFileHandle(scriptName);
            const file = await fileHandle.getFile();
            const sql = await file.text();
            return { name: scriptName, sql };
        } catch {
            throw new Error(`Script not found: workbook ${workbookId}, script ${scriptName}`);
        }
    }

    async saveScript(
        workbookId: string,
        scriptName: string,
        sql: string
    ): Promise<void> {
        const workbookDir = await this.getWorkbookDir(this.workbookRelPath(workbookId), true);
        const scriptsDir = await workbookDir.getDirectoryHandle(STORAGE_SCRIPTS_FOLDER, { create: true });
        const fileHandle = await scriptsDir.getFileHandle(scriptName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(sql);
        await writable.close();
    }

    /// Delete a script, a script that is gone is deleted already: the writer retries a deletion that failed
    async deleteScript(workbookId: string, scriptName: string): Promise<void> {
        try {
            const workbookDir = await this.getWorkbookDir(this.workbookRelPath(workbookId), false);
            const scriptsDir = await workbookDir.getDirectoryHandle(STORAGE_SCRIPTS_FOLDER, { create: false });
            await scriptsDir.removeEntry(scriptName);
        } catch (error) {
            if ((error as any).name === 'NotFoundError' || ((error as any).message ?? '').startsWith('Directory not found')) {
                return;
            }
            throw error;
        }
    }

    async renameScript(workbookId: string, oldScriptName: string, newScriptName: string): Promise<void> {
        if (oldScriptName === newScriptName) {
            return;
        }
        // Navigate without creating anything: if the workbook, page, or source file isn't flushed yet,
        // the pending write under the new name creates them, so there is nothing to move. The
        // scripts/folder/file handles surface a raw OPFS NotFoundError, but getWorkbookDir re-wraps that
        // into a generic "Directory not found" Error, so the no-op guard has to recognise both forms.
        let scriptsDir: FileSystemDirectoryHandle;
        try {
            const workbookDir = await this.getWorkbookDir(this.workbookRelPath(workbookId), false);
            scriptsDir = await workbookDir.getDirectoryHandle(STORAGE_SCRIPTS_FOLDER, { create: false });
            await scriptsDir.getFileHandle(oldScriptName, { create: false });
        } catch (error) {
            if ((error as any).name === 'NotFoundError' || ((error as any).message ?? '').startsWith('Directory not found')) {
                return;
            }
            throw error;
        }
        await this.moveFile(scriptsDir, oldScriptName, scriptsDir, newScriptName);
    }

    private async dataDir(workbookId: string, create: boolean): Promise<FileSystemDirectoryHandle | null> {
        const root = this.ensureInitialized();
        try {
            const workbooks = await root.getDirectoryHandle(STORAGE_WORKBOOKS_FOLDER, { create });
            const workbook = await workbooks.getDirectoryHandle(workbookId, { create });
            return await workbook.getDirectoryHandle(STORAGE_ATTACHMENTS_FOLDER, { create });
        } catch (error) {
            if (!create && (error as Error).name === 'NotFoundError') return null;
            throw error;
        }
    }

    async listDataFiles(workbookId: string): Promise<DataFile[]> {
        const dir = await this.dataDir(workbookId, false);
        if (!dir) return [];
        const files: DataFile[] = [];
        for await (const [name, handle] of dir.entries()) {
            if (handle.kind === 'directory') throw new Error(`Invalid workbook layout: nested data directory ${name}`);
            // Other files in the folder are no attachments
            if (!isAttachmentFileName(name)) continue;
            validateDataFileName(name);
            const file = await (handle as FileSystemFileHandle).getFile();
            files.push({ name, sizeBytes: file.size, mtimeMs: file.lastModified });
        }
        return files.sort((a, b) => this.naturalSort(a.name, b.name));
    }

    async loadDataFile(workbookId: string, name: string): Promise<Uint8Array> {
        validateDataFileName(name);
        const dir = await this.dataDir(workbookId, false);
        if (!dir) throw new Error(`Data file not found: ${name}`);
        const handle = await dir.getFileHandle(name, { create: false });
        return new Uint8Array(await (await handle.getFile()).arrayBuffer());
    }

    async saveDataFile(workbookId: string, name: string, content: DataFileContent): Promise<void> {
        validateDataFileName(name);
        const dir = (await this.dataDir(workbookId, true))!;
        const handle = await dir.getFileHandle(name, { create: true });
        const writable = await handle.createWritable();
        // FileSystemWritableFileStream accepts Blob directly and streams it into OPFS without
        // materializing a second full attachment buffer in the renderer.
        if (content instanceof Blob) {
            await writable.write(content);
        } else {
            const buffer = new ArrayBuffer(content.byteLength);
            new Uint8Array(buffer).set(content);
            await writable.write(buffer);
        }
        await writable.close();
    }

    async deleteDataFile(workbookId: string, name: string): Promise<void> {
        validateDataFileName(name);
        const dir = await this.dataDir(workbookId, false);
        if (!dir) return;
        try {
            await dir.removeEntry(name);
        } catch (error) {
            if ((error as Error).name === 'NotFoundError') return;
            throw error;
        }
    }

    async renameDataFile(workbookId: string, oldName: string, newName: string): Promise<void> {
        validateDataFileName(oldName);
        validateDataFileName(newName);
        if (oldName === newName) return;
        const dir = await this.dataDir(workbookId, false);
        if (!dir) return;
        await this.moveFile(dir, oldName, dir, newName);
    }

    /// Write an empty file (creating or truncating it), which advances its mtime.
    private async writeEmptyFile(dir: FileSystemDirectoryHandle, name: string): Promise<void> {
        const handle = await dir.getFileHandle(name, { create: true });
        const writable = await handle.createWritable();
        await writable.write(new ArrayBuffer(0));
        await writable.close();
    }

    async clearAllStorage(): Promise<void> {
        const root = this.ensureInitialized();

        // Step 1: Remove the workbook tree FIRST.
        // This ensures the app won't try to restore workbooks even if the other cleanup fails.
        try {
            await this.withTreeLock(() => root.removeEntry(STORAGE_WORKBOOK_TREE_FOLDER, { recursive: true }));
        } catch (error) {
            if ((error as DOMException).name !== 'NotFoundError') {
                console.warn('Failed to clear the workbook tree:', error);
            }
        }
        try {
            // The cleared storage stays at its storage version
            await this.withManifestLock(async () => {
                const storageVersion = await this.readManifest(root).then(manifest => manifest.storageVersion, () => undefined);
                await this.writeManifest(root, storageVersion == null ? {} : { storageVersion });
            });
        } catch (error) {
            console.warn('Failed to clear manifest:', error);
        }

        // Step 2: Delete app-owned data folders while leaving unrelated origin storage untouched.
        for (const folder of [STORAGE_WORKBOOKS_FOLDER, STORAGE_CONNECTIONS_FOLDER, STORAGE_SHELL_FOLDER, HYPER_CLOUDS_DIRECTORY]) {
            try {
                await root.removeEntry(folder, { recursive: true });
            } catch (error) {
                if ((error as DOMException).name !== 'NotFoundError') {
                    console.warn(`Failed to delete ${folder} folder:`, error);
                }
            }
        }
    }

    async loadAppSettings(): Promise<AppSettings | null> {
        const root = this.ensureInitialized();
        try {
            const indexFile = await root.getFileHandle(STORAGE_MANIFEST_FILE, { create: false });
            const file = await indexFile.getFile();
            const text = await file.text();
            const manifest: StorageManifest = JSON.parse(text);
            return manifest.appSettings ?? null;
        } catch (error) {
            if ((error as any).name === 'NotFoundError') {
                return null;
            }
            throw error;
        }
    }

    async saveAppSettings(settings: AppSettings): Promise<void> {
        await this.mutateManifest(manifest => {
            manifest.appSettings = settings;
        });
    }

    async loadManifest(): Promise<StorageManifest> {
        const root = this.ensureInitialized();
        return await this.withManifestLock(() => this.readManifest(root));
    }

    async updateConnections(update: (connections: ConnectionEntry[] | undefined) => ConnectionEntry[] | null): Promise<void> {
        await this.mutateManifest(manifest => {
            const next = update(manifest.connections);
            if (next == null) {
                return false;
            }
            manifest.connections = next;
            return true;
        });
    }

    /// The folder of a connection's files, e.g. "connections/<uuid>"
    private connectionRelPath(connectionId: string): string {
        return `${STORAGE_CONNECTIONS_FOLDER}/${connectionId}`;
    }

    async loadConnectionFile(connectionId: string, fileName: string): Promise<string | null> {
        try {
            const dir = await this.getWorkbookDir(this.connectionRelPath(connectionId), false);
            const handle = await dir.getFileHandle(fileName, { create: false });
            return await (await handle.getFile()).text();
        } catch {
            return null;
        }
    }

    async saveConnectionFile(connectionId: string, fileName: string, text: string): Promise<void> {
        const dir = await this.getWorkbookDir(this.connectionRelPath(connectionId), true);
        const handle = await dir.getFileHandle(fileName, { create: true });
        const writable = await handle.createWritable();
        await writable.write(text);
        await writable.close();
    }

    async createConnectionFolder(connectionId: string): Promise<void> {
        await this.getWorkbookDir(this.connectionRelPath(connectionId), true);
    }

    async deleteConnectionFiles(connectionId: string): Promise<void> {
        const root = this.ensureInitialized();
        // The embedded Hyper closes the monitoring database of a deleted connection right after the deletion,
        // until then its file is in use
        for (let attempt = 1; ; ++attempt) {
            try {
                const connections = await root.getDirectoryHandle(STORAGE_CONNECTIONS_FOLDER, { create: false });
                await connections.removeEntry(connectionId, { recursive: true });
                return;
            } catch (error) {
                const name = (error as any).name;
                if (name === 'NotFoundError') return;
                const inUse = name === 'NoModificationAllowedError' || name === 'InvalidModificationError';
                if (!inUse || attempt >= DELETE_IN_USE_ATTEMPTS) throw error;
                await sleep(DELETE_IN_USE_RETRY_MS);
            }
        }
    }

    private async readManifest(root: FileSystemDirectoryHandle): Promise<StorageManifest> {
        try {
            const indexFile = await root.getFileHandle(STORAGE_MANIFEST_FILE, { create: false });
            const file = await indexFile.getFile();
            const text = await file.text();
            const manifest: unknown = JSON.parse(text);
            if (manifest == null || typeof manifest !== 'object' || Array.isArray(manifest)) {
                throw new Error('Invalid manifest format: not a JSON object');
            }
            return manifest as StorageManifest;
        } catch (error) {
            if ((error as any).name === 'NotFoundError') {
                return {};
            }
            throw error;
        }
    }

    /// Write the manifest. The storage is migrated at app start, the migration stamps the storage version and a write
    /// keeps the version of the manifest it read.
    private async writeManifest(root: FileSystemDirectoryHandle, manifest: StorageManifest): Promise<void> {
        const indexFile = await root.getFileHandle(STORAGE_MANIFEST_FILE, { create: true });
        const writable = await indexFile.createWritable();
        await writable.write(JSON.stringify(manifest, null, 2));
        await writable.close();
    }

    /// Load the workbook tree. A workbook that the tree registers twice is listed where it comes first.
    async loadWorkbookTree(): Promise<WorkbookTreeFolder> {
        return await this.withTreeLock(async () => dropDuplicateWorkbooks(await this.readTree()));
    }

    /// Insert or replace a workbook's registry entry (matched by UUID), without touching files.
    ///
    /// A registered workbook keeps its place in the tree, a new one is appended to the folder at
    /// `folderPath` (the root by default). We never re-sort.
    async upsertWorkbookEntry(entry: WorkbookEntry, folderPath: readonly string[] = []): Promise<void> {
        await this.mutateTree(tree => upsertWorkbookInTree(tree, entry, folderPath));
    }

    /// Remove a workbook's registry entry (matched by UUID), without touching files.
    async removeWorkbookEntry(workbookId: string): Promise<void> {
        await this.mutateTree(tree => removeWorkbookFromTree(tree, workbookId));
    }

    /// Move a workbook to a position in a folder, without touching files. The index counts the workbooks of
    /// the folder without the moved workbook. A workbook that isn't registered yet is placed as an OPFS
    /// workbook, its first write keeps the place.
    async moveWorkbook(workbookId: string, folderPath: string[], index: number): Promise<void> {
        await this.mutateTree(tree => {
            if (folderAt(tree, folderPath) == null) {
                throw new Error(`There is no folder ${folderPath.join('/')}`);
            }
            return moveWorkbookInTree(tree, workbookId, folderPath, index);
        });
    }

    /// Create a folder, its parent must exist
    async createFolder(path: string[]): Promise<void> {
        await this.withTreeLock(async () => {
            const tree = await this.readTree();
            const name = path[path.length - 1];
            const parent = folderAt(tree, path.slice(0, -1));
            if (name == null || parent == null) {
                throw new Error(`There is no folder ${path.slice(0, -1).join('/')}`);
            }
            const error = folderNameError(name, parent.folders.map(folder => folder.name));
            if (error != null) throw new Error(error);
            await this.writeFolderFile(path, []);
        });
    }

    /// Move a folder into another folder under a name, its workbooks and subfolders move with it.
    /// Renaming a folder moves it within its parent.
    async moveFolder(path: string[], parentPath: string[], name: string = path[path.length - 1] ?? ''): Promise<void> {
        await this.withTreeLock(async () => {
            const tree = await this.readTree();
            const parent = folderAt(tree, parentPath);
            if (path.length === 0 || folderAt(tree, path) == null) {
                throw new Error(`There is no folder ${path.join('/')}`);
            }
            if (parent == null) {
                throw new Error(`There is no folder ${parentPath.join('/')}`);
            }
            if (isFolderPathWithin(parentPath, path)) {
                throw new Error('A folder cannot move into itself');
            }
            const sameParent = sameFolderPath(parentPath, path.slice(0, -1));
            const oldName = path[path.length - 1];
            if (sameParent && name === oldName) return;
            const siblings = parent.folders.map(folder => folder.name)
                .filter(sibling => !(sameParent && sibling === oldName));
            const error = folderNameError(name, siblings);
            if (error != null) throw new Error(error);
            if (sameParent && name.toLowerCase() === oldName.toLowerCase()) {
                // A file system that ignores the case would copy the folder onto itself, the move takes a detour
                const detour = `${name}.${crypto.randomUUID()}`;
                await this.copyFolderUnlocked(path, parentPath, detour);
                await this.copyFolderUnlocked([...parentPath, detour], parentPath, name);
                return;
            }
            await this.copyFolderUnlocked(path, parentPath, name);
        });
    }

    /// Delete a folder. Its sessions and the workbooks of its subfolders move to the parent folder, no
    /// workbook is deleted.
    async deleteFolder(path: string[]): Promise<void> {
        await this.withTreeLock(async () => {
            const tree = dropDuplicateWorkbooks(await this.readTree());
            const folder = folderAt(tree, path);
            if (path.length === 0 || folder == null) {
                throw new Error(`There is no folder ${path.join('/')}`);
            }
            const parentPath = path.slice(0, -1);
            const parent = folderAt(tree, parentPath)!;
            // The parent registers the workbooks before the folder goes away, an interruption leaves duplicates
            const moved = flattenWorkbookTree(folder);
            if (moved.length > 0) {
                await this.writeFolderFile(parentPath, [...parent.workbooks, ...moved]);
            }
            const parentDir = await this.folderDir(parentPath, false);
            await parentDir.removeEntry(path[path.length - 1], { recursive: true });
        });
    }

    /// Read the workbook tree as it is stored, duplicates included
    private async readTree(): Promise<WorkbookTreeFolder> {
        const root = this.ensureInitialized();
        try {
            const dir = await root.getDirectoryHandle(STORAGE_WORKBOOK_TREE_FOLDER, { create: false });
            return await readWorkbookTreeDirectory(dir);
        } catch (error) {
            if ((error as DOMException).name === 'NotFoundError') return emptyWorkbookTree();
            throw error;
        }
    }

    /// Change the workbooks of the tree exclusively, only the folder files that change are written.
    /// The folders that gain workbooks are written first, an interruption duplicates a workbook instead of
    /// losing it, and the next change drops the duplicates.
    private async mutateTree(fn: (tree: WorkbookTreeFolder) => WorkbookTreeFolder): Promise<void> {
        await this.withTreeLock(async () => {
            const stored = await this.readTree();
            const next = fn(dropDuplicateWorkbooks(stored));
            const before = new Map(listFolders(stored).map(folder => [folderPathKey(folder.path), folder.workbooks]));
            const changed = listFolders(next).filter(folder => {
                const workbooks = before.get(folderPathKey(folder.path));
                return workbooks == null || JSON.stringify(workbooks) !== JSON.stringify(folder.workbooks);
            });
            changed.sort((left, right) => (right.workbooks.length - (before.get(folderPathKey(right.path))?.length ?? 0))
                - (left.workbooks.length - (before.get(folderPathKey(left.path))?.length ?? 0)));
            for (const folder of changed) {
                await this.writeFolderFile(folder.path, folder.workbooks);
            }
        });
    }

    /// The directory of a folder of the workbook tree
    private async folderDir(path: readonly string[], create: boolean): Promise<FileSystemDirectoryHandle> {
        let dir = await this.ensureInitialized().getDirectoryHandle(STORAGE_WORKBOOK_TREE_FOLDER, { create });
        for (const name of path) {
            dir = await dir.getDirectoryHandle(name, { create });
        }
        return dir;
    }

    /// Write the folder file of a folder, the folder is created when missing
    private async writeFolderFile(path: readonly string[], workbooks: WorkbookEntry[]): Promise<void> {
        const dir = await this.folderDir(path, true);
        const writable = await (await dir.getFileHandle(STORAGE_FOLDER_FILE, { create: true })).createWritable();
        await writable.write(JSON.stringify({ workbooks }, null, 2));
        await writable.close();
    }

    /// Copy a folder into a parent under a name, then remove the original. The copy comes first, an
    /// interruption leaves both folders and the workbooks are listed where they come first.
    /// The tree holds small folder files only, so a copy is cheap and works in every browser.
    private async copyFolderUnlocked(path: readonly string[], parentPath: readonly string[], name: string): Promise<void> {
        const source = await this.folderDir(path, false);
        const target = await (await this.folderDir(parentPath, true)).getDirectoryHandle(name, { create: true });
        await copyDirectory(source, target);
        const sourceParent = await this.folderDir(path.slice(0, -1), false);
        await sourceParent.removeEntry(path[path.length - 1], { recursive: true });
    }

    private async getWorkbookDir(
        relativePath: string,
        create: boolean
    ): Promise<FileSystemDirectoryHandle> {
        const root = this.ensureInitialized();
        const parts = relativePath.split('/');
        let currentDir = root;
        let accumulated = '';
        for (const part of parts) {
            if (part) {
                accumulated = accumulated ? `${accumulated}/${part}` : part;
                try {
                    currentDir = await currentDir.getDirectoryHandle(part, { create });
                } catch (error) {
                    if ((error as any).name === 'NotFoundError') {
                        throw new Error(`Directory not found: opfs://${accumulated}`);
                    }
                    throw error;
                }
            }
        }
        return currentDir;
    }
}

/// Copy the files and directories of a directory into another one
async function copyDirectory(source: FileSystemDirectoryHandle, target: FileSystemDirectoryHandle): Promise<void> {
    for await (const [name, handle] of source.entries()) {
        if (handle.kind === 'directory') {
            await copyDirectory(handle as FileSystemDirectoryHandle, await target.getDirectoryHandle(name, { create: true }));
            continue;
        }
        const file = await (handle as FileSystemFileHandle).getFile();
        const writable = await (await target.getFileHandle(name, { create: true })).createWritable();
        await writable.write(file);
        await writable.close();
    }
}
