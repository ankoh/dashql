import * as Immutable from 'immutable';

import { Logger, stringifyError } from '../platform/logger/logger.js';
import { VariantKind } from '../utils/variant.js';
import type { StorageBackend, WorkbookData, WorkbookMetadata as StorageWorkbookMetadata, WorkbookCloudLink, WorkbookConnection, ConnectionEntry, ConnectionParams, WorkbookRegistryBackend, WorkbookScript } from './storage_backend.js';
import { ExternalScriptChangeError, STORAGE_SCRIPTS_FOLDER, STORAGE_WORKBOOK_FILE, STORAGE_CONNECTIONS_FOLDER, isWorkbookRegistryBackend } from './storage_backend.js';
import { WORKBOOK_FORMAT_VERSION } from './migration/versions.js';
import { workbookAttachments, withWorkbookScripts } from './workbook_files.js';

const LOG_CTX = 'storage_writer';

/// Order-independent deep equality for plain JSON values (objects, arrays, primitives).
/// Workbook manifests are plain JSON (no Dates/Maps/functions), so this is sufficient.
function jsonDeepEqual(a: any, b: any): boolean {
    if (a === b) {
        return true;
    }
    if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
        return false;
    }
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
            return false;
        }
        return a.every((v, i) => jsonDeepEqual(v, b[i]));
    }
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) {
        return false;
    }
    return aKeys.every(k => Object.prototype.hasOwnProperty.call(b, k) && jsonDeepEqual(a[k], b[k]));
}

/// Compare the manifest fields the writer owns (formatVersion, workbookId, name, connections, scripts, attachments, metadata).
/// Other fields (storageType/nativePath/workbookPath) are display- or registry-only and are not
/// written into the workbook file, so they're deliberately ignored.
///
/// Both sides are round-tripped through JSON first so this compares exactly what would be
/// persisted: serialization drops `undefined`-valued keys, so a freshly built params object with
/// `{ foo: undefined }` must compare equal to the reloaded `{}` it serializes to.
function workbookManifestEquals(a: WorkbookData, b: WorkbookData): boolean {
    const project = (s: WorkbookData) => JSON.parse(JSON.stringify({
        formatVersion: s.formatVersion,
        workbookId: s.workbookId,
        name: s.name,
        connections: s.connections,
        scripts: s.scripts,
        attachments: s.attachments,
        metadata: s.metadata,
    }));
    return jsonDeepEqual(project(a), project(b));
}

export const DEBOUNCE_DURATION_WORKBOOK_WRITE = 100;
export const DEBOUNCE_DURATION_SCRIPT_WRITE = 100;

export const WRITE_WORKBOOK_MANIFEST = Symbol('WRITE_WORKBOOK_MANIFEST');
export const WRITE_WORKBOOK_PROPERTIES = Symbol('WRITE_WORKBOOK_PROPERTIES');

/// The workbook fields that are owned by the user, not derived from scripts or connections.
/// They are written together since writes of the same manifest replace each other while debounced.
export interface WorkbookProperties {
    /// The workbook name, null if the user never named the workbook
    name: string | null;
    /// Does the workbook stay ephemeral? A write without it promotes the workbook
    ephemeral?: boolean;
    /// The published workbook of the cloud that the workbook is linked to, a write without it removes the link
    cloud?: WorkbookCloudLink;
}
/// A workbook that is written as a whole, its scripts first and its manifest last
export interface WorkbookReplacement {
    /// The workbook id
    workbookId: string;
    /// The workbook name, null keeps the name on disk
    name: string | null;
    /// The script files, their text is read when the write runs. The script list of the workbook file
    /// is written by `WRITE_WORKBOOK_SCRIPTS` alone, it is the only writer of the list.
    scripts: Array<{ fileName: string; readText: () => string }>;
    /// A connection of a workbook that is not stored yet, the script list follows with the others
    connection: WorkbookConnection | null;
    /// The file name the workbook was created from, if any
    originalFileName: string | undefined;
}
export const REPLACE_WORKBOOK_SCRIPTS = Symbol('REPLACE_WORKBOOK_SCRIPTS');
export const WRITE_CONNECTION_ENTRY = Symbol('WRITE_CONNECTION_ENTRY');
export const DELETE_CONNECTION_ENTRY = Symbol('DELETE_CONNECTION_ENTRY');
export const WRITE_CONNECTION_FILE = Symbol('WRITE_CONNECTION_FILE');
export const PATCH_WORKBOOK_CONNECTION = Symbol('PATCH_WORKBOOK_CONNECTION');
export const WRITE_SCRIPT = Symbol('WRITE_SCRIPT');
export const DELETE_SCRIPT = Symbol('DELETE_SCRIPT');
export const RENAME_SCRIPT = Symbol('RENAME_SCRIPT');
export const WRITE_WORKBOOK_SCRIPTS = Symbol('WRITE_WORKBOOK_SCRIPTS');
export const REFRESH_WORKBOOK_ATTACHMENTS = Symbol('REFRESH_WORKBOOK_ATTACHMENTS');

/// The script list of a workbook
export interface WorkbookScriptList {
    /// The scripts in feed order with their connections
    scripts: WorkbookScript[];
    /// Copies of the connections of the scripts that the workbook file may not hold yet
    connections: WorkbookConnection[];
}

