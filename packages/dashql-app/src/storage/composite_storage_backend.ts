import {
    type StorageBackend,
    type WorkbookRegistryBackend,
    type WorkbookData,
    type ScriptData,
    type DataFile,
    type DataFileContent,
    type WorkbookEntry,
    type AppSettings,
    type ConnectionEntry,
    type StorageManifest,
    StorageBackendType,
    validateDataFileName,
} from './storage_backend.js';
import {
    type WorkbookTreeFolder,
    emptyWorkbookTree,
    flattenWorkbookTree,
    removeWorkbookFromTree,
    upsertWorkbookInTree,
} from './workbook_tree.js';
import { type FileStamp } from '../platform/electron_fs.js';
import { NativeStorageBackend } from './native_storage_backend.js';
import { type WorkbookLocation, locationFromEntry } from './workbook_locator.js';
import { copyWorkbook, verifyWorkbook } from './workbook_transfer.js';
import { validateWorkbookData, describeWorkbookValidationError } from './workbook_validation.js';
import {
    assembleWorkbookBundle,
    readWorkbookBundle,
    readWorkbookBundleHead,
    reconcileStoredWorkbookFiles,
    seedConnectionCatalogs,
    writeWorkbookBundle,
    type WorkbookBundle,
} from './workbook_bundle.js';
import type { Logger } from '../platform/logger/logger.js';
import { NativeFolder, OverlayFolder } from './migration/migration_folder.js';
import { migrateWorkbookFolder } from './migration/workbook_migration.js';

const LOG_CTX = 'composite_storage_backend';

export interface WorkbookImportConflict {
    /// The registry key, preserving its registered spelling/casing.
    workbookId: string;
    location: WorkbookLocation;
}

export interface PreparedNativeWorkbook {
    bundle: WorkbookBundle;
    dir: string;
}

/// A storage backend that routes by per-workbook location.
///
/// The OPFS workbook tree is the single registry of *every* workbook; registry-level operations
/// (listing workbooks, app settings, clear-all) therefore always go to OPFS. Per-workbook operations
/// are routed by the workbook UUID to whichever backend physically holds that workbook's files:
///   - OPFS workbooks -> the shared OPFS backend (`workbooks/<uuid>/…`).
///   - Native workbooks -> a per-workbook `NativeStorageBackend` bound to the recorded directory.
///
/// Native filesystem scope is re-granted lazily (and idempotently) the first time a native workbook
/// is touched. The compatibility scope hook is currently a no-op under Electron.
export class CompositeStorageBackend implements WorkbookRegistryBackend {
    /// The OPFS backend, which owns the workbook registry
    private readonly opfs: WorkbookRegistryBackend;
    /// uuid -> physical location, built from the workbook tree at init and kept in sync on writes
    private readonly locations: Map<string, WorkbookLocation>;
    /// The workbook tree, loaded at init and kept in sync on writes
    private tree: WorkbookTreeFolder = emptyWorkbookTree();
    /// Cached per-workbook native backends, keyed by uuid
    private readonly nativeCache: Map<string, NativeStorageBackend>;
    /// The stamps of the native attachments that are mirrored into OPFS, keyed by workbook uuid
    private readonly mirroredAttachments: Map<string, Map<string, FileStamp>>;
    /// The logger
    private readonly logger: Logger;

    constructor(opfs: WorkbookRegistryBackend, logger: Logger) {
        this.opfs = opfs;
        this.locations = new Map();
        this.nativeCache = new Map();
        this.mirroredAttachments = new Map();
        this.logger = logger;
    }

    getBackendType(): StorageBackendType {
        return StorageBackendType.OPFS;
    }

    async initialize(): Promise<void> {
        await this.opfs.initialize?.();
        await this.refreshLocations();
    }

    /// Rebuild the workbook tree and the uuid -> location map from the OPFS workbook tree.
    ///
    /// Called at init (and after relocate, before reload re-runs init).
    async refreshLocations(): Promise<void> {
        this.tree = await this.opfs.loadWorkbookTree();
        this.locations.clear();
        for (const entry of flattenWorkbookTree(this.tree)) {
            this.locations.set(entry.path, locationFromEntry(entry));
        }
    }

