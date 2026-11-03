import { type SessionRegistryBackend, type ConnectionEntry, STORAGE_CONNECTIONS_FOLDER, type SessionData, type ScriptData, type SessionEntry, type StorageManifest, type AppSettings, StorageBackendType, STORAGE_MANIFEST_FILE, STORAGE_SESSIONS_FOLDER, STORAGE_SESSION_FILE, STORAGE_SCRIPTS_FOLDER, STORAGE_SHELL_FOLDER } from './storage_backend.js';
import { STORAGE_VERSION } from './migration/versions.js';
import { type DataFile, type DataFileContent, STORAGE_ATTACHMENTS_FOLDER, isAttachmentFileName, validateDataFileName } from './storage_backend.js';
import { sleep } from '../utils/sleep.js';
import { getOPFSRoot } from '../platform/opfs_root.js';
import {
    INITIAL_SESSION_FOLDER,
    STORAGE_FOLDER_FILE,
    STORAGE_SESSION_TREE_FOLDER,
    type SessionTreeFolder,
    dropDuplicateSessions,
    emptySessionTree,
    flattenSessionTree,
    folderAt,
    folderNameError,
    folderPathKey,
    isFolderPathWithin,
    listFolders,
    moveSessionInTree,
    readSessionTreeDirectory,
    removeSessionFromTree,
    sameFolderPath,
    upsertSessionInTree,
} from './session_tree.js';

/// The name of the web lock that guards the manifest
export const OPFS_MANIFEST_LOCK = 'dashql-manifest';
/// The name of the web lock that guards the session tree
export const OPFS_SESSION_TREE_LOCK = 'dashql-session-tree';

/// The attempts to delete the files of a connection while one of them is in use, and the delay between them
const DELETE_IN_USE_ATTEMPTS = 20;
const DELETE_IN_USE_RETRY_MS = 100;

/// Origin Private File System storage backend.
///
/// This backend owns the session registry (the session tree `sessiontree/`), which lists *every*
/// session regardless of where its files physically live. Sessions stored in OPFS keep their files under
/// `sessions/<uuid>/…`; sessions relocated to a native directory keep only a registry entry here
/// (their files live on disk, managed by `NativeStorageBackend`).
///
/// Every per-session method is keyed by the bare session UUID.
export class OPFSStorageBackend implements SessionRegistryBackend {
    private rootHandle: FileSystemDirectoryHandle | null = null;
    /// The latest manifest mutation, every read-modify-write of the manifest chains onto it
    private manifestChain: Promise<void> = Promise.resolve();
    /// The latest change of the session tree, every change of the tree chains onto it
    private treeChain: Promise<void> = Promise.resolve();

    constructor(private readonly getRoot: () => Promise<FileSystemDirectoryHandle> = getOPFSRoot) {}

    getBackendType(): StorageBackendType {
        return StorageBackendType.OPFS;
    }

    async initialize(): Promise<void> {
        this.rootHandle = await this.getRoot();
        await this.createSessionTree();
    }

    /// A storage without a session tree starts with the folder My Sessions.
    /// The tree is only created once, a deleted folder stays deleted.
    private async createSessionTree(): Promise<void> {
        const root = this.ensureInitialized();
        await this.withTreeLock(async () => {
            try {
                await root.getDirectoryHandle(STORAGE_SESSION_TREE_FOLDER, { create: false });
            } catch (error) {
                if ((error as DOMException).name !== 'NotFoundError') throw error;
                await this.writeFolderFile([], []);
                await this.writeFolderFile(INITIAL_SESSION_FOLDER, []);
            }
        });
    }

    /// Run a manifest operation exclusively.
    ///
    /// Every write of the manifest is a read-modify-write, so concurrent writers (session registry
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

