import type * as core from '../../core/index.js';

import { stringifyError } from '../../platform/platform/logger/logger.js';
import type { ConnectionEntry, StorageBackend, WorkbookData, WorkbookEntry, WorkbookRegistryBackend } from '../../platform/storage/storage_backend.js';
import { isWorkbookRegistryBackend } from '../../platform/storage/storage_backend.js';
import { NativeStorageBackend } from '../../platform/storage/native_storage_backend.js';
import { markWorkbookAttachmentsChanged } from '../../platform/workbook/attachments/attachment_mounts.js';

/// The storage of the runtime: `storage` of the platform of the module over a storage backend, and the commands of the
/// storage writer of the runtime (`packages/dashql-core-runtime/src/storage`, docs/design/dashql_runtime.md). The
/// writer decides what to write and when: the keys and their chains, debouncing, coalescing, pausing, flushing and the
/// statistics. The workbooks and the connections of the runtime write through it.

/// The key of a write. Writes with the same key coalesce, the latest task wins. The keys are built by the module
/// (`storage/keys.rs` of the core runtime), a task names its own key.
export type StorageWriteKey = string;

/// Why the writes of the writer or of a workbook are held
export type StorageHoldReason = core.StorageHoldReason;

/// The outcome of a write
export type StorageWriteResult =
    /// The task was executed (a task may still skip writing content that is already persisted)
    | { status: 'written' }
    /// A newer task with the same key replaced the task before it was executed
    | { status: 'superseded' }
    /// The task was discarded before it was executed
    | { status: 'cancelled' }
    /// The writer or the workbook is paused, the task stays pending and is executed on resume
    | { status: 'deferred' }
    /// Executing the task failed
    | { status: 'failed'; error: unknown };

/// The statistics of the writes of a key, with the key within its workbook for display
export interface StorageKeyStatistics {
    key: StorageWriteKey;
    /// The key without the prefix of its workbook, e.g. `scripts/a.sql:delete`
    label: string;
    stats: StorageWriterStatistics;
}

/// The statistics of the writes of a key
export interface StorageWriterStatistics {
    /// The number of writes we scheduled
    totalScheduledWrites: number;
    /// The number of writes we performed
    totalWrites: number;
    /// The number of bytes written in total to storage
    totalWrittenBytes: number;
    /// The accumulated time spent writing
    totalWriteTime: number;
    /// The last write
    lastWrite: Date | null;
}

/// A workbook whose files are not available, e.g. a native folder that was moved or deleted
export class WorkbookUnavailableError extends Error {
    /// The workbook id
    readonly workbookId: string;

    constructor(workbookId: string, cause: unknown) {
        super(`workbook ${workbookId} is not available: ${stringifyError(cause)}`);
        this.name = 'WorkbookUnavailableError';
        this.workbookId = workbookId;
    }
}

/// The outcome of a write of the runtime as the callers know it
export function writeResultOf(outcome: core.StorageWriteOutcome): StorageWriteResult {
    if (outcome.status !== 'failed') return { status: outcome.status };
    const error = outcome.unavailableWorkbook != null ? new WorkbookUnavailableError(outcome.unavailableWorkbook, outcome.error) : outcome.error;
    return { status: 'failed', error };
}

/// A storage that registers native workbook folders in place, the storage of the desktop app
export interface NativeWorkbookRegistry {
    /// Register a native workbook folder under an id: add it to the workbook tree. The catalogs of the folder were
    /// seeded before, the runtime migrates the folder and reconciles its file lists with its files after.
    registerNativeWorkbook(dir: string, workbookId: string): Promise<void>;
    /// The folder of a workbook that lives in a native folder, null for other workbooks
    nativeWorkbookFolder(workbookId: string): NativeStorageBackend | null;
}