    /// Reload the workbook tree after a change of its folders
    private async refreshTree(): Promise<void> {
        this.tree = await this.opfs.loadWorkbookTree();
    }

    /// The current known location for a workbook (defaulting to OPFS for unknown UUIDs).
    private locationOf(workbookId: string): WorkbookLocation {
        return this.locations.get(workbookId) ?? { type: StorageBackendType.OPFS };
    }

    /// Resolve the backend that physically holds a workbook's files.
    private async backendFor(workbookId: string): Promise<StorageBackend> {
        return this.nativeWorkbookFolder(workbookId) ?? this.opfs;
    }

    /// The backend of a workbook that lives in a native folder, null for other workbooks
    nativeWorkbookFolder(workbookId: string): NativeStorageBackend | null {
        const loc = this.locationOf(workbookId);
        if (loc.type !== StorageBackendType.Native || !loc.nativePath) {
            return null;
        }
        let native = this.nativeCache.get(workbookId);
        if (!native) {
            native = new NativeStorageBackend(loc.nativePath);
            this.nativeCache.set(workbookId, native);
        }
        return native;
    }

    // ---- Registry-level operations (always OPFS) ----------------------------------------------

    listWorkbooks(): Promise<WorkbookEntry[]> {
        return this.opfs.listWorkbooks();
    }
    loadWorkbookTree(): Promise<WorkbookTreeFolder> {
        return this.opfs.loadWorkbookTree();
    }
    loadAppSettings(): Promise<AppSettings | null> {
        return this.opfs.loadAppSettings();
    }
    saveAppSettings(settings: AppSettings): Promise<void> {
        return this.opfs.saveAppSettings(settings);
    }
    loadManifest(): Promise<StorageManifest> {
        return this.opfs.loadManifest();
    }
    updateConnections(update: (connections: ConnectionEntry[] | undefined) => ConnectionEntry[] | null): Promise<void> {
        return this.opfs.updateConnections(update);
    }
    loadConnectionFile(connectionId: string, fileName: string): Promise<string | null> {
        return this.opfs.loadConnectionFile(connectionId, fileName);
    }
    saveConnectionFile(connectionId: string, fileName: string, text: string): Promise<void> {
        return this.opfs.saveConnectionFile(connectionId, fileName, text);
    }
    createConnectionFolder(connectionId: string): Promise<void> {
        return this.opfs.createConnectionFolder(connectionId);
    }
    deleteConnectionFiles(connectionId: string): Promise<void> {
        return this.opfs.deleteConnectionFiles(connectionId);
    }

    async upsertWorkbookEntry(entry: WorkbookEntry, folderPath: readonly string[] = []): Promise<void> {
        await this.opfs.upsertWorkbookEntry(entry, folderPath);
        this.locations.set(entry.path, locationFromEntry(entry));
        this.tree = upsertWorkbookInTree(this.tree, entry, folderPath);
    }
    async removeWorkbookEntry(workbookId: string): Promise<void> {
        await this.opfs.removeWorkbookEntry(workbookId);
        this.forgetWorkbook(workbookId);
    }
    async moveWorkbook(workbookId: string, folderPath: string[], index: number): Promise<void> {
        await this.opfs.moveWorkbook(workbookId, folderPath, index);
        await this.refreshTree();
    }
    async createFolder(path: string[]): Promise<void> {
        await this.opfs.createFolder(path);
        await this.refreshTree();
    }
    async moveFolder(path: string[], parentPath: string[], name?: string): Promise<void> {
        await this.opfs.moveFolder(path, parentPath, name);
        await this.refreshTree();
    }
    async deleteFolder(path: string[]): Promise<void> {
        await this.opfs.deleteFolder(path);
        await this.refreshTree();
    }

    /// Drop the in-memory state of a workbook that is no longer registered
    private forgetWorkbook(workbookId: string): void {
        this.locations.delete(workbookId);
        this.nativeCache.delete(workbookId);
        this.mirroredAttachments.delete(workbookId);
        this.tree = removeWorkbookFromTree(this.tree, workbookId);
    }

