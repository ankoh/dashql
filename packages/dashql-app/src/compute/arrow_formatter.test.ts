import * as arrow from 'apache-arrow';
import { vi } from 'vitest';
import { arrowValueToJson, ArrowTableFormatter, ArrowTextColumnFormatter, dataTypeToString, isArrowListType, isArrowStructuredType, makeArrowValueFormatter } from './arrow_formatter.js';
import { TestLogger } from '../platform/logger/test_logger.js';
import type { LoggerLike } from '../platform/logger/logger.js';
import { tableFromArrays, vectorFromArray } from '../tests/arrow_fixtures.js';

describe('TableFormatter', () => {
    it("can be constructed from a single column", () => {
        const logger = new TestLogger();
        const LENGTH = 10;
        const testData = Int32Array.from(
            { length: LENGTH },
            () => Number((Math.random() * 20).toFixed(0)));
        const table = tableFromArrays({
            test: testData,
        });

        const formatter = new ArrowTableFormatter(table.schema, table.batches, logger);
        expect(formatter.getValue(0, 0)).toEqual(testData[0].toString());
    });

    it("formats only requested rows until the full batch is requested", () => {
        const logger = new TestLogger();
        const table = tableFromArrays({ test: Int32Array.from([10, 20, 30]) });
        const formatter = new ArrowTextColumnFormatter(logger, 0, table.schema, table.batches);

        expect(formatter.getValue(0, 1)).toEqual('20');
        expect(formatter.formattedRowCount).toEqual(1);
        expect(formatter.getValue(0, 1)).toEqual('20');
        expect(formatter.formattedRowCount).toEqual(1);

        expect(formatter.getBatchValues(0)).toEqual(['10', '20', '30']);
        expect(formatter.formattedRowCount).toEqual(3);
    });
});

function field(name: string, type: arrow.DataType): arrow.Field {
    return new arrow.Field(name, type);
}

describe('makeArrowValueFormatter', () => {
    it('formats integers with thousands separators', () => {
        const f = makeArrowValueFormatter(field('n', new arrow.Int32()));
        expect(f.format(1234567)).toBe('1,234,567');
    });

    it('formats booleans as true/false', () => {
        const f = makeArrowValueFormatter(field('b', new arrow.Bool()));
        expect(f.format(true)).toBe('true');
        expect(f.format(false)).toBe('false');
    });

    it('passes through utf8 text and maps empty to null', () => {
        const f = makeArrowValueFormatter(field('s', new arrow.Utf8()));
        expect(f.format('hello')).toBe('hello');
        expect(f.format('')).toBeNull();
    });

    it('maps null/undefined to null', () => {
        const f = makeArrowValueFormatter(field('n', new arrow.Float64()));
        expect(f.format(null)).toBeNull();
        expect(f.format(undefined)).toBeNull();
    });

    it('formats list values as compact previews', () => {
        const type = new arrow.List(new arrow.Field('item', new arrow.Int32(), true));
        const values = vectorFromArray([[1, 2, null, 4, 5, 6]], type);
        const f = makeArrowValueFormatter(field('items', type));

        expect(f.format(values.get(0))).toBe('[1, 2, null, 4, 5, ... +1 more]');
    });

    it('formats a date', () => {
        const f = makeArrowValueFormatter(field('d', new arrow.DateMillisecond()));
        const out = f.format(Date.UTC(2021, 0, 1));
        expect(typeof out).toBe('string');
        expect(out).toContain('2021');
    });

    // Arrow's GetVisitor normalizes every timestamp unit to epoch-milliseconds before the value
    // reaches the formatter, so all four units must render to the same instant. Regression test
    // for microsecond `now()`/`current_timestamp` rendering as 1970 due to a double conversion.
    describe('timestamps are rendered from epoch-milliseconds regardless of unit', () => {
        // 2021-01-01T00:00:00Z as read back through Arrow (already in milliseconds).
        const epochMs = Date.UTC(2021, 0, 1);
        const cases: [string, arrow.Timestamp][] = [
            ['second', new arrow.TimestampSecond()],
            ['millisecond', new arrow.TimestampMillisecond()],
            ['microsecond', new arrow.TimestampMicrosecond()],
            ['nanosecond', new arrow.TimestampNanosecond()],
        ];
        // `dateStyle: 'short'` renders a 2-digit year, so 2021 shows as "21" (not "2021"), and the
        // double-conversion bug produced a 1970 date rendered as "70".
        it.each(cases)('formats %s timestamps to the same instant', (_name, type) => {
            const f = makeArrowValueFormatter(field('ts', type));
            const out = f.format(epochMs);
            expect(out).toContain('/21,');
            expect(out).not.toContain('/70,');
        });
    });
});

