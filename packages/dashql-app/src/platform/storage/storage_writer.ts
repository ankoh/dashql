import * as Immutable from 'immutable';
import * as dashql from '../../core/index.js';

import { Logger } from '../logger/logger.js';
import { VariantKind } from '../../utils/index.js';
import { ScriptData, NotebookState } from '../../notebook/notebook_state.js';
import { ConnectionState } from '../../connection/connection_state.js';
import { getConnectionParamsFromStateDetails, createDefaultConnectionParamsForConnector } from '../../connection/connection_params.js';
import type { StorageBackend, SessionData, NotebookMetadata as StorageNotebookMetadata } from './storage_backend.js';
import { STORAGE_NOTEBOOK_FOLDER } from './storage_backend.js';

const LOG_CTX = 'storage_writer';

export const DEBOUNCE_DURATION_SESSION_WRITE = 100;
export const DEBOUNCE_DURATION_NOTEBOOK_WRITE = 100;
export const DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE = 100;

export const WRITE_SESSION = Symbol('WRITE_SESSION');
export const WRITE_SESSION_SCHEMA = Symbol('WRITE_SESSION_SCHEMA');
export const WRITE_NOTEBOOK = Symbol('WRITE_NOTEBOOK');
export const WRITE_NOTEBOOK_SCRIPT = Symbol('WRITE_NOTEBOOK_SCRIPT');
export const DELETE_SESSION = Symbol('DELETE_SESSION');
export const DELETE_NOTEBOOK = Symbol('DELETE_NOTEBOOK');
export const DELETE_NOTEBOOK_SCRIPT = Symbol('DELETE_NOTEBOOK_SCRIPT');

export type StorageWriteTaskVariant =
    | VariantKind<typeof WRITE_SESSION, [string, ConnectionState]>
    | VariantKind<typeof WRITE_SESSION_SCHEMA, [string, dashql.DashQLScript]>
    | VariantKind<typeof WRITE_NOTEBOOK, NotebookState>
    | VariantKind<typeof WRITE_NOTEBOOK_SCRIPT, [string, string, ScriptData]>  // sessionPath, scriptName, scriptData
    | VariantKind<typeof DELETE_SESSION, string>
    | VariantKind<typeof DELETE_NOTEBOOK, string>
    | VariantKind<typeof DELETE_NOTEBOOK_SCRIPT, [string, string]>  // sessionPath, scriptName
    ;