    /// The workbook tree, the folders and workbooks of the sidebar
    getWorkbookTree(): WorkbookTreeFolder {
        return this.tree;
    }

    /// The user-facing workbook order (the order of the workbook tree), as workbook UUIDs.
    /// Workbooks that are routed but not yet in the tree come last.
    getWorkbookOrder(): string[] {
        const order = flattenWorkbookTree(this.tree).map(entry => entry.path);
        const listed = new Set(order);
        for (const id of this.locations.keys()) {
            if (!listed.has(id)) order.push(id);
        }
        return order;
    }
    deleteWorkbookFiles(workbookId: string): Promise<void> {
        return this.backendFor(workbookId).then(b => {
            if (b === this.opfs) {
                return this.opfs.deleteWorkbookFiles(workbookId);
            }
            // For native workbooks, the directory *is* the workbook.
            return b.deleteWorkbook(workbookId);
        });
    }

    // ---- Per-workbook operations (routed by uuid) ----------------------------------------------

    async loadWorkbook(workbookId: string): Promise<WorkbookData> {
        const backend = await this.backendFor(workbookId);
        const workbook = await backend.loadWorkbook(workbookId);
        await this.syncNativeAttachments(workbookId);
        return workbook;
    }

    /// Mirror the attachments of a native workbook into OPFS, HyperDB-WASM reads them from there.
    /// A file is copied when its stamp differs from the one it was mirrored with, so the first sync of
    /// a workbook in an app run copies every attachment and later syncs copy only the changed ones.
    private async syncNativeAttachments(workbookId: string): Promise<void> {
        const native = this.nativeWorkbookFolder(workbookId);
        if (native == null) {
            return;
        }
        const files = (await native.stampFolder()).attachments;
        let mirrored = this.mirroredAttachments.get(workbookId);
        if (mirrored === undefined) {
            mirrored = new Map();
            this.mirroredAttachments.set(workbookId, mirrored);
        }
        const names = new Set<string>();
        for (const file of files) {
            validateDataFileName(file.name);
            names.add(file.name);
            const stamp = mirrored.get(file.name);
            if (stamp !== undefined && stamp.size === file.size && stamp.mtimeMs === file.mtimeMs) {
                continue;
            }
            // Forget the stamp first, a failed copy is retried by the next sync
            mirrored.delete(file.name);
            await this.opfs.saveDataFile(workbookId, file.name, await native.loadDataFile(workbookId, file.name));
            mirrored.set(file.name, { size: file.size, mtimeMs: file.mtimeMs });
        }
        for (const file of await this.opfs.listDataFiles(workbookId)) {
            if (!names.has(file.name)) {
                await this.opfs.deleteDataFile(workbookId, file.name);
                mirrored.delete(file.name);
            }
        }
    }

    async saveWorkbookManifest(workbookId: string, data: WorkbookData): Promise<void> {
        const backend = await this.backendFor(workbookId);
        await backend.saveWorkbookManifest(workbookId, data);
        const loc = this.locationOf(workbookId);
        if (loc.type === StorageBackendType.Native && loc.nativePath) {
            // The native backend does not touch the registry, so keep its OPFS entry in sync here.
            await this.opfs.upsertWorkbookEntry({
                path: workbookId,
                storageType: StorageBackendType.Native,
                nativePath: loc.nativePath,
            });
        } else {
            // The OPFS backend registered the workbook, a new one at the end of the root. Mirror that in
            // memory so getWorkbookOrder() includes it immediately, before the next app initialization.
            this.locations.set(workbookId, loc);
            this.tree = upsertWorkbookInTree(this.tree, { path: workbookId, storageType: StorageBackendType.OPFS });
        }
    }