describe('makeArrowValueFormatter of other types', () => {
    const struct = new arrow.Struct([field('a', new arrow.Int32())]);
    it.each<[string, arrow.DataType, unknown, string | null]>([
        ['days of a duration', new arrow.DurationSecond(), 90061n, '1d 1h 1m 1s'],
        ['milliseconds of a duration', new arrow.DurationMillisecond(), 1500n, '1.500s'],
        ['an empty duration', new arrow.DurationMicrosecond(), 0n, '0s'],
        ['a negative duration', new arrow.DurationNanosecond(), -2_000_000_000n, '-2s'],
        ['a time in seconds', new arrow.TimeSecond(), 3661, '01:01:01'],
        ['a time in milliseconds', new arrow.TimeMillisecond(), 3_723_456, '01:02:03.456'],
        ['a time in microseconds', new arrow.TimeMicrosecond(), 1_000_000n, '00:00:01'],
        ['a time in nanoseconds', new arrow.TimeNanosecond(), 1_500_000_000n, '00:00:01.500'],
        ['bytes as hex', new arrow.Binary(), Uint8Array.from([1, 255]), '0x01ff'],
        ['long bytes truncated', new arrow.Binary(), new Uint8Array(40), `0x${'00'.repeat(32)}... (+8 bytes)`],
        ['a decimal', new arrow.Decimal(2, 10, 128), Uint32Array.from([12345, 0, 0, 0]), '123.45'],
        ['a struct', struct, { a: 1, b: 'x', c: null }, '{a: 1, b: "x", c: null}'],
        ['a wide struct truncated', struct, { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 }, '{a: 1, b: 2, c: 3, d: 4, e: 5, ... +1 more}'],
        ['a map', new arrow.Map_(field('entries', new arrow.Struct([field('key', new arrow.Utf8()), field('value', new arrow.Int64())]))), new Map([['k', 2n]]), '{k: 2}'],
        ['months of an interval', new arrow.IntervalYearMonth(), 14, '1y 2mo'],
        ['an empty month interval', new arrow.IntervalYearMonth(), 0, '0mo'],
        ['days and milliseconds of an interval', new arrow.IntervalDayTime(), { days: 2, milliseconds: 5 }, '2d 5ms'],
        ['months and nanoseconds of an interval', new arrow.IntervalMonthDayNano(), { months: 13, days: 0, nanoseconds: 3_000_000n }, '1y 1mo 3ms'],
        ['sub-millisecond nanoseconds of an interval', new arrow.IntervalMonthDayNano(), { months: 0, days: 0, nanoseconds: 5n }, '5ns'],
        ['an empty interval', new arrow.IntervalDayTime(), { days: 0, milliseconds: 0 }, '0'],
        ['a union string', new arrow.DenseUnion([0], [field('s', new arrow.Utf8())]), 'x', 'x'],
        ['a union number', new arrow.DenseUnion([0], [field('n', new arrow.Int32())]), 3, '3'],
        ['a union object', new arrow.DenseUnion([0], [field('n', new arrow.Int32())]), { n: 3 }, '{"n":3}'],
        ['a dictionary value', new arrow.Dictionary(new arrow.Utf8(), new arrow.Int32()), 'x', 'x'],
        ['a null column', new arrow.Null(), 1, null],
    ])('formats %s', (_name, type, value, expected) => {
        expect(makeArrowValueFormatter(field('c', type)).format(value)).toEqual(expected);
    });

    it('warns about unsupported types and renders them empty', () => {
        const logger = { warn: vi.fn() } as unknown as LoggerLike;
        const f = makeArrowValueFormatter(field('v', new arrow.Utf8View()), logger);
        expect(f.format('text')).toEqual('');
        expect(logger.warn).toHaveBeenCalledTimes(1);
    });
});

describe('dataTypeToString', () => {
    it.each<[arrow.DataType, string]>([
        [new arrow.Decimal(2, 10, 128), 'Decimal(10,2)'],
        [new arrow.TimestampSecond(), 'Timestamp(s)'],
        [new arrow.TimestampMillisecond(), 'Timestamp(ms)'],
        [new arrow.TimestampMicrosecond(), 'Timestamp(us)'],
        [new arrow.TimestampNanosecond(), 'Timestamp(ns)'],
        [new arrow.Utf8(), 'Text'],
        [new arrow.Int32(), 'Int32'],
    ])('names %s', (type, name) => {
        expect(dataTypeToString(type)).toEqual(name);
    });
});

