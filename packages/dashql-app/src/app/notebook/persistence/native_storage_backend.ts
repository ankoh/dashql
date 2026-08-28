import { type StorageBackend, type NotebookData, type ScriptFolderData, type ScriptData, type NotebookEntry, type AppSettings, type CachedQueryResult, StorageBackendType, STORAGE_NOTEBOOK_FILE, STORAGE_SCRIPTS_FOLDER, STORAGE_SCRIPT_DRAFT, STORAGE_SCRIPT_SCHEMA, STORAGE_SCRIPT_FUNCTIONS, STORAGE_CACHE_FOLDER, STORAGE_CACHE_EXTENSION, STORAGE_CACHE_ACCESS_SUFFIX } from './storage_backend.js';
import { type CacheFileStat, type QueryResultCacheStore, evictToFit } from './query_result_cache_eviction.js';

import { exists, join, mkdir, readDir, readFile, readTextFile, remove, rename, stat, writeFile, writeTextFile } from '../../../platform/electron_fs.js';

/// The name of the notebook-level .gitignore that excludes the cache folder from version control.
const GITIGNORE_FILE = '.gitignore';

/// Native filesystem storage backend for a single Electron notebook.
///
/// One directory holds exactly one notebook. Unlike OPFS, there is no `notebooks/<uuid>` nesting and
/// no manifest file in the directory: the notebook's files (`dashql-notebook.json`,
/// `dashql-relations.sql`, `dashql-functions.sql`, `scripts/…`) are written *directly* under the
/// configured directory. The notebook UUID passed to each method identifies the notebook for the
/// caller's routing, but does not affect the on-disk layout (the directory already is the notebook).
///
/// The notebook *registry* (which notebooks exist, and where each lives) is owned by the OPFS root
/// manifest, not here. The registry-level methods on this backend are therefore inert; the
/// composite backend always routes those to OPFS.
export class NativeStorageBackend implements StorageBackend {
    /// The absolute directory on disk that holds this notebook's files
    private readonly dir: string;

    constructor(dir: string) {
        this.dir = dir;
    }

    getBackendType(): StorageBackendType {
        return StorageBackendType.Native;
    }

    /// The absolute directory backing this notebook
    getDir(): string {
        return this.dir;
    }

    async initialize(): Promise<void> {
        if (!(await exists(this.dir))) {
            await mkdir(this.dir, { recursive: true });
        }
    }

    /// Resolve a relative storage path against the absolute directory using OS-correct separators
    private async abs(relative: string): Promise<string> {
        const parts = relative.split('/').filter(p => p.length > 0);
        return await join(this.dir, ...parts);
    }

    /// Ensure a directory (given as a relative path) exists
    private async ensureDir(relative: string): Promise<void> {
        const dir = relative.length > 0 ? await this.abs(relative) : this.dir;
        if (!(await exists(dir))) {
            await mkdir(dir, { recursive: true });
        }
    }

    /// Natural sort for strings with numeric components (e.g., "page-1" < "page-2" < "page-10")
    private naturalSort(a: string, b: string): number {
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    }

    // ---- Registry-level operations (owned by OPFS; inert here) -------------------------------

    async listNotebooks(_manifestPath: string): Promise<NotebookEntry[]> {
        // The registry lives in the OPFS root manifest, never in a native notebook directory.
        return [];
    }

    async loadAppSettings(): Promise<AppSettings | null> {
        return null;
    }

    async saveAppSettings(_settings: AppSettings): Promise<void> {
        // No-op: app settings live on the OPFS root manifest.
    }

    // ---- Per-notebook operations ---------------------------------------------------------------

    async loadNotebook(notebookId: string): Promise<NotebookData> {
        const metaFile = await this.abs(STORAGE_NOTEBOOK_FILE);
        const text = await readTextFile(metaFile);
        return JSON.parse(text) as NotebookData;
    }

    async saveNotebookManifest(_notebookId: string, data: NotebookData): Promise<void> {
        await this.ensureDir('');
        const metaFile = await this.abs(STORAGE_NOTEBOOK_FILE);
        await writeTextFile(metaFile, JSON.stringify(data, null, 2));
    }

    async deleteNotebook(_notebookId: string): Promise<void> {
        // No-op: a native notebook lives in a user-owned folder on disk. Deleting the notebook in
        // dashql only unregisters it — the registry entry lives in the OPFS root manifest and is
        // dropped by the composite backend. The files on disk are deliberately left intact so the
        // folder can be re-loaded later (and so we never destroy data the user put there).
    }