    async deleteWorkbook(workbookId: string): Promise<void> {
        const loc = this.locationOf(workbookId);
        if (loc.type === StorageBackendType.Native) {
            // Native: the files live in a user-owned folder on disk, so we never delete them —
            // deleting just unregisters the workbook by dropping the registry entry kept in OPFS.
            //
            // We deliberately do NOT route through `backendFor` here. The native backend's
            // `deleteWorkbook` is a no-op, but resolving it would `initialize()` the directory, which
            // re-creates it via `mkdir`. For a workbook whose folder was moved/deleted on disk (the
            // exact case that makes it deletable-because-invalid) that would either resurrect an empty
            // folder or throw before we ever dropped the stale registry entry — leaving it to error
            // again on the next launch. Dropping the entry is all that's needed and can't fail on a
            // missing folder.
            await this.opfs.removeWorkbookEntry(workbookId);
            // Native files remain user-owned, but their OPFS attachment mirror belongs to DashQL.
            await this.opfs.deleteWorkbookFiles(workbookId);
        } else {
            // OPFS deletes files and removes the registry entry in one step.
            await this.opfs.deleteWorkbook(workbookId);
        }
        this.forgetWorkbook(workbookId);
    }

    async loadScripts(workbookId: string): Promise<ScriptData[]> {
        return (await this.backendFor(workbookId)).loadScripts(workbookId);
    }
    async loadScript(workbookId: string, scriptName: string): Promise<ScriptData> {
        return (await this.backendFor(workbookId)).loadScript(workbookId, scriptName);
    }
    async saveScript(workbookId: string, scriptName: string, sql: string): Promise<void> {
        return (await this.backendFor(workbookId)).saveScript(workbookId, scriptName, sql);
    }
    async deleteScript(workbookId: string, scriptName: string): Promise<void> {
        return (await this.backendFor(workbookId)).deleteScript(workbookId, scriptName);
    }
    async renameScript(workbookId: string, oldScriptName: string, newScriptName: string): Promise<void> {
        return (await this.backendFor(workbookId)).renameScript(workbookId, oldScriptName, newScriptName);
    }
    async listDataFiles(workbookId: string): Promise<DataFile[]> {
        return (await this.backendFor(workbookId)).listDataFiles(workbookId);
    }
    async loadDataFile(workbookId: string, name: string): Promise<Uint8Array> {
        return (await this.backendFor(workbookId)).loadDataFile(workbookId, name);
    }
    async saveDataFile(workbookId: string, name: string, content: DataFileContent): Promise<void> {
        const backend = await this.backendFor(workbookId);
        await backend.saveDataFile(workbookId, name, content);
        await this.syncNativeAttachments(workbookId);
    }
    async deleteDataFile(workbookId: string, name: string): Promise<void> {
        const backend = await this.backendFor(workbookId);
        await backend.deleteDataFile(workbookId, name);
        await this.syncNativeAttachments(workbookId);
    }
    async renameDataFile(workbookId: string, oldName: string, newName: string): Promise<void> {
        const backend = await this.backendFor(workbookId);
        await backend.renameDataFile(workbookId, oldName, newName);
        await this.syncNativeAttachments(workbookId);
    }
    async clearAllStorage(): Promise<void> {
        // Only the OPFS root is wiped (registry + OPFS-backed workbooks). Native workbooks live in
        // user-owned folders on disk that we never delete; they're simply unregistered when the
        // OPFS workbook tree is removed. We drop the in-memory location/backend caches to match.
        this.nativeCache.clear();
        this.mirroredAttachments.clear();
        this.locations.clear();
        this.tree = emptyWorkbookTree();
        await this.opfs.clearAllStorage?.();
    }

    /// The recorded location for a workbook (used by the UI to render a display path).
    getWorkbookLocation(workbookId: string): WorkbookLocation {
        return this.locationOf(workbookId);
    }

    /// Find a registered UUID collision without attempting to read the workbook itself.
    ///
    /// The workbook tree is authoritative, including entries whose files or metadata are invalid.
    /// UUID comparison is case-insensitive, but the returned id preserves the actual registry key.
    async findWorkbookImportConflict(workbookId: string): Promise<WorkbookImportConflict | null> {
        const normalizedId = workbookId.toLowerCase();
        const entries = await this.opfs.listWorkbooks();
        const entry = entries.find(candidate => candidate.path.toLowerCase() === normalizedId);
        return entry == null
            ? null
            : { workbookId: entry.path, location: locationFromEntry(entry) };
    }

