import * as arrow from 'apache-arrow';
import type * as core from '../../core/index.js';

import type { HandleTable } from './handles.js';
import { QueryResultStream } from '../query/query_result_stream.js';

/// The Arrow tables of the platform by handle (docs/wip/runtime_api.md): result data never enters the module, a table
/// is an object of the handle table. A table begins with an Arrow IPC stream, its schema and maybe batches, takes the
/// batches of more streams and is a table of the handle table once it finished. The result of a query streams into a
/// table that was opened: the parts of one Arrow IPC stream as they arrive, or the record batches of a channel of the
/// host (`stream`). The runtime reads a table back as an Arrow IPC stream, e.g. the result of a query that it analyzes.
export interface PlatformTables extends core.RuntimeTables {
    /// The stream of a table that was opened and didn't finish, a channel of the host pushes its batches into it
    stream(table: number): QueryResultStream | null;
}

export function createRuntimeTables(handles: HandleTable): PlatformTables {
    /// The tables that began and didn't finish, their schema and their batches
    const building = new Map<number, { schema: arrow.Schema; batches: arrow.RecordBatch[]; bytes: number }>();
    /// The tables that stream and didn't finish
    const streams = new Map<number, { stream: QueryResultStream; bytes: number }>();
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
        open: () => {
            const handle = handles.register(null);
            streams.set(handle, { stream: new QueryResultStream(), bytes: 0 });
            return handle;
        },
        push: (handle, part) => {
            const stream = streams.get(handle);
            if (stream == null) throw new Error(`the table ${handle} was not opened`);
            stream.stream.pushBytes(part);
            stream.bytes += part.byteLength;
        },
        stream: handle => streams.get(handle)?.stream ?? null,
        finish: handle => {
            const stream = streams.get(handle);
            if (stream != null) {
                streams.delete(handle);
                const finished = stream.stream.finish();
                handles.set(handle, finished);
                return { rows: finished.numRows, bytes: stream.bytes, columns: finished.numCols, batches: finished.batches.length };
            }
            const table = building.get(handle);
            if (table == null) throw new Error(`the table ${handle} did not begin`);
            building.delete(handle);
            const finished = new arrow.Table(table.schema, table.batches);
            handles.set(handle, finished);
            return { rows: finished.numRows, bytes: table.bytes, columns: finished.numCols, batches: finished.batches.length };
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
