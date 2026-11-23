import * as buffers from '../../core/buffers.js';
import { tableFromArrays } from '../testing/arrow_fixtures.js';
import { formatKpiChange, formatKpiNumber, kpiProblems, readKpi } from './kpi_reading.js';

const Delta = buffers.visualization.KpiDelta;

function spec(value: string | null = null, x: string | null = null, delta = Delta.PREVIOUS) {
    return new buffers.visualization.KpiSpecT(value, x, delta);
}

describe('the reading of a KPI card', () => {
    it('reads the last row against the previous one, the first column is the x axis', () => {
        const table = tableFromArrays({ day: new Int32Array([1, 2, 4]), revenue: new Float64Array([100, 200, 150]) });
        const reading = readKpi(table, spec());
        expect(reading.label).toBe('revenue');
        expect(reading.value).toBe('150');
        expect(reading.change).toBeCloseTo(-0.25);
        // The x axis places the points, the gap between 2 and 4 is wider
        expect(reading.points).toEqual([[0, 0], [1 / 3, 1], [1, 0.5]]);
        expect(reading).toMatchObject({ rows: 3, numeric: true, xLabel: 'day', ordered: true });
        expect(readKpi(table, spec(null, null, Delta.FIRST)).change).toBeCloseTo(0.5);
        expect(readKpi(table, spec(null, null, Delta.NONE)).change).toBeNull();
    });

    it('takes the named columns', () => {
        const table = tableFromArrays({ revenue: new Int32Array([5, 10]), day: new Int32Array([1, 2]), note: ['a', 'b'] });
        const reading = readKpi(table, spec('revenue', 'day'));
        expect(reading.label).toBe('revenue');
        expect(reading.value).toBe('10');
        expect(reading.change).toBeCloseTo(1);
        expect(reading.points).toEqual([[0, 0], [1, 1]]);
        expect(readKpi(table, spec('total')).missing).toBe('Result has no column total');
        expect(readKpi(table, spec('revenue', 'date')).missing).toBe('Result has no column date');
    });

    it('shows only the value of a single row', () => {
        const reading = readKpi(tableFromArrays({ total: new Float64Array([1234567]) }), spec());
        expect(reading.value).toBe('1.23M');
        expect(reading.change).toBeNull();
        expect(reading.points).toEqual([]);
        expect(reading.xLabel).toBeNull();
    });

    it('spaces the points evenly over an x axis of text or out of order, and shows a text value as written', () => {
        const table = tableFromArrays({ region: ['north', 'south', 'west'], revenue: new Int32Array([1, 3, 2]) });
        expect(readKpi(table, spec()).points).toEqual([[0, 0], [0.5, 1], [1, 0.5]]);
        expect(readKpi(table, spec()).ordered).toBeNull();
        const unordered = readKpi(tableFromArrays({ day: new Int32Array([3, 1, 2]), n: new Int32Array([1, 3, 2]) }), spec());
        expect(unordered.ordered).toBe(false);
        expect(unordered.points).toEqual([[0, 0], [0.5, 1], [1, 0.5]]);
        const status = readKpi(tableFromArrays({ status: ['red', 'green'] }), spec());
        expect(status.value).toBe('green');
        expect(status.numeric).toBe(false);
        expect(status.change).toBeNull();
        expect(status.points).toEqual([]);
    });

    it('has no change against zero and no value without rows', () => {
        expect(readKpi(tableFromArrays({ n: new Int32Array([0, 5]) }), spec()).change).toBeNull();
        const empty = readKpi(tableFromArrays({ n: new Int32Array([]) }), spec());
        expect(empty.value).toBeNull();
        expect(empty.points).toEqual([]);
    });

    it('formats numbers compactly from ten thousand on and changes with their sign', () => {
        expect(formatKpiNumber(9999.5)).toBe('9,999.5');
        expect(formatKpiNumber(12_345)).toBe('12.35K');
        expect(formatKpiChange(0.031)).toBe('+3.1%');
        expect(formatKpiChange(-0.5)).toBe('-50%');
    });

    it('names what is likely not meant', () => {
        const problems = (table: ReturnType<typeof tableFromArrays>, kpi = spec()) =>
            kpiProblems(readKpi(table, kpi), table.schema.fields.map((field: { name: string }) => field.name));
        expect(problems(tableFromArrays({ day: new Int32Array([1, 2]), n: new Int32Array([1, 2]) }))).toEqual([]);
        expect(problems(tableFromArrays({ n: new Int32Array([7]) }))).toEqual([]);
        expect(problems(tableFromArrays({ day: new Int32Array([1]) }), spec('total'))).toEqual([
            'the column "total" of the tag is no column of the result, its columns are day',
        ]);
        expect(problems(tableFromArrays({ n: new Int32Array([]) }))).toEqual(['the result has no rows, the card shows a dash']);
        expect(problems(tableFromArrays({ day: new Int32Array([2, 1]), n: new Int32Array([1, 2]) }))).toEqual([
            'the rows are not in the order of day, the card shows the last row and compares it with the row before it: add order by day',
        ]);
        expect(problems(tableFromArrays({ n: new Int32Array([1, 2]), region: ['a', 'b'] }))[0]).toMatch(/^region is no column of numbers/);
    });
});
