import * as arrow from 'apache-arrow';
import { describe, expect, it } from 'vitest';

import { TestLogger } from '../../platform/logger/test_logger.js';
import { parseTrinoTimestampMs, translateAnyRowsToArrowBatch } from './arrow_conversion.js';

/// Translate the values of a single column
function translateColumn(type: arrow.DataType, values: unknown[]): arrow.Vector {
    const schema = new arrow.Schema([new arrow.Field('c', type, true)]);
    return translateAnyRowsToArrowBatch(schema, values.map(value => [value]), new TestLogger()).getChildAt(0)!;
}

describe('translateAnyRowsToArrowBatch', () => {
    it.each<[string, arrow.DataType, unknown[], unknown[]]>([
        ['booleans', new arrow.Bool(), [true, 0, null], [true, false, null]],
        ['int8', new arrow.Int8(), [-3, '5'], [-3, 5]],
        ['int32', new arrow.Int32(), [1, '42', '', null, 'abc'], [1, 42, null, null, null]],
        ['int64', new arrow.Int64(), ['9007199254740993', 2, '1.5', ''], [9007199254740993n, 2n, null, null]],
        ['floats', new arrow.Float64(), [1.5, '2.25', 'x', null], [1.5, 2.25, null, null]],
        ['dates', new arrow.DateDay(), ['2024-02-29', 'not a date', null], [Date.UTC(2024, 1, 29), null, null]],
        ['millisecond dates', new arrow.DateMillisecond(), ['1970-01-02', ''], [86_400_000, null]],
        ['times', new arrow.TimeMillisecond(), ['01:02:03.456', '12:30', '00:00:00.5', null], [3_723_456, 45_000_000, 500, null]],
        ['timestamps', new arrow.TimestampMillisecond('UTC'), ['2024-01-02 03:04:05.678Z', 'never'], [Date.UTC(2024, 0, 2, 3, 4, 5, 678), null]],
        ['wall clock timestamps', new arrow.TimestampMillisecond(), ['2024-01-02 03:04:05.678', ''], [Date.UTC(2024, 0, 2, 3, 4, 5, 678), null]],
        ['binaries', new arrow.Binary(), [btoa('\x01\x02'), Uint8Array.from([7]), 42], [Uint8Array.from([1, 2]), Uint8Array.from([7]), null]],
        ['strings', new arrow.Utf8(), ['äö', 3, { a: [1] }, null], ['äö', '3', '{"a":[1]}', null]],
    ])('translates %s', (_name, type, values, expected) => {
        const vector = translateColumn(type, values);
        expect(vector.type.typeId).toEqual(type.typeId);
        expect([...vector]).toEqual(expected);
    });

    it('translates decimals into unscaled values and drops values that do not fit', () => {
        const tooLarge = (1n << 127n).toString();
        const vector = translateColumn(new arrow.Decimal(2, 38, 128), ['12.34', '-0.5', '.25', 12.5, '1.234', '.', tooLarge]);
        const words = vector.data[0].values as Uint32Array;
        const unscaled = (row: number) => BigInt.asIntN(64, BigInt(words[row * 4]) | (BigInt(words[row * 4 + 1]) << 32n));
        expect([0, 1, 2, 3].map(unscaled)).toEqual([1234n, -50n, 25n, 1250n]);
        expect([4, 5, 6].map(row => vector.isValid(row))).toEqual([false, false, false]);
    });

    it.each<[string, number | null]>([
        ['2024-03-01 12:30:00.123', Date.UTC(2024, 2, 1, 12, 30, 0, 123)],
        ['2024-03-01 12:30:00.123456789', Date.UTC(2024, 2, 1, 12, 30, 0, 123)],
        ['2024-03-01 12:30:00', Date.UTC(2024, 2, 1, 12, 30, 0)],
        ['0050-03-01 12:30:00.000', -60_584_153_400_000],
        ['2024-03-01 12:30:00.123 UTC', Date.UTC(2024, 2, 1, 12, 30, 0, 123)],
        ['2024-03-01 12:30:00.000 +01:00', Date.UTC(2024, 2, 1, 11, 30)],
        ['2024-03-01 12:30:00.000 -05:30', Date.UTC(2024, 2, 1, 18, 0)],
        ['2024-01-15 12:00:00.000 Europe/Berlin', Date.UTC(2024, 0, 15, 11, 0)],
        ['2024-07-15 12:00:00.000 Europe/Berlin', Date.UTC(2024, 6, 15, 10, 0)],
        ['2024-07-15 12:00:00.000 America/New_York', Date.UTC(2024, 6, 15, 16, 0)],
        ['2024-03-31 03:30:00.000 Europe/Berlin', Date.UTC(2024, 2, 31, 1, 30)],
        ['2024-03-01 12:30:00.000 Mars/Olympus', null],
        ['yesterday', null],
    ])('parses the Trino timestamp %s', (text, expected) => {
        expect(parseTrinoTimestampMs(text)).toEqual(expected);
    });

    it('falls back to JSON strings for types without a translation', () => {
        const vector = translateColumn(new arrow.List(new arrow.Field('item', new arrow.Int32())), [[1, 2]]);
        expect(vector.type).toBeInstanceOf(arrow.Utf8);
        expect([...vector]).toEqual(['[1,2]']);
    });
});
