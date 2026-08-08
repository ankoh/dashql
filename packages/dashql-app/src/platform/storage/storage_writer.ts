import * as Immutable from 'immutable';
import * as dashql from '../../core/index.js';

import { Logger, stringifyError } from '../logger/logger.js';
import { VariantKind } from '../../utils/index.js';
import { NotebookScripts } from '../../scripts/notebook_scripts.js';
import { ConnectionState } from '../../connection/connection_state.js';
import { getConnectionParamsFromStateDetails, createDefaultConnectionParamsForConnector } from '../../connection/connection_params.js';
import type { StorageBackend, NotebookData, NotebookMetadata as StorageNotebookMetadata } from './storage_backend.js';
import { STORAGE_SCRIPTS_FOLDER, STORAGE_NOTEBOOK_FILE } from './storage_backend.js';

const LOG_CTX = 'storage_writer';

/// Order-independent deep equality for plain JSON values (objects, arrays, primitives).
/// Notebook manifests are plain JSON (no Dates/Maps/functions), so this is sufficient.
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

/// Compare the manifest fields the writer owns (notebookId, name, connectionParams, metadata).
/// Other fields (storageType/nativePath/notebookPath) are display- or registry-only and are not
/// written into the notebook file, so they're deliberately ignored.
///
/// Both sides are round-tripped through JSON first so this compares exactly what would be
/// persisted: serialization drops `undefined`-valued keys, so a freshly built params object with
/// `{ foo: undefined }` must compare equal to the reloaded `{}` it serializes to.
function notebookManifestEquals(a: NotebookData, b: NotebookData): boolean {
    const project = (s: NotebookData) => JSON.parse(JSON.stringify({
        notebookId: s.notebookId,
        name: s.name,
        connectionParams: s.connectionParams,
        metadata: s.metadata,
    }));
    return jsonDeepEqual(project(a), project(b));
}

export const DEBOUNCE_DURATION_NOTEBOOK_WRITE = 100;
export const DEBOUNCE_DURATION_SCRIPT_WRITE = 100;

export const WRITE_NOTEBOOK_MANIFEST = Symbol('WRITE_NOTEBOOK_MANIFEST');
export const WRITE_NOTEBOOK_CATALOG_SCRIPT = Symbol('WRITE_NOTEBOOK_CATALOG_SCRIPT');
export const WRITE_NOTEBOOK_FUNCTION_SCRIPT = Symbol('WRITE_NOTEBOOK_FUNCTION_SCRIPT');
export const REPLACE_NOTEBOOK_SCRIPTS = Symbol('REPLACE_NOTEBOOK_SCRIPTS');
export const WRITE_SCRIPT = Symbol('WRITE_SCRIPT');
export const WRITE_SCRIPT_DRAFT = Symbol('WRITE_SCRIPT_DRAFT');
export const CREATE_SCRIPT_FOLDER = Symbol('CREATE_SCRIPT_FOLDER');
export const DELETE_SCRIPT_FOLDER = Symbol('DELETE_SCRIPT_FOLDER');
export const RENAME_SCRIPT_FOLDER = Symbol('RENAME_SCRIPT_FOLDER');
export const DELETE_NOTEBOOK = Symbol('DELETE_NOTEBOOK');
export const DELETE_SCRIPT = Symbol('DELETE_SCRIPT');
export const RENAME_SCRIPT = Symbol('RENAME_SCRIPT');

export type StorageWriteTaskVariant =
    | VariantKind<typeof WRITE_NOTEBOOK_MANIFEST, [string, ConnectionState]>
    | VariantKind<typeof WRITE_NOTEBOOK_CATALOG_SCRIPT, [string, dashql.DashQLScript]>
    | VariantKind<typeof WRITE_NOTEBOOK_FUNCTION_SCRIPT, [string, dashql.DashQLScript]>
    | VariantKind<typeof REPLACE_NOTEBOOK_SCRIPTS, NotebookScripts>
    | VariantKind<typeof WRITE_SCRIPT, [string, string, string, string]>
    | VariantKind<typeof WRITE_SCRIPT_DRAFT, [string, string]>
    | VariantKind<typeof CREATE_SCRIPT_FOLDER, [string, string, { scriptId: number, fileName: string, sql: string }[]]>
    | VariantKind<typeof DELETE_SCRIPT_FOLDER, [string, string]>
    | VariantKind<typeof RENAME_SCRIPT_FOLDER, [string, string, string]>
    | VariantKind<typeof DELETE_NOTEBOOK, string>
    | VariantKind<typeof DELETE_SCRIPT, [string, string, string]>
    | VariantKind<typeof RENAME_SCRIPT, [string, string, string, string]>
    ;

