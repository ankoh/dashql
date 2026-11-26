import * as arrow from 'apache-arrow';
import type * as core from '../../core/index.js';

import type { HandleTable } from './handles.js';
import { QueryResultStream } from '../query/query_result_stream.js';

/// The Arrow tables of the platform by handle (docs/design/dashql_runtime.md): result data never enters the module, a
/// table is an object of the handle table. A table begins with an Arrow IPC stream, its schema and maybe batches, takes
/// the batches of more streams and is a table of the handle table once it finished. The result of a query streams into
/// a table that was opened: the parts of one Arrow IPC stream as they arrive, or the record batches of a channel of the
/// host (`stream`). The runtime reads the small tables that it parses back as Arrow IPC streams, of the others it
/// learns the rows and the schema (`describe`).
///
/// A table that didn't finish is the object of its handle as well, a builder or a stream that `finish` replaces with
/// the table: a release of the handle, e.g. of the result of a cancelled query, drops what it holds.
export interface PlatformTables extends core.RuntimeTables {
    /// The stream of a table that was opened and didn't finish, a channel of the host pushes its batches into it
    stream(table: number): QueryResultStream | null;
}

/// A table that began and didn't finish: its schema and its batches
class TableBuilder {
    constructor(public readonly schema: arrow.Schema, public readonly batches: arrow.RecordBatch[], public bytes: number) { }
}

/// A table that streams and didn't finish
class TableStream {
    public readonly stream = new QueryResultStream();
    public bytes = 0;
}

/// The schema of a table as an Arrow IPC stream without batches
function schemaIPC(schema: arrow.Schema): Uint8Array {
    // The schema may come from another copy of apache-arrow, the empty table is one of this copy
    return arrow.tableToIPC(new arrow.Table(new arrow.Schema(schema.fields, schema.metadata)), 'stream');
}

export function createRuntimeTables(handles: HandleTable): PlatformTables {
    const read = (ipc: Uint8Array) => arrow.tableFromIPC(new Uint8Array(ipc));
    const builderOf = (handle: number) => {
        const builder = handles.get<unknown>(handle);
        if (!(builder instanceof TableBuilder)) throw new Error(`the table ${handle} did not begin`);
        return builder;
    };
    const streamOf = (handle: number) => {
        const stream = handles.get<unknown>(handle);
        return stream instanceof TableStream ? stream : null;
    };
    const tableOf = (handle: number) => {
        const table = handles.get<arrow.Table>(handle);
        if (table == null || !isArrowTable(table)) throw new Error(`the handle ${handle} is no table`);
        return table;
    };
    return {
        begin: ipc => {
            const table = read(ipc);
            return handles.register(new TableBuilder(table.schema, [...table.batches], ipc.byteLength));
        },
        append: (handle, ipc) => {
            const builder = builderOf(handle);
            builder.batches.push(...read(ipc).batches);
            builder.bytes += ipc.byteLength;
        },
        open: () => handles.register(new TableStream()),
        push: (handle, part) => {
            const stream = streamOf(handle);
            if (stream == null) throw new Error(`the table ${handle} was not opened`);
            stream.stream.pushBytes(part);
            stream.bytes += part.byteLength;
        },
        stream: handle => streamOf(handle)?.stream ?? null,
        finish: handle => {
            const stream = streamOf(handle);
            if (stream != null) {
                const finished = stream.stream.finish();
                handles.set(handle, finished);
                return { rows: finished.numRows, bytes: stream.bytes, columns: finished.numCols, batches: finished.batches.length };
            }
            const builder = builderOf(handle);
            const finished = new arrow.Table(builder.schema, builder.batches);
            handles.set(handle, finished);
            return { rows: finished.numRows, bytes: builder.bytes, columns: finished.numCols, batches: finished.batches.length };
        },
        read: handle => arrow.tableToIPC(tableOf(handle), 'stream'),
        describe: handle => {
            const table = tableOf(handle);
            return { rows: table.numRows, schema: schemaIPC(table.schema) };
        },
    };
}

/// Is a value an Arrow table? A bundle may hold two copies of apache-arrow.
export function isArrowTable(table: unknown): table is arrow.Table {
    return table != null && typeof table === 'object' && Array.isArray((table as arrow.Table).batches) && (table as arrow.Table).schema != null;
}
