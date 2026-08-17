import {
    type StorageBackend,
    type NotebookRegistryBackend,
    type NotebookData,
    type ScriptFolderData,
    type ScriptData,
    type NotebookEntry,
    type AppSettings,
    type CachedQueryResult,
    StorageBackendType,
    STORAGE_MANIFEST_FILE,
    STORAGE_NOTEBOOK_FILE,
} from './storage_backend.js';
import { type CacheFileStat } from './query_result_cache_eviction.js';
import { NativeStorageBackend } from './native_storage_backend.js';
import { type NotebookLocation, locationFromEntry } from './notebook_locator.js';
import { grantFsScope } from './native_fs_scope.js';
import { copyNotebook, verifyNotebook } from './storage_migration.js';
import { validateNotebookData, describeNotebookValidationError } from './notebook_validation.js';
import type { Logger } from '../../../platform/logger/logger.js';

const LOG_CTX = 'composite_storage_backend';

/// A storage backend that routes by per-notebook location.
///
/// The OPFS root manifest is the single registry of *every* notebook; registry-level operations
/// (listing notebooks, app settings, clear-all) therefore always go to OPFS. Per-notebook operations
/// are routed by the notebook UUID to whichever backend physically holds that notebook's files:
///   - OPFS notebooks -> the shared OPFS backend (`notebooks/<uuid>/…`).
///   - Native notebooks -> a per-notebook `NativeStorageBackend` bound to the recorded directory.
///
/// Native filesystem scope is re-granted lazily (and idempotently) the first time a native notebook
/// is touched, since Tauri's runtime scope is lost across reloads and the manifest is the source of
/// truth for which directories belong to dashql.
export class CompositeStorageBackend implements NotebookRegistryBackend {
    /// The OPFS backend, which owns the notebook registry
    private readonly opfs: NotebookRegistryBackend;
    /// uuid -> physical location, built from the manifest at init and kept in sync on writes
    private readonly locations: Map<string, NotebookLocation>;
    /// Cached per-notebook native backends, keyed by uuid
    private readonly nativeCache: Map<string, NativeStorageBackend>;
    /// Native directories whose fs scope has already been granted this notebook
    private readonly grantedScopes: Set<string>;
    /// The logger
    private readonly logger: Logger;

    constructor(opfs: NotebookRegistryBackend, logger: Logger) {
        this.opfs = opfs;
        this.locations = new Map();
        this.nativeCache = new Map();
        this.grantedScopes = new Set();
        this.logger = logger;
    }

    getBackendType(): StorageBackendType {
        return StorageBackendType.OPFS;
    }

    async initialize(): Promise<void> {
        await this.opfs.initialize?.();
        await this.refreshLocations();
    }

    /// Rebuild the uuid -> location map from the OPFS root manifest and re-grant native fs scopes.
    ///
    /// Called at init (and after relocate, before reload re-runs init). Granting scope here, before
    /// any native notebook is read, satisfies "grant before read" without a separate boot step.
    async refreshLocations(): Promise<void> {
        const notebooks = await this.opfs.listNotebooks(STORAGE_MANIFEST_FILE);
        this.locations.clear();
        for (const entry of notebooks) {
            this.locations.set(entry.path, locationFromEntry(entry));
        }
        for (const loc of this.locations.values()) {
            if (loc.type === StorageBackendType.Native && loc.nativePath) {
                await this.ensureScope(loc.nativePath);
            }
        }
    }

    /// Grant the native fs scope for a directory exactly once per notebook.
    private async ensureScope(dir: string): Promise<void> {
        if (this.grantedScopes.has(dir)) {
            return;
        }
        try {
            await grantFsScope(dir);
            this.grantedScopes.add(dir);
        } catch (e: any) {
            // A failed grant means subsequent native reads/writes for this directory will fail with
            // a permission error. Log it, but don't poison the whole restore - other notebooks are
            // independent. We deliberately don't mark the scope as granted so a later access retries.
            this.logger.warn('failed to grant native fs scope', { dir, error: String(e?.message ?? e) }, LOG_CTX);
        }
    }

    /// The current known location for a notebook (defaulting to OPFS for unknown UUIDs).
    private locationOf(notebookId: string): NotebookLocation {
        return this.locations.get(notebookId) ?? { type: StorageBackendType.OPFS };
    }