export type StorageWriteKey = string;
/// The manifest is keyed on its real file path (`<notebookId>/dashql-notebook.json`) so the key it is
/// *scheduled* under matches the path its *completed* write is recorded under — otherwise the manifest
/// shows up as two rows in the stats view (a phantom `<notebookId>/` schedule row plus the real
/// file's write row). Keying both on the file also means a scheduled-but-not-yet-flushed manifest
/// write coalesces onto the same statistics row as its completion.
export const groupNotebookManifestWrites = (notebookId: string) => `${notebookId}/${STORAGE_NOTEBOOK_FILE}`;
export const groupNotebookSchemaWrites = (notebookId: string) => `${notebookId}/dashql-relations.sql`;
export const groupNotebookFunctionWrites = (notebookId: string) => `${notebookId}/dashql-functions.sql`;
export const groupNotebookWrites = (notebookId: string) => `${notebookId}/${STORAGE_SCRIPTS_FOLDER}`;
export const groupScriptFolderWrites = (notebookId: string, folderName: string) => `${notebookId}/${STORAGE_SCRIPTS_FOLDER}/${folderName}`;
export const groupDraftWrites = (notebookId: string) => `${notebookId}/${STORAGE_SCRIPTS_FOLDER}/dashql-draft.sql`;
export const groupScriptWrites = (notebookId: string, folderName: string, fileName: string) =>
    `${notebookId}/${STORAGE_SCRIPTS_FOLDER}/${folderName}/${fileName}`;
export const groupScriptDeletes = (notebookId: string, folderName: string, scriptName: string) =>
    `${notebookId}/${STORAGE_SCRIPTS_FOLDER}/${folderName}/${scriptName}:delete`;
/// A page/script rename lives in its own `:rename` keyspace, keyed by the *source* path. Keeping it
/// off the write/delete keyspaces means a later content write (or delete) of the destination never
/// coalesces onto — and so never clobbers — a still-pending rename of the same name. The action lives
/// in a `:rename` *suffix* rather than a prefix so the key still starts with the notebook id and
/// sorts/scopes like every other file key.
export const groupScriptFolderRenames = (notebookId: string, oldFolderName: string) =>
    `${notebookId}/${STORAGE_SCRIPTS_FOLDER}/${oldFolderName}:rename`;
export const groupScriptRenames = (notebookId: string, folderName: string, oldScriptName: string) =>
    `${notebookId}/${STORAGE_SCRIPTS_FOLDER}/${folderName}/${oldScriptName}:rename`;

/// Whether a statistics key belongs to a given notebook. Every write key is a path rooted at the
/// notebook id (`<notebookId>/…`), with the `:delete`/`:rename` action namespaces living in a suffix
/// (see the group* helpers above), so the notebook owns the key when it is the notebook id itself or a
/// descendant of it. Used to scope the storage-writer stats view to the active notebook.
export function storageWriteKeyBelongsToNotebook(key: StorageWriteKey, notebookId: string): boolean {
    return key === notebookId || key.startsWith(`${notebookId}/`);
}

/// Strip the notebook-id prefix from a write key for display, keeping any `:delete`/`:rename` suffix
/// so the action stays legible. Once the stats view is scoped to a single notebook the notebook id is
/// redundant on every row, so e.g. `<notebookId>/scripts/page-1/01.sql` renders as
/// `scripts/page-1/01.sql` and `<notebookId>/scripts/page-1:rename` as `scripts/page-1:rename`.
/// The bare notebook key collapses to an empty string. Keys that don't belong to the notebook are
/// returned unchanged.
export function storageWriteKeyWithinNotebook(key: StorageWriteKey, notebookId: string): string {
    if (!storageWriteKeyBelongsToNotebook(key, notebookId)) {
        return key;
    }
    return key === notebookId ? '' : key.slice(notebookId.length + 1);
}

