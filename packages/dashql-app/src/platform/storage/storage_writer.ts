import * as Immutable from 'immutable';
import * as dashql from '../../core/index.js';

import { Logger, stringifyError } from '../logger/logger.js';
import { VariantKind } from '../../utils/index.js';
import { NotebookState } from '../../notebook/notebook_state.js';
import { ConnectionState } from '../../connection/connection_state.js';
import { getConnectionParamsFromStateDetails, createDefaultConnectionParamsForConnector } from '../../connection/connection_params.js';
import type { StorageBackend, SessionData, NotebookMetadata as StorageNotebookMetadata } from './storage_backend.js';
import { STORAGE_NOTEBOOK_FOLDER } from './storage_backend.js';

const LOG_CTX = 'storage_writer';

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
export const DELETE_SESSION = Symbol('DELETE_SESSION');
export const DELETE_NOTEBOOK = Symbol('DELETE_NOTEBOOK');
export const DELETE_NOTEBOOK_SCRIPT = Symbol('DELETE_NOTEBOOK_SCRIPT');

export type StorageWriteTaskVariant =
    | VariantKind<typeof WRITE_SESSION_MANIFEST, [string, ConnectionState]>
    | VariantKind<typeof WRITE_SESSION_CATALOG_SCRIPT, [string, dashql.DashQLScript]>
    | VariantKind<typeof WRITE_SESSION_FUNCTION_SCRIPT, [string, dashql.DashQLScript]>
    | VariantKind<typeof REPLACE_NOTEBOOK, NotebookState>
    | VariantKind<typeof WRITE_NOTEBOOK_SCRIPT, [string, string, string, string]>  // sessionPath, folderName, fileName, sql
    | VariantKind<typeof WRITE_NOTEBOOK_DRAFT, [string, string]>  // sessionPath, sql
    | VariantKind<typeof CREATE_NOTEBOOK_PAGE, [string, string, { scriptId: number, fileName: string, sql: string }[]]>  // sessionPath, pageName, scripts
    | VariantKind<typeof DELETE_NOTEBOOK_PAGE, [string, string]>  // sessionPath, pageName
    | VariantKind<typeof DELETE_SESSION, string>
    | VariantKind<typeof DELETE_NOTEBOOK, string>
    | VariantKind<typeof DELETE_NOTEBOOK_SCRIPT, [string, string, string]>  // sessionPath, pageName, scriptName
    ;

export type StorageWriteKey = string;
export const groupSessionWrites = (sessionPath: string) => `${sessionPath}/`;
export const groupSessionSchemaWrites = (sessionPath: string) => `${sessionPath}/dashql-relations.sql`;
export const groupSessionFunctionWrites = (sessionPath: string) => `${sessionPath}/dashql-functions.sql`;
export const groupNotebookWrites = (sessionPath: string) => `${sessionPath}/${STORAGE_NOTEBOOK_FOLDER}`;
export const groupPageWrites = (sessionPath: string, pageName: string) => `${sessionPath}/${STORAGE_NOTEBOOK_FOLDER}/${pageName}`;
export const groupDraftWrites = (sessionPath: string) => `${sessionPath}/notebook/dashql-draft.sql`;
export const groupScriptWrites = (sessionPath: string, folderName: string, fileName: string) =>
    `${sessionPath}/${STORAGE_NOTEBOOK_FOLDER}/${folderName}/${fileName}`;
export const groupScriptDeletes = (sessionPath: string, pageName: string, scriptName: string) =>
    `delete:${sessionPath}/${STORAGE_NOTEBOOK_FOLDER}/${pageName}/${scriptName}`;

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
    /// The executions that are currently in flight (used by flush() to await completion).
    inFlight: Set<Promise<void>>;

    constructor(logger: Logger, backend: StorageBackend) {
        this.logger = logger;
        this.backend = backend;
        this.pendingTasks = new Map();
        this.statistics = Immutable.Map();
        this.statisticsSubscribers = new Set();
        this.paused = false;
        this.inFlight = new Set();
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
            await this.processTask(key);
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
    public subscribeStatisticsListener(listener: StorageWriteStatisticsSubscriber) {
        this.statisticsSubscribers.add(listener);

    }
    public unsubscribeStatisticsListener(listener: StorageWriteStatisticsSubscriber) {
        this.statisticsSubscribers.delete(listener);
    }

    public async write(key: string, task: StorageWriteTaskVariant, debounceFor: number = 0): Promise<boolean> {
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

    protected async processTask(key: string) {
        const task = this.pendingTasks.get(key);
        if (!task) {
            return;
        }
        // If a timer fires while paused, leave the task pending - it'll be re-armed on resume().
        if (this.paused) {
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

                // Preserve the original createdAt across rewrites; only stamp it on the first write.
                // Otherwise every connection-state change would churn the manifest with a fresh
                // timestamp even when nothing else changed.
                let createdAt: string;
                try {
                    const existingSession = await this.backend.loadSession(sessionPath);
                    createdAt = existingSession.notebook?.createdAt ?? new Date().toISOString();
                } catch {
                    createdAt = new Date().toISOString();
                }

                // For now, create minimal notebook metadata
                const notebookMetadata: StorageNotebookMetadata = {
                    originalFileName: undefined,
                    createdAt,
                };

                // sessionPath is a display-only field, recomputed from the uuid + location for
                // the UI; we don't persist it here. storageType/nativePath are stamped by the
                // composite backend, which knows the session's physical location.
                const connData: SessionData = {
                    sessionId: conn.sessionId,
                    title: conn.connectorInfo.names.fileShort || "Untitled",
                    connectionParams,
                    notebook: notebookMetadata,
                };

                const timeBefore = new Date();
                await this.backend.saveSessionManifest(sessionPath, connData);
                const timeAfter = new Date();
                const writeDuration = timeAfter.getTime() - timeBefore.getTime();
                const actualPath = `${sessionPath}/dashql-session.json`;
                this.registerWrite(actualPath, JSON.stringify(connData).length, writeDuration);
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
                }

                // Save session last so it never references content that doesn't exist yet.
                // Preserve the original createdAt across rewrites; only stamp it on the first write.
                let connectionParams: any;
                let createdAt: string;
                try {
                    const existingSession = await this.backend.loadSession(sessionPath);
                    connectionParams = existingSession.connectionParams;
                    createdAt = existingSession.notebook?.createdAt ?? new Date().toISOString();
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
                    title: notebook.notebookMetadata.originalFileName || "Untitled",
                    connectionParams,
                    notebook: notebookMetadata,
                };

                const sessionTimeBefore = new Date();
                await this.backend.saveSessionManifest(sessionPath, connData);
                const sessionTimeAfter = new Date();
                this.registerWrite(`${sessionPath}/dashql-session.json`, JSON.stringify(connData).length, sessionTimeAfter.getTime() - sessionTimeBefore.getTime());

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
                break;
            }
            case DELETE_SESSION:
                this.logger.info("Deleting session", {
                    task: key,
                    sessionPath: task.value
                }, LOG_CTX);
                await this.backend.deleteSession(task.value);
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
                break;
            }
        }
    }
}
