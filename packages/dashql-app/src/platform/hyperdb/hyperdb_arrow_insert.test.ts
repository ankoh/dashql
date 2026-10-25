import * as arrow from 'apache-arrow';
import { describe, expect, it } from 'vitest';

import { prepareHyperArrowInsert } from './hyperdb_arrow_insert.js';

function tableOf(columns: Record<string, arrow.Vector>): arrow.Table {
    return new arrow.Table(columns);
}

describe('Hyper Arrow inserts', () => {
    it('describes the Hyper type that corresponds to each Arrow type', () => {
        const table = tableOf({
            int8: arrow.vectorFromArray([1], new arrow.Int8()),
            int16: arrow.vectorFromArray([1], new arrow.Int16()),
            int32: arrow.vectorFromArray([1], new arrow.Int32()),
            int64: arrow.vectorFromArray([1n], new arrow.Int64()),
            uint8: arrow.vectorFromArray([1], new arrow.Uint8()),
            uint16: arrow.vectorFromArray([1], new arrow.Uint16()),
            uint32: arrow.vectorFromArray([1], new arrow.Uint32()),
            uint64: arrow.vectorFromArray([1n], new arrow.Uint64()),
            float32: arrow.vectorFromArray([1.5], new arrow.Float32()),
            float64: arrow.vectorFromArray([1.5], new arrow.Float64()),
            text: arrow.vectorFromArray(['a'], new arrow.Utf8()),
            bytes: arrow.vectorFromArray([new Uint8Array([1])], new arrow.Binary()),
            flag: arrow.vectorFromArray([true], new arrow.Bool()),
            amount: arrow.vectorFromArray([null], new arrow.Decimal(2, 10, 128)),
            day: arrow.vectorFromArray([new Date(0)], new arrow.DateDay()),
            clock: arrow.vectorFromArray([1000], new arrow.TimeMillisecond()),
            local: arrow.vectorFromArray([new Date(0)], new arrow.TimestampMillisecond()),
            zoned: arrow.vectorFromArray([new Date(0)], new arrow.TimestampMicrosecond('UTC')),
            span: arrow.vectorFromArray([null], new arrow.IntervalMonthDayNano()),
            list: arrow.vectorFromArray([[1, 2]], new arrow.List(new arrow.Field('item', new arrow.Int32(), true))),
            strict: arrow.vectorFromArray([['a']], new arrow.List(new arrow.Field('item', new arrow.Utf8(), false))),
        });

        const insert = prepareHyperArrowInsert(table);

        expect(insert.table).toBe(table);
        expect(insert.columns).toBe([
            '"int8" smallint', '"int16" smallint', '"int32" integer', '"int64" bigint',
            '"uint8" smallint', '"uint16" integer', '"uint32" bigint', '"uint64" numeric(20,0)',
            '"float32" real', '"float64" double precision', '"text" text', '"bytes" bytea', '"flag" boolean',
            '"amount" numeric(10,2)', '"day" date', '"clock" time', '"local" timestamp', '"zoned" timestamptz',
            '"span" interval', '"list" array(integer)', '"strict" array(text not null)',
        ].join(', '));
    });

    it('describes the Hyper types that the field metadata names', () => {
        const annotated = (name: string, type: arrow.DataType, metadata: Record<string, string>) =>
            new arrow.Field(name, type, true, new Map(Object.entries(metadata)));
        const fields = [
            annotated('doc', new arrow.Utf8(), { 'hyper:type': 'JSON' }),
            annotated('id', new arrow.Uint32(), { 'hyper:type': 'Oid' }),
            annotated('place', new arrow.Binary(), { 'hyper:type': 'Geography' }),
            annotated('code', new arrow.Utf8(), { 'hyper:type': 'Char', 'hyper:max_string_length': '3' }),
            annotated('name', new arrow.Utf8(), { 'hyper:max_string_length': '5' }),
            new arrow.Field('docs', new arrow.List(annotated('item', new arrow.Utf8(), { 'hyper:type': 'JSON' })), true),
        ];
        const vectors = [
            arrow.vectorFromArray(['{}'], new arrow.Utf8()),
            arrow.vectorFromArray([1], new arrow.Uint32()),
            arrow.vectorFromArray([new Uint8Array([1])], new arrow.Binary()),
            arrow.vectorFromArray(['abc'], new arrow.Utf8()),
            arrow.vectorFromArray(['abcde'], new arrow.Utf8()),
            arrow.vectorFromArray([['{}']], fields[5].type),
        ];
        const schema = new arrow.Schema(fields);
        const table = new arrow.Table([new arrow.RecordBatch(schema, arrow.makeData({
            type: new arrow.Struct(fields),
            length: 1,
            nullCount: 0,
            children: vectors.map(vector => vector.data[0]),
        }))]);

        expect(prepareHyperArrowInsert(table).columns).toBe([
            '"doc" json', '"id" oid', '"place" geography', '"code" char(3)', '"name" varchar(5)', '"docs" array(json)',
        ].join(', '));
    });

    it('converts the columns that Hyper cannot read', () => {
        const nanos = arrow.makeVector(arrow.makeData({
            type: new arrow.TimestampNanosecond(),
            length: 2,
            nullCount: 0,
            data: new BigInt64Array([1_500_000n, 3_000_999n]),
        }));
        const table = tableOf({
            label: arrow.vectorFromArray(['a', 'b'], new arrow.Dictionary(new arrow.Utf8(), new arrow.Int32())),
            long: arrow.vectorFromArray(['x', null], new arrow.LargeUtf8()),
            half: arrow.vectorFromArray([1.5, 2.5], new arrow.Float16()),
            missing: arrow.vectorFromArray([null, null], new arrow.Null()),
            nanos,
        });

        const insert = prepareHyperArrowInsert(table);

        expect(insert.columns).toBe('"label" text, "long" text, "half" real, "missing" text, "nanos" timestamp');
        expect(insert.table.schema.fields.map(field => String(field.type))).toEqual([
            'Utf8', 'Utf8', 'Float32', 'Utf8', 'Timestamp<MICROSECOND>',
        ]);
        expect(insert.table.numRows).toBe(2);
        expect([...insert.table.getChild('label')!]).toEqual(['a', 'b']);
        expect([...insert.table.getChild('long')!]).toEqual(['x', null]);
        expect([...insert.table.getChild('half')!]).toEqual([1.5, 2.5]);
        expect([...insert.table.getChild('missing')!]).toEqual([null, null]);
        expect([...insert.table.getChild('nanos')!.data[0].values]).toEqual([1_500n, 3_000n]);
    });

    it('rejects Arrow types that Hyper cannot import', () => {
        const table = tableOf({
            point: arrow.vectorFromArray([{ x: 1 }], new arrow.Struct([new arrow.Field('x', new arrow.Int32(), true)])),
        });

        expect(() => prepareHyperArrowInsert(table)).toThrow('Hyper cannot import Arrow columns of type Struct');
    });
});
