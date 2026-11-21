import * as arrow from 'apache-arrow';
import type * as core from '../core/index.js';

import type { EmbeddedClientContext, EmbeddedComputeDatabase, EmbeddedConnection } from '../platform/embedded_database.js';
import { appendRowNumbers, isArrowTable } from './store/runtime_tables.js';

/// The client context of the opaque JSON of the runtime
export function clientContextOf(json: string | null | undefined): EmbeddedClientContext | null {
    if (json == null) return null;
    try {
        return JSON.parse(json) as EmbeddedClientContext;
    } catch {
        return null;
    }
}

/// The client context as the opaque JSON of the runtime
export function clientContextJson(clientContext: EmbeddedClientContext | null | undefined): string | null {
    if (clientContext == null) return null;
    try {
        return JSON.stringify(clientContext);
    } catch {
        return null;
    }
}

/// The compute database of the computations of the runtime (`ComputePlatform` of the module) over the embedded Hyper,
/// the calls wait until the platform set it up. The runtime tracks the SELECTs that create the tables of the tasks in a
/// query history and names their client context. A cancelled run aborts its calls. Result data never enters the
/// module: a result is imported from its Arrow table with the row numbers appended here, the tables that the tasks
/// read stay Arrow tables (`queryTable`), only the small ones that the runtime parses cross as Arrow IPC.
export function createComputePlatform(database: () => Promise<EmbeddedComputeDatabase>): core.ComputePlatform {
    /// The abort controllers of the calls of the runs
    const runs = new Map<number, Set<AbortController>>();
    const inRun = async <T>(run: number, call: (signal: AbortSignal) => Promise<T>): Promise<T> => {
        const controller = new AbortController();
        let controllers = runs.get(run);
        if (controllers == null) {
            controllers = new Set();
            runs.set(run, controllers);
        }
        controllers.add(controller);
        try {
            return await call(controller.signal);
        } finally {
            controllers.delete(controller);
            if (controllers.size === 0) runs.delete(run);
        }
    };
    const withConnection = async <T>(clientContext: EmbeddedClientContext | null, fn: (conn: EmbeddedConnection) => Promise<T>): Promise<T> => {
        const conn = await (await database()).connect({ pooled: true, clientContext: clientContext ?? undefined });
        try {
            return await fn(conn);
        } finally {
            await conn.close();
        }
    };
    return {
        importTable: async (_dataFrame, tableName, result, rowNumberField, context) => {
            if (!isArrowTable(result)) throw new Error(`the result to import into ${tableName} is no table`);
            const table = appendRowNumbers(result as arrow.Table, rowNumberField);
            await inRun(context.run, signal => withConnection(clientContextOf(context.clientContext), conn => conn.insertArrowTable(table, { name: tableName, create: true, abort: signal })));
        },
        createTable: async (_dataFrame, tableName, sql, context) => {
            await inRun(context.run, signal => withConnection(clientContextOf(context.clientContext), conn => conn.createTableAs(tableName, sql, signal)));
        },
        query: async (sql, context) => {
            const table = await inRun(context.run, signal => withConnection(clientContextOf(context.clientContext), conn => conn.query(sql, signal)));
            return arrow.tableToIPC(table, 'stream');
        },
        queryTable: async (sql, context) => {
            return await inRun(context.run, signal => withConnection(clientContextOf(context.clientContext), conn => conn.query(sql, signal)));
        },
        dropTable: async (_dataFrame, _tableName, sql) => {
            await withConnection(null, conn => conn.execute(sql));
        },
        cancel: run => {
            for (const controller of runs.get(run) ?? []) controller.abort(new DOMException('The task was cancelled', 'AbortError'));
        },
    };
}