export type StorageWriteTaskVariant =
    | VariantKind<typeof WRITE_WORKBOOK_MANIFEST, [string, WorkbookConnection[]] | [string, WorkbookConnection[], { ephemeral: boolean }]>
    | VariantKind<typeof WRITE_WORKBOOK_PROPERTIES, [string, WorkbookProperties]>
    | VariantKind<typeof REPLACE_WORKBOOK_SCRIPTS, WorkbookReplacement>
    | VariantKind<typeof WRITE_CONNECTION_ENTRY, ConnectionEntry>
    | VariantKind<typeof DELETE_CONNECTION_ENTRY, string>
    /// The text of a file, or how to read it when the write runs, null if there is nothing to write anymore
    | VariantKind<typeof WRITE_CONNECTION_FILE, [string, string, string | (() => string | null)]>
    | VariantKind<typeof PATCH_WORKBOOK_CONNECTION, [string, WorkbookConnection] | [string, WorkbookConnection, string[]]>
    | VariantKind<typeof WRITE_SCRIPT, [string, string, string]>
    | VariantKind<typeof DELETE_SCRIPT, [string, string]>
    | VariantKind<typeof RENAME_SCRIPT, [string, string, string]>
    | VariantKind<typeof WRITE_WORKBOOK_SCRIPTS, [string, WorkbookScriptList]>
    | VariantKind<typeof REFRESH_WORKBOOK_ATTACHMENTS, string>
    ;

/// The key of a write. Writes with the same key coalesce, the latest task wins.
///
/// Keys are logical paths, they are not the paths of the files:
///   - Workbook keys start with the workbook UUID, e.g. `<workbookId>/scripts/01_query.sql`. The
///     per-workbook operations (pause, pending writes, cancellation) select keys by this prefix.
///   - Keys of the app storage start with `@`, e.g. `@manifest/connections/<id>` for a connection
///     entry of the app manifest and `@connections/<id>/<file>` for the files of a connection in
///     `connections/<id>/`. A UUID never starts with `@`, so these keys never match the prefix of a
///     workbook and are never paused or cancelled with one. `storageWriteChainKey` orders them.
export type StorageWriteKey = string;
/// The manifest is keyed on its real file path (`<workbookId>/dashql-workbook.json`) so the key it is
/// *scheduled* under matches the path its *completed* write is recorded under — otherwise the manifest
/// shows up as two rows in the stats view (a phantom `<workbookId>/` schedule row plus the real
/// file's write row). Keying both on the file also means a scheduled-but-not-yet-flushed manifest
/// write coalesces onto the same statistics row as its completion.
export const groupWorkbookManifestWrites = (workbookId: string) => `${workbookId}/${STORAGE_WORKBOOK_FILE}`;
export const groupWorkbookWrites = (workbookId: string) => `${workbookId}/${STORAGE_SCRIPTS_FOLDER}`;
/// The connection entries are written into the app manifest, one key per connection.
export const groupConnectionEntryWrites = (connectionId: string) => `@manifest/${STORAGE_CONNECTIONS_FOLDER}/${connectionId}`;
/// The files of a connection, e.g. its catalog relations
export const groupConnectionFileWrites = (connectionId: string, fileName: string) => `@${STORAGE_CONNECTIONS_FOLDER}/${connectionId}/${fileName}`;
/// The copy of a connection's params in a workbook. Copies of different connections must not
/// coalesce, but they serialize with every other write of the workbook.
export const groupWorkbookConnectionCopyWrites = (workbookId: string, connectionId: string) => `${workbookId}/${STORAGE_WORKBOOK_FILE}:connection/${connectionId}`;
/// The script list of a workbook and the connections it uses. It is patched into the workbook file and
/// must not coalesce with the other writes of the workbook file.
export const groupWorkbookScriptListWrites = (workbookId: string) => `${workbookId}/${STORAGE_WORKBOOK_FILE}:scripts`;
/// The attachment list of a workbook
export const groupWorkbookAttachmentListWrites = (workbookId: string) => `${workbookId}/${STORAGE_WORKBOOK_FILE}:attachments`;
/// A cached query result of a workbook and the marker of its last access
export const groupScriptWrites = (workbookId: string, fileName: string) =>
    `${workbookId}/${STORAGE_SCRIPTS_FOLDER}/${fileName}`;
export const groupScriptDeletes = (workbookId: string, scriptName: string) =>
    `${workbookId}/${STORAGE_SCRIPTS_FOLDER}/${scriptName}:delete`;
/// A page/script rename lives in its own `:rename` keyspace, keyed by the *source* path. Keeping it
/// off the write/delete keyspaces means a later content write (or delete) of the destination never
/// coalesces onto — and so never clobbers — a still-pending rename of the same name. The action lives
/// in a `:rename` *suffix* rather than a prefix so the key still starts with the workbook id and
/// sorts/scopes like every other file key.
export const groupScriptRenames = (workbookId: string, oldScriptName: string) =>
    `${workbookId}/${STORAGE_SCRIPTS_FOLDER}/${oldScriptName}:rename`;

