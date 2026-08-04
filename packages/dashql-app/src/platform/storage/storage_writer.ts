import * as Immutable from 'immutable';
import * as dashql from '../../core/index.js';

import { Logger, stringifyError } from '../logger/logger.js';
import { VariantKind } from '../../utils/index.js';
import { NotebookState } from '../../notebook/notebook_state.js';
import { ConnectionState } from '../../connection/connection_state.js';
import { getConnectionParamsFromStateDetails, createDefaultConnectionParamsForConnector } from '../../connection/connection_params.js';
import type { StorageBackend, SessionData, NotebookMetadata as StorageNotebookMetadata } from './storage_backend.js';
import { STORAGE_NOTEBOOK_FOLDER, STORAGE_SESSION_FILE } from './storage_backend.js';

const LOG_CTX = 'storage_writer';

/// Order-independent deep equality for plain JSON values (objects, arrays, primitives).
/// Session manifests are plain JSON (no Dates/Maps/functions), so this is sufficient.
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

/// Compare the manifest fields the writer owns (sessionId, name, connectionParams, notebook).
/// Other fields (storageType/nativePath/sessionPath) are display- or registry-only and are not
/// written into the session file, so they're deliberately ignored.
///
/// Both sides are round-tripped through JSON first so this compares exactly what would be
/// persisted: serialization drops `undefined`-valued keys, so a freshly built params object with
/// `{ foo: undefined }` must compare equal to the reloaded `{}` it serializes to.
function sessionManifestEquals(a: SessionData, b: SessionData): boolean {
    const project = (s: SessionData) => JSON.parse(JSON.stringify({
        sessionId: s.sessionId,
        name: s.name,
        connectionParams: s.connectionParams,
        notebook: s.notebook,
    }));
    return jsonDeepEqual(project(a), project(b));
}

export const DEBOUNCE_DURATION_SESSION_WRITE = 100;
export const DEBOUNCE_DURATION_NOTEBOOK_WRITE = 100;
export const DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE = 100;

export const WRITE_SESSION_MANIFEST = Symbol('WRITE_SESSION_MANIFEST');
export const WRITE_SESSION_CATALOG_SCRIPT = Symbol('WRITE_SESSION_CATALOG_SCRIPT');
export const WRITE_SESSION_FUNCTION_SCRIPT = Symbol('WRITE_SESSION_FUNCTION_SCRIPT');
export const REPLACE_NOTEBOOK = Symbol('REPLACE_NOTEBOOK');
export const WRITE_NOTEBOOK_SCRIPT = Symbol('WRITE_NOTEBOOK_SCRIPT');
export const WRITE_NOTEBOOK_DRAFT = Symbol('WRITE_NOTEBOOK_DRAFT');
export const CREATE_NOTEBOOK_PAGE = Symbol('CREATE_NOTEBOOK_PAGE');
export const DELETE_NOTEBOOK_PAGE = Symbol('DELETE_NOTEBOOK_PAGE');
export const RENAME_NOTEBOOK_PAGE = Symbol('RENAME_NOTEBOOK_PAGE');
export const DELETE_SESSION = Symbol('DELETE_SESSION');
export const DELETE_NOTEBOOK = Symbol('DELETE_NOTEBOOK');
export const DELETE_NOTEBOOK_SCRIPT = Symbol('DELETE_NOTEBOOK_SCRIPT');
export const RENAME_NOTEBOOK_SCRIPT = Symbol('RENAME_NOTEBOOK_SCRIPT');