    /// Resolve the backend that physically holds a notebook's files, granting scope as needed.
    private async backendFor(notebookId: string): Promise<StorageBackend> {
        const loc = this.locationOf(notebookId);
        if (loc.type === StorageBackendType.Native && loc.nativePath) {
            await this.ensureScope(loc.nativePath);
            let native = this.nativeCache.get(notebookId);
            if (!native) {
                native = new NativeStorageBackend(loc.nativePath);
                await native.initialize();
                this.nativeCache.set(notebookId, native);
            }
            return native;
        }
        return this.opfs;
    }

    // ---- Registry-level operations (always OPFS) ----------------------------------------------

    listNotebooks(manifestPath: string): Promise<NotebookEntry[]> {
        return this.opfs.listNotebooks(manifestPath);
    }
    loadAppSettings(): Promise<AppSettings | null> {
        return this.opfs.loadAppSettings();
    }
    saveAppSettings(settings: AppSettings): Promise<void> {
        return this.opfs.saveAppSettings(settings);
    }

    upsertNotebookEntry(entry: NotebookEntry): Promise<void> {
        // Keep the in-memory location map consistent with what we persist.
        this.locations.set(entry.path, locationFromEntry(entry));
        return this.opfs.upsertNotebookEntry(entry);
    }
    removeNotebookEntry(notebookId: string): Promise<void> {
        this.locations.delete(notebookId);
        return this.opfs.removeNotebookEntry(notebookId);
    }
    reorderNotebooks(orderedIds: string[]): Promise<void> {
        // Keep the in-memory location map's iteration order (the source of `getNotebookOrder`) in
        // lockstep with what we persist, applying the exact same "listed ids first, unlisted kept at
        // the end in current order" rule the OPFS backend uses.
        const previous = this.locations;
        const reordered = new Map<string, NotebookLocation>();
        for (const id of orderedIds) {
            const loc = previous.get(id);
            if (loc && !reordered.has(id)) {
                reordered.set(id, loc);
            }
        }
        for (const [id, loc] of previous) {
            if (!reordered.has(id)) {
                reordered.set(id, loc);
            }
        }
        this.locations.clear();
        for (const [id, loc] of reordered) {
            this.locations.set(id, loc);
        }
        return this.opfs.reorderNotebooks(orderedIds);
    }

    /// The user-facing notebook order (the manifest array order), as notebook UUIDs.
    getNotebookOrder(): string[] {
        return [...this.locations.keys()];
    }
    deleteNotebookFiles(notebookId: string): Promise<void> {
        return this.backendFor(notebookId).then(b => {
            if (b === this.opfs) {
                return this.opfs.deleteNotebookFiles(notebookId);
            }
            // For native notebooks, the directory *is* the notebook.
            return b.deleteNotebook(notebookId);
        });
    }

    // ---- Per-notebook operations (routed by uuid) ----------------------------------------------

    async loadNotebook(notebookId: string): Promise<NotebookData> {
        return (await this.backendFor(notebookId)).loadNotebook(notebookId);
    }

    async saveNotebookManifest(notebookId: string, data: NotebookData): Promise<void> {
        const backend = await this.backendFor(notebookId);
        await backend.saveNotebookManifest(notebookId, data);
        // The OPFS backend updates the registry entry itself (storageType=opfs). The native backend
        // does not touch the registry, so when a notebook lives on disk we keep its registry entry
        // in sync here.
        const loc = this.locationOf(notebookId);
        if (loc.type === StorageBackendType.Native && loc.nativePath) {
            await this.opfs.upsertNotebookEntry({
                path: notebookId,
                storageType: StorageBackendType.Native,
                nativePath: loc.nativePath,
            });
        }
    }

    async deleteNotebook(notebookId: string): Promise<void> {
        const loc = this.locationOf(notebookId);
        if (loc.type === StorageBackendType.Native) {
            // Native: the files live in a user-owned folder on disk, so we never delete them —
            // deleting just unregisters the notebook by dropping the registry entry kept in OPFS.
            //
            // We deliberately do NOT route through `backendFor` here. The native backend's
            // `deleteNotebook` is a no-op, but resolving it would `initialize()` the directory, which
            // re-creates it via `mkdir`. For a notebook whose folder was moved/deleted on disk (the
            // exact case that makes it deletable-because-invalid) that would either resurrect an empty
            // folder or throw before we ever dropped the stale manifest entry — leaving it to error
            // again on the next launch. Dropping the entry is all that's needed and can't fail on a
            // missing folder.
            await this.opfs.removeNotebookEntry(notebookId);
        } else {
            // OPFS deletes files and removes the registry entry in one step.
            await this.opfs.deleteNotebook(notebookId);
        }
        this.locations.delete(notebookId);
        this.nativeCache.delete(notebookId);
    }