/// Whether a statistics key belongs to a given workbook. Every write key is a path rooted at the
/// workbook id (`<workbookId>/…`), with the `:delete`/`:rename` action namespaces living in a suffix
/// (see the group* helpers above), so the workbook owns the key when it is the workbook id itself or a
/// descendant of it. Used to scope the storage-writer stats view to the active workbook.
export function storageWriteKeyBelongsToWorkbook(key: StorageWriteKey, workbookId: string): boolean {
    return key === workbookId || key.startsWith(`${workbookId}/`);
}

/// Strip the workbook-id prefix from a write key for display, keeping any `:delete`/`:rename` suffix
/// so the action stays legible. Once the stats view is scoped to a single workbook the workbook id is
/// redundant on every row, so e.g. `<workbookId>/scripts/page-1/01.sql` renders as
/// `scripts/page-1/01.sql` and `<workbookId>/scripts/page-1:rename` as `scripts/page-1:rename`.
/// The bare workbook key collapses to an empty string. Keys that don't belong to the workbook are
/// returned unchanged.
export function storageWriteKeyWithinWorkbook(key: StorageWriteKey, workbookId: string): string {
    if (!storageWriteKeyBelongsToWorkbook(key, workbookId)) {
        return key;
    }
    return key === workbookId ? '' : key.slice(workbookId.length + 1);
}

/// The outcome of a scheduled write
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

/// The chain key of a write key, tasks with the same chain key are executed one after another.
/// Workbook keys chain per workbook (`<workbookId>/…`), so mutations and their index rebuilds cannot
/// overlap. Global keys start with `@` and chain per entity
/// (`@manifest/…`, `@connections/<id>/…`).
export function storageWriteChainKey(key: StorageWriteKey): string {
    const parts = key.split('/');
    if (key.startsWith('@connections/') && parts.length > 1) {
        return `${parts[0]}/${parts[1]}`;
    }
    return parts[0];
}

interface AsyncStorageWriteTask {
    /// The latest task
    latestTask: StorageWriteTaskVariant;
    /// Resolve the caller of the latest task
    resolveLatestTask: (result: StorageWriteResult) => void;
    /// The time when this task was first scheduled
    scheduledAt: Date;
    /// The debounce duration in milliseconds
    debounceDurationMs: number;
    /// The timer
    timer: ReturnType<typeof setTimeout>;
}

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

export type StorageWriteStatisticsMap = Immutable.Map<StorageWriteKey, StorageWriterStatistics>;
export type StorageWriteStatisticsSubscriber = (stats: StorageWriteStatisticsMap) => void;

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

/// Subscriber for scripts that changed outside the app
export type ExternalScriptChangeSubscriber = (workbookId: string) => void;

/// Replace the copies of a connection's params in a workbook.
/// References of the replaced connections (connections that were merged into this one) are rewritten
/// to the connection id. Returns null when the workbook doesn't reference the connection or the copies
/// are up to date.
export function patchWorkbookConnection(workbook: WorkbookData, copy: WorkbookConnection, replaced: readonly string[] = []): WorkbookData | null {
    const connectionId = copy.connectionId;
    const references = (id: string) => id === connectionId || replaced.includes(id);
    const next: WorkbookData = {
        ...workbook,
        connections: dedupeConnections(workbook.connections.map(connection =>
            references(connection.connectionId) ? copy : connection)),
        scripts: workbook.scripts.map(script => replaced.includes(script.connectionId) ? { ...script, connectionId } : script),
    };
    return workbookManifestEquals(workbook, next) ? null : next;
}

/// Drop connections that an earlier connection of the list references already.
/// Consolidated connections can turn distinct references into the same one.
export function dedupeConnections<T extends { connectionId: string }>(connections: T[]): T[] {
    const seen = new Set<string>();
    return connections.filter(connection => {
        if (seen.has(connection.connectionId)) return false;
        seen.add(connection.connectionId);
        return true;
    });
}

/// Insert or replace a connection entry, keeping its creation time
export function upsertConnectionEntry(connections: ConnectionEntry[] | undefined, entry: ConnectionEntry): ConnectionEntry[] | null {
    const entries = connections ?? [];
    const index = entries.findIndex(e => e.id === entry.id);
    const prev = index >= 0 ? entries[index] : null;
    const next: ConnectionEntry = {
        ...entry,
        ...(entry.createdAt == null && prev?.createdAt != null ? { createdAt: prev.createdAt } : {}),
    };
    if (prev != null && jsonDeepEqual(JSON.parse(JSON.stringify(prev)), JSON.parse(JSON.stringify(next)))) {
        return null;
    }
    return index >= 0 ? entries.map((e, i) => (i === index ? next : e)) : [...entries, next];
}

