import * as arrow from 'apache-arrow';
import { ArrowTableFormatter, makeArrowValueFormatter } from './arrow_formatter.js';
import { TestLogger } from '../../platform/logger/test_logger.js';

describe('TableFormatter', () => {
    it("can be constructed from a single column", () => {
        const logger = new TestLogger();
        const LENGTH = 10;
        const testData = Int32Array.from(
            { length: LENGTH },
            () => Number((Math.random() * 20).toFixed(0)));
        const table = arrow.tableFromArrays({
            test: testData,
        });

        const formatter = new ArrowTableFormatter(table.schema, table.batches, logger);
        expect(formatter.getValue(0, 0)).toEqual(testData[0].toString());
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



