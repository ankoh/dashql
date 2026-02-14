import * as Immutable from 'immutable';
import * as dashql from '@ankoh/dashql-core';
import * as pb from '@ankoh/dashql-protobuf';
import * as buf from "@bufbuild/protobuf";

import { DB } from './storage_setup.js';
import { Logger } from '../platform/logger.js';
import { VariantKind } from '../utils/index.js';
import { ScriptData, NotebookState } from '../notebook/notebook_state.js';
import { encodeCatalogAsProto } from '../connection/catalog_export.js';
import { encodeNotebookAsProto } from '../notebook/notebook_export.js';
import { encodeConnectionAsProto } from '../connection/connection_export.js';
import { ConnectionState } from '../connection/connection_state.js';

const LOG_CTX = 'storage_writer';

export const DEBOUNCE_DURATION_CATALOG_WRITE = 100;
export const DEBOUNCE_DURATION_CONNECTION_WRITE = 100;
export const DEBOUNCE_DURATION_NOTEBOOK_WRITE = 100;
export const DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE = 100;

export const WRITE_CONNECTION_STATE = Symbol('WRITE_CONNECTION_STATE');
export const WRITE_CONNECTION_CATALOG = Symbol('WRITE_CONNECTION_CATALOG');
export const WRITE_NOTEBOOK_STATE = Symbol('WRITE_NOTEBOOK_STATE');
export const WRITE_NOTEBOOK_SCRIPT = Symbol('WRITE_NOTEBOOK_SCRIPT');
export const DELETE_CONNECTION_STATE = Symbol('DELETE_CONNECTION_STATE');
export const DELETE_CONNECTION_CATALOG = Symbol('DELETE_CONNECTION_CATALOG');
export const DELETE_NOTEBOOK_STATE = Symbol('DELETE_NOTEBOOK_STATE');
export const DELETE_NOTEBOOK_SCRIPT = Symbol('DELETE_NOTEBOOK_SCRIPT');

export type StorageWriteTaskVariant =
    | VariantKind<typeof WRITE_CONNECTION_STATE, [number, ConnectionState]>
    | VariantKind<typeof WRITE_CONNECTION_CATALOG, [number, dashql.DashQLCatalog]>
    | VariantKind<typeof WRITE_NOTEBOOK_STATE, [number, NotebookState]>
    | VariantKind<typeof WRITE_NOTEBOOK_SCRIPT, [number, number, ScriptData]>
    | VariantKind<typeof DELETE_CONNECTION_STATE, number>
    | VariantKind<typeof DELETE_CONNECTION_CATALOG, number>
    | VariantKind<typeof DELETE_NOTEBOOK_STATE, number>
    | VariantKind<typeof DELETE_NOTEBOOK_SCRIPT, [number, number]>
    ;

