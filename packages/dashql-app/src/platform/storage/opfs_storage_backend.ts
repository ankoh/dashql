import { type SessionRegistryBackend, type SessionData, type PageData, type ScriptData, type SessionEntry, type StorageManifest, type AppSettings, type CachedQueryResult, StorageBackendType, STORAGE_MANIFEST_FILE, STORAGE_SESSIONS_FOLDER, STORAGE_SESSION_FILE, STORAGE_NOTEBOOK_FOLDER, STORAGE_SCRIPT_DRAFT, STORAGE_SCRIPT_SCHEMA, STORAGE_SCRIPT_FUNCTIONS, STORAGE_CACHE_FOLDER, STORAGE_CACHE_EXTENSION } from './storage_backend.js';
import { type CacheFileStat, type QueryResultCacheStore, evictToFit } from './query_result_cache_eviction.js';

/// Origin Private File System storage backend.
///
/// This backend owns the session registry (the root manifest), which lists *every* session
/// regardless of where its files physically live. Sessions stored in OPFS keep their files under
/// `sessions/<uuid>/…`; sessions relocated to a native directory keep only a registry entry here
/// (their files live on disk, managed by `NativeStorageBackend`).
///
/// Every per-session method is keyed by the bare session UUID.
export class OPFSStorageBackend implements SessionRegistryBackend {
    private rootHandle: FileSystemDirectoryHandle | null = null;

    getBackendType(): StorageBackendType {
        return StorageBackendType.OPFS;
    }

