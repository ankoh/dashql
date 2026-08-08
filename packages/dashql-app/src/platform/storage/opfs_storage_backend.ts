import { type NotebookRegistryBackend, type NotebookData, type ScriptFolderData, type ScriptData, type NotebookEntry, type StorageManifest, type AppSettings, type CachedQueryResult, StorageBackendType, STORAGE_MANIFEST_FILE, STORAGE_NOTEBOOKS_FOLDER, STORAGE_NOTEBOOK_FILE, STORAGE_SCRIPTS_FOLDER, STORAGE_SCRIPT_DRAFT, STORAGE_SCRIPT_SCHEMA, STORAGE_SCRIPT_FUNCTIONS, STORAGE_CACHE_FOLDER, STORAGE_CACHE_EXTENSION, STORAGE_CACHE_ACCESS_SUFFIX } from './storage_backend.js';
import { type CacheFileStat, type QueryResultCacheStore, evictToFit } from './query_result_cache_eviction.js';

/// Origin Private File System storage backend.
///
/// This backend owns the notebook registry (the root manifest), which lists *every* notebook
/// regardless of where its files physically live. Notebooks stored in OPFS keep their files under
/// `notebooks/<uuid>/…`; notebooks relocated to a native directory keep only a registry entry here
/// (their files live on disk, managed by `NativeStorageBackend`).
///
/// Every per-notebook method is keyed by the bare notebook UUID.
export class OPFSStorageBackend implements NotebookRegistryBackend {
    private rootHandle: FileSystemDirectoryHandle | null = null;

    getBackendType(): StorageBackendType {
        return StorageBackendType.OPFS;
    }

    async initialize(): Promise<void> {
        this.rootHandle = await navigator.storage.getDirectory();
        await this.resetObsoleteManifest(this.rootHandle);
    }

    /// The Session -> Notebook rename intentionally has no data migration. Since both versions use
    /// the same root manifest filename, replace the obsolete registry shape with an empty notebook
    /// registry so an existing installation can start cleanly. Keep app settings, but do not import
    /// or delete any old session data.
    private async resetObsoleteManifest(root: FileSystemDirectoryHandle): Promise<void> {
        try {
            const indexFile = await root.getFileHandle(STORAGE_MANIFEST_FILE, { create: false });
            const file = await indexFile.getFile();
            const manifest = JSON.parse(await file.text());
            if (!Array.isArray(manifest?.notebooks) && Array.isArray(manifest?.sessions)) {
                const reset: StorageManifest = { notebooks: [] };
                if (manifest.appSettings != null) {
                    reset.appSettings = manifest.appSettings;
                }
                await this.writeManifest(root, reset);
            }
        } catch (error) {
            if ((error as any).name !== 'NotFoundError') {
                throw error;
            }
        }
    }

    private ensureInitialized(): FileSystemDirectoryHandle {
        if (!this.rootHandle) {
            throw new Error('OPFSStorageBackend not initialized. Call initialize() first.');
        }
        return this.rootHandle;
    }

    /// The relative folder that holds a notebook's files, e.g. "notebooks/<uuid>"
    private notebookRelPath(notebookId: string): string {
        return `${STORAGE_NOTEBOOKS_FOLDER}/${notebookId}`;
    }

    /// Natural sort for strings with numeric components (e.g., "page-1" < "page-2" < "page-10")
    private naturalSort(a: string, b: string): number {
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    }

    async listNotebooks(manifestPath: string): Promise<NotebookEntry[]> {
        const root = this.ensureInitialized();
        try {
            const indexFile = await root.getFileHandle(manifestPath, { create: false });
            const file = await indexFile.getFile();
            const text = await file.text();
            const manifest: StorageManifest = JSON.parse(text);

            if (!manifest.notebooks || !Array.isArray(manifest.notebooks)) {
                throw new Error('Invalid manifest format: notebooks must be an array');
            }

            // Validate entries
            for (const entry of manifest.notebooks) {
                if (!entry.path) {
                    throw new Error('Invalid manifest format: each notebook must have path');
                }
            }

            return manifest.notebooks;
        } catch (error) {
            // If file doesn't exist, return empty array
            if ((error as any).name === 'NotFoundError') {
                return [];
            }
            // Re-throw other errors (including validation errors)
            throw error;
        }
    }