export type StorageWriteTaskVariant =
    | VariantKind<typeof WRITE_SESSION_MANIFEST, [string, ConnectionState]>
    | VariantKind<typeof WRITE_SESSION_CATALOG_SCRIPT, [string, dashql.DashQLScript]>
    | VariantKind<typeof WRITE_SESSION_FUNCTION_SCRIPT, [string, dashql.DashQLScript]>
    | VariantKind<typeof REPLACE_NOTEBOOK, NotebookState>
    | VariantKind<typeof WRITE_NOTEBOOK_SCRIPT, [string, string, string, string]>  // sessionPath, folderName, fileName, sql
    | VariantKind<typeof WRITE_NOTEBOOK_DRAFT, [string, string]>  // sessionPath, sql
    | VariantKind<typeof CREATE_NOTEBOOK_PAGE, [string, string, { scriptId: number, fileName: string, sql: string }[]]>  // sessionPath, pageName, scripts
    | VariantKind<typeof DELETE_NOTEBOOK_PAGE, [string, string]>  // sessionPath, pageName
    | VariantKind<typeof RENAME_NOTEBOOK_PAGE, [string, string, string]>  // sessionPath, oldPageName, newPageName
    | VariantKind<typeof DELETE_SESSION, string>
    | VariantKind<typeof DELETE_NOTEBOOK, string>
    | VariantKind<typeof DELETE_NOTEBOOK_SCRIPT, [string, string, string]>  // sessionPath, pageName, scriptName
    | VariantKind<typeof RENAME_NOTEBOOK_SCRIPT, [string, string, string, string]>  // sessionPath, pageName, oldScriptName, newScriptName
    ;

export type StorageWriteKey = string;
/// The manifest is keyed on its real file path (`<sessionPath>/dashql-session.json`) so the key it is
/// *scheduled* under matches the path its *completed* write is recorded under — otherwise the manifest
/// shows up as two rows in the stats view (a phantom `<sessionPath>/` schedule row plus the real
/// file's write row). Keying both on the file also means a scheduled-but-not-yet-flushed manifest
/// write coalesces onto the same statistics row as its completion.
export const groupSessionWrites = (sessionPath: string) => `${sessionPath}/${STORAGE_SESSION_FILE}`;
export const groupSessionSchemaWrites = (sessionPath: string) => `${sessionPath}/dashql-relations.sql`;
export const groupSessionFunctionWrites = (sessionPath: string) => `${sessionPath}/dashql-functions.sql`;
export const groupNotebookWrites = (sessionPath: string) => `${sessionPath}/${STORAGE_NOTEBOOK_FOLDER}`;
export const groupPageWrites = (sessionPath: string, pageName: string) => `${sessionPath}/${STORAGE_NOTEBOOK_FOLDER}/${pageName}`;
export const groupDraftWrites = (sessionPath: string) => `${sessionPath}/notebook/dashql-draft.sql`;
export const groupScriptWrites = (sessionPath: string, folderName: string, fileName: string) =>
    `${sessionPath}/${STORAGE_NOTEBOOK_FOLDER}/${folderName}/${fileName}`;
export const groupScriptDeletes = (sessionPath: string, pageName: string, scriptName: string) =>
    `${sessionPath}/${STORAGE_NOTEBOOK_FOLDER}/${pageName}/${scriptName}:delete`;
/// A page/script rename lives in its own `:rename` keyspace, keyed by the *source* path. Keeping it
/// off the write/delete keyspaces means a later content write (or delete) of the destination never
/// coalesces onto — and so never clobbers — a still-pending rename of the same name. The action lives
/// in a `:rename` *suffix* rather than a prefix so the key still starts with the session path and
/// sorts/scopes like every other file key.
export const groupPageRenames = (sessionPath: string, oldPageName: string) =>
    `${sessionPath}/${STORAGE_NOTEBOOK_FOLDER}/${oldPageName}:rename`;
export const groupScriptRenames = (sessionPath: string, pageName: string, oldScriptName: string) =>
    `${sessionPath}/${STORAGE_NOTEBOOK_FOLDER}/${pageName}/${oldScriptName}:rename`;

/// Whether a statistics key belongs to a given session. Every write key is a path rooted at the
/// session id (`<sessionId>/…`), with the `:delete`/`:rename` action namespaces living in a suffix
/// (see the group* helpers above), so the session owns the key when it is the session id itself or a
/// descendant of it. Used to scope the storage-writer stats view to the active session.
export function storageWriteKeyBelongsToSession(key: StorageWriteKey, sessionId: string): boolean {
    return key === sessionId || key.startsWith(`${sessionId}/`);
}