export class StorageWriter {
    /// The logger
    logger: Logger;
    /// The storage backend
    backend: StorageBackend;
    /// The pending tasks
    pendingTasks: Map<StorageWriteKey, AsyncStorageWriteTask>;
    /// The statistics
    statistics: StorageWriteStatisticsMap;
    /// The listeners for
    statisticsSubscribers: Set<StorageWriteStatisticsSubscriber>;
    /// Is the writer paused? While paused, debounced timers don't process tasks.
    paused: boolean;
    /// Workbooks temporarily held by external reload/conflict handling.
    pausedWorkbooks: Set<string>;
    /// Deleted workbooks, writes for them are discarded until a workbook with the id is registered again.
    deletedWorkbooks: Set<string>;
    /// The executions that are currently in flight (used by flush() to await completion).
    inFlight: Set<Promise<void>>;
    /// Latest execution per chain key, so mutations and their index rebuilds cannot overlap.
    chainExecutions: Map<string, Promise<void>>;
    /// Subscribers for scripts that changed outside the app
    externalChangeSubscribers: Set<ExternalScriptChangeSubscriber>;
    /// Monotonic scheduled-write generation per key, used to revalidate destructive prompts.
    writeKeyGenerations: Map<string, number>;
    nextWriteGeneration: number;

    constructor(logger: Logger, backend: StorageBackend) {
        this.logger = logger;
        this.backend = backend;
        this.pendingTasks = new Map();
        this.statistics = Immutable.Map();
        this.statisticsSubscribers = new Set();
        this.paused = false;
        this.pausedWorkbooks = new Set();
        this.deletedWorkbooks = new Set();
        this.inFlight = new Set();
        this.chainExecutions = new Map();
        this.externalChangeSubscribers = new Set();
        this.writeKeyGenerations = new Map();
        this.nextWriteGeneration = 1;
    }

    /// Pause the writer.
    /// Cancels all pending debounce timers so nothing is written until resume()/flush() is called.
    /// Tasks scheduled while paused stay pending and are re-armed on resume().
    public pause(): void {
        this.paused = true;
        for (const task of this.pendingTasks.values()) {
            clearTimeout(task.timer);
        }
    }

    /// Resume the writer, re-arming debounce timers for any tasks accumulated while paused.
    public resume(): void {
        if (!this.paused) {
            return;
        }
        this.paused = false;
        for (const [key, task] of this.pendingTasks) {
            if ([...this.pausedWorkbooks].some(workbookId => storageWriteKeyBelongsToWorkbook(key, workbookId))) {
                continue;
            }
            task.timer = setTimeout(() => this.processTask(key), task.debounceDurationMs);
        }
    }

    /// Flush the writer: process every pending task immediately and await all in-flight writes.
    /// Works regardless of the paused state and leaves the paused state unchanged.
    public async flush(): Promise<void> {
        const wasPaused = this.paused;
        // Temporarily allow processing even if paused.
        this.paused = false;
        const keys = [...this.pendingTasks.keys()];
        for (const key of keys) {
            const task = this.pendingTasks.get(key);
            if (task) {
                clearTimeout(task.timer);
            }
            await this.processTask(key, true);
        }
        this.paused = wasPaused;
        // Await any executions that were already in flight (e.g. a timer that fired just before).
        while (this.inFlight.size > 0) {
            await Promise.all([...this.inFlight]);
        }
    }

    public getStatistics(): StorageWriteStatisticsMap {
        return this.statistics;
    }

    public pauseWorkbook(workbookId: string): void {
        this.pausedWorkbooks.add(workbookId);
        for (const [key, task] of this.pendingTasks) {
            if (storageWriteKeyBelongsToWorkbook(key, workbookId)) {
                clearTimeout(task.timer);
            }
        }
    }

    public resumeWorkbook(workbookId: string): void {
        if (!this.pausedWorkbooks.delete(workbookId) || this.paused) {
            return;
        }
        for (const [key, task] of this.pendingTasks) {
            if (storageWriteKeyBelongsToWorkbook(key, workbookId)) {
                task.timer = setTimeout(() => this.processTask(key), task.debounceDurationMs);
            }
        }
    }

    /// Pending write keys below a workbook id. This is intentionally prefix-based: every writer key
    /// is rooted at the workbook id, including the delete/rename action namespaces.
    public getPendingKeysForWorkbook(workbookId: string, include: (key: string) => boolean = () => true): string[] {
        return [...this.pendingTasks.keys()].filter(key => storageWriteKeyBelongsToWorkbook(key, workbookId) && include(key));
    }

    /// Discard pending writes for a workbook, resolving their promises as not executed. Used only
    /// after the user explicitly chooses an externally-written disk version over local debounced
    /// edits. Writes already in flight cannot be cancelled and are handled by settle().
    public cancelPendingWritesForWorkbook(workbookId: string, include: (key: string) => boolean = () => true): void {
        for (const [key, task] of this.pendingTasks) {
            if (!storageWriteKeyBelongsToWorkbook(key, workbookId) || !include(key)) {
                continue;
            }
            clearTimeout(task.timer);
            this.pendingTasks.delete(key);
            task.resolveLatestTask({ status: 'cancelled' });
        }
    }

    /// Discard the pending writes of the files of a connection that is deleted, they would recreate its folder
    public cancelPendingConnectionFileWrites(connectionId: string): void {
        const prefix = `@${STORAGE_CONNECTIONS_FOLDER}/${connectionId}/`;
        for (const [key, task] of this.pendingTasks) {
            if (key.startsWith(prefix)) {
                clearTimeout(task.timer);
                this.pendingTasks.delete(key);
                task.resolveLatestTask({ status: 'cancelled' });
            }
        }
    }