    async loadNotebookSchema(notebookId: string): Promise<string | null> {
        return (await this.backendFor(notebookId)).loadNotebookSchema(notebookId);
    }
    async saveNotebookSchema(notebookId: string, sql: string): Promise<void> {
        return (await this.backendFor(notebookId)).saveNotebookSchema(notebookId, sql);
    }
    async loadNotebookFunctions(notebookId: string): Promise<string | null> {
        return (await this.backendFor(notebookId)).loadNotebookFunctions(notebookId);
    }
    async saveNotebookFunctions(notebookId: string, sql: string): Promise<void> {
        return (await this.backendFor(notebookId)).saveNotebookFunctions(notebookId, sql);
    }
    async loadScriptFolders(notebookId: string): Promise<ScriptFolderData[]> {
        return (await this.backendFor(notebookId)).loadScriptFolders(notebookId);
    }
    async createScriptFolder(notebookId: string, folderName: string): Promise<void> {
        return (await this.backendFor(notebookId)).createScriptFolder(notebookId, folderName);
    }
    async deleteScriptFolder(notebookId: string, folderName: string): Promise<void> {
        return (await this.backendFor(notebookId)).deleteScriptFolder(notebookId, folderName);
    }
    async renameScriptFolder(notebookId: string, oldFolderName: string, newFolderName: string): Promise<void> {
        return (await this.backendFor(notebookId)).renameScriptFolder(notebookId, oldFolderName, newFolderName);
    }
    async loadScript(notebookId: string, folderName: string, scriptName: string): Promise<ScriptData> {
        return (await this.backendFor(notebookId)).loadScript(notebookId, folderName, scriptName);
    }
    async saveScript(notebookId: string, folderName: string, scriptName: string, sql: string): Promise<void> {
        return (await this.backendFor(notebookId)).saveScript(notebookId, folderName, scriptName, sql);
    }
    async deleteScript(notebookId: string, folderName: string, scriptName: string): Promise<void> {
        return (await this.backendFor(notebookId)).deleteScript(notebookId, folderName, scriptName);
    }
    async renameScript(notebookId: string, folderName: string, oldScriptName: string, newScriptName: string): Promise<void> {
        return (await this.backendFor(notebookId)).renameScript(notebookId, folderName, oldScriptName, newScriptName);
    }
    async loadScriptDraft(notebookId: string): Promise<string | null> {
        return (await this.backendFor(notebookId)).loadScriptDraft(notebookId);
    }
    async saveScriptDraft(notebookId: string, sql: string): Promise<void> {
        return (await this.backendFor(notebookId)).saveScriptDraft(notebookId, sql);
    }
    async loadQueryResultCache(notebookId: string, hash: string): Promise<CachedQueryResult | null> {
        return (await this.backendFor(notebookId)).loadQueryResultCache(notebookId, hash);
    }
    async saveQueryResultCache(notebookId: string, hash: string, bytes: Uint8Array): Promise<void> {
        return (await this.backendFor(notebookId)).saveQueryResultCache(notebookId, hash, bytes);
    }
    async touchQueryResultCacheAccess(notebookId: string, hash: string): Promise<void> {
        return (await this.backendFor(notebookId)).touchQueryResultCacheAccess(notebookId, hash);
    }
    async listQueryResultCache(notebookId: string): Promise<CacheFileStat[]> {
        return (await this.backendFor(notebookId)).listQueryResultCache(notebookId);
    }
    async hasCachedQueryResult(notebookId: string, hash: string): Promise<boolean> {
        return (await this.backendFor(notebookId)).hasCachedQueryResult(notebookId, hash);
    }
    async deleteQueryResultCache(notebookId: string, hash: string): Promise<void> {
        return (await this.backendFor(notebookId)).deleteQueryResultCache(notebookId, hash);
    }

    async clearAllStorage(): Promise<void> {
        // Only the OPFS root is wiped (registry + OPFS-backed notebooks). Native notebooks live in
        // user-owned folders on disk that we never delete; they're simply unregistered when the
        // OPFS manifest is reset. We drop the in-memory location/backend caches to match.
        this.nativeCache.clear();
        this.locations.clear();
        await this.opfs.clearAllStorage?.();
    }

    /// The recorded location for a notebook (used by the UI to render a display path).
    getNotebookLocation(notebookId: string): NotebookLocation {
        return this.locationOf(notebookId);
    }