    async initialize(): Promise<void> {
        this.rootHandle = await navigator.storage.getDirectory();
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

    async listSessions(manifestPath: string): Promise<SessionEntry[]> {
        const root = this.ensureInitialized();
        try {
            const indexFile = await root.getFileHandle(manifestPath, { create: false });
            const file = await indexFile.getFile();
            const text = await file.text();
            const manifest: StorageManifest = JSON.parse(text);

            if (!manifest.sessions || !Array.isArray(manifest.sessions)) {
                throw new Error('Invalid manifest format: sessions must be an array');
            }

            // Validate entries
            for (const entry of manifest.sessions) {
                if (!entry.path) {
                    throw new Error('Invalid manifest format: each session must have path');
                }
            }

            return manifest.sessions;
        } catch (error) {
            // If file doesn't exist, return empty array
            if ((error as any).name === 'NotFoundError') {
                return [];
            }
            // Re-throw other errors (including validation errors)
            throw error;
        }
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

    async loadSessionSchema(sessionId: string): Promise<string | null> {
        try {
            const sessionDir = await this.getSessionDir(this.sessionRelPath(sessionId), false);
            const schemaFile = await sessionDir.getFileHandle(STORAGE_SCRIPT_SCHEMA, { create: false });
            const file = await schemaFile.getFile();
            return await file.text();
        } catch {
            return null;
        }
    }

    async saveSessionSchema(sessionId: string, sql: string): Promise<void> {
        const sessionDir = await this.getSessionDir(this.sessionRelPath(sessionId), true);
        const schemaFile = await sessionDir.getFileHandle(STORAGE_SCRIPT_SCHEMA, { create: true });
        const writable = await schemaFile.createWritable();
        await writable.write(sql);
        await writable.close();
    }

    async loadSessionFunctions(sessionId: string): Promise<string | null> {
        try {
            const sessionDir = await this.getSessionDir(this.sessionRelPath(sessionId), false);
            const functionsFile = await sessionDir.getFileHandle(STORAGE_SCRIPT_FUNCTIONS, { create: false });
            const file = await functionsFile.getFile();
            return await file.text();
        } catch {
            return null;
        }
    }

    async saveSessionFunctions(sessionId: string, sql: string): Promise<void> {
        const sessionDir = await this.getSessionDir(this.sessionRelPath(sessionId), true);
        const functionsFile = await sessionDir.getFileHandle(STORAGE_SCRIPT_FUNCTIONS, { create: true });
        const writable = await functionsFile.createWritable();
        await writable.write(sql);
        await writable.close();
    }

    async loadNotebookPages(sessionId: string): Promise<PageData[]> {
        const sessionDir = await this.getSessionDir(this.sessionRelPath(sessionId), false).catch((error) => {
            if ((error as any).name === 'NotFoundError') return null;
            throw error;
        });
        if (!sessionDir) {
            return [];
        }
        let notebookDir: FileSystemDirectoryHandle;
        try {
            notebookDir = await sessionDir.getDirectoryHandle(STORAGE_NOTEBOOK_FOLDER, { create: false });
        } catch (error) {
            if ((error as any).name === 'NotFoundError') {
                return [];
            }
            throw error;
        }
        const pages: PageData[] = [];

        for await (const [name, handle] of notebookDir.entries()) {
            if (handle.kind === 'directory') {
                const scripts = await this.loadScriptsInPage(handle as FileSystemDirectoryHandle);
                pages.push({ name, scripts });
            }
        }
        pages.sort((a, b) => this.naturalSort(a.name, b.name));
        return pages;
    }

    private async loadScriptsInPage(pageDir: FileSystemDirectoryHandle): Promise<ScriptData[]> {
        const scripts: ScriptData[] = [];

        for await (const [name, handle] of pageDir.entries()) {
            if (handle.kind === 'file' && name.endsWith('.sql') && name !== STORAGE_SCRIPT_DRAFT) {
                const file = await (handle as FileSystemFileHandle).getFile();
                const sql = await file.text();
                scripts.push({ name, sql });
            }
        }
        scripts.sort((a, b) => this.naturalSort(a.name, b.name));
        return scripts;
    }

    async createNotebookPage(sessionId: string, pageName: string): Promise<void> {
        const sessionDir = await this.getSessionDir(this.sessionRelPath(sessionId), true);
        const notebookDir = await sessionDir.getDirectoryHandle(STORAGE_NOTEBOOK_FOLDER, { create: true });
        await notebookDir.getDirectoryHandle(pageName, { create: true });
    }

    async deleteNotebookPage(sessionId: string, pageName: string): Promise<void> {
        const sessionDir = await this.getSessionDir(this.sessionRelPath(sessionId), false);
        const notebookDir = await sessionDir.getDirectoryHandle(STORAGE_NOTEBOOK_FOLDER);
        await notebookDir.removeEntry(pageName, { recursive: true });
    }

    async renameNotebookPage(sessionId: string, oldPageName: string, newPageName: string): Promise<void> {
        if (oldPageName === newPageName) {
            return;
        }
        const sessionDir = await this.getSessionDir(this.sessionRelPath(sessionId), true);
        const notebookDir = await sessionDir.getDirectoryHandle(STORAGE_NOTEBOOK_FOLDER, { create: true });

        // The source folder may not exist yet (the page was created and renamed before its first
        // flush); there is then nothing on disk to move, so leave it for the pending write.
        let oldDir: FileSystemDirectoryHandle;
        try {
            oldDir = await notebookDir.getDirectoryHandle(oldPageName, { create: false });
        } catch (error) {
            if ((error as any).name === 'NotFoundError') {
                return;
            }
            throw error;
        }

        // OPFS has no atomic directory rename, so create the target folder and move every file into
        // it. Collect names up front: moving (or copy+delete) mutates the source dir, and mutating it
        // mid-iteration is unsafe. Pages only ever contain files (scripts), so nested dirs are ignored.
        const newDir = await notebookDir.getDirectoryHandle(newPageName, { create: true });
        const fileNames: string[] = [];
        for await (const [name, handle] of oldDir.entries()) {
            if (handle.kind === 'file') {
                fileNames.push(name);
            }
        }
        for (const name of fileNames) {
            await this.moveFile(oldDir, name, newDir, name);
        }
        await notebookDir.removeEntry(oldPageName, { recursive: true });
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


    async loadNotebookScript(sessionId: string, pageName: string, scriptName: string): Promise<ScriptData> {
        const pageDir = await this.getPageDir(this.sessionRelPath(sessionId), pageName, false);

        try {
            const fileHandle = await pageDir.getFileHandle(scriptName);
            const file = await fileHandle.getFile();
            const sql = await file.text();
            return { name: scriptName, sql };
        } catch {
            throw new Error(`Script not found: session ${sessionId}, page ${pageName}, script ${scriptName}`);
        }
    }

    async saveNotebookScript(
        sessionId: string,
        pageName: string,
        scriptName: string,
        sql: string
    ): Promise<void> {
        const pageDir = await this.getPageDir(this.sessionRelPath(sessionId), pageName, true);
        const fileHandle = await pageDir.getFileHandle(scriptName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(sql);
        await writable.close();
    }

    async deleteNotebookScript(sessionId: string, pageName: string, scriptName: string): Promise<void> {
        const pageDir = await this.getPageDir(this.sessionRelPath(sessionId), pageName, false);
        await pageDir.removeEntry(scriptName);
    }

    async renameNotebookScript(sessionId: string, pageName: string, oldScriptName: string, newScriptName: string): Promise<void> {
        if (oldScriptName === newScriptName) {
            return;
        }
        // Navigate without creating anything: if the page or the source file isn't flushed yet, the
        // pending write under the new name creates both, so there is nothing to move. Walk by hand
        // (rather than via getPageDir, which re-wraps NotFoundError into a generic Error) so a missing
        // page/file surfaces as a clean NotFoundError we can no-op on.
        let pageDir: FileSystemDirectoryHandle;
        try {
            const sessionDir = await this.getSessionDir(this.sessionRelPath(sessionId), false);
            const notebookDir = await sessionDir.getDirectoryHandle(STORAGE_NOTEBOOK_FOLDER, { create: false });
            pageDir = await notebookDir.getDirectoryHandle(pageName, { create: false });
            await pageDir.getFileHandle(oldScriptName, { create: false });
        } catch (error) {
            if ((error as any).name === 'NotFoundError') {
                return;
            }
            throw error;
        }
        await this.moveFile(pageDir, oldScriptName, pageDir, newScriptName);
    }

    async loadNotebookScriptDraft(sessionId: string): Promise<string | null> {
        try {
            const sessionDir = await this.getSessionDir(this.sessionRelPath(sessionId), false);
            const notebookDir = await sessionDir.getDirectoryHandle(STORAGE_NOTEBOOK_FOLDER, { create: false });
            const draftFile = await notebookDir.getFileHandle(STORAGE_SCRIPT_DRAFT, { create: false });
            const file = await draftFile.getFile();
            return await file.text();
        } catch {
            return null;
        }
    }

    async saveNotebookScriptDraft(sessionId: string, sql: string): Promise<void> {
        const sessionDir = await this.getSessionDir(this.sessionRelPath(sessionId), true);
        const notebookDir = await sessionDir.getDirectoryHandle(STORAGE_NOTEBOOK_FOLDER, { create: true });
        const draftFile = await notebookDir.getFileHandle(STORAGE_SCRIPT_DRAFT, { create: true });
        const writable = await draftFile.createWritable();
        await writable.write(sql);
        await writable.close();
    }

    /// The relative folder that holds a session's cached query results, e.g. "sessions/<uuid>/cache"
    private cacheRelPath(sessionId: string): string {
        return `${this.sessionRelPath(sessionId)}/${STORAGE_CACHE_FOLDER}`;
    }

    async loadQueryResultCache(sessionId: string, hash: string): Promise<CachedQueryResult | null> {
        try {
            const cacheDir = await this.getSessionDir(this.cacheRelPath(sessionId), false);
            const fileHandle = await cacheDir.getFileHandle(`${hash}${STORAGE_CACHE_EXTENSION}`, { create: false });
            const file = await fileHandle.getFile();
            return {
                bytes: new Uint8Array(await file.arrayBuffer()),
                cachedAtMs: file.lastModified,
            };
        } catch {
            // Missing cache folder or entry — a plain miss.
            return null;
        }
    }

    async saveQueryResultCache(sessionId: string, hash: string, bytes: Uint8Array): Promise<void> {
        const cacheDir = await this.getSessionDir(this.cacheRelPath(sessionId), true);

        // Evict least-recently-used entries first so the new file fits under the thresholds.
        const store: QueryResultCacheStore = {
            listCacheFiles: async (): Promise<CacheFileStat[]> => {
                const stats: CacheFileStat[] = [];
                for await (const [name, handle] of cacheDir.entries()) {
                    if (handle.kind === 'file' && name.endsWith(STORAGE_CACHE_EXTENSION)) {
                        const file = await (handle as FileSystemFileHandle).getFile();
                        stats.push({ name, size: file.size, mtimeMs: file.lastModified });
                    }
                }
                return stats;
            },
            deleteCacheFile: async (_sessionId: string, name: string): Promise<void> => {
                try {
                    await cacheDir.removeEntry(name);
                } catch (error) {
                    if ((error as any).name !== 'NotFoundError') {
                        throw error;
                    }
                }
            },
        };
        await evictToFit(store, sessionId, bytes.byteLength);

        const fileHandle = await cacheDir.getFileHandle(`${hash}${STORAGE_CACHE_EXTENSION}`, { create: true });
        const writable = await fileHandle.createWritable();
        // Copy into a plain ArrayBuffer to write binary bytes (a Uint8Array's backing buffer may be
        // typed as SharedArrayBuffer, which the write chunk type rejects).
        const buffer = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(buffer).set(bytes);
        await writable.write(buffer);
        await writable.close();
    }

    async deleteQueryResultCache(sessionId: string, hash: string): Promise<void> {
        try {
            const cacheDir = await this.getSessionDir(this.cacheRelPath(sessionId), false);
            await cacheDir.removeEntry(`${hash}${STORAGE_CACHE_EXTENSION}`);
        } catch (error) {
            // Missing cache folder or entry — nothing to delete.
            if ((error as any).name !== 'NotFoundError' && !((error as any).message ?? '').startsWith('Directory not found')) {
                throw error;
            }
        }
    }

    async clearAllStorage(): Promise<void> {
        const root = this.ensureInitialized();

        // Step 1: Clear the manifest (reset sessions to empty array) FIRST.
        // This ensures the app won't try to restore sessions even if directory cleanup fails.
        try {
            const emptyManifest: StorageManifest = { sessions: [] };
            const manifestFile = await root.getFileHandle(STORAGE_MANIFEST_FILE, { create: true });
            const writable = await manifestFile.createWritable();
            await writable.write(JSON.stringify(emptyManifest, null, 2));
            await writable.close();
        } catch (error) {
            console.warn('Failed to clear manifest:', error);
        }

        // Step 2: Delete the entire sessions folder
        try {
            await root.removeEntry(STORAGE_SESSIONS_FOLDER, { recursive: true });
        } catch (error) {
            console.warn('Failed to delete sessions folder:', error);
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
        const root = this.ensureInitialized();
        const manifest = await this.readManifest(root);
        manifest.appSettings = settings;
        await this.writeManifest(root, manifest);
    }

    private async readManifest(root: FileSystemDirectoryHandle): Promise<StorageManifest> {
        try {
            const indexFile = await root.getFileHandle(STORAGE_MANIFEST_FILE, { create: false });
            const file = await indexFile.getFile();
            const text = await file.text();
            const manifest: StorageManifest = JSON.parse(text);
            if (!manifest.sessions || !Array.isArray(manifest.sessions)) {
                throw new Error('Invalid manifest format: sessions must be an array');
            }
            return manifest;
        } catch (error) {
            if ((error as any).name === 'NotFoundError') {
                return { sessions: [] };
            }
            throw error;
        }
    }

    private async writeManifest(root: FileSystemDirectoryHandle, manifest: StorageManifest): Promise<void> {
        const indexFile = await root.getFileHandle(STORAGE_MANIFEST_FILE, { create: true });
        const writable = await indexFile.createWritable();
        await writable.write(JSON.stringify(manifest, null, 2));
        await writable.close();
    }

    /// Insert or replace a session's registry entry (matched by UUID), without touching files.
    ///
    /// The array order is the user-facing session order (surfaced in the selector, reorderable by
    /// drag-and-drop via `reorderSessions`), so we deliberately preserve it: a new session appends to
    /// the end and an existing one is updated in place. We never re-sort.
    async upsertSessionEntry(entry: SessionEntry): Promise<void> {
        const root = this.ensureInitialized();
        const manifest = await this.readManifest(root);

        const existingIndex = manifest.sessions.findIndex(s => s.path === entry.path);
        if (existingIndex < 0) {
            manifest.sessions.push(entry);
        } else {
            manifest.sessions[existingIndex] = entry;
        }

        await this.writeManifest(root, manifest);
    }

    /// Remove a session's registry entry (matched by UUID), without touching files.
    async removeSessionEntry(sessionId: string): Promise<void> {
        const root = this.ensureInitialized();
        const manifest = await this.readManifest(root);
        manifest.sessions = manifest.sessions.filter(s => s.path !== sessionId);
        await this.writeManifest(root, manifest);
    }

    /// Reorder the registry entries to match `orderedIds` (a permutation of the existing session
    /// UUIDs), without touching files. Entries are re-emitted in the given order; any UUID not present
    /// in the manifest is ignored, and any manifest entry missing from `orderedIds` is appended at the
    /// end in its current relative order (so a stale/racing id list can never drop a session).
    async reorderSessions(orderedIds: string[]): Promise<void> {
        const root = this.ensureInitialized();
        const manifest = await this.readManifest(root);

        const byId = new Map(manifest.sessions.map(s => [s.path, s]));
        const reordered: SessionEntry[] = [];
        const taken = new Set<string>();
        for (const id of orderedIds) {
            const entry = byId.get(id);
            if (entry && !taken.has(id)) {
                reordered.push(entry);
                taken.add(id);
            }
        }
        // Preserve any entries the caller didn't mention, keeping their existing relative order.
        for (const entry of manifest.sessions) {
            if (!taken.has(entry.path)) {
                reordered.push(entry);
            }
        }

        manifest.sessions = reordered;
        await this.writeManifest(root, manifest);
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

    private async getPageDir(
        sessionPath: string,
        pageName: string,
        create: boolean
    ): Promise<FileSystemDirectoryHandle> {
        const sessionDir = await this.getSessionDir(sessionPath, create);
        try {
            const notebookDir = await sessionDir.getDirectoryHandle(STORAGE_NOTEBOOK_FOLDER, { create });
            return await notebookDir.getDirectoryHandle(pageName, { create });
        } catch (error) {
            if ((error as any).name === 'NotFoundError') {
                throw new Error(`Directory not found: opfs://${sessionPath}/${STORAGE_NOTEBOOK_FOLDER}/${pageName}`);
            }
            throw error;
        }
    }
}