export type StorageWriteKey = string;
export const groupSessionWrites = (sessionPath: string) => `session/${sessionPath}`;
export const groupSessionSchemaWrites = (sessionPath: string) => `session/${sessionPath}/schema`;
export const groupNotebookWrites = (sessionPath: string) => `${STORAGE_NOTEBOOK_FOLDER}/${sessionPath}`;
export const groupScriptWrites = (sessionPath: string, scriptName: string) => `${STORAGE_NOTEBOOK_FOLDER}/${sessionPath}/script/${scriptName}`;

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

    constructor(logger: Logger, backend: StorageBackend) {
        this.logger = logger;
        this.backend = backend;
        this.pendingTasks = new Map();
        this.statistics = Immutable.Map();
        this.statisticsSubscribers = new Set();
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
        this.pendingTasks.delete(key);
        try {
            await this.executeTask(key, task.latestTask);
            task.resolveLatestTask(true);
        } catch (e: any) {
            this.logger.error("executing write task failed", {
                key: key,
                error: e.toString()
            })
            task.resolveLatestTask(false);
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
            case WRITE_SESSION: {
                const [sessionPath, conn] = task.value;
                this.logger.info("writing session", {
                    key,
                    sessionPath,
                    sessionId: conn.sessionId,
                }, LOG_CTX);

                // Extract connection params
                const connectionParams = getConnectionParamsFromStateDetails(conn.details);
                if (!connectionParams) {
                    this.logger.debug("skipping session write: connection not yet configured", {
                        sessionId: conn.sessionId,
                        connectorType: conn.connectorInfo.connectorType.toString()
                    }, LOG_CTX);
                    break;
                }

                // For now, create minimal notebook metadata
                const notebookMetadata: StorageNotebookMetadata = {
                    originalFileName: undefined,
                    createdAt: new Date().toISOString(),
                };

                const connData: SessionData = {
                    sessionId: conn.sessionId,
                    sessionPath,
                    title: conn.connectorInfo.names.fileShort || "Untitled",
                    connectionParams,
                    notebook: notebookMetadata,
                };

                const timeBefore = new Date();
                await this.backend.saveSession(sessionPath, connData);
                const timeAfter = new Date();
                const writeDuration = timeAfter.getTime() - timeBefore.getTime();
                this.registerWrite(key, JSON.stringify(connData).length, writeDuration);
                break;
            }
            case WRITE_SESSION_SCHEMA: {
                const [sessionPath, catalogScript] = task.value;
                this.logger.info("writing session schema", {
                    key,
                    sessionPath,
                }, LOG_CTX);

                // Get the SQL from the catalog script
                const schemaSQL = catalogScript.toString();

                const timeBefore = new Date();
                await this.backend.saveSessionSchema(sessionPath, schemaSQL);
                const timeAfter = new Date();
                const writeDuration = timeAfter.getTime() - timeBefore.getTime();
                this.registerWrite(key, schemaSQL.length, writeDuration);
                break;
            }
            case WRITE_NOTEBOOK: {
                const notebook = task.value;
                this.logger.info("writing notebook", {
                    key,
                    sessionPath: notebook.sessionPath,
                }, LOG_CTX);

                const timeBefore = new Date();
                let totalBytes = 0;

                const sessionPath = notebook.sessionPath;

                // Load existing session data to preserve connection params
                let connectionParams: any;
                try {
                    const existingSession = await this.backend.loadSession(sessionPath);
                    connectionParams = existingSession.connectionParams;
                } catch {
                    // Session doesn't exist yet, create default params for this connector
                    connectionParams = createDefaultConnectionParamsForConnector(notebook.connectorInfo);
                }

                const notebookMetadata: StorageNotebookMetadata = {
                    originalFileName: notebook.notebookMetadata.originalFileName,
                    createdAt: new Date().toISOString(),
                };

                const connData: SessionData = {
                    sessionId: notebook.sessionId,
                    sessionPath,
                    title: notebook.notebookMetadata.originalFileName || "Untitled",
                    connectionParams,
                    notebook: notebookMetadata,
                };

                await this.backend.saveSession(sessionPath, connData);
                totalBytes += JSON.stringify(connData).length;

                // Write all pages and their scripts
                for (let pageIdx = 0; pageIdx < notebook.notebookPages.length; pageIdx++) {
                    const page = notebook.notebookPages[pageIdx];
                    const pageName = `page-${pageIdx + 1}`; // page-1, page-2, page-3, etc.

                    // Create page folder
                    await this.backend.createNotebookPage(sessionPath, pageName);

                    // Write all scripts in this page
                    for (let entryIdx = 0; entryIdx < page.scripts.length; entryIdx++) {
                        const pageScript = page.scripts[entryIdx];
                        const scriptName = `${String(entryIdx + 1).padStart(2, '0')}-script.sql`; // 01-script.sql, 02-script.sql, etc.

                        // Look up the actual script data
                        const scriptData = notebook.scripts[pageScript.scriptId];
                        if (scriptData) {
                            const sql = scriptData.script.toString();

                            await this.backend.saveNotebookScript(
                                sessionPath,
                                pageName,
                                scriptName,
                                sql
                            );
                            totalBytes += sql.length;
                        }
                    }
                }

                // Write composer script if it exists
                const composerScriptData = notebook.scripts[notebook.uncommittedScriptId];
                if (composerScriptData) {
                    const composerSql = composerScriptData.script.toString();
                    await this.backend.saveNotebookScriptDraft(sessionPath, composerSql);
                    totalBytes += composerSql.length;
                }

                const timeAfter = new Date();
                const writeDuration = timeAfter.getTime() - timeBefore.getTime();
                this.registerWrite(key, totalBytes, writeDuration);
                break;
            }
            case WRITE_NOTEBOOK_SCRIPT: {
                // Individual script writes are complex in the new model because we need page context
                // For now, we skip individual script writes and rely on full notebook writes
                // TODO: Implement this by querying notebook state to find which page(s) this script belongs to
                this.logger.info("skipping individual script write (use WRITE_NOTEBOOK instead)", {
                    key,
                }, LOG_CTX);
                break;
            }
            case DELETE_SESSION:
                this.logger.info("deleting session", {
                    task: key,
                    sessionPath: task.value
                }, LOG_CTX);
                await this.backend.deleteSession(task.value);
                break;
            case DELETE_NOTEBOOK:
                // Deleting notebook means deleting the session (1:1 relationship)
                this.logger.info("deleting notebook (session)", {
                    task: key,
                    sessionPath: task.value
                }, LOG_CTX);
                await this.backend.deleteSession(task.value);
                break;
            case DELETE_NOTEBOOK_SCRIPT: {
                // Individual script deletes are complex in the new model
                // For now, skip and rely on full notebook writes
                // TODO: Implement by finding page context and calling backend.deleteScript
                this.logger.info("skipping individual script delete (use WRITE_NOTEBOOK instead)", {
                    task: key,
                }, LOG_CTX);
                break;
            }
        }
    }
}