    async loadNotebookSchema(_notebookId: string): Promise<string | null> {
        const schemaFile = await this.abs(STORAGE_SCRIPT_SCHEMA);
        if (!(await exists(schemaFile))) {
            return null;
        }
        return await readTextFile(schemaFile);
    }

    async saveNotebookSchema(_notebookId: string, sql: string): Promise<void> {
        await this.ensureDir('');
        const schemaFile = await this.abs(STORAGE_SCRIPT_SCHEMA);
        await writeTextFile(schemaFile, sql);
    }

    async loadNotebookFunctions(_notebookId: string): Promise<string | null> {
        const functionsFile = await this.abs(STORAGE_SCRIPT_FUNCTIONS);
        if (!(await exists(functionsFile))) {
            return null;
        }
        return await readTextFile(functionsFile);
    }

    async saveNotebookFunctions(_notebookId: string, sql: string): Promise<void> {
        await this.ensureDir('');
        const functionsFile = await this.abs(STORAGE_SCRIPT_FUNCTIONS);
        await writeTextFile(functionsFile, sql);
    }

    async loadScriptFolders(_notebookId: string): Promise<ScriptFolderData[]> {
        const scriptsDir = await this.abs(STORAGE_SCRIPTS_FOLDER);
        if (!(await exists(scriptsDir))) {
            return [];
        }

        const entries = await readDir(scriptsDir);
        const folders: ScriptFolderData[] = [];
        for (const entry of entries) {
            if (entry.isDirectory) {
                const scripts = await this.loadScriptsInFolder(`${STORAGE_SCRIPTS_FOLDER}/${entry.name}`);
                folders.push({ name: entry.name, scripts });
            }
        }
        folders.sort((a, b) => this.naturalSort(a.name, b.name));
        return folders;
    }

    private async loadScriptsInFolder(folderRel: string): Promise<ScriptData[]> {
        const folderDir = await this.abs(folderRel);
        const scripts: ScriptData[] = [];
        if (!(await exists(folderDir))) {
            return scripts;
        }

        const entries = await readDir(folderDir);
        for (const entry of entries) {
            if (entry.isFile && entry.name.endsWith('.sql') && entry.name !== STORAGE_SCRIPT_DRAFT) {
                const sql = await readTextFile(await this.abs(`${folderRel}/${entry.name}`));
                scripts.push({ name: entry.name, sql });
            }
        }
        scripts.sort((a, b) => this.naturalSort(a.name, b.name));
        return scripts;
    }

    async createScriptFolder(_notebookId: string, folderName: string): Promise<void> {
        await this.ensureDir(`${STORAGE_SCRIPTS_FOLDER}/${folderName}`);
    }

    async deleteScriptFolder(_notebookId: string, folderName: string): Promise<void> {
        const folderDir = await this.abs(`${STORAGE_SCRIPTS_FOLDER}/${folderName}`);
        if (await exists(folderDir)) {
            await remove(folderDir, { recursive: true });
        }
    }

    async renameScriptFolder(_notebookId: string, oldFolderName: string, newFolderName: string): Promise<void> {
        if (oldFolderName === newFolderName) {
            return;
        }
        const oldDir = await this.abs(`${STORAGE_SCRIPTS_FOLDER}/${oldFolderName}`);
        const newDir = await this.abs(`${STORAGE_SCRIPTS_FOLDER}/${newFolderName}`);
        // If the source is missing there is nothing on disk to move yet (e.g. the folder was created and
        // renamed before its first flush); leave it to the pending write of the new name.
        if (!(await exists(oldDir))) {
            return;
        }
        // Atomic directory rename onto a destination the caller guarantees is free. Callers schedule
        // these so the destination is always free at flush time: within one reprefix pass the
        // destination "<n>_<clean>" carries a globally-unique clean name, so it can equal no other
        // folder's current name; across passes the writer flushes renames in insertion order, and each
        // pass's destinations are the next pass's sources, so every destination has already been
        // vacated by the time its rename runs.
        await rename(oldDir, newDir);
    }

