import * as arrow from 'apache-arrow';

/// The end-of-stream marker of the Arrow IPC stream format
const END_OF_STREAM = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0]);
/// The continuation marker in front of the length of a message
const CONTINUATION = 0xffffffff;

/// The result of a query as it streams to the host. The result never lives in the core module: its parts come here as
/// they arrive, and the table is built from them once the result is complete.
///
/// - The parts of one Arrow IPC stream, in the order of the result: the chunks of Hyper over HTTP as the server sent
///   them, or the pages of Trino that the core wrote as Arrow. A message may span parts, a
///   schema after the first one and an end-of-stream marker inside the stream are skipped, so a server that repeats the
///   schema or ends every chunk still gives one table.
/// - Or the record batches of a channel of the host, e.g. the embedded Hyper, which never leave JavaScript.
///
/// The messages are kept as views of the parts, a part is copied only when a message spans it.
export class QueryResultStream {
    /// The parts that hold an incomplete message
    private pending: Uint8Array[] = [];
    private pendingBytes = 0;
    /// The bytes of the incomplete message, 0 while its header is incomplete
    private pendingNeeded = 0;
    /// The first schema message
    private schemaMessage: Uint8Array | null = null;
    /// The dictionary and record batch messages, in order
    private messages: Uint8Array[] = [];
    /// The record batches of a channel of the host
    private batches: arrow.RecordBatch[] = [];
    /// The schema of a channel of the host that sent no batch
    private schema: arrow.Schema | null = null;

    /// Add the next part of the Arrow IPC stream of the result
    pushBytes(part: Uint8Array): void {
        if (part.byteLength === 0) return;
        this.pending.push(part);
        this.pendingBytes += part.byteLength;
        // Still inside a message whose length is known
        if (this.pendingBytes < this.pendingNeeded) return;
        const buffer = this.pending.length === 1 ? this.pending[0] : concat(this.pending, this.pendingBytes);
        this.pending = [];
        this.pendingBytes = 0;
        this.pendingNeeded = 0;
        const offset = this.frame(buffer);
        if (offset < buffer.byteLength) {
            const rest = buffer.subarray(offset);
            this.pending.push(rest);
            this.pendingBytes = rest.byteLength;
        }
    }

    /// Add a record batch of a channel of the host
    pushBatch(batch: arrow.RecordBatch): void {
        this.batches.push(batch);
    }

    /// The schema of a channel of the host whose result has no batch
    setSchema(schema: arrow.Schema): void {
        this.schema = schema;
    }

    /// Split a buffer into its messages, returns the offset of the first incomplete one
    private frame(buffer: Uint8Array): number {
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        let offset = 0;
        while (buffer.byteLength - offset >= 4) {
            const rest = buffer.byteLength - offset;
            let prefix = 4;
            let metadataLength = view.getUint32(offset, true);
            // A stream of the format before 0.15 has no continuation marker
            if (metadataLength === CONTINUATION) {
                if (rest < 8) break;
                metadataLength = view.getUint32(offset + 4, true);
                prefix = 8;
            }
            if (metadataLength === 0) {
                // An end-of-stream marker, the stream may go on
                offset += prefix;
                continue;
            }
            if (rest < prefix + metadataLength) break;
            const message = arrow.Message.decode(buffer.subarray(offset + prefix, offset + prefix + metadataLength));
            const length = prefix + metadataLength + Number(message.bodyLength);
            if (rest < length) {
                this.pendingNeeded = length;
                break;
            }
            // The arrays of a message are views of its bytes, Arrow pads the messages of a stream to 8 bytes
            const framed = buffer.subarray(offset, offset + length);
            const bytes = framed.byteOffset % 8 === 0 ? framed : framed.slice();
            if (message.isSchema()) {
                // A schema after the first one repeats it
                this.schemaMessage ??= bytes;
            } else {
                this.messages.push(bytes);
            }
            offset += length;
        }
        return offset;
    }

    /// The table of the result
    finish(): arrow.Table {
        if (this.pendingBytes > 0) {
            throw new Error(`The Arrow stream of the result ends inside a message, ${this.pendingBytes} bytes are left`);
        }
        let table: arrow.Table;
        if (this.batches.length > 0) {
            table = new arrow.Table(this.batches);
        } else if (this.schemaMessage != null) {
            table = arrow.tableFromIPC([this.schemaMessage, ...this.messages, END_OF_STREAM]);
        } else if (this.messages.length > 0) {
            throw new Error('The Arrow stream of the result has batches without a schema');
        } else {
            table = new arrow.Table(this.schema ?? new arrow.Schema([]), []);
        }
        this.messages = [];
        this.batches = [];
        return table;
    }
}

/// Join byte arrays
function concat(parts: Uint8Array[], length: number): Uint8Array {
    const joined = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
        joined.set(part, offset);
        offset += part.byteLength;
    }
    return joined;
}
