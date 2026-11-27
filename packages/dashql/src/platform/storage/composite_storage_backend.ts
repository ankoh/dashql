import type * as core from '../../core/index.js';
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
    type ExpectedStamp,
    StorageBackendType,
} from './storage_backend.js';
import {
    type WorkbookTreeChange,
    type WorkbookTreeFolder,
    applyWorkbookTreeChange,
    emptyWorkbookTree,
    flattenWorkbookTree,
    folderAt,
} from './workbook_tree.js';
import { type FileStamp } from '../electron_fs.js';
import { NativeStorageBackend } from './native_storage_backend.js';
import { type WorkbookLocation, locationFromEntry } from './workbook_locator.js';
import { copyWorkbook, verifyWorkbook } from './workbook_transfer.js';
import type { Logger } from '../logger/logger.js';
import { ELECTRON_FILE_SYSTEM } from '../electron_fs.js';

const LOG_CTX = 'composite_storage_backend';

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
    /// The listeners of the workbook tree, e.g. the sidebars
    private readonly treeListeners = new Set<() => void>();
    /// The changes of the workbook tree that are being written
    private pendingTreeChanges = 0;
    /// Counts the changes of the workbook tree, a read of the stored tree that a change overtook is dropped
    private treeRevision = 0;
    /// Cached per-workbook native backends, keyed by uuid
    private readonly nativeCache: Map<string, NativeStorageBackend>;
    /// The stamps of the native attachments that are mirrored into OPFS, keyed by workbook uuid
    private readonly mirroredAttachments: Map<string, Map<string, FileStamp>>;
    /// The logger
    private readonly logger: Logger;

    /// The core decides the names of attachments and how a change of the workbook tree changes it
    private readonly core: core.DashQL;

    constructor(core: core.DashQL, opfs: WorkbookRegistryBackend, logger: Logger) {
        this.core = core;
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
        const tree = await this.opfs.loadWorkbookTree();
        this.locations.clear();
        for (const entry of flattenWorkbookTree(tree)) {
            this.locations.set(entry.path, locationFromEntry(entry));
        }
        this.setTree(tree);
    }

    /// Show a workbook tree, the listeners are told
    private setTree(tree: WorkbookTreeFolder): void {
        if (tree === this.tree) return;
        this.tree = tree;
        for (const listener of this.treeListeners) listener();
    }

    /// Listen to the changes of the workbook tree, returns the function that stops listening
    subscribeWorkbookTree(listener: () => void): () => void {
        this.treeListeners.add(listener);
        return () => { this.treeListeners.delete(listener); };
    }

    /// Apply a change to the workbook tree in memory, after it was written. A reload of the stored tree that began
    /// before it doesn't replace it.
    private applyTreeChange(change: WorkbookTreeChange): void {
        this.treeRevision += 1;
        this.setTree(applyWorkbookTreeChange(this.core, this.tree, change));
    }

    /// Change the workbook tree: the tree that the change leads to shows right away if it is known, the write follows,
    /// and once no other change is being written the tree is read as it is stored. A failed write shows the stored tree
    /// again. A change that starts during the read keeps its tree, its own read follows. The promise settles like the
    /// write, a failed read is only logged.
    private async changeTree(write: () => Promise<void>, changed: WorkbookTreeFolder | null = null): Promise<void> {
        this.treeRevision += 1;
        if (changed != null) this.setTree(changed);
        this.pendingTreeChanges += 1;
        try {
            await write();
        } finally {
            this.pendingTreeChanges -= 1;
            // An earlier write would read the tree without the changes that are still being written
            if (this.pendingTreeChanges === 0) await this.reloadTree();
        }
    }

    /// Show the workbook tree as it is stored. A tree that changed while it was read is read again, unless a change is
    /// being written: that change reads it once it is written.
    private async reloadTree(): Promise<void> {
        for (;;) {
            const revision = this.treeRevision;
            let stored: WorkbookTreeFolder;
            try {
                stored = await this.opfs.loadWorkbookTree();
            } catch (error) {
                this.logger.warn('failed to read the workbook tree', { error: String(error) }, LOG_CTX);
                return;
            }
            if (this.pendingTreeChanges !== 0) return;
            if (this.treeRevision === revision) {
                this.setTree(stored);
                return;
            }
        }
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
            native = new NativeStorageBackend(loc.nativePath, ELECTRON_FILE_SYSTEM);
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
    deleteConnectionFiles(connectionId: string): Promise<void> {
        return this.opfs.deleteConnectionFiles(connectionId);
    }

    async upsertWorkbookEntry(entry: WorkbookEntry, folderPath: readonly string[] = []): Promise<void> {
        await this.opfs.upsertWorkbookEntry(entry, folderPath);
        this.locations.set(entry.path, locationFromEntry(entry));
        this.applyTreeChange({ kind: 'upsert', entry, folderPath });
    }
    async removeWorkbookEntry(workbookId: string): Promise<void> {
        await this.opfs.removeWorkbookEntry(workbookId);
        this.forgetWorkbook(workbookId);
    }
    /// Move a workbook to a position in a folder, the move shows right away. A move into a folder that is gone fails with
    /// its write.
    async moveWorkbook(workbookId: string, folderPath: string[], index: number): Promise<void> {
        const moved = folderAt(this.tree, folderPath) == null
            ? null
            : applyWorkbookTreeChange(this.core, this.tree, { kind: 'move', workbookId, folderPath, index });
        await this.changeTree(() => this.opfs.moveWorkbook(workbookId, folderPath, index), moved);
    }
    async createFolder(path: string[]): Promise<void> {
        await this.changeTree(() => this.opfs.createFolder(path));
    }
    async moveFolder(path: string[], parentPath: string[], name?: string): Promise<void> {
        await this.changeTree(() => this.opfs.moveFolder(path, parentPath, name));
    }
    async deleteFolder(path: string[]): Promise<void> {
        await this.changeTree(() => this.opfs.deleteFolder(path));
    }

    /// Drop the in-memory state of a workbook that is no longer registered
    private forgetWorkbook(workbookId: string): void {
        this.locations.delete(workbookId);
        this.nativeCache.delete(workbookId);
        this.mirroredAttachments.delete(workbookId);
        this.applyTreeChange({ kind: 'remove', workbookId });
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
            this.core.validateDataFileName(file.name);
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

    async saveWorkbookManifest(workbookId: string, data: WorkbookData, expected?: ExpectedStamp): Promise<FileStamp | null> {
        const backend = await this.backendFor(workbookId);
        const stamp = await backend.saveWorkbookManifest(workbookId, data, expected) ?? null;
        await this.registerSavedWorkbook(workbookId);
        return stamp;
    }

    async loadGitignore(workbookId: string): Promise<string | null> {
        const backend = await this.backendFor(workbookId);
        return await backend.loadGitignore?.(workbookId) ?? null;
    }

    async saveGitignore(workbookId: string, text: string): Promise<void> {
        await (await this.backendFor(workbookId)).saveGitignore?.(workbookId, text);
    }

    /// Keep the registry entry of a workbook whose workbook file was written in sync
    private async registerSavedWorkbook(workbookId: string): Promise<void> {
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
            this.applyTreeChange({ kind: 'upsert', entry: { path: workbookId, storageType: StorageBackendType.OPFS } });
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
    async saveScript(workbookId: string, scriptName: string, sql: string, expected?: ExpectedStamp): Promise<FileStamp | null> {
        return await (await this.backendFor(workbookId)).saveScript(workbookId, scriptName, sql, expected) ?? null;
    }
    async deleteScript(workbookId: string, scriptName: string, expected?: ExpectedStamp): Promise<void> {
        return (await this.backendFor(workbookId)).deleteScript(workbookId, scriptName, expected);
    }
    async renameScript(workbookId: string, oldScriptName: string, newScriptName: string, expectedFrom?: ExpectedStamp, expectedTo?: ExpectedStamp): Promise<void> {
        return (await this.backendFor(workbookId)).renameScript(workbookId, oldScriptName, newScriptName, expectedFrom, expectedTo);
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
        this.treeRevision += 1;
        this.setTree(emptyWorkbookTree());
        await this.opfs.clearAllStorage?.();
    }

    /// The recorded location for a workbook (used by the UI to render a display path).
    getWorkbookLocation(workbookId: string): WorkbookLocation {
        return this.locationOf(workbookId);
    }

    /// Register a native workbook folder in place under an id (`NativeWorkbookRegistry` of the runtime). The runtime
    /// validated the folder and seeded the catalogs of its connections before, and migrates the folder of an older
    /// version and reconciles the file lists of its workbook file with its files after. A workbook of the origin private
    /// file system that the folder replaces loses its files once the folder is registered, the stored results of its
    /// scripts stay: the results of a native workbook live in the origin private file system (`workbook_results.md`).
    async registerNativeWorkbook(dir: string, workbookId: string): Promise<void> {
        const replaced = this.locations.get(workbookId);
        const native = new NativeStorageBackend(dir, ELECTRON_FILE_SYSTEM);
        await this.upsertWorkbookEntry({
            path: workbookId,
            storageType: StorageBackendType.Native,
            nativePath: dir,
        });
        this.nativeCache.set(workbookId, native);
        if (replaced?.type === StorageBackendType.OPFS) {
            await this.opfs.deleteWorkbookFiles(workbookId, { keepResults: true });
        }
    }

    /// A native workbook folder as the runtime reads it for an import. The folder is only read: a folder of an older
    /// version is migrated in memory and a missing folder is not created.
    importFolder(dir: string): core.RuntimeImportFolder {
        // Native reads do not require initialize(), which would create a missing folder
        const native = new NativeStorageBackend(dir, ELECTRON_FILE_SYSTEM);
        const failed = (error: unknown) => new Error(`Failed to read workbook in ${dir}: ${(error as Error)?.message ?? String(error)}`);
        return {
            errorPrefix: `Invalid workbook folder ${dir}`,
            nativePath: dir,
            readText: path => native.readText(path),
            scripts: async () => {
                try {
                    return (await native.loadScripts(dir)).map(script => ({ name: script.name, sql: script.sql }));
                } catch (error) {
                    throw failed(error);
                }
            },
            attachments: async () => {
                try {
                    return await Promise.all((await native.listDataFiles(dir))
                        .map(async file => ({ name: file.name, file: await native.loadDataFile(dir, file.name) })));
                } catch (error) {
                    throw failed(error);
                }
            },
        };
    }

    /// Relocate a single OPFS workbook's files into a native directory.
    ///
    /// The registry entry stays in OPFS; only the files move. Steps:
    ///   1. Grant scope for, and initialize, the target directory.
    ///   2. Copy the workbook's files OPFS -> native (UUID preserved).
    ///   3. Verify the copy; on failure throw without touching OPFS.
    ///   4. Flip the OPFS registry entry to `location=native, nativePath=dir` and persist the
    ///      workbook manifest's `storageType`/`nativePath`.
    ///   5. Delete the OPFS copy of the workbook's files (NOT the registry entry). The stored results of its scripts
    ///      stay, the results of a native workbook live in OPFS (`workbook_results.md`).
    ///
    /// On any failure before step 4 the OPFS copy is left fully intact, so the caller can recover.
    async relocateWorkbookToNative(uuid: string, dir: string): Promise<void> {
        if (this.locationOf(uuid).type !== StorageBackendType.OPFS) {
            throw new Error(`Workbook ${uuid} is not an OPFS workbook`);
        }

        const native = new NativeStorageBackend(dir, ELECTRON_FILE_SYSTEM);
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
        this.applyTreeChange({ kind: 'upsert', entry: { path: uuid, storageType: StorageBackendType.Native, nativePath: dir } });
        this.nativeCache.set(uuid, native);

        // 5. Now it's safe to drop the OPFS copy of the files (registry entry and results stay).
        await this.opfs.deleteWorkbookFiles(uuid, { keepResults: true });
        this.logger.info('relocated workbook to native storage', { workbookId: uuid, dir }, LOG_CTX);
    }
}