    /// Run an operation on the session tree exclusively, within this backend and across tabs.
    /// Changes of the session tree read and write several folder files, the lock keeps them consistent.
    private withTreeLock<T>(fn: () => Promise<T>): Promise<T> {
        const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
        const run = locks != null ? () => locks.request(OPFS_SESSION_TREE_LOCK, fn) : fn;
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

    /// The relative folder that holds a session's files, e.g. "sessions/<uuid>"
    private sessionRelPath(sessionId: string): string {
        return `${STORAGE_SESSIONS_FOLDER}/${sessionId}`;
    }

    /// Natural sort for strings with numeric components (e.g., "page-1" < "page-2" < "page-10")
    private naturalSort(a: string, b: string): number {
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    }

    /// The sessions of the session tree, in the order of the sidebar
    async listSessions(): Promise<SessionEntry[]> {
        return flattenSessionTree(await this.loadSessionTree());
    }

    async loadSession(sessionId: string): Promise<SessionData> {
        const sessionDir = await this.getSessionDir(this.sessionRelPath(sessionId), false);
        const metaFile = await sessionDir.getFileHandle(STORAGE_SESSION_FILE);
        const file = await metaFile.getFile();
        const text = await file.text();
        const data: SessionData = JSON.parse(text);

        // sessionId is required - will throw if missing
        if (!data.sessionId) {
            throw new Error(`Session ${sessionId} is missing required sessionId field. Please migrate the session or regenerate it.`);
        }

        return data;
    }

    async saveSessionManifest(sessionId: string, data: SessionData): Promise<void> {
        const sessionDir = await this.getSessionDir(this.sessionRelPath(sessionId), true);
        const metaFile = await sessionDir.getFileHandle(STORAGE_SESSION_FILE, { create: true });
        const writable = await metaFile.createWritable();
        await writable.write(JSON.stringify(data, null, 2));
        await writable.close();

        await this.upsertSessionEntry({ path: sessionId, storageType: StorageBackendType.OPFS });
    }



    async deleteSession(sessionId: string): Promise<void> {
        await this.deleteSessionFiles(sessionId);
        // Always try to update the manifest even if the session files weren't found
        // (in case the manifest still has a stale reference).
        await this.removeSessionEntry(sessionId);
    }

    /// Delete a session's files only, leaving the registry entry intact.
    async deleteSessionFiles(sessionId: string): Promise<void> {
        const relativePath = this.sessionRelPath(sessionId);
        const root = this.ensureInitialized();

        try {
            // Navigate to the parent directory, then remove the session entry
            const parts = relativePath.split('/').filter(p => p);
            if (parts.length > 0) {
                let parentDir: FileSystemDirectoryHandle = root;
                for (let i = 0; i < parts.length - 1; i++) {
                    parentDir = await parentDir.getDirectoryHandle(parts[i], { create: false });
                }
                await parentDir.removeEntry(parts[parts.length - 1], { recursive: true });
            }
        } catch (error) {
            // If sessions folder or session doesn't exist, that's fine - it's already deleted
            if ((error as any).name !== 'NotFoundError') {
                throw error;
            }
        }
    }

    async loadScripts(sessionId: string): Promise<ScriptData[]> {
        const sessionDir = await this.getSessionDir(this.sessionRelPath(sessionId), false).catch((error) => {
            if ((error as any).name === 'NotFoundError') return null;
            throw error;
        });
        if (!sessionDir) {
            return [];
        }
        let scriptsDir: FileSystemDirectoryHandle;
        try {
            scriptsDir = await sessionDir.getDirectoryHandle(STORAGE_SCRIPTS_FOLDER, { create: false });
        } catch (error) {
            if ((error as any).name === 'NotFoundError') {
                return [];
            }
            throw error;
        }
        const scripts: ScriptData[] = [];

        for await (const [name, handle] of scriptsDir.entries()) {
            if (handle.kind === 'directory') {
                throw new Error(`Invalid V2 session layout: nested scripts directory ${name}`);
            }
            if (name.toLowerCase() === 'dashql-draft.sql') {
                throw new Error('Invalid V2 session layout: dashql-draft.sql is not supported');
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


    async loadScript(sessionId: string, scriptName: string): Promise<ScriptData> {
        const sessionDir = await this.getSessionDir(this.sessionRelPath(sessionId), false);
        const scriptsDir = await sessionDir.getDirectoryHandle(STORAGE_SCRIPTS_FOLDER, { create: false });

        try {
            const fileHandle = await scriptsDir.getFileHandle(scriptName);
            const file = await fileHandle.getFile();
            const sql = await file.text();
            return { name: scriptName, sql };
        } catch {
            throw new Error(`Script not found: session ${sessionId}, script ${scriptName}`);
        }
    }

    async saveScript(
        sessionId: string,
        scriptName: string,
        sql: string
    ): Promise<void> {
        const sessionDir = await this.getSessionDir(this.sessionRelPath(sessionId), true);
        const scriptsDir = await sessionDir.getDirectoryHandle(STORAGE_SCRIPTS_FOLDER, { create: true });
        const fileHandle = await scriptsDir.getFileHandle(scriptName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(sql);
        await writable.close();
    }

    async deleteScript(sessionId: string, scriptName: string): Promise<void> {
        const sessionDir = await this.getSessionDir(this.sessionRelPath(sessionId), false);
        const scriptsDir = await sessionDir.getDirectoryHandle(STORAGE_SCRIPTS_FOLDER, { create: false });
        await scriptsDir.removeEntry(scriptName);
    }

    async renameScript(sessionId: string, oldScriptName: string, newScriptName: string): Promise<void> {
        if (oldScriptName === newScriptName) {
            return;
        }
        // Navigate without creating anything: if the session, page, or source file isn't flushed yet,
        // the pending write under the new name creates them, so there is nothing to move. The
        // scripts/folder/file handles surface a raw OPFS NotFoundError, but getSessionDir re-wraps that
        // into a generic "Directory not found" Error, so the no-op guard has to recognise both forms.
        let scriptsDir: FileSystemDirectoryHandle;
        try {
            const sessionDir = await this.getSessionDir(this.sessionRelPath(sessionId), false);
            scriptsDir = await sessionDir.getDirectoryHandle(STORAGE_SCRIPTS_FOLDER, { create: false });
            await scriptsDir.getFileHandle(oldScriptName, { create: false });
        } catch (error) {
            if ((error as any).name === 'NotFoundError' || ((error as any).message ?? '').startsWith('Directory not found')) {
                return;
            }
            throw error;
        }
        await this.moveFile(scriptsDir, oldScriptName, scriptsDir, newScriptName);
    }

    private async dataDir(sessionId: string, create: boolean): Promise<FileSystemDirectoryHandle | null> {
        const root = this.ensureInitialized();
        try {
            const sessions = await root.getDirectoryHandle(STORAGE_SESSIONS_FOLDER, { create });
            const session = await sessions.getDirectoryHandle(sessionId, { create });
            return await session.getDirectoryHandle(STORAGE_ATTACHMENTS_FOLDER, { create });
        } catch (error) {
            if (!create && (error as Error).name === 'NotFoundError') return null;
            throw error;
        }
    }

    async listDataFiles(sessionId: string): Promise<DataFile[]> {
        const dir = await this.dataDir(sessionId, false);
        if (!dir) return [];
        const files: DataFile[] = [];
        for await (const [name, handle] of dir.entries()) {
            if (handle.kind === 'directory') throw new Error(`Invalid session layout: nested data directory ${name}`);
            // Other files in the folder are no attachments
            if (!isAttachmentFileName(name)) continue;
            validateDataFileName(name);
            const file = await (handle as FileSystemFileHandle).getFile();
            files.push({ name, sizeBytes: file.size, mtimeMs: file.lastModified });
        }
        return files.sort((a, b) => this.naturalSort(a.name, b.name));
    }

    async loadDataFile(sessionId: string, name: string): Promise<Uint8Array> {
        validateDataFileName(name);
        const dir = await this.dataDir(sessionId, false);
        if (!dir) throw new Error(`Data file not found: ${name}`);
        const handle = await dir.getFileHandle(name, { create: false });
        return new Uint8Array(await (await handle.getFile()).arrayBuffer());
    }

    async saveDataFile(sessionId: string, name: string, content: DataFileContent): Promise<void> {
        validateDataFileName(name);
        const dir = (await this.dataDir(sessionId, true))!;
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

    async deleteDataFile(sessionId: string, name: string): Promise<void> {
        validateDataFileName(name);
        const dir = await this.dataDir(sessionId, false);
        if (!dir) return;
        try {
            await dir.removeEntry(name);
        } catch (error) {
            if ((error as Error).name === 'NotFoundError') return;
            throw error;
        }
    }

    async renameDataFile(sessionId: string, oldName: string, newName: string): Promise<void> {
        validateDataFileName(oldName);
        validateDataFileName(newName);
        if (oldName === newName) return;
        const dir = await this.dataDir(sessionId, false);
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

        // Step 1: Remove the session tree FIRST.
        // This ensures the app won't try to restore sessions even if the other cleanup fails.
        try {
            await this.withTreeLock(() => root.removeEntry(STORAGE_SESSION_TREE_FOLDER, { recursive: true }));
        } catch (error) {
            if ((error as DOMException).name !== 'NotFoundError') {
                console.warn('Failed to clear the session tree:', error);
            }
        }
        try {
            await this.withManifestLock(() => this.writeManifest(root, {}));
        } catch (error) {
            console.warn('Failed to clear manifest:', error);
        }

        // Step 2: Delete app-owned data folders while leaving unrelated origin storage untouched.
        for (const folder of [STORAGE_SESSIONS_FOLDER, STORAGE_CONNECTIONS_FOLDER, STORAGE_SHELL_FOLDER]) {
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
            const dir = await this.getSessionDir(this.connectionRelPath(connectionId), false);
            const handle = await dir.getFileHandle(fileName, { create: false });
            return await (await handle.getFile()).text();
        } catch {
            return null;
        }
    }

    async saveConnectionFile(connectionId: string, fileName: string, text: string): Promise<void> {
        const dir = await this.getSessionDir(this.connectionRelPath(connectionId), true);
        const handle = await dir.getFileHandle(fileName, { create: true });
        const writable = await handle.createWritable();
        await writable.write(text);
        await writable.close();
    }

    async createConnectionFolder(connectionId: string): Promise<void> {
        await this.getSessionDir(this.connectionRelPath(connectionId), true);
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

    /// Write the manifest. The storage is migrated at app start, the manifest is at the current version.
    private async writeManifest(root: FileSystemDirectoryHandle, manifest: StorageManifest): Promise<void> {
        const indexFile = await root.getFileHandle(STORAGE_MANIFEST_FILE, { create: true });
        const writable = await indexFile.createWritable();
        await writable.write(JSON.stringify({ ...manifest, storageVersion: STORAGE_VERSION }, null, 2));
        await writable.close();
    }

    /// Load the session tree. A session that the tree registers twice is listed where it comes first.
    async loadSessionTree(): Promise<SessionTreeFolder> {
        return await this.withTreeLock(async () => dropDuplicateSessions(await this.readTree()));
    }

    /// Insert or replace a session's registry entry (matched by UUID), without touching files.
    ///
    /// A registered session keeps its place in the tree, a new one is appended to the folder at
    /// `folderPath` (the root by default). We never re-sort.
    async upsertSessionEntry(entry: SessionEntry, folderPath: readonly string[] = []): Promise<void> {
        await this.mutateTree(tree => upsertSessionInTree(tree, entry, folderPath));
    }

    /// Remove a session's registry entry (matched by UUID), without touching files.
    async removeSessionEntry(sessionId: string): Promise<void> {
        await this.mutateTree(tree => removeSessionFromTree(tree, sessionId));
    }

    /// Move a session to a position in a folder, without touching files. The index counts the sessions of
    /// the folder without the moved session. A session that isn't registered yet is placed as an OPFS
    /// session, its first write keeps the place.
    async moveSession(sessionId: string, folderPath: string[], index: number): Promise<void> {
        await this.mutateTree(tree => {
            if (folderAt(tree, folderPath) == null) {
                throw new Error(`There is no folder ${folderPath.join('/')}`);
            }
            return moveSessionInTree(tree, sessionId, folderPath, index);
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

    /// Move a folder into another folder under a name, its sessions and subfolders move with it.
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

    /// Delete a folder. Its sessions and the sessions of its subfolders move to the parent folder, no
    /// session is deleted.
    async deleteFolder(path: string[]): Promise<void> {
        await this.withTreeLock(async () => {
            const tree = dropDuplicateSessions(await this.readTree());
            const folder = folderAt(tree, path);
            if (path.length === 0 || folder == null) {
                throw new Error(`There is no folder ${path.join('/')}`);
            }
            const parentPath = path.slice(0, -1);
            const parent = folderAt(tree, parentPath)!;
            // The parent registers the sessions before the folder goes away, an interruption leaves duplicates
            const moved = flattenSessionTree(folder);
            if (moved.length > 0) {
                await this.writeFolderFile(parentPath, [...parent.sessions, ...moved]);
            }
            const parentDir = await this.folderDir(parentPath, false);
            await parentDir.removeEntry(path[path.length - 1], { recursive: true });
        });
    }

    /// Read the session tree as it is stored, duplicates included
    private async readTree(): Promise<SessionTreeFolder> {
        const root = this.ensureInitialized();
        try {
            const dir = await root.getDirectoryHandle(STORAGE_SESSION_TREE_FOLDER, { create: false });
            return await readSessionTreeDirectory(dir);
        } catch (error) {
            if ((error as DOMException).name === 'NotFoundError') return emptySessionTree();
            throw error;
        }
    }

    /// Change the sessions of the tree exclusively, only the folder files that change are written.
    /// The folders that gain sessions are written first, an interruption duplicates a session instead of
    /// losing it, and the next change drops the duplicates.
    private async mutateTree(fn: (tree: SessionTreeFolder) => SessionTreeFolder): Promise<void> {
        await this.withTreeLock(async () => {
            const stored = await this.readTree();
            const next = fn(dropDuplicateSessions(stored));
            const before = new Map(listFolders(stored).map(folder => [folderPathKey(folder.path), folder.sessions]));
            const changed = listFolders(next).filter(folder => {
                const sessions = before.get(folderPathKey(folder.path));
                return sessions == null || JSON.stringify(sessions) !== JSON.stringify(folder.sessions);
            });
            changed.sort((left, right) => (right.sessions.length - (before.get(folderPathKey(right.path))?.length ?? 0))
                - (left.sessions.length - (before.get(folderPathKey(left.path))?.length ?? 0)));
            for (const folder of changed) {
                await this.writeFolderFile(folder.path, folder.sessions);
            }
        });
    }

    /// The directory of a folder of the session tree
    private async folderDir(path: readonly string[], create: boolean): Promise<FileSystemDirectoryHandle> {
        let dir = await this.ensureInitialized().getDirectoryHandle(STORAGE_SESSION_TREE_FOLDER, { create });
        for (const name of path) {
            dir = await dir.getDirectoryHandle(name, { create });
        }
        return dir;
    }

    /// Write the folder file of a folder, the folder is created when missing
    private async writeFolderFile(path: readonly string[], sessions: SessionEntry[]): Promise<void> {
        const dir = await this.folderDir(path, true);
        const writable = await (await dir.getFileHandle(STORAGE_FOLDER_FILE, { create: true })).createWritable();
        await writable.write(JSON.stringify({ sessions }, null, 2));
        await writable.close();
    }

    /// Copy a folder into a parent under a name, then remove the original. The copy comes first, an
    /// interruption leaves both folders and the sessions are listed where they come first.
    /// The tree holds small folder files only, so a copy is cheap and works in every browser.
    private async copyFolderUnlocked(path: readonly string[], parentPath: readonly string[], name: string): Promise<void> {
        const source = await this.folderDir(path, false);
        const target = await (await this.folderDir(parentPath, true)).getDirectoryHandle(name, { create: true });
        await copyDirectory(source, target);
        const sourceParent = await this.folderDir(path.slice(0, -1), false);
        await sourceParent.removeEntry(path[path.length - 1], { recursive: true });
    }

    private async getSessionDir(
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