interface AsyncStorageWriteTask {
    /// The latest task
    latestTask: StorageWriteTaskVariant;
    /// Resolve the latest task
    resolveLatestTask: (ok: boolean) => void;
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
    /// Notebooks temporarily held by external reload/conflict handling.
    pausedNotebooks: Set<string>;
    /// The executions that are currently in flight (used by flush() to await completion).
    inFlight: Set<Promise<void>>;
    /// Last content known to have been persisted by this writer, keyed by storage-relative path.
    completedFileContents: Map<string, string | null>;
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
        this.pausedNotebooks = new Set();
        this.inFlight = new Set();
        this.completedFileContents = new Map();
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
            if ([...this.pausedNotebooks].some(notebookId => storageWriteKeyBelongsToNotebook(key, notebookId))) {
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

    public pauseNotebook(notebookId: string): void {
        this.pausedNotebooks.add(notebookId);
        for (const [key, task] of this.pendingTasks) {
            if (storageWriteKeyBelongsToNotebook(key, notebookId)) {
                clearTimeout(task.timer);
            }
        }
    }

    public resumeNotebook(notebookId: string): void {
        if (!this.pausedNotebooks.delete(notebookId) || this.paused) {
            return;
        }
        for (const [key, task] of this.pendingTasks) {
            if (storageWriteKeyBelongsToNotebook(key, notebookId)) {
                task.timer = setTimeout(() => this.processTask(key), task.debounceDurationMs);
            }
        }
    }

    /// Pending write keys below a notebook id. This is intentionally prefix-based: every writer key
    /// is rooted at the notebook id, including the delete/rename action namespaces.
    public getPendingKeysForNotebook(notebookId: string, include: (key: string) => boolean = () => true): string[] {
        return [...this.pendingTasks.keys()].filter(key => storageWriteKeyBelongsToNotebook(key, notebookId) && include(key));
    }

    /// Discard pending writes for a notebook, resolving their promises as not executed. Used only
    /// after the user explicitly chooses an externally-written disk version over local debounced
    /// edits. Writes already in flight cannot be cancelled and are handled by settle().
    public cancelPendingWritesForNotebook(notebookId: string, include: (key: string) => boolean = () => true): void {
        for (const [key, task] of this.pendingTasks) {
            if (!storageWriteKeyBelongsToNotebook(key, notebookId) || !include(key)) {
                continue;
            }
            clearTimeout(task.timer);
            this.pendingTasks.delete(key);
            task.resolveLatestTask(false);
        }
    }

    /// Wait for writes that have already started without flushing pending debounced work.
    public async settle(): Promise<void> {
        while (this.inFlight.size > 0) {
            await Promise.all([...this.inFlight]);
        }
    }

    public getNotebookWriteGeneration(notebookId: string, include: (key: string) => boolean = () => true): number {
        let generation = 0;
        for (const [key, value] of this.writeKeyGenerations) {
            if (storageWriteKeyBelongsToNotebook(key, notebookId) && include(key)) {
                generation = Math.max(generation, value);
            }
        }
        return generation;
    }

    public getCompletedFileContent(path: string): string | null | undefined {
        return this.completedFileContents.get(path);
    }

    public subscribeStatisticsListener(listener: StorageWriteStatisticsSubscriber) {
        this.statisticsSubscribers.add(listener);

    }
    public unsubscribeStatisticsListener(listener: StorageWriteStatisticsSubscriber) {
        this.statisticsSubscribers.delete(listener);
    }

    public async write(key: string, task: StorageWriteTaskVariant, debounceFor: number = 0): Promise<boolean> {
        this.writeKeyGenerations.set(key, this.nextWriteGeneration++);
        // Is there a previous task with the same key?
        const prevTask = this.pendingTasks.get(key);
        let scheduledAt: Date;
        let debounceDurationMs: number = debounceFor;
        let timer: ReturnType<typeof setTimeout>;
        if (prevTask) {
            // Tell the former write call that the task was not executed
            prevTask.resolveLatestTask(false);
            // Overwrite the task
            scheduledAt = prevTask.scheduledAt;
            debounceDurationMs = prevTask.debounceDurationMs;
            timer = prevTask.timer;
        } else {
            scheduledAt = new Date();
            timer = setTimeout(() => this.processTask(key), debounceFor);
        }
        let resolveTask: ((ok: boolean) => void) | null = null;
        let taskPromise = new Promise<boolean>(r => { resolveTask = r; });

        // Overwrite any previous task with the same key
        this.pendingTasks.set(key, {
            latestTask: task,
            resolveLatestTask: resolveTask!,
            scheduledAt: scheduledAt,
            debounceDurationMs,
            timer,
        });
        this.registerScheduledWrite(key);
        return await taskPromise;
    }

    protected async processTask(key: string, force: boolean = false) {
        const task = this.pendingTasks.get(key);
        if (!task) {
            return;
        }
        // If a timer fires while paused, leave the task pending - it'll be re-armed on resume().
        if (!force && (this.paused || [...this.pausedNotebooks].some(notebookId => storageWriteKeyBelongsToNotebook(key, notebookId)))) {
            return;
        }
        this.pendingTasks.delete(key);
        const execution = (async () => {
            try {
                await this.executeTask(key, task.latestTask);
                task.resolveLatestTask(true);
            } catch (e: any) {
                this.logger.error("executing write task failed", {
                    key: key,
                    error: stringifyError(e)
                })
                task.resolveLatestTask(false);
            }
        })();
        this.inFlight.add(execution);
        try {
            await execution;
        } finally {
            this.inFlight.delete(execution);
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

    protected async executeTask(key: string, task: StorageWriteTaskVariant) {
        switch (task.type) {
            case WRITE_NOTEBOOK_MANIFEST: {
                const [notebookId, conn] = task.value;
                this.logger.info("Writing notebook", {
                    key,
                    notebookId,
                }, LOG_CTX);

                // Extract connection params
                const connectionParams = getConnectionParamsFromStateDetails(conn.details);
                if (!connectionParams) {
                    this.logger.debug("Skipping notebook write: connection not yet configured", {
                        notebookId: conn.notebookId,
                        connectorType: conn.connectorInfo.connectorType.toString()
                    }, LOG_CTX);
                    break;
                }

                // Load whatever is already on disk so we can (a) preserve the original createdAt
                // instead of churning a fresh timestamp on every write, and (b) skip the write
                // entirely when nothing actually changed. WRITE_NOTEBOOK_MANIFEST is scheduled on
                // every connection-state change, so most of these tasks rewrite identical content.
                let existingNotebook: NotebookData | null = null;
                try {
                    existingNotebook = await this.backend.loadNotebook(notebookId);
                } catch {
                    existingNotebook = null;
                }

                // For now, create minimal notebook metadata
                const notebookMetadata: StorageNotebookMetadata = {
                    originalFileName: undefined,
                    createdAt: existingNotebook?.metadata?.createdAt ?? new Date().toISOString(),
                };

                // notebookPath is a display-only field, recomputed from the UUID + location for
                // the UI; we don't persist it here. storageType/nativePath are stamped by the
                // composite backend, which knows the notebook's physical location.
                const connData: NotebookData = {
                    notebookId: conn.notebookId,
                    // `name` is the user-supplied label, omitted entirely when unset so a notebook
                    // the user never named carries no `name` key at all.
                    ...(conn.name ? { name: conn.name } : {}),
                    connectionParams,
                    metadata: notebookMetadata,
                };

                // Skip the write if the persisted manifest already matches what we'd write.
                if (existingNotebook != null && notebookManifestEquals(existingNotebook, connData)) {
                    this.logger.debug("Skipping notebook write: manifest unchanged", {
                        notebookId: conn.notebookId,
                    }, LOG_CTX);
                    break;
                }

                const timeBefore = new Date();
                await this.backend.saveNotebookManifest(notebookId, connData);
                const timeAfter = new Date();
                const writeDuration = timeAfter.getTime() - timeBefore.getTime();
                const actualPath = `${notebookId}/dashql-notebook.json`;
                this.registerWrite(actualPath, JSON.stringify(connData).length, writeDuration);
                this.completedFileContents.set(actualPath, JSON.stringify(connData, null, 2));
                break;
            }
            case WRITE_NOTEBOOK_CATALOG_SCRIPT: {
                const [notebookId, catalogRelationScript] = task.value;
                this.logger.info("Writing notebook schema", {
                    key,
                    notebookId,
                }, LOG_CTX);

                // Get the SQL from the catalog script
                const schemaSQL = catalogRelationScript.toString();

                const timeBefore = new Date();
                await this.backend.saveNotebookSchema(notebookId, schemaSQL);
                const timeAfter = new Date();
                const writeDuration = timeAfter.getTime() - timeBefore.getTime();
                const actualPath = `${notebookId}/dashql-relations.sql`;
                this.registerWrite(actualPath, schemaSQL.length, writeDuration);
                this.completedFileContents.set(actualPath, schemaSQL);
                break;
            }
            case WRITE_NOTEBOOK_FUNCTION_SCRIPT: {
                const [notebookId, functionScript] = task.value;
                this.logger.info("Writing notebook functions", {
                    key,
                    notebookId,
                }, LOG_CTX);

                const functionsSQL = functionScript.toString();

                const timeBefore = new Date();
                await this.backend.saveNotebookFunctions(notebookId, functionsSQL);
                const timeAfter = new Date();
                const writeDuration = timeAfter.getTime() - timeBefore.getTime();
                const actualPath = `${notebookId}/dashql-functions.sql`;
                this.registerWrite(actualPath, functionsSQL.length, writeDuration);
                this.completedFileContents.set(actualPath, functionsSQL);
                break;
            }
            case REPLACE_NOTEBOOK_SCRIPTS: {
                const notebookScripts = task.value;
                this.logger.info("Creating notebook", {
                    key,
                    notebookId: notebookScripts.notebookId,
                }, LOG_CTX);

                const notebookId = notebookScripts.notebookId;

                // Write all pages and their scripts first
                for (const folderName in notebookScripts.scriptFolders) {
                    const page = notebookScripts.scriptFolders[folderName];
                    await this.backend.createScriptFolder(notebookId, folderName);

                    for (const fileName in page.scripts) {
                        const pageScript = page.scripts[fileName];
                        const scriptData = notebookScripts.scripts[pageScript.scriptId];
                        if (scriptData) {
                            const sql = scriptData.script.toString();
                            const t0 = new Date();
                            await this.backend.saveScript(notebookId, folderName, pageScript.fileName, sql);
                            const t1 = new Date();
                            this.registerWrite(`${notebookId}/scripts/${folderName}/${pageScript.fileName}`, sql.length, t1.getTime() - t0.getTime());
                            this.completedFileContents.set(`${notebookId}/scripts/${folderName}/${pageScript.fileName}`, sql);
                        }
                    }
                }

                // Write composer script if it exists
                const composerScriptData = notebookScripts.scripts[notebookScripts.uncommittedScriptId];
                if (composerScriptData) {
                    const composerSql = composerScriptData.script.toString();
                    const t0 = new Date();
                    await this.backend.saveScriptDraft(notebookId, composerSql);
                    const t1 = new Date();
                    this.registerWrite(`${notebookId}/scripts/dashql-draft.sql`, composerSql.length, t1.getTime() - t0.getTime());
                    this.completedFileContents.set(`${notebookId}/scripts/dashql-draft.sql`, composerSql);
                }

                // Save notebook last so it never references content that doesn't exist yet.
                // Preserve the original createdAt across rewrites; only stamp it on the first write.
                let connectionParams: any;
                let createdAt: string;
                // Preserve the user-supplied name across a notebook rewrite: this path rebuilds the
                // whole manifest from notebook scripts, which carry no name, so we must carry over
                // whatever the user already set on disk.
                let existingName: string | undefined;
                try {
                    const existingNotebook = await this.backend.loadNotebook(notebookId);
                    connectionParams = existingNotebook.connectionParams;
                    createdAt = existingNotebook.metadata?.createdAt ?? new Date().toISOString();
                    existingName = existingNotebook.name;
                } catch {
                    connectionParams = createDefaultConnectionParamsForConnector(notebookScripts.connectorInfo);
                    createdAt = new Date().toISOString();
                }

                const notebookMetadata: StorageNotebookMetadata = {
                    originalFileName: notebookScripts.notebookMetadata.originalFileName,
                    createdAt,
                };

                const connData: NotebookData = {
                    notebookId: notebookScripts.notebookId,
                    ...(existingName ? { name: existingName } : {}),
                    connectionParams,
                    metadata: notebookMetadata,
                };

                const notebookTimeBefore = new Date();
                await this.backend.saveNotebookManifest(notebookId, connData);
                const notebookTimeAfter = new Date();
                this.registerWrite(`${notebookId}/dashql-notebook.json`, JSON.stringify(connData).length, notebookTimeAfter.getTime() - notebookTimeBefore.getTime());
                this.completedFileContents.set(`${notebookId}/dashql-notebook.json`, JSON.stringify(connData, null, 2));

                break;
            }
            case WRITE_SCRIPT: {
                const [notebookId, folderName, fileName, sql] = task.value;

                this.logger.info("Writing notebook script", {
                    key,
                    notebookId,
                    folder: folderName,
                    file: fileName,
                }, LOG_CTX);

                const timeBefore = new Date();
                await this.backend.saveScript(notebookId, folderName, fileName, sql);
                const actualPath = `${notebookId}/scripts/${folderName}/${fileName}`;
                const timeAfter = new Date();
                this.registerWrite(actualPath, sql.length, timeAfter.getTime() - timeBefore.getTime());
                this.completedFileContents.set(actualPath, sql);
                break;
            }
            case WRITE_SCRIPT_DRAFT: {
                const [notebookId, sql] = task.value;

                this.logger.info("Writing notebook draft", {
                    key,
                    notebookId,
                }, LOG_CTX);

                const timeBefore = new Date();
                await this.backend.saveScriptDraft(notebookId, sql);
                const actualPath = `${notebookId}/scripts/dashql-draft.sql`;
                const timeAfter = new Date();
                this.registerWrite(actualPath, sql.length, timeAfter.getTime() - timeBefore.getTime());
                this.completedFileContents.set(actualPath, sql);
                break;
            }
            case DELETE_NOTEBOOK:
                this.logger.info("Deleting notebook", {
                    task: key,
                    notebookId: task.value
                }, LOG_CTX);
                await this.backend.deleteNotebook(task.value);
                for (const path of this.completedFileContents.keys()) {
                    if (storageWriteKeyBelongsToNotebook(path, task.value)) {
                        this.completedFileContents.set(path, null);
                    }
                }
                break;
            case CREATE_SCRIPT_FOLDER: {
                const [notebookId, folderName, scripts] = task.value;
                this.logger.info("Creating script folder", {
                    task: key,
                    notebookId,
                    folderName,
                }, LOG_CTX);
                await this.backend.createScriptFolder(notebookId, folderName);
                for (const script of scripts) {
                    const t0 = new Date();
                    await this.backend.saveScript(notebookId, folderName, script.fileName, script.sql);
                    const t1 = new Date();
                    this.registerWrite(`${notebookId}/scripts/${folderName}/${script.fileName}`, script.sql.length, t1.getTime() - t0.getTime());
                    this.completedFileContents.set(`${notebookId}/scripts/${folderName}/${script.fileName}`, script.sql);
                }
                break;
            }
            case DELETE_SCRIPT_FOLDER: {
                const [notebookId, folderName] = task.value;
                this.logger.info("Deleting script folder", {
                    task: key,
                    notebookId,
                    folderName,
                }, LOG_CTX);
                await this.backend.deleteScriptFolder(notebookId, folderName);
                for (const path of this.completedFileContents.keys()) {
                    if (path.startsWith(`${notebookId}/scripts/${folderName}/`)) {
                        this.completedFileContents.set(path, null);
                    }
                }
                break;
            }
            case RENAME_SCRIPT_FOLDER: {
                const [notebookId, oldFolderName, newFolderName] = task.value;
                this.logger.info("Renaming script folder", {
                    task: key,
                    notebookId,
                    oldFolderName,
                    newFolderName,
                }, LOG_CTX);
                await this.backend.renameScriptFolder(notebookId, oldFolderName, newFolderName);
                const oldPrefix = `${notebookId}/scripts/${oldFolderName}/`;
                const newPrefix = `${notebookId}/scripts/${newFolderName}/`;
                for (const [path, content] of [...this.completedFileContents]) {
                    if (path.startsWith(oldPrefix)) {
                        this.completedFileContents.set(path, null);
                        this.completedFileContents.set(`${newPrefix}${path.slice(oldPrefix.length)}`, content);
                    }
                }
                break;
            }
            case DELETE_SCRIPT: {
                const [notebookId, folderName, scriptName] = task.value;
                this.logger.info("Deleting notebook script", {
                    task: key,
                    notebookId,
                    folderName,
                    scriptName,
                }, LOG_CTX);
                await this.backend.deleteScript(notebookId, folderName, scriptName);
                this.completedFileContents.set(`${notebookId}/scripts/${folderName}/${scriptName}`, null);
                break;
            }
            case RENAME_SCRIPT: {
                const [notebookId, folderName, oldScriptName, newScriptName] = task.value;
                this.logger.info("Renaming notebook script", {
                    task: key,
                    notebookId,
                    folderName,
                    oldScriptName,
                    newScriptName,
                }, LOG_CTX);
                await this.backend.renameScript(notebookId, folderName, oldScriptName, newScriptName);
                const oldPath = `${notebookId}/scripts/${folderName}/${oldScriptName}`;
                const newPath = `${notebookId}/scripts/${folderName}/${newScriptName}`;
                const content = this.completedFileContents.get(oldPath);
                this.completedFileContents.set(oldPath, null);
                if (content !== undefined) {
                    this.completedFileContents.set(newPath, content);
                }
                break;
            }
        }
    }
}