/// `storage` of the platform over a storage backend: the reads and writes of the storage writer and of the restore
export function createRuntimeStorage(backend: StorageBackend): core.RuntimeStorage {
    const registry = (): WorkbookRegistryBackend => {
        if (!isWorkbookRegistryBackend(backend)) throw new Error('the storage backend does not own a workbook registry');
        return backend;
    };
    const owner = isWorkbookRegistryBackend(backend) ? backend : null;
    return {
        loadWorkbook: async workbookId => backend.loadWorkbook(workbookId),
        saveWorkbook: async (workbookId, workbook) => backend.saveWorkbookManifest(workbookId, workbook as WorkbookData),
        saveScript: async (workbookId, fileName, text) => backend.saveScript(workbookId, fileName, text),
        deleteScript: async (workbookId, fileName) => backend.deleteScript(workbookId, fileName),
        renameScript: async (workbookId, from, to) => backend.renameScript(workbookId, from, to),
        listAttachments: async workbookId => (await backend.listDataFiles(workbookId)).map(file => file.name.normalize('NFC')),
        updateConnections: async update => registry().updateConnections(connections => update(connections ?? null) as ConnectionEntry[] | null),
        saveConnectionFile: async (connectionId, fileName, text) => registry().saveConnectionFile(connectionId, fileName, text),
        deleteConnectionFiles: async connectionId => registry().deleteConnectionFiles(connectionId),
        deleteWorkbook: async workbookId => backend.deleteWorkbook(workbookId),
        ownsConnections: () => owner != null,
        listWorkbooks: async () => (await backend.listWorkbooks()).map(entry => entry.path),
        loadManifestConnections: async () => (await owner?.loadManifest())?.connections ?? null,
        loadScripts: async workbookId => (await backend.loadScripts(workbookId)).map(script => ({ name: script.name, sql: script.sql })),
        listDataFiles: async workbookId => backend.listDataFiles(workbookId),
        loadConnectionFile: async (connectionId, fileName) => owner == null ? null : owner.loadConnectionFile(connectionId, fileName),
        loadDataFile: async (workbookId, name) => backend.loadDataFile(workbookId, name),
        saveDataFile: async (workbookId, name, file) => backend.saveDataFile(workbookId, name, file),
        findWorkbook: async workbookId => {
            // The workbook tree is authoritative, also for entries whose files or metadata are invalid. Ids compare
            // without their case, the entry keeps the spelling of the tree.
            const id = workbookId.toLowerCase();
            return (await backend.listWorkbooks()).find(entry => entry.path.toLowerCase() === id) ?? null;
        },
        upsertWorkbookEntry: async entry => registry().upsertWorkbookEntry(entry as WorkbookEntry),
        deleteWorkbookFiles: async workbookId => registry().deleteWorkbookFiles(workbookId),
        registerNativeWorkbook: async (dir, workbookId) => {
            const native = backend as Partial<NativeWorkbookRegistry>;
            if (typeof native.registerNativeWorkbook !== 'function') throw new Error('the storage registers no native workbook folders');
            await native.registerNativeWorkbook(dir, workbookId);
        },
        // A storage of a single folder is that folder, the storage of the desktop app keeps native workbooks in theirs
        workbookFolder: workbookId => backend instanceof NativeStorageBackend
            ? backend
            : (backend as Partial<NativeWorkbookRegistry>).nativeWorkbookFolder?.(workbookId) ?? null,
        attachmentsChanged: workbookId => markWorkbookAttachmentsChanged(workbookId),
    };
}

/// The commands of the storage writer of the runtime over the module. A flush or a settle of a destroyed runtime has
/// nothing to wait for.
export class StorageWriter {
    constructor(private readonly runtime: { readonly module: core.Runtime; readonly destroyed: boolean }) { }

    private get module(): core.Runtime {
        return this.runtime.module;
    }

    /// Run every pending write right away and wait until all writes ended. Writes past a hold of the writer, never past
    /// the hold of a workbook, e.g. a file that changed outside the app.
    async flush(): Promise<void> {
        if (this.runtime.destroyed) return;
        await this.module.storage({ kind: 'flush' });
    }

    /// Wait for the writes that started without running the pending ones
    async settle(): Promise<void> {
        if (this.runtime.destroyed) return;
        await this.module.storage({ kind: 'settle' });
    }