    /// Delete a workbook from the storage.
    /// The pending writes of the workbook are discarded and writes that already started finish first,
    /// no write recreates files of the deleted workbook afterwards.
    public async deleteWorkbook(workbookId: string): Promise<void> {
        this.deletedWorkbooks.add(workbookId);
        this.cancelPendingWritesForWorkbook(workbookId);
        await this.settle();
        try {
            await this.backend.deleteWorkbook(workbookId);
        } catch (error) {
            // The workbook stays in the storage, it may be written again
            this.deletedWorkbooks.delete(workbookId);
            throw error;
        }
        this.logger.info("Deleted workbook", { workbookId }, LOG_CTX);
    }

    /// A workbook with the id of a deleted workbook was registered again, e.g. by importing the same bundle.
    /// Writes for the id are accepted again, the writes discarded while it was deleted stay discarded.
    public reviveWorkbook(workbookId: string): void {
        this.deletedWorkbooks.delete(workbookId);
    }

    /// Is a workbook held, e.g. after one of its scripts changed outside the app?
    /// Its writes stay pending until the workbook resumes.
    public isWorkbookPaused(workbookId: string): boolean {
        return this.paused || this.pausedWorkbooks.has(workbookId);
    }

    /// Write the pending tasks of a workbook right away and wait until they are persisted.
    ///
    /// Resolves true when every pending write of the workbook reached the storage. A held writer or
    /// workbook keeps its writes pending and resolves false. Unlike flush(), a held workbook is never
    /// forced, its writes would overwrite the external change. A failed write stays pending as well,
    /// unless a newer write of its key replaced it, and the next flush writes it again.
    public async flushWorkbook(workbookId: string): Promise<boolean> {
        if (this.isWorkbookPaused(workbookId)) return false;
        const failed = new Map<StorageWriteKey, AsyncStorageWriteTask>();
        for (const key of this.getPendingKeysForWorkbook(workbookId)) {
            const task = this.pendingTasks.get(key);
            if (task == null) continue;
            const resolve = task.resolveLatestTask;
            task.resolveLatestTask = result => {
                if (result.status === 'failed') failed.set(key, task);
                resolve(result);
            };
            clearTimeout(task.timer);
            void this.processTask(key);
        }
        await this.settle();
        for (const [key, task] of failed) {
            if (this.pendingTasks.has(key)) continue;
            task.resolveLatestTask = () => { };
            task.timer = setTimeout(() => this.processTask(key), task.debounceDurationMs);
            this.pendingTasks.set(key, task);
        }
        // A write that would overwrite an external change pauses the workbook and stays pending
        return failed.size === 0 && !this.isWorkbookPaused(workbookId);
    }

    /// Wait for writes that have already started without flushing pending debounced work.
    public async settle(): Promise<void> {
        while (this.inFlight.size > 0) {
            await Promise.all([...this.inFlight]);
        }
    }

    public getWorkbookWriteGeneration(workbookId: string, include: (key: string) => boolean = () => true): number {
        let generation = 0;
        for (const [key, value] of this.writeKeyGenerations) {
            if (storageWriteKeyBelongsToWorkbook(key, workbookId) && include(key)) {
                generation = Math.max(generation, value);
            }
        }
        return generation;
    }

    /// Subscribe to script writes that are held because the script changed outside the app
    public subscribeExternalChanges(subscriber: ExternalScriptChangeSubscriber): () => void {
        this.externalChangeSubscribers.add(subscriber);
        return () => this.externalChangeSubscribers.delete(subscriber);
    }

    public subscribeStatisticsListener(listener: StorageWriteStatisticsSubscriber) {
        this.statisticsSubscribers.add(listener);

    }
    public unsubscribeStatisticsListener(listener: StorageWriteStatisticsSubscriber) {
        this.statisticsSubscribers.delete(listener);
    }

    /// Schedule a debounced write, resolves true when the task was executed.
    /// A newer write with the same key replaces a pending task and resolves its caller with false.
    public async write(key: string, task: StorageWriteTaskVariant, debounceFor: number = 0): Promise<boolean> {
        const result = await this.schedule(key, task, debounceFor);
        return result.status === 'written';
    }

    /// Write without debouncing and wait until the content is persisted.
    ///
    /// The task replaces any pending task with the same key and is executed right away, chained after
    /// running tasks of the same chain key. A paused writer or workbook resolves with `deferred` and
    /// keeps the task pending, it is executed on resume.
    public writeDurable(key: string, task: StorageWriteTaskVariant): Promise<StorageWriteResult> {
        const result = this.schedule(key, task, 0);
        const pending = this.pendingTasks.get(key)!;
        clearTimeout(pending.timer);
        if (this.isPausedKey(key)) {
            pending.resolveLatestTask({ status: 'deferred' });
            pending.resolveLatestTask = () => { };
        } else {
            void this.processTask(key);
        }
        return result;
    }

    /// Is a key held by a paused writer or a paused workbook?
    protected isPausedKey(key: string): boolean {
        return this.paused || [...this.pausedWorkbooks].some(workbookId => storageWriteKeyBelongsToWorkbook(key, workbookId));
    }