    /// Relocate a single OPFS notebook's files into a native directory.
    ///
    /// The registry entry stays in OPFS; only the files move. Steps:
    ///   1. Grant scope for, and initialize, the target directory.
    ///   2. Copy the notebook's files OPFS -> native (UUID preserved).
    ///   3. Verify the copy; on failure throw without touching OPFS.
    ///   4. Flip the OPFS registry entry to `location=native, nativePath=dir` and persist the
    ///      notebook manifest's `storageType`/`nativePath`.
    ///   5. Delete the OPFS copy of the notebook's files (NOT the registry entry).
    ///
    /// On any failure before step 4 the OPFS copy is left fully intact, so the caller can recover.
    async relocateNotebookToNative(uuid: string, dir: string): Promise<void> {
        if (this.locationOf(uuid).type !== StorageBackendType.OPFS) {
            throw new Error(`Notebook ${uuid} is not an OPFS notebook`);
        }

        await this.ensureScope(dir);
        const native = new NativeStorageBackend(dir);
        await native.initialize();

        // 2. Copy. Stamp the notebook manifest with its new physical location as we write it.
        const notebookData = await this.opfs.loadNotebook(uuid);
        await copyNotebook(uuid, this.opfs, native, this.logger);
        await native.saveNotebookManifest(uuid, {
            ...notebookData,
            storageType: StorageBackendType.Native,
            nativePath: dir,
        });

        // 3. Verify before we touch OPFS.
        const ok = await verifyNotebook(uuid, this.opfs, native);
        if (!ok) {
            throw new Error(`Relocation verification failed for notebook ${uuid} - keeping OPFS copy`);
        }

        // 4. Flip the registry entry + cache the new location/backend.
        await this.opfs.upsertNotebookEntry({
            path: uuid,
            storageType: StorageBackendType.Native,
            nativePath: dir,
        });
        this.locations.set(uuid, { type: StorageBackendType.Native, nativePath: dir });
        this.nativeCache.set(uuid, native);

        // 5. Now it's safe to drop the OPFS copy of the files (registry entry stays).
        await this.opfs.deleteNotebookFiles(uuid);
        this.logger.info('relocated notebook to native storage', { notebookId: uuid, dir }, LOG_CTX);
    }

    /// Load a pre-existing native notebook directory into the registry.
    ///
    /// Unlike `relocateNotebookToNative`, this copies nothing: the directory already holds a complete
    /// notebook written by a previous run (or another machine). We simply read its notebook manifest,
    /// validate the metadata up front (the same fail-fast gate the loader uses), and record a
    /// `location=native` entry in the OPFS root manifest so the next restore picks it up.
    ///
    /// Returns the loaded notebook's UUID. Throws if the directory holds no readable notebook, the
    /// metadata is invalid, or a notebook with the same UUID is already registered (we never silently
    /// overwrite an existing entry — the caller surfaces the error).
    async loadNativeNotebook(dir: string): Promise<string> {
        await this.ensureScope(dir);
        const native = new NativeStorageBackend(dir);
        await native.initialize();

        // Read the notebook manifest the directory already contains. File-system and JSON failures
        // mean this isn't a readable dashql notebook folder. Structurally invalid metadata is handled
        // by the validation gate below so callers get the actual reason instead of a misleading
        // "not found" error.
        let notebookData: NotebookData;
        try {
            // The UUID argument is only used for the error message here — the native backend reads
            // the single notebook file directly from the directory regardless of the id passed.
            notebookData = await native.loadNotebook(dir);
        } catch (e: any) {
            throw new Error(`No dashql notebook found in ${dir} (expected ${STORAGE_NOTEBOOK_FILE})`);
        }

        // Fail-fast metadata validation, mirroring the loader: refuse a folder whose notebook is
        // structurally unusable rather than registering an entry that would fail at restore.
        const validation = validateNotebookData(notebookData);
        if (!validation.ok) {
            throw new Error(`Notebook in ${dir} is invalid: ${describeNotebookValidationError(validation.error)}`);
        }

        // Validation guarantees a syntactically valid UUID; it is the authoritative identity.
        const uuid = notebookData.notebookId;

        // Never clobber a notebook that's already registered (same folder added twice, or a UUID
        // collision with an existing OPFS/native notebook).
        if (this.locations.has(uuid)) {
            throw new Error(`Notebook ${uuid} is already registered`);
        }

        // Record the native location in the OPFS root manifest and cache the backend/location.
        await this.opfs.upsertNotebookEntry({
            path: uuid,
            storageType: StorageBackendType.Native,
            nativePath: dir,
        });
        this.locations.set(uuid, { type: StorageBackendType.Native, nativePath: dir });
        this.nativeCache.set(uuid, native);

        this.logger.info('loaded native notebook', { notebookId: uuid, dir }, LOG_CTX);
        return uuid;
    }
}
