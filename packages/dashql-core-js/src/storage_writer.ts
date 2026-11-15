import { DashQL, Ptr } from './api.js';
import type * as glue from './wasm/dashql_core.js';

/// The storage writer of the Rust runtime (`packages/dashql-core-runtime/src/storage`, see docs/wip/core_runtime.md):
/// debounced writes of workbooks and connections. The writer decides what to write and when, the host does the I/O:
/// its methods return promises, the writer runs its tasks on the event loop. Workbooks cross as plain JSON values.

export type { StorageWriterHost } from './wasm/dashql_core.js';
/// The views of the storage writer, declared by the module (`packages/dashql-core-wasm/src/storage_writer/view.rs`)
export type {
    DeleteConnectionEntryTask,
    DeleteScriptTask,
    JsonValue,
    LogDetails,
    PatchWorkbookConnectionTask,
    RefreshWorkbookAttachmentsTask,
    RenameScriptTask,
    ReplacedScript,
    ReplaceWorkbookScriptsTask,
    StorageWriteGenerations,
    StorageWriteOutcome,
    StorageWriteStatistics,
    StorageWriteTask,
    StorageWriteText,
    WriteConnectionEntryTask,
    WriteConnectionFileTask,
    WriteScriptTask,
    WriteWorkbookManifestTask,
    WriteWorkbookPropertiesTask,
    WriteWorkbookScriptsTask,
} from './wasm/dashql_core.js';

const STORAGE_WRITER_TYPE = Symbol('STORAGE_WRITER_TYPE');

export class DashQLStorageWriter {
    public readonly ptr: Ptr<typeof STORAGE_WRITER_TYPE, glue.StorageWriter>;

    public constructor(ptr: Ptr<typeof STORAGE_WRITER_TYPE, glue.StorageWriter>) {
        this.ptr = ptr;
    }

    /// A writer on a host that writes workbook files of a format version
    public static create(api: DashQL, host: glue.StorageWriterHost, formatVersion: number): DashQLStorageWriter {
        return new DashQLStorageWriter(new Ptr(STORAGE_WRITER_TYPE, api, new api.bindings.StorageWriter(host, formatVersion)));
    }

    public destroy(): void {
        this.ptr.destroy();
    }

    /// Schedule a debounced write. A newer write with the same key replaces a pending task and keeps its timer.
    public write(key: string, task: glue.StorageWriteTask, debounceMs: number): Promise<glue.StorageWriteOutcome> {
        return this.ptr.assertNotNull().write(key, task, debounceMs);
    }

    /// Write right away, after the running tasks of the chain of the key. A paused writer or workbook defers it.
    public writeDurable(key: string, task: glue.StorageWriteTask): Promise<glue.StorageWriteOutcome> {
        return this.ptr.assertNotNull().writeDurable(key, task);
    }

    /// Run every pending task right away and wait until all tasks ran, also while paused
    public async flush(): Promise<void> {
        await this.ptr.assertNotNull().flush();
    }

    /// Write the pending tasks of a workbook right away, true when all of them reached the storage
    public async flushWorkbook(workbookId: string): Promise<boolean> {
        return (await this.ptr.assertNotNull().flushWorkbook(workbookId)) === true;
    }

    /// Wait for the tasks that run already
    public async settle(): Promise<void> {
        await this.ptr.assertNotNull().settle();
    }

    /// Delete a workbook, no write creates its files afterwards
    public async deleteWorkbook(workbookId: string): Promise<void> {
        await this.ptr.assertNotNull().deleteWorkbook(workbookId);
    }

    public pause(): void {
        this.ptr.assertNotNull().pause();
    }

    public resume(): void {
        this.ptr.assertNotNull().resume();
    }

    public pauseWorkbook(workbookId: string): void {
        this.ptr.assertNotNull().pauseWorkbook(workbookId);
    }

    public resumeWorkbook(workbookId: string): void {
        this.ptr.assertNotNull().resumeWorkbook(workbookId);
    }

    /// Accept the writes of a deleted workbook again
    public reviveWorkbook(workbookId: string): void {
        this.ptr.assertNotNull().reviveWorkbook(workbookId);
    }

    public isWorkbookPaused(workbookId: string): boolean {
        return this.ptr.assertNotNull().isWorkbookPaused(workbookId);
    }

    /// The pending keys of a workbook, or all of them, in the order they were scheduled
    public pendingKeys(workbookId?: string): string[] {
        return this.ptr.assertNotNull().pendingKeys(workbookId);
    }

    /// Discard pending writes, their callers learn that they were cancelled
    public cancelPendingWrites(keys: string[]): void {
        this.ptr.assertNotNull().cancelPendingWrites(keys);
    }

    public cancelPendingConnectionFileWrites(connectionId: string): void {
        this.ptr.assertNotNull().cancelPendingConnectionFileWrites(connectionId);
    }

    /// The latest generation of every key of a workbook, a scheduled write advances it
    public writeGenerations(workbookId: string): glue.StorageWriteGenerations {
        return this.ptr.assertNotNull().writeGenerations(workbookId);
    }
}