    async loadNotebook(notebookId: string): Promise<NotebookData> {
        const notebookDir = await this.getNotebookDir(this.notebookRelPath(notebookId), false);
        const metaFile = await notebookDir.getFileHandle(STORAGE_NOTEBOOK_FILE);
        const file = await metaFile.getFile();
        const text = await file.text();
        const data: NotebookData = JSON.parse(text);

        // notebookId is required - will throw if missing
        if (!data.notebookId) {
            throw new Error(`Notebook ${notebookId} is missing required notebookId field. Please migrate the notebook or regenerate it.`);
        }

        return data;
    }

    async saveNotebookManifest(notebookId: string, data: NotebookData): Promise<void> {
        const notebookDir = await this.getNotebookDir(this.notebookRelPath(notebookId), true);
        const metaFile = await notebookDir.getFileHandle(STORAGE_NOTEBOOK_FILE, { create: true });
        const writable = await metaFile.createWritable();
        await writable.write(JSON.stringify(data, null, 2));
        await writable.close();

        await this.upsertNotebookEntry({ path: notebookId, storageType: StorageBackendType.OPFS });
    }

    async deleteNotebook(notebookId: string): Promise<void> {
        await this.deleteNotebookFiles(notebookId);
        // Always try to update the manifest even if the notebook files weren't found
        // (in case the manifest still has a stale reference).
        await this.removeNotebookEntry(notebookId);
    }

    /// Delete a notebook's files only, leaving the registry entry intact.
    async deleteNotebookFiles(notebookId: string): Promise<void> {
        const relativePath = this.notebookRelPath(notebookId);
        const root = this.ensureInitialized();

        try {
            // Navigate to the parent directory, then remove the notebook entry
            const parts = relativePath.split('/').filter(p => p);
            if (parts.length > 0) {
                let parentDir: FileSystemDirectoryHandle = root;
                for (let i = 0; i < parts.length - 1; i++) {
                    parentDir = await parentDir.getDirectoryHandle(parts[i], { create: false });
                }
                await parentDir.removeEntry(parts[parts.length - 1], { recursive: true });
            }
        } catch (error) {
            // If notebooks folder or notebook doesn't exist, that's fine - it's already deleted
            if ((error as any).name !== 'NotFoundError') {
                throw error;
            }
        }
    }

    async loadNotebookSchema(notebookId: string): Promise<string | null> {
        try {
            const notebookDir = await this.getNotebookDir(this.notebookRelPath(notebookId), false);
            const schemaFile = await notebookDir.getFileHandle(STORAGE_SCRIPT_SCHEMA, { create: false });
            const file = await schemaFile.getFile();
            return await file.text();
        } catch {
            return null;
        }
    }

    async saveNotebookSchema(notebookId: string, sql: string): Promise<void> {
        const notebookDir = await this.getNotebookDir(this.notebookRelPath(notebookId), true);
        const schemaFile = await notebookDir.getFileHandle(STORAGE_SCRIPT_SCHEMA, { create: true });
        const writable = await schemaFile.createWritable();
        await writable.write(sql);
        await writable.close();
    }

    async loadNotebookFunctions(notebookId: string): Promise<string | null> {
        try {
            const notebookDir = await this.getNotebookDir(this.notebookRelPath(notebookId), false);
            const functionsFile = await notebookDir.getFileHandle(STORAGE_SCRIPT_FUNCTIONS, { create: false });
            const file = await functionsFile.getFile();
            return await file.text();
        } catch {
            return null;
        }
    }

    async saveNotebookFunctions(notebookId: string, sql: string): Promise<void> {
        const notebookDir = await this.getNotebookDir(this.notebookRelPath(notebookId), true);
        const functionsFile = await notebookDir.getFileHandle(STORAGE_SCRIPT_FUNCTIONS, { create: true });
        const writable = await functionsFile.createWritable();
        await writable.write(sql);
        await writable.close();
    }

    async loadScriptFolders(notebookId: string): Promise<ScriptFolderData[]> {
        const notebookDir = await this.getNotebookDir(this.notebookRelPath(notebookId), false).catch((error) => {
            if ((error as any).name === 'NotFoundError') return null;
            throw error;
        });
        if (!notebookDir) {
            return [];
        }
        let scriptsDir: FileSystemDirectoryHandle;
        try {
            scriptsDir = await notebookDir.getDirectoryHandle(STORAGE_SCRIPTS_FOLDER, { create: false });
        } catch (error) {
            if ((error as any).name === 'NotFoundError') {
                return [];
            }
            throw error;
        }
        const folders: ScriptFolderData[] = [];

        for await (const [name, handle] of scriptsDir.entries()) {
            if (handle.kind === 'directory') {
                const scripts = await this.loadScriptsInFolder(handle as FileSystemDirectoryHandle);
                folders.push({ name, scripts });
            }
        }
        folders.sort((a, b) => this.naturalSort(a.name, b.name));
        return folders;
    }