    /// Hold the writes of the writer, or of a workbook, for a reason. Holds are counted, each is released on its own.
    hold(reason: StorageHoldReason, workbookId: string | null = null): void {
        this.module.storageHold(reason, workbookId);
    }

    /// Release one hold of a reason, the pending writes wait for their debounce duration again once nothing holds them
    release(reason: StorageHoldReason, workbookId: string | null = null): void {
        this.module.storageRelease(reason, workbookId);
    }

    /// Write nothing until `resume` or `flush`, the writes stay pending
    pause(): void {
        this.hold('pause');
    }

    /// Release a pause of the writer
    resume(): void {
        this.release('pause');
    }

    /// Another tab took over the app: nothing is written any more, a flush still writes what is pending
    handOver(): void {
        this.hold('handover');
    }

    /// Accept writes of a workbook id again after the workbook was deleted, e.g. an import of the same workbook
    reviveWorkbook(workbookId: string): void {
        this.module.storageReviveWorkbook(workbookId);
    }

    /// Write the pending writes of a workbook and wait for them, resolves whether every write reached the storage. A
    /// held workbook keeps its writes pending.
    async flushWorkbook(workbookId: string): Promise<boolean> {
        return (await this.module.storage({ kind: 'flushWorkbook', workbookId })) === true;
    }

    /// Delete a workbook from the storage, its pending writes are discarded. Rejects with what the storage failed with.
    async deleteWorkbook(workbookId: string): Promise<void> {
        await this.module.storage({ kind: 'deleteWorkbook', workbookId });
    }

    /// Are the writes of a workbook held, e.g. after one of its files changed outside the app?
    isWorkbookHeld(workbookId: string): boolean {
        return this.module.isWorkbookHeld(workbookId);
    }

    /// The pending keys below a workbook in the order they were scheduled
    getPendingKeysForWorkbook(workbookId: string, include: (key: string) => boolean = () => true): string[] {
        return this.module.storagePendingKeys(workbookId).filter(include);
    }

    /// The pending keys in the order they were scheduled
    getPendingKeys(): string[] {
        return this.module.storagePendingKeys(null);
    }

    /// Discard pending writes of a workbook, e.g. after the user chose a version on disk over the edits of the app
    cancelPendingWritesForWorkbook(workbookId: string, include: (key: string) => boolean = () => true): void {
        this.module.storageCancelPendingWrites(workbookId, this.getPendingKeysForWorkbook(workbookId, include));
    }

    /// The latest generation of the keys of a workbook
    getWorkbookWriteGeneration(workbookId: string, include: (key: string) => boolean = () => true): number {
        let generation = 0;
        for (const [key, value] of this.module.storageWriteGenerations(workbookId)) {
            if (include(key)) generation = Math.max(generation, value);
        }
        return generation;
    }

    /// The statistics of the writes of a workbook by key, read when shown
    getStatistics(workbookId: string): StorageKeyStatistics[] {
        return this.module.storageStatistics(workbookId).map(({ key, label, statistics: value }) => ({
            key,
            label,
            stats: {
                totalScheduledWrites: value.scheduledWrites,
                totalWrites: value.writes,
                totalWrittenBytes: value.writtenBytes,
                totalWriteTime: value.writeTimeMs,
                lastWrite: value.lastWriteMs == null ? null : new Date(value.lastWriteMs),
            },
        }));
    }

    /// Schedule a debounced write that no state of the runtime describes under the key that the task names, resolves
    /// true when the task was executed
    async write(task: core.StorageWriteTask, debounceFor: number = 0): Promise<boolean> {
        const outcome = await this.module.storageWrite(null, task, debounceFor, false);
        return outcome.status === 'written';
    }

    /// Write right away and wait until the content is persisted. A paused writer or workbook defers it.
    async writeDurable(key: string, task: core.StorageWriteTask): Promise<StorageWriteResult> {
        return writeResultOf(await this.module.storageWrite(key, task, 0, true));
    }
}