    async loadScript(notebookId: string, folderName: string, scriptName: string): Promise<ScriptData> {
        const scriptFile = await this.abs(`${STORAGE_SCRIPTS_FOLDER}/${folderName}/${scriptName}`);
        if (!(await exists(scriptFile))) {
            throw new Error(`Script not found: notebook ${notebookId}, folder ${folderName}, script ${scriptName}`);
        }
        const sql = await readTextFile(scriptFile);
        return { name: scriptName, sql };
    }

    async saveScript(
        _notebookId: string,
        folderName: string,
        scriptName: string,
        sql: string
    ): Promise<void> {
        await this.ensureDir(`${STORAGE_SCRIPTS_FOLDER}/${folderName}`);
        const scriptFile = await this.abs(`${STORAGE_SCRIPTS_FOLDER}/${folderName}/${scriptName}`);
        await writeTextFile(scriptFile, sql);
    }

    async deleteScript(_notebookId: string, folderName: string, scriptName: string): Promise<void> {
        const scriptFile = await this.abs(`${STORAGE_SCRIPTS_FOLDER}/${folderName}/${scriptName}`);
        if (await exists(scriptFile)) {
            await remove(scriptFile);
        }
    }

    async renameScript(_notebookId: string, folderName: string, oldScriptName: string, newScriptName: string): Promise<void> {
        if (oldScriptName === newScriptName) {
            return;
        }
        const oldFile = await this.abs(`${STORAGE_SCRIPTS_FOLDER}/${folderName}/${oldScriptName}`);
        const newFile = await this.abs(`${STORAGE_SCRIPTS_FOLDER}/${folderName}/${newScriptName}`);
        // A missing source means the script hasn't been flushed yet; the pending write under the new
        // name will create it, so there is nothing to move here.
        if (!(await exists(oldFile))) {
            return;
        }
        // Atomic file rename. The new clean base is disambiguated unique within the folder, so the
        // destination is free.
        await rename(oldFile, newFile);
    }

    async loadScriptDraft(_notebookId: string): Promise<string | null> {
        const draftFile = await this.abs(`${STORAGE_SCRIPTS_FOLDER}/${STORAGE_SCRIPT_DRAFT}`);
        if (!(await exists(draftFile))) {
            return null;
        }
        return await readTextFile(draftFile);
    }

    async saveScriptDraft(_notebookId: string, sql: string): Promise<void> {
        await this.ensureDir(STORAGE_SCRIPTS_FOLDER);
        const draftFile = await this.abs(`${STORAGE_SCRIPTS_FOLDER}/${STORAGE_SCRIPT_DRAFT}`);
        await writeTextFile(draftFile, sql);
    }

    async loadQueryResultCache(_notebookId: string, hash: string): Promise<CachedQueryResult | null> {
        const file = await this.abs(`${STORAGE_CACHE_FOLDER}/${hash}${STORAGE_CACHE_EXTENSION}`);
        if (!(await exists(file))) {
            return null;
        }
        const bytes = await readFile(file);
        // Read the file's write time so the UI can show how old the cached result is.
        const meta = await stat(file);
        return {
            bytes,
            cachedAtMs: meta.mtime ? meta.mtime.getTime() : 0,
        };
    }

    async saveQueryResultCache(notebookId: string, hash: string, bytes: Uint8Array): Promise<void> {
        await this.ensureDir(STORAGE_CACHE_FOLDER);
        // Keep the cache out of version control. Write the ignore file lazily and only when absent so
        // we never clobber a user-authored .gitignore in their notebook folder.
        const gitignore = await this.abs(GITIGNORE_FILE);
        if (!(await exists(gitignore))) {
            await writeTextFile(gitignore, `${STORAGE_CACHE_FOLDER}/\n`);
        }

        const cacheDir = await this.abs(STORAGE_CACHE_FOLDER);
        await evictToFit(this.cacheStoreForDir(cacheDir), notebookId, bytes.byteLength);

        const file = await this.abs(`${STORAGE_CACHE_FOLDER}/${hash}${STORAGE_CACHE_EXTENSION}`);
        await writeFile(file, bytes);
        // Seed the access marker so a freshly written (never-hit) entry has a last-access time.
        await writeFile(await join(cacheDir, `${hash}${STORAGE_CACHE_EXTENSION}${STORAGE_CACHE_ACCESS_SUFFIX}`), new Uint8Array(0));
    }