    private async loadScriptsInFolder(folderDir: FileSystemDirectoryHandle): Promise<ScriptData[]> {
        const scripts: ScriptData[] = [];

        for await (const [name, handle] of folderDir.entries()) {
            if (handle.kind === 'file' && name.endsWith('.sql') && name !== STORAGE_SCRIPT_DRAFT) {
                const file = await (handle as FileSystemFileHandle).getFile();
                const sql = await file.text();
                scripts.push({ name, sql });
            }
        }
        scripts.sort((a, b) => this.naturalSort(a.name, b.name));
        return scripts;
    }

    async createScriptFolder(notebookId: string, folderName: string): Promise<void> {
        const notebookDir = await this.getNotebookDir(this.notebookRelPath(notebookId), true);
        const scriptsDir = await notebookDir.getDirectoryHandle(STORAGE_SCRIPTS_FOLDER, { create: true });
        await scriptsDir.getDirectoryHandle(folderName, { create: true });
    }

    async deleteScriptFolder(notebookId: string, folderName: string): Promise<void> {
        const notebookDir = await this.getNotebookDir(this.notebookRelPath(notebookId), false);
        const scriptsDir = await notebookDir.getDirectoryHandle(STORAGE_SCRIPTS_FOLDER);
        await scriptsDir.removeEntry(folderName, { recursive: true });
    }

