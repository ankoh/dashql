import * as arrow from 'apache-arrow';
import type * as core from '@ankoh/dashql-core';

import type { HandleTable } from './handles.js';

/// The Arrow tables of the platform by handle (docs/wip/runtime_api.md): result data never enters the module, a table
/// is an object of the handle table. A table begins with an Arrow IPC stream, its schema and maybe batches, takes the
/// batches of more streams and is a table of the handle table once it finished. The runtime reads a table back as an
/// Arrow IPC stream, e.g. the result of a query that it analyzes.
export function createRuntimeTables(handles: HandleTable): core.RuntimeTables {
    /// The tables that began and didn't finish, their schema and their batches
    const building = new Map<number, { schema: arrow.Schema; batches: arrow.RecordBatch[]; bytes: number }>();
    const read = (ipc: Uint8Array) => arrow.tableFromIPC(new Uint8Array(ipc));
    return {
        begin: ipc => {
            const table = read(ipc);
            const handle = handles.register(null);
            building.set(handle, { schema: table.schema, batches: [...table.batches], bytes: ipc.byteLength });
            return handle;
        },
        append: (handle, ipc) => {
            const table = building.get(handle);
            if (table == null) throw new Error(`the table ${handle} did not begin`);
            table.batches.push(...read(ipc).batches);
            table.bytes += ipc.byteLength;
        },
        finish: handle => {
            const table = building.get(handle);
            if (table == null) throw new Error(`the table ${handle} did not begin`);
            building.delete(handle);
            const finished = new arrow.Table(table.schema, table.batches);
            handles.set(handle, finished);
            return { rows: finished.numRows, bytes: table.bytes };
        },
        read: handle => {
            const table = handles.get<arrow.Table>(handle);
            if (table == null || !isArrowTable(table)) throw new Error(`the handle ${handle} is no table`);
            return arrow.tableToIPC(table, 'stream');
        },
    };
}

/// Is a value an Arrow table? A bundle may hold two copies of apache-arrow.
export function isArrowTable(table: unknown): table is arrow.Table {
    return table != null && typeof table === 'object' && Array.isArray((table as arrow.Table).batches) && (table as arrow.Table).schema != null;
}
