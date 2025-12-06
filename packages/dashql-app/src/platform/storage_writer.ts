import * as dashql from '@ankoh/dashql-core';
import * as pb from '@ankoh/dashql-protobuf';
import * as buf from "@bufbuild/protobuf";

import { ConnectionStateDetailsVariant } from '../connection/connection_state_details.js';
import { DB } from './storage_setup.js';
import { Logger } from './logger.js';
import { VariantKind } from '../utils/index.js';
import { WorkbookState } from '../workbook/workbook_state.js';
import { encodeWorkbookAsProto } from '../workbook/workbook_export.js';

const LOG_CTX = 'storage_writer';

export const WRITE_CONNECTION_DETAILS = Symbol('WRITE_CONNECTION_DETAILS');
export const WRITE_CONNECTION_CATALOG = Symbol('WRITE_CONNECTION_CATALOG');
export const WRITE_WORKBOOK_STATE = Symbol('WRITE_WORKBOOK_STATE');
export const WRITE_WORKBOOK_SCRIPT = Symbol('WRITE_WORKBOOK_SCRIPT');
export const DELETE_CONNECTION_DETAILS = Symbol('DELETE_CONNECTION_DETAILS');
export const DELETE_CONNECTION_CATALOG = Symbol('DELETE_CONNECTION_CATALOG');
export const DELETE_WORKBOOK_STATE = Symbol('DELETE_WORKBOOK_STATE');
export const DELETE_WORKBOOK_SCRIPT = Symbol('DELETE_WORKBOOK_SCRIPT');

export type StorageWriteTaskVariant =
    | VariantKind<typeof WRITE_CONNECTION_DETAILS, [number, ConnectionStateDetailsVariant]>
    | VariantKind<typeof WRITE_CONNECTION_CATALOG, [number, dashql.DashQLCatalog]>
    | VariantKind<typeof WRITE_WORKBOOK_STATE, [number, WorkbookState]>
    | VariantKind<typeof WRITE_WORKBOOK_SCRIPT, [number, number, dashql.DashQLScript]>
    | VariantKind<typeof DELETE_CONNECTION_DETAILS, number>
    | VariantKind<typeof DELETE_CONNECTION_CATALOG, number>
    | VariantKind<typeof DELETE_WORKBOOK_STATE, number>
    | VariantKind<typeof DELETE_WORKBOOK_SCRIPT, number>
    ;

export type StorageWriteKey = string;

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

export class StorageWriter {
    /// The logger
    logger: Logger;
    /// The pending tasks
    pendingTasks: Map<StorageWriteKey, AsyncStorageWriteTask>;

    constructor(logger: Logger) {
        this.logger = logger;
        this.pendingTasks = new Map();
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

    protected async executeTask(key: string, task: StorageWriteTaskVariant) {
        switch (task.type) {
            case WRITE_CONNECTION_DETAILS: break;
            case WRITE_CONNECTION_CATALOG:
                break;
            case WRITE_WORKBOOK_STATE: {
                const [workbookId, workbook] = task.value;
                this.logger.info("writing script text", {
                    key,
                    workbookId: workbookId.toString(),
                    connectionId: workbook.connectionId.toString(),
                }, LOG_CTX);
                const workbookProto = encodeWorkbookAsProto(workbook, false, null);
                const workbookBytes = buf.toBinary(pb.dashql.workbook.WorkbookSchema, workbookProto);
                await DB.workbooks.add({
                    workbookId,
                    connectionId: workbook.connectionId,
                    workbookBuffer: workbookBytes,
                }, workbookId);
                break;
            }
            case WRITE_WORKBOOK_SCRIPT: {
                const [workbookId, scriptId, script] = task.value;
                const text = script.toString();
                this.logger.info("writing script text", {
                    key,
                    scriptId: scriptId.toString(),
                    workbookId: workbookId.toString(),
                    scriptTextLength: text.length.toString()
                }, LOG_CTX);
                await DB.workbookScripts.add({
                    scriptId,
                    workbookId,
                    scriptText: text
                }, scriptId);
                break;
            }
            case DELETE_CONNECTION_DETAILS:
                this.logger.info("deleting connection details", {
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
            case DELETE_WORKBOOK_STATE:
                this.logger.info("deleting workbook", {
                    task: key,
                    workbookId: task.value.toString()
                }, LOG_CTX);
                await DB.workbooks.delete(task.value);
                break;
            case DELETE_WORKBOOK_SCRIPT:
                this.logger.info("deleting workbook script", {
                    task: key,
                    scriptId: task.value.toString()
                }, LOG_CTX);
                await DB.workbookScripts.delete(task.value);
                break;
        }
    }
}