    /// Read and validate a selected native folder without creating or modifying anything in it.
    ///
    /// A folder of an older version is migrated in memory, the folder itself is migrated once it is
    /// registered.
    async prepareNativeWorkbook(dir: string): Promise<PreparedNativeWorkbook> {
        const head = await readWorkbookBundleHead(new OverlayFolder(new NativeFolder(dir)), `Invalid workbook folder ${dir}`);

        let bundle: WorkbookBundle;
        try {
            // Native reads do not require initialize(); avoiding it keeps a missing selected folder
            // from being created as a side effect of validation.
            const native = new NativeStorageBackend(dir);
            const scripts = await native.loadScripts(dir);
            const data = await Promise.all((await native.listDataFiles(dir))
                .map(async file => ({ name: file.name, bytes: await native.loadDataFile(dir, file.name) })));
            bundle = assembleWorkbookBundle(head, scripts, data);
        } catch (error) {
            throw new Error(`Failed to read workbook in ${dir}: ${(error as Error)?.message ?? String(error)}`);
        }
        return { bundle, dir };
    }

    /// Read durable data from the physical location currently registered for a workbook.
    readWorkbookBundle(workbookId: string): Promise<WorkbookBundle> {
        return readWorkbookBundle(workbookId, this);
    }

    /// Read durable data explicitly from OPFS, bypassing composite location routing.
    readPortableWorkbookBundle(workbookId: string): Promise<WorkbookBundle> {
        return readWorkbookBundle(workbookId, this.opfs);
    }

    /// Write a complete bundle explicitly to OPFS, bypassing a current native route.
    ///
    /// `targetIsFresh` enables writeWorkbookBundle's whole-workbook rollback. The in-memory route is
    /// changed only after every durable write succeeds.
    async writePortableWorkbookBundle(
        bundle: WorkbookBundle,
        targetWorkbookId: string,
        targetIsFresh: boolean,
    ): Promise<void> {
        await writeWorkbookBundle(bundle, this.opfs, { targetWorkbookId, targetIsFresh });
        this.setLocationAfterPortableWrite(targetWorkbookId);
        this.nativeCache.delete(targetWorkbookId);
    }

    private setLocationAfterPortableWrite(workbookId: string): void {
        // Preserve the registry key when the source UUID differs only by case, the tree keeps its place
        const registeredId = [...this.locations.keys()]
            .find(candidate => candidate.toLowerCase() === workbookId.toLowerCase()) ?? workbookId;
        this.locations.set(registeredId, { type: StorageBackendType.OPFS });
        this.tree = upsertWorkbookInTree(this.tree, { path: registeredId, storageType: StorageBackendType.OPFS });
    }

    /// Delete the complete OPFS workbook directory (durable files and derived cache), preserving its
    /// registry entry and any native folder registered under the same UUID.
    deletePortableWorkbookFiles(workbookId: string): Promise<void> {
        return this.opfs.deleteWorkbookFiles(workbookId);
    }

    /// Delete an OPFS workbook directory and registry entry. Used for fresh staging UUID cleanup.
    async deletePortableWorkbook(workbookId: string): Promise<void> {
        await this.opfs.deleteWorkbook(workbookId);
        this.forgetWorkbook(workbookId);
    }

    /// Register an already-prepared native folder and reconcile its file lists with its files.
    async registerPreparedNativeWorkbook(prepared: PreparedNativeWorkbook, workbookId: string): Promise<void> {
        const validation = validateWorkbookData(prepared.bundle.workbook);
        if (!validation.ok) {
            throw new Error(`Workbook in ${prepared.dir} is invalid: ${describeWorkbookValidationError(validation.error)}`);
        }
        // The catalogs of the folder seed the connections that are new to the app. The app ignores
        // them afterwards, and the migration removes the catalog copy of older folders.
        await seedConnectionCatalogs(this.opfs, prepared.bundle, workbookId);
        await migrateWorkbookFolder(new NativeFolder(prepared.dir));
        const native = new NativeStorageBackend(prepared.dir);
        await reconcileStoredWorkbookFiles(native, workbookId);
        await this.upsertWorkbookEntry({
            path: workbookId,
            storageType: StorageBackendType.Native,
            nativePath: prepared.dir,
        });
        this.nativeCache.set(workbookId, native);
    }