    /// Build the eviction store over the cache directory. The native readDir entry carries no
    /// size/mtime, so eviction has to `stat()` each file. Pairs each `<hash>.arrow` payload with its
    /// `<hash>.arrow.last_access` marker (an empty file whose mtime is the last access time), falling
    /// back to the payload's own mtime when the marker is absent. Marker files are skipped by the
    /// listing and removed alongside their `.arrow` sibling on delete.
    ///
    /// The listing also reaps orphaned markers — a marker whose payload no longer exists. Deletion is
    /// payload-then-marker, so a crash in between (or any external cache tampering) can strand a
    /// zero-byte marker; folding the reap into this scan (which runs on every save, before eviction)
    /// cleans them up with no extra directory walk and no background timer. Orphan reaping is
    /// best-effort: a failed delete is ignored (the marker is harmless and will be retried next save).
    private cacheStoreForDir(cacheDir: string): QueryResultCacheStore {
        return {
            listCacheFiles: async (): Promise<CacheFileStat[]> => {
                const entries = await readDir(cacheDir);
                // First pass: collect marker mtimes keyed by their payload name, and payload stats.
                const accessMs = new Map<string, number>();
                const payloads: { name: string; size: number; mtimeMs: number }[] = [];
                for (const entry of entries) {
                    if (!entry.isFile) {
                        continue;
                    }
                    if (entry.name.endsWith(STORAGE_CACHE_ACCESS_SUFFIX)) {
                        const meta = await stat(await join(cacheDir, entry.name));
                        accessMs.set(entry.name.slice(0, -STORAGE_CACHE_ACCESS_SUFFIX.length), meta.mtime ? meta.mtime.getTime() : 0);
                    } else if (entry.name.endsWith(STORAGE_CACHE_EXTENSION)) {
                        const meta = await stat(await join(cacheDir, entry.name));
                        payloads.push({ name: entry.name, size: meta.size, mtimeMs: meta.mtime ? meta.mtime.getTime() : 0 });
                    }
                }
                // Reap markers whose payload is gone (best-effort).
                const payloadNames = new Set(payloads.map(p => p.name));
                for (const payloadName of accessMs.keys()) {
                    if (!payloadNames.has(payloadName)) {
                        try {
                            await remove(await join(cacheDir, `${payloadName}${STORAGE_CACHE_ACCESS_SUFFIX}`));
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
                    const path = await join(cacheDir, entry);
                    if (await exists(path)) {
                        await remove(path);
                    }
                }
            },
        };
    }

    async listQueryResultCache(notebookId: string): Promise<CacheFileStat[]> {
        const cacheDir = await this.abs(STORAGE_CACHE_FOLDER);
        if (!(await exists(cacheDir))) {
            // No cache folder yet — nothing cached.
            return [];
        }
        return this.cacheStoreForDir(cacheDir).listCacheFiles(notebookId);
    }

    async touchQueryResultCacheAccess(_notebookId: string, hash: string): Promise<void> {
        // Bump only the empty marker's mtime — never the payload — so this stays cheap regardless of
        // result size and leaves the payload's "cached at" write time intact.
        const marker = await this.abs(`${STORAGE_CACHE_FOLDER}/${hash}${STORAGE_CACHE_EXTENSION}${STORAGE_CACHE_ACCESS_SUFFIX}`);
        await writeFile(marker, new Uint8Array(0));
    }

    async hasCachedQueryResult(_notebookId: string, hash: string): Promise<boolean> {
        const marker = await this.abs(`${STORAGE_CACHE_FOLDER}/${hash}${STORAGE_CACHE_EXTENSION}`);
        return await exists(marker);
    }

    async deleteQueryResultCache(_notebookId: string, hash: string): Promise<void> {
        // Remove the payload and its access marker together.
        for (const suffix of ['', STORAGE_CACHE_ACCESS_SUFFIX]) {
            const file = await this.abs(`${STORAGE_CACHE_FOLDER}/${hash}${STORAGE_CACHE_EXTENSION}${suffix}`);
            if (await exists(file)) {
                await remove(file);
            }
        }
    }

    async clearAllStorage(): Promise<void> {
        // No-op: like deleteNotebook, this never touches the user-owned folder on disk. "Clear all
        // storage" only resets the OPFS root (registry + OPFS-backed notebooks); native notebooks are
        // simply unregistered when the manifest is wiped, and their files stay put on disk.
    }
}
