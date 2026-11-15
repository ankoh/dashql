import { DashQL, Ptr } from './api.js';
import type * as glue from './wasm/dashql_core.js';

/// The storage writer of the Rust runtime (`packages/dashql-runtime-rs/src/storage`, see docs/wip/rust_runtime.md):
/// debounced writes of workbooks and connections. The writer decides what to write and when, the host does the I/O:
/// its methods return promises, the writer runs its tasks on the event loop. Workbooks cross as JSON text.

export type { StorageWriterHost } from './wasm/dashql_core.js';

const STORAGE_WRITER_TYPE = Symbol('STORAGE_WRITER_TYPE');

/// A text that is written, or how to read it when the write runs, null if there is nothing to write anymore
export type StorageWriteText = string | (() => string | null);

/// What a write does. Workbook files, connections and scripts are plain JSON values.
export type StorageWriteTask =
    /// Write the workbook file with the given copies of connections, the scripts, the name and the attachments on disk stay
    | { type: 'writeWorkbookManifest'; workbookId: string; connections: unknown[]; ephemeral: boolean }
    /// Patch the properties of the user into the workbook file, a write without `ephemeral` promotes the workbook and
    /// one without `cloud` removes the link to the cloud
    | { type: 'writeWorkbookProperties'; workbookId: string; name: string | null; ephemeral: boolean; cloud: unknown }
    /// Write a workbook as a whole, its scripts first and its workbook file last
    | {
        type: 'replaceWorkbookScripts';
        workbookId: string;
        name: string | null;
        scripts: { fileName: string; text: StorageWriteText }[];
        connection: unknown;
        originalFileName: string | null;
    }
    | { type: 'writeConnectionEntry'; entry: unknown }
    | { type: 'deleteConnectionEntry'; connectionId: string }
    | { type: 'writeConnectionFile'; connectionId: string; fileName: string; text: StorageWriteText }
    /// Patch the copies of a connection into an existing workbook file, the connections it replaced move to it
    | { type: 'patchWorkbookConnection'; workbookId: string; copy: unknown; replaced: string[] }
    | { type: 'writeScript'; workbookId: string; fileName: string; text: string }
    | { type: 'deleteScript'; workbookId: string; fileName: string }
    | { type: 'renameScript'; workbookId: string; from: string; to: string }
    /// Patch the script list and the copies of the connections it uses into the workbook file
    | { type: 'writeWorkbookScripts'; workbookId: string; scripts: unknown[]; connections: unknown[] }
    /// Patch the attachment list of the workbook file from the attachments on disk
    | { type: 'refreshWorkbookAttachments'; workbookId: string };

/// The outcome of a write. A failed write carries what the host failed with, a patch of a workbook file that is not
/// available names the workbook.
export type StorageWriteOutcome =
    | { status: 'written' | 'superseded' | 'cancelled' | 'deferred' }
    | { status: 'failed'; error: unknown; unavailableWorkbook?: string };

/// A task as JSON, the functions that read texts are passed next to it as `{ reader: <index> }`
function encodeTask(task: StorageWriteTask): [string, (() => string | null)[]] {
    const readers: (() => string | null)[] = [];
    const json = JSON.stringify(task, (_key, value: unknown) =>
        typeof value === 'function' ? { reader: readers.push(value as () => string | null) - 1 } : value);
    return [json, readers];
}

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
    public write(key: string, task: StorageWriteTask, debounceMs: number): Promise<StorageWriteOutcome> {
        const [json, readers] = encodeTask(task);
        return this.ptr.assertNotNull().write(key, json, readers, debounceMs);
    }

    /// Write right away, after the running tasks of the chain of the key. A paused writer or workbook defers it.
    public writeDurable(key: string, task: StorageWriteTask): Promise<StorageWriteOutcome> {
        const [json, readers] = encodeTask(task);
        return this.ptr.assertNotNull().writeDurable(key, json, readers);
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
    public writeGenerations(workbookId: string): [string, number][] {
        return JSON.parse(this.ptr.assertNotNull().writeGenerations(workbookId)) as [string, number][];
    }
}