    protected schedule(key: string, task: StorageWriteTaskVariant, debounceFor: number): Promise<StorageWriteResult> {
        // Writes that were queued while a workbook was deleted must not recreate its files
        if ([...this.deletedWorkbooks].some(workbookId => storageWriteKeyBelongsToWorkbook(key, workbookId))) {
            return Promise.resolve({ status: 'cancelled' });
        }
        this.writeKeyGenerations.set(key, this.nextWriteGeneration++);
        // Is there a previous task with the same key?
        const prevTask = this.pendingTasks.get(key);
        let scheduledAt: Date;
        let debounceDurationMs: number = debounceFor;
        let timer: ReturnType<typeof setTimeout>;
        if (prevTask) {
            // Tell the former write call that the task was not executed
            prevTask.resolveLatestTask({ status: 'superseded' });
            // Overwrite the task
            scheduledAt = prevTask.scheduledAt;
            debounceDurationMs = prevTask.debounceDurationMs;
            timer = prevTask.timer;
        } else {
            scheduledAt = new Date();
            timer = setTimeout(() => this.processTask(key), debounceFor);
        }
        let resolveTask: ((result: StorageWriteResult) => void) | null = null;
        const result = new Promise<StorageWriteResult>(resolve => { resolveTask = resolve; });

        // Overwrite any previous task with the same key
        this.pendingTasks.set(key, {
            latestTask: task,
            resolveLatestTask: resolveTask!,
            scheduledAt: scheduledAt,
            debounceDurationMs,
            timer,
        });
        this.registerScheduledWrite(key);
        return result;
    }

    protected async processTask(key: string, force: boolean = false) {
        const task = this.pendingTasks.get(key);
        if (!task) {
            return;
        }
        // If a timer fires while paused, leave the task pending - it'll be re-armed on resume().
        if (!force && this.isPausedKey(key)) {
            return;
        }
        this.pendingTasks.delete(key);
        const chainKey = storageWriteChainKey(key);
        const previousExecution = this.chainExecutions.get(chainKey);
        const execution = (async () => {
            if (previousExecution) {
                await previousExecution;
            }
            try {
                await this.executeTask(key, task.latestTask);
                task.resolveLatestTask({ status: 'written' });
            } catch (e: any) {
                if (e instanceof ExternalScriptChangeError) {
                    this.holdExternallyChangedWrite(key, task, e);
                    return;
                }
                this.logger.error("executing write task failed", {
                    key: key,
                    error: stringifyError(e)
                })
                task.resolveLatestTask({ status: 'failed', error: e });
            }
        })();
        this.chainExecutions.set(chainKey, execution);
        this.inFlight.add(execution);
        try {
            await execution;
        } finally {
            this.inFlight.delete(execution);
            if (this.chainExecutions.get(chainKey) === execution) {
                this.chainExecutions.delete(chainKey);
            }
        }
    }

    /// Keep a write that would overwrite an external change pending and pause its workbook.
    /// The subscribers decide between the disk and the app, then resume the workbook.
    protected holdExternallyChangedWrite(key: string, task: AsyncStorageWriteTask, error: ExternalScriptChangeError) {
        this.logger.warn("script changed outside the app, holding the write", { key, workbookId: error.workbookId, file: error.fileName }, LOG_CTX);
        this.pauseWorkbook(error.workbookId);
        if (this.pendingTasks.has(key)) {
            // A newer task with the same key was scheduled while this one was executing
            task.resolveLatestTask({ status: 'superseded' });
        } else {
            this.pendingTasks.set(key, task);
        }
        for (const subscriber of this.externalChangeSubscribers) {
            subscriber(error.workbookId);
        }
    }

    protected updateStatistics(statistics: Immutable.Map<StorageWriteKey, StorageWriterStatistics>) {
        this.statistics = statistics;
        for (const subscriber of this.statisticsSubscribers) {
            subscriber(statistics);
        }
    }

    protected registerScheduledWrite(key: StorageWriteKey) {
        const ifNotSet: StorageWriterStatistics = {
            totalScheduledWrites: 1,
            totalWrites: 0,
            totalWrittenBytes: 0,
            totalWriteTime: 0,
            lastWrite: null,
        };
        const stats = this.statistics.update(key, ifNotSet, (stats) => ({ ...stats, totalScheduledWrites: stats.totalScheduledWrites + 1 }));
        this.updateStatistics(stats);
    }

    protected registerWrite(key: StorageWriteKey, writtenBytes: number, writeDurationMs: number) {
        const ifNotSet: StorageWriterStatistics = {
            totalScheduledWrites: 1,
            totalWrites: 1,
            totalWrittenBytes: writtenBytes,
            totalWriteTime: writeDurationMs,
            lastWrite: new Date(),
        };
        const stats = this.statistics.update(key, ifNotSet, (stats) => ({
            ...stats,
            totalWrites: stats.totalWrites + 1,
            totalWrittenBytes: stats.totalWrittenBytes + writtenBytes,
            totalWriteTime: stats.totalWriteTime + writeDurationMs,
            lastWrite: new Date(),
        }));
        this.updateStatistics(stats);
    }

