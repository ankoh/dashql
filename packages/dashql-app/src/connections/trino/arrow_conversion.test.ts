import * as arrow from 'apache-arrow';
import { describe, expect, it } from 'vitest';

import { TestLogger } from '../../platform/logger/test_logger.js';
import { translateAnyRowsToArrowBatch } from './arrow_conversion.js';

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

    it('falls back to JSON strings for types without a translation', () => {
        const vector = translateColumn(new arrow.List(new arrow.Field('item', new arrow.Int32())), [[1, 2]]);
        expect(vector.type).toBeInstanceOf(arrow.Utf8);
        expect([...vector]).toEqual(['[1,2]']);
    });
});