describe('arrowValueToJson', () => {
    it('converts nested Arrow list vectors without truncating values', () => {
        const innerType = new arrow.List(new arrow.Field('item', new arrow.Int64(), true));
        const outerType = new arrow.List(new arrow.Field('item', innerType, true));
        const values = vectorFromArray([[[1n, 2n], null, [3n, 4n, 5n, 6n, 7n, 8n]]], outerType);

        expect(arrowValueToJson(values.get(0))).toEqual([
            [1n, 2n],
            null,
            [3n, 4n, 5n, 6n, 7n, 8n],
        ]);
    });

    it('converts Arrow struct rows nested in lists to plain objects', () => {
        const structType = new arrow.Struct([
            new arrow.Field('name', new arrow.Utf8(), false),
            new arrow.Field('active', new arrow.Bool(), false),
        ]);
        const listType = new arrow.List(new arrow.Field('item', structType, true));
        const values = vectorFromArray([[{ name: 'one', active: true }]], listType);

        expect(arrowValueToJson(values.get(0))).toEqual([{ name: 'one', active: true }]);
    });
});

describe('isArrowListType', () => {
    it('recognizes variable and fixed-size lists', () => {
        const item = new arrow.Field('item', new arrow.Int32(), true);

        expect(isArrowListType(new arrow.List(item))).toBe(true);
        expect(isArrowListType(new arrow.FixedSizeList(2, item))).toBe(true);
        expect(isArrowListType(new arrow.Utf8())).toBe(false);
    });
});

describe('isArrowStructuredType', () => {
    it('recognizes list and struct values', () => {
        const item = new arrow.Field('item', new arrow.Int32(), true);

        expect(isArrowStructuredType(new arrow.List(item))).toBe(true);
        expect(isArrowStructuredType(new arrow.Struct([item]))).toBe(true);
        expect(isArrowStructuredType(new arrow.Utf8())).toBe(false);
    });
});

describe('ArrowTextColumnFormatter of values beyond the safe integers', () => {
    /// A batch of one Timestamp(ms) column, Arrow JS refuses to read values beyond 2^53 as numbers
    function timestampBatch(values: (bigint | null)[]) {
        const type = new arrow.TimestampMillisecond();
        const data = new BigInt64Array(values.map(value => value ?? 0n));
        const nullBitmap = new Uint8Array(Math.ceil(values.length / 8));
        values.forEach((value, i) => { if (value != null) nullBitmap[i >> 3] |= 1 << (i & 7); });
        const nullCount = values.filter(value => value == null).length;
        const column = arrow.makeData({ type, length: values.length, nullCount, nullBitmap, data });
        const schema = new arrow.Schema([new arrow.Field('ts', type, true)]);
        const batch = new arrow.RecordBatch(schema, arrow.makeData({
            type: new arrow.Struct(schema.fields), length: values.length, nullCount: 0, children: [column],
        }));
        return { schema, batch };
    }

    it('reads the raw values when Arrow cannot convert them', () => {
        const huge = 2n ** 60n;
        const { schema, batch } = timestampBatch([0n, null, huge]);
        const formatter = new ArrowTextColumnFormatter(new TestLogger(), 0, schema, [batch]);
        const values = formatter.ensureBatchIsLoaded(0);
        expect(values.length).toBe(3);
        expect(values[0]).toEqual(new Intl.DateTimeFormat('en-US', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(0)));
        expect(values[1]).toBeNull();
        expect(values[2]).toBe(huge.toString());
        expect(formatter.formattedRowCount).toBe(3);
        expect(formatter.getLayoutInfo().valueMaxWidth).toBe(Math.max(values[0]!.length, huge.toString().length));
        // A loaded batch is not formatted again
        expect(formatter.ensureBatchIsLoaded(0)).toBe(values);
    });

    it('reads single raw values when Arrow cannot convert them', () => {
        const huge = 2n ** 60n;
        const { schema, batch } = timestampBatch([null, huge, 1000n]);
        const formatter = new ArrowTextColumnFormatter(new TestLogger(), 0, schema, [batch]);
        expect(formatter.getValue(0, 1)).toBe(huge.toString());
        expect(formatter.getValue(0, 0)).toBeNull();
        expect(formatter.getValue(0, 2)).toEqual(new Intl.DateTimeFormat('en-US', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(1000)));
    });

    it('renders dates beyond the range of dates as their epoch milliseconds', () => {
        const format = makeArrowValueFormatter(field('d', new arrow.DateMillisecond())).format;
        expect(format(9e15)).toBe('9000000000000000');
    });
});