    /// The backend as workbook registry, connection writes need one
    protected requireRegistry(): WorkbookRegistryBackend {
        if (!isWorkbookRegistryBackend(this.backend)) {
            throw new Error('the storage backend does not own a workbook registry');
        }
        return this.backend;
    }

    /// Patch an existing workbook file, the write is skipped when nothing changed.
    /// A missing file is not recreated, a moved native folder would otherwise come back as a new one.
    private async patchWorkbookFile(key: string, workbookId: string, patch: (workbook: WorkbookData) => WorkbookData): Promise<void> {
        let existing: WorkbookData;
        try {
            existing = await this.backend.loadWorkbook(workbookId);
        } catch (e: any) {
            throw new WorkbookUnavailableError(workbookId, e);
        }
        const next = patch(existing);
        if (workbookManifestEquals(existing, next)) return;
        this.logger.info("Patching workbook", { key, workbookId }, LOG_CTX);
        await this.saveWorkbookFile(workbookId, next);
    }

    /// Save the workbook file of a workbook and record the write
    private async saveWorkbookFile(workbookId: string, workbook: WorkbookData): Promise<void> {
        const text = JSON.stringify(workbook, null, 2);
        await this.timedWrite(`${workbookId}/${STORAGE_WORKBOOK_FILE}`, text, () => this.backend.saveWorkbookManifest(workbookId, workbook));
    }

    /// Write a file and record the write with its duration
    private async timedWrite(path: string, text: string, write: () => Promise<void>): Promise<void> {
        const timeBefore = new Date();
        await write();
        this.registerWrite(path, text.length, new Date().getTime() - timeBefore.getTime());
    }

