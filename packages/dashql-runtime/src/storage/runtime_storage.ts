import type * as core from '@ankoh/dashql-core';

import { stringifyError } from '../platform/logger/logger.js';
import type { ConnectionEntry, StorageBackend, WorkbookData, WorkbookEntry, WorkbookRegistryBackend } from './storage_backend.js';
import { STORAGE_SCRIPTS_FOLDER, STORAGE_WORKBOOK_FILE, isWorkbookRegistryBackend } from './storage_backend.js';

/// The storage of the runtime: `storage` of the platform of the module over a storage backend, and the commands of the
/// storage writer of the runtime (`packages/dashql-core-runtime/src/storage`, docs/wip/runtime_api.md). The writer
/// decides what to write and when: the keys and their chains, debouncing, coalescing, pausing, flushing and the
/// statistics. The workbooks and the connections of the runtime write through it.

/// How long a write of the host waits for the next change
export const DEBOUNCE_DURATION_WORKBOOK_WRITE = 100;

/// The key of a write. Writes with the same key coalesce, the latest task wins. Workbook keys start with the workbook
/// id, the keys of the app storage with `@`.
export type StorageWriteKey = string;
/// A script of a workbook
export const groupScriptWrites = (workbookId: string, fileName: string) => `${workbookId}/${STORAGE_SCRIPTS_FOLDER}/${fileName}`;
/// The attachment list of a workbook
export const groupWorkbookAttachmentListWrites = (workbookId: string) => `${workbookId}/${STORAGE_WORKBOOK_FILE}:attachments`;

/// Whether a key belongs to a workbook: the workbook id itself or a path below it
export function storageWriteKeyBelongsToWorkbook(key: StorageWriteKey, workbookId: string): boolean {
    return key === workbookId || key.startsWith(`${workbookId}/`);
}

/// A key without the prefix of its workbook for display, keeping a `:delete` or `:rename` suffix
export function storageWriteKeyWithinWorkbook(key: StorageWriteKey, workbookId: string): string {
    if (!storageWriteKeyBelongsToWorkbook(key, workbookId)) {
        return key;
    }
    return key === workbookId ? '' : key.slice(workbookId.length + 1);
}

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
    /// Register a native workbook folder under an id: migrate its top-level files, reconcile its file lists with its
    /// files and add it to the workbook tree. The catalogs of the folder were seeded before.
    registerNativeWorkbook(dir: string, workbookId: string): Promise<void>;
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
    };
}

/// What the writer of the storage asks of the runtime
export interface StorageWriterRuntime {
    /// The runtime of the module, null until the core is there
    readonly module: core.Runtime | null;
    /// The runtime of the module, the core is set up with the first call
    ready(): Promise<core.Runtime>;
}

/// The commands of the storage writer of the runtime. A write before the core waits for it, a flush or a settle
/// before the core has nothing to wait for.
export class StorageWriter {
    constructor(private readonly runtime: StorageWriterRuntime) { }

    private async command(command: core.StorageCommand): Promise<unknown> {
        const module = this.runtime.module ?? await this.runtime.ready();
        return await module.storage(command);
    }

    /// Run every pending write right away and wait until all writes ended, also while paused
    async flush(): Promise<void> {
        if (this.runtime.module == null) return;
        await this.command({ kind: 'flush' });
    }

    /// Wait for the writes that started without running the pending ones
    async settle(): Promise<void> {
        if (this.runtime.module == null) return;
        await this.command({ kind: 'settle' });
    }

    /// Write nothing until `resume` or `flush`, the writes stay pending
    pause(): void {
        void this.command({ kind: 'pause' });
    }

    /// Resume the writer, the pending writes wait for their debounce duration again
    resume(): void {
        void this.command({ kind: 'resume' });
    }

    /// Hold the writes of a workbook
    pauseWorkbook(workbookId: string): void {
        void this.command({ kind: 'pauseWorkbook', workbookId });
    }

    /// Resume the writes of a workbook
    resumeWorkbook(workbookId: string): void {
        void this.command({ kind: 'resumeWorkbook', workbookId });
    }

    /// Accept writes of a workbook id again after the workbook was deleted, e.g. an import of the same workbook
    reviveWorkbook(workbookId: string): void {
        void this.command({ kind: 'reviveWorkbook', workbookId });
    }

    /// Write the pending writes of a workbook and wait for them, resolves whether every write reached the storage. A
    /// held workbook keeps its writes pending.
    async flushWorkbook(workbookId: string): Promise<boolean> {
        return (await this.command({ kind: 'flushWorkbook', workbookId })) === true;
    }

    /// Delete a workbook from the storage, its pending writes are discarded. Rejects with what the storage failed with.
    async deleteWorkbook(workbookId: string): Promise<void> {
        await this.command({ kind: 'deleteWorkbook', workbookId });
    }

    /// Are the writes of a workbook held, e.g. after one of its scripts changed outside the app?
    isWorkbookPaused(workbookId: string): boolean {
        return this.runtime.module?.isWorkbookPaused(workbookId) ?? false;
    }

    /// The pending keys below a workbook in the order they were scheduled
    getPendingKeysForWorkbook(workbookId: string, include: (key: string) => boolean = () => true): string[] {
        return (this.runtime.module?.storagePendingKeys(workbookId) ?? []).filter(include);
    }

    /// The pending keys in the order they were scheduled
    getPendingKeys(): string[] {
        return this.runtime.module?.storagePendingKeys(null) ?? [];
    }

    /// Discard pending writes of a workbook, e.g. after the user chose a version on disk over the edits of the app
    cancelPendingWritesForWorkbook(workbookId: string, include: (key: string) => boolean = () => true): void {
        const keys = this.getPendingKeysForWorkbook(workbookId, include);
        void this.command({ kind: 'cancelPendingWrites', workbookId, keys });
    }

    /// The latest generation of the keys of a workbook
    getWorkbookWriteGeneration(workbookId: string, include: (key: string) => boolean = () => true): number {
        let generation = 0;
        for (const [key, value] of this.runtime.module?.storageWriteGenerations(workbookId) ?? []) {
            if (include(key)) generation = Math.max(generation, value);
        }
        return generation;
    }

    /// The statistics of the writes by key, read when shown
    getStatistics(): Map<StorageWriteKey, StorageWriterStatistics> {
        const statistics = new Map<StorageWriteKey, StorageWriterStatistics>();
        for (const [key, value] of this.runtime.module?.storageStatistics() ?? []) {
            statistics.set(key, {
                totalScheduledWrites: value.scheduledWrites,
                totalWrites: value.writes,
                totalWrittenBytes: value.writtenBytes,
                totalWriteTime: value.writeTimeMs,
                lastWrite: value.lastWriteMs == null ? null : new Date(value.lastWriteMs),
            });
        }
        return statistics;
    }

    /// Schedule a debounced write that no state of the runtime describes, resolves true when the task was executed
    async write(key: string, task: core.StorageWriteTask, debounceFor: number = 0): Promise<boolean> {
        const module = this.runtime.module ?? await this.runtime.ready();
        const outcome = await module.storageWrite(key, task, debounceFor, false);
        return outcome.status === 'written';
    }

    /// Write right away and wait until the content is persisted. A paused writer or workbook defers it.
    async writeDurable(key: string, task: core.StorageWriteTask): Promise<StorageWriteResult> {
        const module = this.runtime.module ?? await this.runtime.ready();
        return writeResultOf(await module.storageWrite(key, task, 0, true));
    }
}