/// Strip the session-id prefix from a write key for display, keeping any `:delete`/`:rename` suffix
/// so the action stays legible. Once the stats view is scoped to a single session the session id is
/// redundant on every row, so e.g. `<sessionId>/notebook/page-1/01.sql` renders as
/// `notebook/page-1/01.sql` and `<sessionId>/notebook/page-1:rename` as `notebook/page-1:rename`.
/// The bare session key collapses to an empty string. Keys that don't belong to the session are
/// returned unchanged.
export function storageWriteKeyWithinSession(key: StorageWriteKey, sessionId: string): string {
    if (!storageWriteKeyBelongsToSession(key, sessionId)) {
        return key;
    }
    return key === sessionId ? '' : key.slice(sessionId.length + 1);
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
    /// Sessions temporarily held by external reload/conflict handling.
    pausedSessions: Set<string>;
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
        this.pausedSessions = new Set();
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
            if ([...this.pausedSessions].some(sessionId => storageWriteKeyBelongsToSession(key, sessionId))) {
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

    public pauseSession(sessionId: string): void {
        this.pausedSessions.add(sessionId);
        for (const [key, task] of this.pendingTasks) {
            if (storageWriteKeyBelongsToSession(key, sessionId)) {
                clearTimeout(task.timer);
            }
        }
    }

    public resumeSession(sessionId: string): void {
        if (!this.pausedSessions.delete(sessionId) || this.paused) {
            return;
        }
        for (const [key, task] of this.pendingTasks) {
            if (storageWriteKeyBelongsToSession(key, sessionId)) {
                task.timer = setTimeout(() => this.processTask(key), task.debounceDurationMs);
            }
        }
    }

    /// Pending write keys below a session path. This is intentionally path-based: every writer key
    /// is rooted at the session id, including the delete/rename action namespaces.
    public getPendingKeysForSession(sessionId: string, include: (key: string) => boolean = () => true): string[] {
        return [...this.pendingTasks.keys()].filter(key => storageWriteKeyBelongsToSession(key, sessionId) && include(key));
    }

    /// Discard pending writes for a session, resolving their promises as not executed. Used only
    /// after the user explicitly chooses an externally-written disk version over local debounced
    /// edits. Writes already in flight cannot be cancelled and are handled by settle().
    public cancelPendingWritesForSession(sessionId: string, include: (key: string) => boolean = () => true): void {
        for (const [key, task] of this.pendingTasks) {
            if (!storageWriteKeyBelongsToSession(key, sessionId) || !include(key)) {
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

    public getSessionWriteGeneration(sessionId: string, include: (key: string) => boolean = () => true): number {
        let generation = 0;
        for (const [key, value] of this.writeKeyGenerations) {
            if (storageWriteKeyBelongsToSession(key, sessionId) && include(key)) {
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
        if (!force && (this.paused || [...this.pausedSessions].some(sessionId => storageWriteKeyBelongsToSession(key, sessionId)))) {
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
            case WRITE_SESSION_MANIFEST: {
                const [sessionPath, conn] = task.value;
                this.logger.info("Writing session", {
                    key,
                    sessionPath,
                    sessionId: conn.sessionId,
                }, LOG_CTX);

                // Extract connection params
                const connectionParams = getConnectionParamsFromStateDetails(conn.details);
                if (!connectionParams) {
                    this.logger.debug("Skipping session write: connection not yet configured", {
                        sessionId: conn.sessionId,
                        connectorType: conn.connectorInfo.connectorType.toString()
                    }, LOG_CTX);
                    break;
                }

                // Load whatever is already on disk so we can (a) preserve the original createdAt
                // instead of churning a fresh timestamp on every write, and (b) skip the write
                // entirely when nothing actually changed. WRITE_SESSION_MANIFEST is scheduled on
                // every connection-state change, so most of these tasks rewrite identical content.
                let existingSession: SessionData | null = null;
                try {
                    existingSession = await this.backend.loadSession(sessionPath);
                } catch {
                    existingSession = null;
                }

                // For now, create minimal notebook metadata
                const notebookMetadata: StorageNotebookMetadata = {
                    originalFileName: undefined,
                    createdAt: existingSession?.notebook?.createdAt ?? new Date().toISOString(),
                };

                // sessionPath is a display-only field, recomputed from the uuid + location for
                // the UI; we don't persist it here. storageType/nativePath are stamped by the
                // composite backend, which knows the session's physical location.
                const connData: SessionData = {
                    sessionId: conn.sessionId,
                    // `name` is the user-supplied label, omitted entirely when unset so a session
                    // the user never named carries no `name` key at all.
                    ...(conn.name ? { name: conn.name } : {}),
                    connectionParams,
                    notebook: notebookMetadata,
                };

                // Skip the write if the persisted manifest already matches what we'd write.
                if (existingSession != null && sessionManifestEquals(existingSession, connData)) {
                    this.logger.debug("Skipping session write: manifest unchanged", {
                        sessionId: conn.sessionId,
                    }, LOG_CTX);
                    break;
                }

                const timeBefore = new Date();
                await this.backend.saveSessionManifest(sessionPath, connData);
                const timeAfter = new Date();
                const writeDuration = timeAfter.getTime() - timeBefore.getTime();
                const actualPath = `${sessionPath}/dashql-session.json`;
                this.registerWrite(actualPath, JSON.stringify(connData).length, writeDuration);
                this.completedFileContents.set(actualPath, JSON.stringify(connData, null, 2));
                break;
            }
            case WRITE_SESSION_CATALOG_SCRIPT: {
                const [sessionPath, catalogRelationScript] = task.value;
                this.logger.info("Writing session schema", {
                    key,
                    sessionPath,
                }, LOG_CTX);

                // Get the SQL from the catalog script
                const schemaSQL = catalogRelationScript.toString();

                const timeBefore = new Date();
                await this.backend.saveSessionSchema(sessionPath, schemaSQL);
                const timeAfter = new Date();
                const writeDuration = timeAfter.getTime() - timeBefore.getTime();
                const actualPath = `${sessionPath}/dashql-relations.sql`;
                this.registerWrite(actualPath, schemaSQL.length, writeDuration);
                this.completedFileContents.set(actualPath, schemaSQL);
                break;
            }
            case WRITE_SESSION_FUNCTION_SCRIPT: {
                const [sessionPath, functionScript] = task.value;
                this.logger.info("Writing session functions", {
                    key,
                    sessionPath,
                }, LOG_CTX);

                const functionsSQL = functionScript.toString();

                const timeBefore = new Date();
                await this.backend.saveSessionFunctions(sessionPath, functionsSQL);
                const timeAfter = new Date();
                const writeDuration = timeAfter.getTime() - timeBefore.getTime();
                const actualPath = `${sessionPath}/dashql-functions.sql`;
                this.registerWrite(actualPath, functionsSQL.length, writeDuration);
                this.completedFileContents.set(actualPath, functionsSQL);
                break;
            }
            case REPLACE_NOTEBOOK: {
                const notebook = task.value;
                this.logger.info("Creating notebook", {
                    key,
                    sessionPath: notebook.sessionId,
                }, LOG_CTX);

                const sessionPath = notebook.sessionId;

                // Write all pages and their scripts first
                for (const folderName in notebook.notebookPages) {
                    const page = notebook.notebookPages[folderName];
                    await this.backend.createNotebookPage(sessionPath, folderName);

                    for (const fileName in page.scripts) {
                        const pageScript = page.scripts[fileName];
                        const scriptData = notebook.scripts[pageScript.scriptId];
                        if (scriptData) {
                            const sql = scriptData.script.toString();
                            const t0 = new Date();
                            await this.backend.saveNotebookScript(sessionPath, folderName, pageScript.fileName, sql);
                            const t1 = new Date();
                            this.registerWrite(`${sessionPath}/notebook/${folderName}/${pageScript.fileName}`, sql.length, t1.getTime() - t0.getTime());
                            this.completedFileContents.set(`${sessionPath}/notebook/${folderName}/${pageScript.fileName}`, sql);
                        }
                    }
                }

                // Write composer script if it exists
                const composerScriptData = notebook.scripts[notebook.uncommittedScriptId];
                if (composerScriptData) {
                    const composerSql = composerScriptData.script.toString();
                    const t0 = new Date();
                    await this.backend.saveNotebookScriptDraft(sessionPath, composerSql);
                    const t1 = new Date();
                    this.registerWrite(`${sessionPath}/notebook/dashql-draft.sql`, composerSql.length, t1.getTime() - t0.getTime());
                    this.completedFileContents.set(`${sessionPath}/notebook/dashql-draft.sql`, composerSql);
                }

                // Save session last so it never references content that doesn't exist yet.
                // Preserve the original createdAt across rewrites; only stamp it on the first write.
                let connectionParams: any;
                let createdAt: string;
                // Preserve the user-supplied name across a notebook rewrite: this path rebuilds the
                // whole manifest from notebook state, which carries no name, so we must carry over
                // whatever the user already set on disk.
                let existingName: string | undefined;
                try {
                    const existingSession = await this.backend.loadSession(sessionPath);
                    connectionParams = existingSession.connectionParams;
                    createdAt = existingSession.notebook?.createdAt ?? new Date().toISOString();
                    existingName = existingSession.name;
                } catch {
                    connectionParams = createDefaultConnectionParamsForConnector(notebook.connectorInfo);
                    createdAt = new Date().toISOString();
                }

                const notebookMetadata: StorageNotebookMetadata = {
                    originalFileName: notebook.notebookMetadata.originalFileName,
                    createdAt,
                };

                const connData: SessionData = {
                    sessionId: notebook.sessionId,
                    ...(existingName ? { name: existingName } : {}),
                    connectionParams,
                    notebook: notebookMetadata,
                };

                const sessionTimeBefore = new Date();
                await this.backend.saveSessionManifest(sessionPath, connData);
                const sessionTimeAfter = new Date();
                this.registerWrite(`${sessionPath}/dashql-session.json`, JSON.stringify(connData).length, sessionTimeAfter.getTime() - sessionTimeBefore.getTime());
                this.completedFileContents.set(`${sessionPath}/dashql-session.json`, JSON.stringify(connData, null, 2));

                break;
            }
            case WRITE_NOTEBOOK_SCRIPT: {
                const [sessionPath, folderName, fileName, sql] = task.value;

                this.logger.info("Writing notebook script", {
                    key,
                    sessionPath,
                    folder: folderName,
                    file: fileName,
                }, LOG_CTX);

                const timeBefore = new Date();
                await this.backend.saveNotebookScript(sessionPath, folderName, fileName, sql);
                const actualPath = `${sessionPath}/notebook/${folderName}/${fileName}`;
                const timeAfter = new Date();
                this.registerWrite(actualPath, sql.length, timeAfter.getTime() - timeBefore.getTime());
                this.completedFileContents.set(actualPath, sql);
                break;
            }
            case WRITE_NOTEBOOK_DRAFT: {
                const [sessionPath, sql] = task.value;

                this.logger.info("Writing notebook draft", {
                    key,
                    sessionPath,
                }, LOG_CTX);

                const timeBefore = new Date();
                await this.backend.saveNotebookScriptDraft(sessionPath, sql);
                const actualPath = `${sessionPath}/notebook/dashql-draft.sql`;
                const timeAfter = new Date();
                this.registerWrite(actualPath, sql.length, timeAfter.getTime() - timeBefore.getTime());
                this.completedFileContents.set(actualPath, sql);
                break;
            }
            case DELETE_SESSION:
                this.logger.info("Deleting session", {
                    task: key,
                    sessionPath: task.value
                }, LOG_CTX);
                await this.backend.deleteSession(task.value);
                for (const path of this.completedFileContents.keys()) {
                    if (storageWriteKeyBelongsToSession(path, task.value)) {
                        this.completedFileContents.set(path, null);
                    }
                }
                break;
            case DELETE_NOTEBOOK:
                // Deleting notebook means deleting the session (1:1 relationship)
                this.logger.info("Deleting notebook (session)", {
                    task: key,
                    sessionPath: task.value
                }, LOG_CTX);
                await this.backend.deleteSession(task.value);
                break;
            case CREATE_NOTEBOOK_PAGE: {
                const [sessionPath, pageName, scripts] = task.value;
                this.logger.info("Creating notebook page", {
                    task: key,
                    sessionPath,
                    pageName,
                }, LOG_CTX);
                await this.backend.createNotebookPage(sessionPath, pageName);
                for (const script of scripts) {
                    const t0 = new Date();
                    await this.backend.saveNotebookScript(sessionPath, pageName, script.fileName, script.sql);
                    const t1 = new Date();
                    this.registerWrite(`${sessionPath}/notebook/${pageName}/${script.fileName}`, script.sql.length, t1.getTime() - t0.getTime());
                    this.completedFileContents.set(`${sessionPath}/notebook/${pageName}/${script.fileName}`, script.sql);
                }
                break;
            }
            case DELETE_NOTEBOOK_PAGE: {
                const [sessionPath, pageName] = task.value;
                this.logger.info("Deleting notebook page", {
                    task: key,
                    sessionPath,
                    pageName,
                }, LOG_CTX);
                await this.backend.deleteNotebookPage(sessionPath, pageName);
                for (const path of this.completedFileContents.keys()) {
                    if (path.startsWith(`${sessionPath}/notebook/${pageName}/`)) {
                        this.completedFileContents.set(path, null);
                    }
                }
                break;
            }
            case RENAME_NOTEBOOK_PAGE: {
                const [sessionPath, oldPageName, newPageName] = task.value;
                this.logger.info("Renaming notebook page", {
                    task: key,
                    sessionPath,
                    oldPageName,
                    newPageName,
                }, LOG_CTX);
                await this.backend.renameNotebookPage(sessionPath, oldPageName, newPageName);
                const oldPrefix = `${sessionPath}/notebook/${oldPageName}/`;
                const newPrefix = `${sessionPath}/notebook/${newPageName}/`;
                for (const [path, content] of [...this.completedFileContents]) {
                    if (path.startsWith(oldPrefix)) {
                        this.completedFileContents.set(path, null);
                        this.completedFileContents.set(`${newPrefix}${path.slice(oldPrefix.length)}`, content);
                    }
                }
                break;
            }
            case DELETE_NOTEBOOK_SCRIPT: {
                const [sessionPath, pageName, scriptName] = task.value;
                this.logger.info("Deleting notebook script", {
                    task: key,
                    sessionPath,
                    pageName,
                    scriptName,
                }, LOG_CTX);
                await this.backend.deleteNotebookScript(sessionPath, pageName, scriptName);
                this.completedFileContents.set(`${sessionPath}/notebook/${pageName}/${scriptName}`, null);
                break;
            }
            case RENAME_NOTEBOOK_SCRIPT: {
                const [sessionPath, pageName, oldScriptName, newScriptName] = task.value;
                this.logger.info("Renaming notebook script", {
                    task: key,
                    sessionPath,
                    pageName,
                    oldScriptName,
                    newScriptName,
                }, LOG_CTX);
                await this.backend.renameNotebookScript(sessionPath, pageName, oldScriptName, newScriptName);
                const oldPath = `${sessionPath}/notebook/${pageName}/${oldScriptName}`;
                const newPath = `${sessionPath}/notebook/${pageName}/${newScriptName}`;
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