    protected async executeTask(key: string, task: StorageWriteTaskVariant) {
        switch (task.type) {
            case WRITE_WORKBOOK_MANIFEST: {
                const [workbookId, connections, created] = task.value;
                this.logger.info("Writing workbook", {
                    key,
                    workbookId,
                }, LOG_CTX);

                // Load whatever is already on disk so we can (a) preserve the original createdAt
                // instead of churning a fresh timestamp on every write, and (b) skip the write
                // entirely when nothing actually changed. WRITE_WORKBOOK_MANIFEST is scheduled on
                // every connection-state change, so most of these tasks rewrite identical content.
                let existingWorkbook: WorkbookData | null = null;
                try {
                    existingWorkbook = await this.backend.loadWorkbook(workbookId);
                } catch {
                    existingWorkbook = null;
                }

                // For now, create minimal workbook metadata
                const workbookMetadata: StorageWorkbookMetadata = {
                    ...existingWorkbook?.metadata,
                    createdAt: existingWorkbook?.metadata?.createdAt ?? new Date().toISOString(),
                    ...(created?.ephemeral ? { ephemeral: true } : {}),
                };

                // workbookPath is a display-only field, recomputed from the UUID + location for
                // the UI; we don't persist it here. storageType/nativePath are stamped by the
                // composite backend, which knows the workbook's physical location.
                // The given connections replace the copies on disk, the scripts keep theirs
                const connData: WorkbookData = withWorkbookScripts({
                    formatVersion: WORKBOOK_FORMAT_VERSION,
                    workbookId,
                    ...(existingWorkbook?.name ? { name: existingWorkbook.name } : {}),
                    connections: [],
                    scripts: [],
                    attachments: existingWorkbook?.attachments ?? [],
                    metadata: workbookMetadata,
                }, existingWorkbook?.scripts ?? [], [...connections, ...existingWorkbook?.connections ?? []]);

                // Skip the write if the persisted manifest already matches what we'd write.
                if (existingWorkbook != null && workbookManifestEquals(existingWorkbook, connData)) {
                    this.logger.debug("Skipping workbook write: manifest unchanged", {
                        workbookId,
                        connectionIds: connections.map(connection => connection.connectionId).join(','),
                    }, LOG_CTX);
                    break;
                }

                await this.saveWorkbookFile(workbookId, connData);
                break;
            }
            case WRITE_WORKBOOK_PROPERTIES: {
                const [workbookId, { name, ephemeral, cloud }] = task.value;
                await this.patchWorkbookFile(key, workbookId, existing => {
                    const next: WorkbookData = { ...existing };
                    if (name) next.name = name;
                    else delete next.name;
                    if (!ephemeral && next.metadata?.ephemeral != null) {
                        const { ephemeral: _promoted, ...metadata } = next.metadata;
                        next.metadata = metadata;
                    }
                    if (cloud != null) {
                        next.metadata = { ...next.metadata, cloud };
                    } else if (next.metadata?.cloud != null) {
                        const { cloud: _unlinked, ...metadata } = next.metadata;
                        next.metadata = metadata;
                    }
                    return next;
                });
                break;
            }
            case REPLACE_WORKBOOK_SCRIPTS: {
                const workbook = task.value;
                const workbookId = workbook.workbookId;
                this.logger.info("Creating workbook", {
                    key,
                    workbookId,
                }, LOG_CTX);

                for (const script of workbook.scripts) {
                    const sql = script.readText();
                    await this.timedWrite(`${workbookId}/scripts/${script.fileName}`, sql, () => this.backend.saveScript(workbookId, script.fileName, sql));
                }

                // Save workbook last so it never references content that doesn't exist yet.
                // Preserve the original createdAt across rewrites; only stamp it on the first write.
                let connections: WorkbookData['connections'];
                let createdAt: string;
                // Preserve the user-supplied name across a workbook rewrite: this path rebuilds the
                // whole manifest from workbook scripts, which carry no name, so we must carry over
                // whatever the user already set on disk.
                let existingName: string | undefined;
                let existingMetadata: StorageWorkbookMetadata | undefined;
                let existingAttachments: WorkbookData['attachments'] = [];
                let existingScripts: WorkbookData['scripts'] = [];
                try {
                    const existingWorkbook = await this.backend.loadWorkbook(workbookId);
                    existingScripts = existingWorkbook.scripts ?? [];
                    connections = existingWorkbook.connections;
                    createdAt = existingWorkbook.metadata?.createdAt ?? new Date().toISOString();
                    existingName = existingWorkbook.name;
                    existingMetadata = existingWorkbook.metadata;
                    existingAttachments = existingWorkbook.attachments ?? [];
                } catch {
                    connections = workbook.connection == null ? [] : [workbook.connection];
                    createdAt = new Date().toISOString();
                }

                const workbookMetadata: StorageWorkbookMetadata = {
                    ...existingMetadata,
                    originalFileName: workbook.originalFileName,
                    createdAt,
                };

                const connData: WorkbookData = withWorkbookScripts({
                    formatVersion: WORKBOOK_FORMAT_VERSION,
                    workbookId,
                    ...(workbook.name ? { name: workbook.name } : existingName ? { name: existingName } : {}),
                    connections,
                    scripts: [],
                    attachments: existingAttachments,
                    metadata: workbookMetadata,
                }, existingScripts);

                await this.saveWorkbookFile(workbookId, connData);
                break;
            }
            case WRITE_WORKBOOK_SCRIPTS: {
                const [workbookId, list] = task.value;
                await this.patchWorkbookFile(key, workbookId, workbook => withWorkbookScripts(workbook, list.scripts, list.connections));
                break;
            }
            case REFRESH_WORKBOOK_ATTACHMENTS: {
                const workbookId = task.value;
                const attachments = workbookAttachments((await this.backend.listDataFiles(workbookId)).map(file => file.name));
                await this.patchWorkbookFile(key, workbookId, workbook => ({ ...workbook, attachments }));
                break;
            }
            case WRITE_CONNECTION_ENTRY: {
                const entry = task.value;
                const registry = this.requireRegistry();
                const timeBefore = new Date();
                await registry.updateConnections(connections => upsertConnectionEntry(connections, entry));
                this.registerWrite(key, JSON.stringify(entry).length, new Date().getTime() - timeBefore.getTime());
                break;
            }
            case DELETE_CONNECTION_ENTRY: {
                const connectionId = task.value;
                const registry = this.requireRegistry();
                this.logger.info("Deleting connection", { key, connectionId }, LOG_CTX);
                await registry.updateConnections(connections => {
                    if (connections == null || !connections.some(e => e.id === connectionId)) return null;
                    return connections.filter(e => e.id !== connectionId);
                });
                await registry.deleteConnectionFiles(connectionId);
                break;
            }
            case WRITE_CONNECTION_FILE: {
                const [connectionId, fileName, content] = task.value;
                const text = typeof content === 'function' ? content() : content;
                if (text == null) break;
                const registry = this.requireRegistry();
                await this.timedWrite(`@${STORAGE_CONNECTIONS_FOLDER}/${connectionId}/${fileName}`, text, () => registry.saveConnectionFile(connectionId, fileName, text));
                break;
            }
            case PATCH_WORKBOOK_CONNECTION: {
                const [workbookId, copy, replaced] = task.value;
                // The copy is only patched into an existing workbook file. A missing file must not be
                // recreated, a moved native folder would otherwise silently come back as a new one.
                await this.patchWorkbookFile(key, workbookId, existing => patchWorkbookConnection(existing, copy, replaced) ?? existing);
                break;
            }
            case WRITE_SCRIPT: {
                const [workbookId, fileName, sql] = task.value;

                this.logger.info("Writing workbook script", {
                    key,
                    workbookId,
                    file: fileName,
                }, LOG_CTX);

                await this.timedWrite(`${workbookId}/scripts/${fileName}`, sql, () => this.backend.saveScript(workbookId, fileName, sql));
                break;
            }
            case DELETE_SCRIPT: {
                const [workbookId, scriptName] = task.value;
                this.logger.info("Deleting workbook script", {
                    task: key,
                    workbookId,
                    scriptName,
                }, LOG_CTX);
                await this.backend.deleteScript(workbookId, scriptName);
                break;
            }
            case RENAME_SCRIPT: {
                const [workbookId, oldScriptName, newScriptName] = task.value;
                this.logger.info("Renaming workbook script", {
                    task: key,
                    workbookId,
                    oldScriptName,
                    newScriptName,
                }, LOG_CTX);
                await this.backend.renameScript(workbookId, oldScriptName, newScriptName);
                break;
            }
        }
    }
}