    async renameScriptFolder(notebookId: string, oldFolderName: string, newFolderName: string): Promise<void> {
        if (oldFolderName === newFolderName) {
            return;
        }
        const notebookDir = await this.getNotebookDir(this.notebookRelPath(notebookId), true);
        const scriptsDir = await notebookDir.getDirectoryHandle(STORAGE_SCRIPTS_FOLDER, { create: true });

        // The source folder may not exist yet (the folder was created and renamed before its first
        // flush); there is then nothing on disk to move, so leave it for the pending write.
        let oldDir: FileSystemDirectoryHandle;
        try {
            oldDir = await scriptsDir.getDirectoryHandle(oldFolderName, { create: false });
        } catch (error) {
            if ((error as any).name === 'NotFoundError') {
                return;
            }
            throw error;
        }

        // OPFS has no atomic directory rename, so create the target folder and move every file into
        // it. Collect names up front: moving (or copy+delete) mutates the source dir, and mutating it
        // mid-iteration is unsafe. Pages only ever contain files (scripts), so nested dirs are ignored.
        const newDir = await scriptsDir.getDirectoryHandle(newFolderName, { create: true });
        const fileNames: string[] = [];
        for await (const [name, handle] of oldDir.entries()) {
            if (handle.kind === 'file') {
                fileNames.push(name);
            }
        }
        for (const name of fileNames) {
            await this.moveFile(oldDir, name, newDir, name);
        }
        await scriptsDir.removeEntry(oldFolderName, { recursive: true });
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


    async loadScript(notebookId: string, folderName: string, scriptName: string): Promise<ScriptData> {
        const folderDir = await this.getFolderDir(this.notebookRelPath(notebookId), folderName, false);

        try {
            const fileHandle = await folderDir.getFileHandle(scriptName);
            const file = await fileHandle.getFile();
            const sql = await file.text();
            return { name: scriptName, sql };
        } catch {
            throw new Error(`Script not found: notebook ${notebookId}, folder ${folderName}, script ${scriptName}`);
        }
    }

    async saveScript(
        notebookId: string,
        folderName: string,
        scriptName: string,
        sql: string
    ): Promise<void> {
        const folderDir = await this.getFolderDir(this.notebookRelPath(notebookId), folderName, true);
        const fileHandle = await folderDir.getFileHandle(scriptName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(sql);
        await writable.close();
    }

    async deleteScript(notebookId: string, folderName: string, scriptName: string): Promise<void> {
        const folderDir = await this.getFolderDir(this.notebookRelPath(notebookId), folderName, false);
        await folderDir.removeEntry(scriptName);
    }

    async renameScript(notebookId: string, folderName: string, oldScriptName: string, newScriptName: string): Promise<void> {
        if (oldScriptName === newScriptName) {
            return;
        }
        // Navigate without creating anything: if the notebook, page, or source file isn't flushed yet,
        // the pending write under the new name creates them, so there is nothing to move. The
        // scripts/folder/file handles surface a raw OPFS NotFoundError, but getNotebookDir re-wraps that
        // into a generic "Directory not found" Error, so the no-op guard has to recognise both forms.
        let folderDir: FileSystemDirectoryHandle;
        try {
            const notebookDir = await this.getNotebookDir(this.notebookRelPath(notebookId), false);
            const scriptsDir = await notebookDir.getDirectoryHandle(STORAGE_SCRIPTS_FOLDER, { create: false });
            folderDir = await scriptsDir.getDirectoryHandle(folderName, { create: false });
            await folderDir.getFileHandle(oldScriptName, { create: false });
        } catch (error) {
            if ((error as any).name === 'NotFoundError' || ((error as any).message ?? '').startsWith('Directory not found')) {
                return;
            }
            throw error;
        }
        await this.moveFile(folderDir, oldScriptName, folderDir, newScriptName);
    }

    async loadScriptDraft(notebookId: string): Promise<string | null> {
        try {
            const notebookDir = await this.getNotebookDir(this.notebookRelPath(notebookId), false);
            const scriptsDir = await notebookDir.getDirectoryHandle(STORAGE_SCRIPTS_FOLDER, { create: false });
            const draftFile = await scriptsDir.getFileHandle(STORAGE_SCRIPT_DRAFT, { create: false });
            const file = await draftFile.getFile();
            return await file.text();
        } catch {
            return null;
        }
    }

    async saveScriptDraft(notebookId: string, sql: string): Promise<void> {
        const notebookDir = await this.getNotebookDir(this.notebookRelPath(notebookId), true);
        const scriptsDir = await notebookDir.getDirectoryHandle(STORAGE_SCRIPTS_FOLDER, { create: true });
        const draftFile = await scriptsDir.getFileHandle(STORAGE_SCRIPT_DRAFT, { create: true });
        const writable = await draftFile.createWritable();
        await writable.write(sql);
        await writable.close();
    }

    /// The relative folder that holds a notebook's cached query results, e.g. "notebooks/<uuid>/cache"
    private cacheRelPath(notebookId: string): string {
        return `${this.notebookRelPath(notebookId)}/${STORAGE_CACHE_FOLDER}`;
    }

    async loadQueryResultCache(notebookId: string, hash: string): Promise<CachedQueryResult | null> {
        try {
            const cacheDir = await this.getNotebookDir(this.cacheRelPath(notebookId), false);
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

    /// Build the eviction store over an already-resolved cache directory. Pairs each `<hash>.arrow`
    /// payload with its `<hash>.arrow.last_access` marker (an empty file whose mtime is the last
    /// access time), falling back to the payload's own mtime when the marker is absent. The marker
    /// files are not themselves cache entries, so they are skipped by the listing and their `.arrow`
    /// sibling is removed alongside them on delete.
    ///
    /// The listing also reaps orphaned markers — a marker whose payload no longer exists. Deletion is
    /// payload-then-marker, so a crash in between (or any external cache tampering) can strand a
    /// zero-byte marker; folding the reap into this scan (which runs on every save, before eviction)
    /// cleans them up with no extra directory walk and no background timer. Orphan reaping is
    /// best-effort: a failed delete is ignored (the marker is harmless and will be retried next save).
    private cacheStoreForDir(cacheDir: FileSystemDirectoryHandle): QueryResultCacheStore {
        return {
            listCacheFiles: async (): Promise<CacheFileStat[]> => {
                // First pass: collect marker mtimes keyed by their payload name, and payload stats.
                const accessMs = new Map<string, number>();
                const payloads: { name: string; size: number; mtimeMs: number }[] = [];
                for await (const [name, handle] of cacheDir.entries()) {
                    if (handle.kind !== 'file') {
                        continue;
                    }
                    if (name.endsWith(STORAGE_CACHE_ACCESS_SUFFIX)) {
                        const file = await (handle as FileSystemFileHandle).getFile();
                        accessMs.set(name.slice(0, -STORAGE_CACHE_ACCESS_SUFFIX.length), file.lastModified);
                    } else if (name.endsWith(STORAGE_CACHE_EXTENSION)) {
                        const file = await (handle as FileSystemFileHandle).getFile();
                        payloads.push({ name, size: file.size, mtimeMs: file.lastModified });
                    }
                }
                // Reap markers whose payload is gone (best-effort).
                const payloadNames = new Set(payloads.map(p => p.name));
                for (const payloadName of accessMs.keys()) {
                    if (!payloadNames.has(payloadName)) {
                        try {
                            await cacheDir.removeEntry(`${payloadName}${STORAGE_CACHE_ACCESS_SUFFIX}`);
                        } catch {
                            // Ignore: a harmless empty file; retried on the next save.
                        }
                    }
                }
                return payloads.map(p => ({
                    ...p,
                    lastAccessMs: accessMs.get(p.name) ?? p.mtimeMs,
                }));
            },
            deleteCacheFile: async (_notebookId: string, name: string): Promise<void> => {
                // Drop the payload and its access marker together; tolerate either being gone.
                for (const entry of [name, `${name}${STORAGE_CACHE_ACCESS_SUFFIX}`]) {
                    try {
                        await cacheDir.removeEntry(entry);
                    } catch (error) {
                        if ((error as any).name !== 'NotFoundError') {
                            throw error;
                        }
                    }
                }
            },
        };
    }

    /// Write an empty file (creating or truncating it), which advances its mtime.
    private async writeEmptyFile(dir: FileSystemDirectoryHandle, name: string): Promise<void> {
        const handle = await dir.getFileHandle(name, { create: true });
        const writable = await handle.createWritable();
        await writable.write(new ArrayBuffer(0));
        await writable.close();
    }

    async saveQueryResultCache(notebookId: string, hash: string, bytes: Uint8Array): Promise<void> {
        const cacheDir = await this.getNotebookDir(this.cacheRelPath(notebookId), true);

        // Evict least-recently-used entries first so the new file fits under the thresholds.
        await evictToFit(this.cacheStoreForDir(cacheDir), notebookId, bytes.byteLength);

        const fileHandle = await cacheDir.getFileHandle(`${hash}${STORAGE_CACHE_EXTENSION}`, { create: true });
        const writable = await fileHandle.createWritable();
        // Copy into a plain ArrayBuffer to write binary bytes (a Uint8Array's backing buffer may be
        // typed as SharedArrayBuffer, which the write chunk type rejects).
        const buffer = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(buffer).set(bytes);
        await writable.write(buffer);
        await writable.close();

        // Seed the access marker so a freshly written (never-hit) entry has a last-access time.
        await this.writeEmptyFile(cacheDir, `${hash}${STORAGE_CACHE_EXTENSION}${STORAGE_CACHE_ACCESS_SUFFIX}`);
    }

    async listQueryResultCache(notebookId: string): Promise<CacheFileStat[]> {
        let cacheDir: FileSystemDirectoryHandle;
        try {
            cacheDir = await this.getNotebookDir(this.cacheRelPath(notebookId), false);
        } catch {
            // No cache folder yet — nothing cached.
            return [];
        }
        return this.cacheStoreForDir(cacheDir).listCacheFiles(notebookId);
    }

    async touchQueryResultCacheAccess(notebookId: string, hash: string): Promise<void> {
        // Bump only the empty marker's mtime — never the payload — so this stays cheap regardless of
        // result size and leaves the payload's "cached at" write time intact.
        const cacheDir = await this.getNotebookDir(this.cacheRelPath(notebookId), false);
        await this.writeEmptyFile(cacheDir, `${hash}${STORAGE_CACHE_EXTENSION}${STORAGE_CACHE_ACCESS_SUFFIX}`);
    }

    async deleteQueryResultCache(notebookId: string, hash: string): Promise<void> {
        let cacheDir: FileSystemDirectoryHandle;
        try {
            cacheDir = await this.getNotebookDir(this.cacheRelPath(notebookId), false);
        } catch (error) {
            // Missing cache folder — nothing to delete.
            if ((error as any).name === 'NotFoundError' || ((error as any).message ?? '').startsWith('Directory not found')) {
                return;
            }
            throw error;
        }
        // Remove the payload and its access marker together; tolerate either being gone.
        for (const entry of [`${hash}${STORAGE_CACHE_EXTENSION}`, `${hash}${STORAGE_CACHE_EXTENSION}${STORAGE_CACHE_ACCESS_SUFFIX}`]) {
            try {
                await cacheDir.removeEntry(entry);
            } catch (error) {
                if ((error as any).name !== 'NotFoundError') {
                    throw error;
                }
            }
        }
    }

    async clearAllStorage(): Promise<void> {
        const root = this.ensureInitialized();

        // Step 1: Clear the manifest (reset notebooks to empty array) FIRST.
        // This ensures the app won't try to restore notebooks even if directory cleanup fails.
        try {
            const emptyManifest: StorageManifest = { notebooks: [] };
            const manifestFile = await root.getFileHandle(STORAGE_MANIFEST_FILE, { create: true });
            const writable = await manifestFile.createWritable();
            await writable.write(JSON.stringify(emptyManifest, null, 2));
            await writable.close();
        } catch (error) {
            console.warn('Failed to clear manifest:', error);
        }

        // Step 2: Delete the entire notebooks folder
        try {
            await root.removeEntry(STORAGE_NOTEBOOKS_FOLDER, { recursive: true });
        } catch (error) {
            console.warn('Failed to delete notebooks folder:', error);
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
            if (!manifest.notebooks || !Array.isArray(manifest.notebooks)) {
                throw new Error('Invalid manifest format: notebooks must be an array');
            }
            return manifest;
        } catch (error) {
            if ((error as any).name === 'NotFoundError') {
                return { notebooks: [] };
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

    /// Insert or replace a notebook's registry entry (matched by UUID), without touching files.
    ///
    /// The array order is the user-facing notebook order (surfaced in the selector, reorderable by
    /// drag-and-drop via `reorderNotebooks`), so we deliberately preserve it: a new notebook appends to
    /// the end and an existing one is updated in place. We never re-sort.
    async upsertNotebookEntry(entry: NotebookEntry): Promise<void> {
        const root = this.ensureInitialized();
        const manifest = await this.readManifest(root);

        const existingIndex = manifest.notebooks.findIndex(s => s.path === entry.path);
        if (existingIndex < 0) {
            manifest.notebooks.push(entry);
        } else {
            manifest.notebooks[existingIndex] = entry;
        }

        await this.writeManifest(root, manifest);
    }

    /// Remove a notebook's registry entry (matched by UUID), without touching files.
    async removeNotebookEntry(notebookId: string): Promise<void> {
        const root = this.ensureInitialized();
        const manifest = await this.readManifest(root);
        manifest.notebooks = manifest.notebooks.filter(s => s.path !== notebookId);
        await this.writeManifest(root, manifest);
    }

    /// Reorder the registry entries to match `orderedIds` (a permutation of the existing notebook
    /// UUIDs), without touching files. Entries are re-emitted in the given order; any UUID not present
    /// in the manifest is ignored, and any manifest entry missing from `orderedIds` is appended at the
    /// end in its current relative order (so a stale/racing id list can never drop a notebook).
    async reorderNotebooks(orderedIds: string[]): Promise<void> {
        const root = this.ensureInitialized();
        const manifest = await this.readManifest(root);

        const byId = new Map(manifest.notebooks.map(s => [s.path, s]));
        const reordered: NotebookEntry[] = [];
        const taken = new Set<string>();
        for (const id of orderedIds) {
            const entry = byId.get(id);
            if (entry && !taken.has(id)) {
                reordered.push(entry);
                taken.add(id);
            }
        }
        // Preserve any entries the caller didn't mention, keeping their existing relative order.
        for (const entry of manifest.notebooks) {
            if (!taken.has(entry.path)) {
                reordered.push(entry);
            }
        }

        manifest.notebooks = reordered;
        await this.writeManifest(root, manifest);
    }

    private async getNotebookDir(
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

    private async getFolderDir(
        notebookId: string,
        folderName: string,
        create: boolean
    ): Promise<FileSystemDirectoryHandle> {
        const notebookDir = await this.getNotebookDir(notebookId, create);
        try {
            const scriptsDir = await notebookDir.getDirectoryHandle(STORAGE_SCRIPTS_FOLDER, { create });
            return await scriptsDir.getDirectoryHandle(folderName, { create });
        } catch (error) {
            if ((error as any).name === 'NotFoundError') {
                throw new Error(`Directory not found: opfs://${notebookId}/${STORAGE_SCRIPTS_FOLDER}/${folderName}`);
            }
            throw error;
        }
    }
}