export type StorageWriteKey = string;
export const groupConnectionWrites = (id: number) => `conn/${id}`;
export const groupCatalogWrites = (id: number) => `conn/${id}/catalog`;
export const groupNotebookWrites = (id: number) => `notebook/${id}`;
export const groupScriptWrites = (id: number, script: number) => `notebook/${id}/script/${script}`;

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
    /// The pending tasks
    pendingTasks: Map<StorageWriteKey, AsyncStorageWriteTask>;
    /// The statistics
    statistics: StorageWriteStatisticsMap;
    /// The listeners for 
    statisticsSubscribers: Set<StorageWriteStatisticsSubscriber>;

    constructor(logger: Logger) {
        this.logger = logger;
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

    public async write(key: string, task: StorageWriteTaskVariant, debounceFor: number = 0) {
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
        await taskPromise;
    }

    protected async processTask(key: string) {
        const task = this.pendingTasks.get(key);
        if (!task) {
            return;
        }
        this.pendingTasks.delete(key);
        try {
            this.executeTask(key, task.latestTask);
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
            case WRITE_CONNECTION_STATE: {
                const [connectionId, conn] = task.value;
                const connectionProto = encodeConnectionAsProto(conn);
                const connectionBytes = buf.toBinary(pb.dashql.connection.ConnectionSchema, connectionProto);
                this.logger.info("writing connection", {
                    key,
                    connectionId: connectionId.toString(),
                    connectionBytes: connectionBytes.byteLength.toString(),
                }, LOG_CTX);
                const timeBefore = new Date();
                await DB.connections.put({
                    connectionId,
                    connectionProto: connectionBytes,
                }, connectionId);
                const timeAfter = new Date();
                const writeDuration = timeAfter.getTime() - timeBefore.getTime();
                this.registerWrite(key, connectionBytes.byteLength, writeDuration);
                break;
            }
            case WRITE_CONNECTION_CATALOG: {
                const [connectionId, catalog] = task.value;
                const catalogSnapshot = catalog.createSnapshot();
                const catalogProto = encodeCatalogAsProto(catalogSnapshot, null);
                const catalogBytes = buf.toBinary(pb.dashql.catalog.CatalogSchema$, catalogProto);
                this.logger.info("writing connection catalog", {
                    key,
                    connectionId: connectionId.toString(),
                    catalogSizeBytes: catalogBytes.byteLength.toString(),
                }, LOG_CTX);
                const timeBefore = new Date();
                await DB.connectionCatalogs.put({
                    connectionId,
                    catalogProto: catalogBytes,
                }, connectionId);
                const timeAfter = new Date();
                const writeDuration = timeAfter.getTime() - timeBefore.getTime();
                this.registerWrite(key, catalogBytes.byteLength, writeDuration);
                break;
            }
            case WRITE_NOTEBOOK_STATE: {
                const [notebookId, notebook] = task.value;
                this.logger.info("writing script text", {
                    key,
                    notebookId: notebookId.toString(),
                    connectionId: notebook.connectionId.toString(),
                }, LOG_CTX);
                const notebookProto = encodeNotebookAsProto(notebook, false, null);
                const notebookBytes = buf.toBinary(pb.dashql.notebook.NotebookSchema, notebookProto);
                const timeBefore = new Date();
                await DB.notebooks.put({
                    notebookId,
                    connectionId: notebook.connectionId,
                    notebookProto: notebookBytes,
                }, notebookId);
                const timeAfter = new Date();
                const writeDuration = timeAfter.getTime() - timeBefore.getTime();
                this.registerWrite(key, notebookBytes.byteLength, writeDuration);
                break;
            }
            case WRITE_NOTEBOOK_SCRIPT: {
                const [notebookId, scriptId, scriptData] = task.value;
                const text = scriptData.script?.toString() ?? "";
                this.logger.info("writing script text", {
                    key,
                    scriptId: scriptId.toString(),
                    notebookId: notebookId.toString(),
                    scriptTextLength: text.length.toString()
                }, LOG_CTX);
                const timeBefore = new Date();
                const scriptProto = buf.create(pb.dashql.notebook.NotebookScriptSchema, {
                    scriptId,
                    scriptText: text,
                    annotations: scriptData.annotations
                });
                const scriptBytes = buf.toBinary(pb.dashql.notebook.NotebookScriptSchema, scriptProto);
                await DB.notebookScripts.put({
                    scriptId,
                    notebookId,
                    scriptProto: scriptBytes
                }, [notebookId, scriptId]);
                const timeAfter = new Date();
                const writeDuration = timeAfter.getTime() - timeBefore.getTime();
                this.registerWrite(key, text.length, writeDuration);
                break;
            }
            case DELETE_CONNECTION_STATE:
                this.logger.info("deleting connection", {
                    task: key,
                    connectionId: task.value.toString()
                }, LOG_CTX);
                await DB.connectionCatalogs.delete(task.value);
                break;
            case DELETE_CONNECTION_CATALOG:
                this.logger.info("deleting connection catalog", {
                    task: key,
                    connectionId: task.value.toString()
                }, LOG_CTX);
                await DB.connections.delete(task.value);
                break;
            case DELETE_NOTEBOOK_STATE:
                this.logger.info("deleting notebook", {
                    task: key,
                    notebookId: task.value.toString()
                }, LOG_CTX);
                await DB.notebooks.delete(task.value);
                break;
            case DELETE_NOTEBOOK_SCRIPT: {
                const [notebookId, scriptId] = task.value;
                this.logger.info("deleting notebook script", {
                    task: key,
                    notebookId: notebookId.toString(),
                    scriptId: scriptId.toString(),
                }, LOG_CTX);
                await DB.notebookScripts.delete([notebookId, scriptId]);

                break;
            }
        }
    }
}
