import * as dashql from '@ankoh/dashql-core';

import { ConnectionStateDetailsVariant } from '../connection/connection_state_details.js';
import { WorkbookState } from '../workbook/workbook_state.js';
import { VariantKind } from '../utils/index.js';

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
    | VariantKind<typeof WRITE_WORKBOOK_SCRIPT, [number, dashql.DashQLScript]>
    | VariantKind<typeof DELETE_CONNECTION_DETAILS, number>
    | VariantKind<typeof DELETE_CONNECTION_CATALOG, number>
    | VariantKind<typeof DELETE_WORKBOOK_STATE, number>
    | VariantKind<typeof DELETE_WORKBOOK_SCRIPT, number>
    ;

export type StorageWriteKey = string;

interface AsyncStorageWriteTask {
    task: StorageWriteTaskVariant;
    resolve: (ok: boolean) => void;
}

export class StorageWriter {
    /// The pending tasks
    pendingTasks: Map<StorageWriteKey, AsyncStorageWriteTask>;

    constructor() {
        this.pendingTasks = new Map();
    }

    public async write(key: string, task: StorageWriteTaskVariant) {
        // Is there a previous task?
        const prevTask = this.pendingTasks.get(key);
        if (prevTask) {
            prevTask.resolve(false);
        }

        let resolveTask: ((ok: boolean) => void) | null = null;
        let taskPromise = new Promise<boolean>(r => { resolveTask = r; });

        // Overwrite any previous task with the same key
        this.pendingTasks.set(key, { task, resolve: resolveTask! });

        // XXX Schedule the async writer

        await taskPromise;
    }
}
