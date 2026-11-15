import * as arrow from 'apache-arrow';
import { describe, expect, it } from 'vitest';

import { vectorFromArray } from '../testing/arrow_fixtures.js';
import { QueryResultStream } from './query_result_stream.js';

const SCHEMA = new arrow.Schema([new arrow.Field('n', new arrow.Int32())]);

function batchOf(values: number[]): arrow.RecordBatch {
    return new arrow.RecordBatch(SCHEMA, arrow.makeData({
        type: new arrow.Struct(SCHEMA.fields),
        length: values.length,
        children: [vectorFromArray(values, new arrow.Int32()).data[0]],
    }));
}

/// A whole Arrow IPC stream: schema, batches, end of stream
const streamOf = (...batches: number[][]) => arrow.tableToIPC(new arrow.Table(SCHEMA, batches.map(batchOf)), 'stream');

const values = (table: arrow.Table) => [...table.getChild('n')!.toArray()];

describe('QueryResultStream', () => {
    it('builds a table from the parts of one stream', () => {
        const result = new QueryResultStream();
        result.pushBytes(streamOf([1, 2], [3]));
        const table = result.finish();
        expect(values(table)).toEqual([1, 2, 3]);
        expect(table.batches).toHaveLength(2);
    });

    it('reads a message that spans parts', () => {
        const bytes = streamOf([4, 5, 6], [7]);
        for (const size of [1, 3, 7, 64]) {
            const result = new QueryResultStream();
            for (let offset = 0; offset < bytes.byteLength; offset += size) {
                result.pushBytes(bytes.subarray(offset, offset + size));
            }
            expect(values(result.finish())).toEqual([4, 5, 6, 7]);
        }
    });

    it('skips a repeated schema and an end-of-stream marker inside the stream', () => {
        // Every chunk is a whole stream, as a server that repeats the schema and ends every chunk sends it
        const result = new QueryResultStream();
        result.pushBytes(streamOf([1]));
        result.pushBytes(streamOf([2, 3]));
        result.pushBytes(streamOf());
        expect(values(result.finish())).toEqual([1, 2, 3]);
    });

    it('reads a message at an offset that is not aligned', () => {
        const bytes = streamOf([8, 9]);
        const shifted = new Uint8Array(bytes.byteLength + 3);
        shifted.set(bytes, 3);
        const result = new QueryResultStream();
        result.pushBytes(shifted.subarray(3));
        expect(values(result.finish())).toEqual([8, 9]);
    });

    it('fails on a stream that ends inside a message', () => {
        const bytes = streamOf([1, 2, 3]);
        const result = new QueryResultStream();
        result.pushBytes(bytes.subarray(0, bytes.byteLength / 2));
        expect(() => result.finish()).toThrow('ends inside a message');
    });

    it('is an empty table without parts, or the schema of a channel', () => {
        expect(new QueryResultStream().finish().numCols).toBe(0);
        const result = new QueryResultStream();
        result.setSchema(SCHEMA);
        const table = result.finish();
        expect([table.numRows, table.schema.fields.map(f => f.name)]).toEqual([0, ['n']]);
        // A stream with a schema and no batch
        const empty = new QueryResultStream();
        empty.pushBytes(streamOf());
        expect([empty.finish().numRows, empty.finish().numCols]).toEqual([0, 1]);
    });

    it('keeps the batches of a channel of the host', () => {
        const result = new QueryResultStream();
        const batch = batchOf([1, 2]);
        result.pushBatch(batch);
        result.pushBatch(batchOf([3]));
        const table = result.finish();
        expect(values(table)).toEqual([1, 2, 3]);
        expect(table.batches[0]).toBe(batch);
    });
});