    /// Relocate a single OPFS workbook's files into a native directory.
    ///
    /// The registry entry stays in OPFS; only the files move. Steps:
    ///   1. Grant scope for, and initialize, the target directory.
    ///   2. Copy the workbook's files OPFS -> native (UUID preserved).
    ///   3. Verify the copy; on failure throw without touching OPFS.
    ///   4. Flip the OPFS registry entry to `location=native, nativePath=dir` and persist the
    ///      workbook manifest's `storageType`/`nativePath`.
    ///   5. Delete the OPFS copy of the workbook's files (NOT the registry entry).
    ///
    /// On any failure before step 4 the OPFS copy is left fully intact, so the caller can recover.
    async relocateWorkbookToNative(uuid: string, dir: string): Promise<void> {
        if (this.locationOf(uuid).type !== StorageBackendType.OPFS) {
            throw new Error(`Workbook ${uuid} is not an OPFS workbook`);
        }

        const native = new NativeStorageBackend(dir);
        await native.initialize();

        // 2. Copy. Stamp the workbook manifest with its new physical location as we write it.
        const workbookData = await this.opfs.loadWorkbook(uuid);
        await copyWorkbook(uuid, this.opfs, native, this.logger);
        await native.saveWorkbookManifest(uuid, {
            ...workbookData,
            storageType: StorageBackendType.Native,
            nativePath: dir,
        });

        // 3. Verify before we touch OPFS.
        const ok = await verifyWorkbook(uuid, this.opfs, native);
        if (!ok) {
            throw new Error(`Relocation verification failed for workbook ${uuid} - keeping OPFS copy`);
        }

        // 4. Flip the registry entry + cache the new location/backend.
        await this.opfs.upsertWorkbookEntry({
            path: uuid,
            storageType: StorageBackendType.Native,
            nativePath: dir,
        });
        this.locations.set(uuid, { type: StorageBackendType.Native, nativePath: dir });
        this.tree = upsertWorkbookInTree(this.tree, { path: uuid, storageType: StorageBackendType.Native, nativePath: dir });
        this.nativeCache.set(uuid, native);

        // 5. Now it's safe to drop the OPFS copy of the files (registry entry stays).
        await this.opfs.deleteWorkbookFiles(uuid);
        this.logger.info('relocated workbook to native storage', { workbookId: uuid, dir }, LOG_CTX);
    }

    /// Load a pre-existing native workbook directory into the registry.
    ///
    /// Unlike `relocateWorkbookToNative`, this copies nothing: the directory already holds a complete
    /// workbook written by a previous run (or another machine). We simply read its workbook manifest,
    /// validate the metadata up front (the same fail-fast gate the loader uses), and record a
    /// `location=native` entry in the OPFS workbook tree so the next restore picks it up.
    ///
    /// Returns the loaded workbook's UUID. Throws if the directory holds no readable workbook, the
    /// metadata is invalid, or a workbook with the same UUID is already registered (we never silently
    /// overwrite an existing entry — the caller surfaces the error).
    async loadNativeWorkbook(dir: string): Promise<string> {
        const prepared = await this.prepareNativeWorkbook(dir);
        const uuid = prepared.bundle.workbook.workbookId;

        // Never clobber a workbook that's already registered (same folder added twice, or a UUID
        // collision with an existing OPFS/native workbook).
        if (await this.findWorkbookImportConflict(uuid)) {
            throw new Error(`Workbook ${uuid} is already registered`);
        }

        await this.registerPreparedNativeWorkbook(prepared, uuid);

        this.logger.info('loaded native workbook', { workbookId: uuid, dir }, LOG_CTX);
        return uuid;
    }
}
