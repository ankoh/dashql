// What a KPI card shows of a result (`@vis kpi`, see docs/design/vis_comments.md): the card of the app draws it,
// dashql vis prints it and checks it. It reads every value of the result, so it is TypeScript, not the core.
import * as arrow from 'apache-arrow';

import * as buffers from '../../core/buffers.js';
import { makeArrowValueFormatter } from '../compute/arrow_formatter.js';
import { Int128 } from '../utils/int128.js';

type KpiSpec = buffers.visualization.KpiSpecT;
const KpiDelta = buffers.visualization.KpiDelta;
const KpiChart = buffers.visualization.KpiChart;

/// The rows of a result that dashql vis reads for a KPI card, a result with more is no KPI
export const KPI_CHECK_ROWS = 1000;

/// What a KPI card shows of a result
export interface KpiReading {
    /// The name of the column of the value
    label: string;
    /// The value of the last row, formatted, null for an empty result or a null value
    value: string | null;
    /// The change of the value against its base, a fraction (0.1 is +10%), null without a base
    change: number | null;
    /// The chart: a line through its points or a bar per point, null without one
    chart: 'line' | 'bar' | null;
    /// The points of the chart in the unit square, x to the right and y up, empty for fewer than two numbers. A bar
    /// rises from zero, the y of zero is `zero`; the bars are spaced evenly.
    points: [number, number][];
    /// The y of zero in the unit square, the base of the bars
    zero: number;
    /// The message of a column that the result doesn't have
    missing: string | null;
    /// The rows of the result
    rows: number;
    /// Is the value column a column of numbers?
    numeric: boolean;
    /// The name of the column of the x axis, null without one
    xLabel: string | null;
    /// Do the rows ascend along the x axis? Null if the x axis is not numeric or temporal
    ordered: boolean | null;
    /// The labels of the axes of the chart, null without a chart
    axis: KpiAxis | null;
}

/// The labels of the axes of the chart of a KPI card, inset into the chart
export interface KpiAxis {
    /// The x of the first and the last point, null without an x axis
    xFirst: string | null;
    xLast: string | null;
    /// The x of the row that the change compares with, null without an x axis or a change
    xBase: string | null;
    /// The smallest and the largest value of the chart, at the bottom and the top of the line. Bars that rise from zero
    /// leave out the zero at their base.
    yMin: string | null;
    yMax: string;
}

/// The number of an Arrow value of a numeric column, or also of a temporal one as epoch milliseconds, null for other
/// columns and null values
function numberOf(type: arrow.DataType, value: unknown, temporal: boolean): number | null {
    if (value == null) return null;
    if (arrow.DataType.isDecimal(type)) {
        if (!(value instanceof Uint32Array)) return null;
        return Number(Int128.decodeLE(value)) / 10 ** type.scale;
    }
    const isTemporal = arrow.DataType.isTimestamp(type) || arrow.DataType.isDate(type);
    if (arrow.DataType.isInt(type) || arrow.DataType.isFloat(type) || (temporal && isTemporal)) {
        const number = typeof value === 'bigint' ? Number(value) : typeof value === 'number' ? value : value instanceof Date ? value.getTime() : NaN;
        return Number.isFinite(number) ? number : null;
    }
    return null;
}

/// Is a column a column of numbers?
function isNumeric(type: arrow.DataType): boolean {
    return arrow.DataType.isInt(type) || arrow.DataType.isFloat(type) || arrow.DataType.isDecimal(type);
}

/// A string of a FlatBuffer, the object API may hold its bytes
function readString(value: string | Uint8Array | null): string | null {
    if (value == null || typeof value === 'string') return value;
    return new TextDecoder().decode(value);
}

const COMPACT_FORMAT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });
const PLAIN_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const SMALL_FORMAT = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 3 });
const CHANGE_FORMAT = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' });

/// A number as the large value of a card: compact from ten thousand on, a fraction with three significant digits
export function formatKpiNumber(value: number): string {
    const magnitude = Math.abs(value);
    if (magnitude >= 10_000) return COMPACT_FORMAT.format(value);
    if (magnitude > 0 && magnitude < 1) return SMALL_FORMAT.format(value);
    return PLAIN_FORMAT.format(value);
}

/// The smallest and the largest of numbers, starting from a range. A loop: a spread into Math.min and Math.max throws
/// for a result of a few hundred thousand rows.
function extent(values: readonly number[], [min, max]: [number, number] = [Infinity, -Infinity]): [number, number] {
    for (const value of values) {
        if (value < min) min = value;
        if (value > max) max = value;
    }
    return [min, max];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/// The format of the dates of a temporal x axis, as short as the span of the axis allows: times within two days, the
/// month of dates that are all the first of a month, days within a year, months beyond
function dateFormat(dates: number[]): Intl.DateTimeFormat {
    const [first, last] = extent(dates);
    const span = dates.length > 0 ? last - first : 0;
    const options: Intl.DateTimeFormatOptions = { timeZone: 'UTC' };
    if (span <= 2 * DAY_MS) {
        Object.assign(options, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    } else if (dates.every(date => new Date(date).getUTCDate() === 1)) {
        Object.assign(options, span > 366 * DAY_MS ? { month: 'short', year: 'numeric' } : { month: 'short' });
    } else if (span <= 366 * DAY_MS) {
        Object.assign(options, { month: 'short', day: 'numeric' });
    } else {
        Object.assign(options, { month: 'short', year: 'numeric' });
    }
    return new Intl.DateTimeFormat('en-US', options);
}

const TICK_FORMAT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumSignificantDigits: 3 });

/// A number as a label of an axis: compact with three significant digits
export function formatKpiTick(value: number): string {
    return TICK_FORMAT.format(value);
}

/// A change as a signed percentage
export function formatKpiChange(change: number): string {
    return CHANGE_FORMAT.format(change);
}

/// The row that the value of a card is compared with, the label of the change
export function kpiBase(spec: KpiSpec): string | null {
    switch (spec.delta) {
        case KpiDelta.FIRST:
            return 'the first row';
        case KpiDelta.NONE:
            return null;
        default:
            return 'the previous row';
    }
}

/// Read the KPI of a result: the value column is the named one or the last one, the x axis the named one or the
/// first one if it is not the value
export function readKpi(table: arrow.Table, spec: KpiSpec): KpiReading {
    const fields = table.schema.fields;
    const rows = table.numRows;
    const indexOf = (name: string | null) => name == null ? -1 : fields.findIndex(field => field.name === name);
    const valueName = readString(spec.valueColumn);
    const xName = readString(spec.xColumn);
    const valueIndex = valueName != null ? indexOf(valueName) : fields.length - 1;
    const empty = { label: valueName ?? '', value: null, change: null, chart: null, points: [], zero: 0, rows, numeric: false, xLabel: xName, ordered: null, axis: null };
    if (valueIndex < 0) {
        return { ...empty, missing: fields.length === 0 ? 'Result has no columns' : `Result has no column ${valueName}` };
    }
    const xIndex = xName != null ? indexOf(xName) : (valueIndex !== 0 ? 0 : -1);
    if (xName != null && xIndex < 0) {
        return { ...empty, missing: `Result has no column ${xName}` };
    }
    const valueField = fields[valueIndex];
    const valueVector = table.getChildAt(valueIndex)!;
    const numbers: (number | null)[] = [];
    for (let row = 0; row < rows; ++row) numbers.push(numberOf(valueField.type, valueVector.get(row), false));

    // The last row is the value, a number large and compact, other values as the table shows them
    let value: string | null = null;
    if (rows > 0) {
        const last = numbers[rows - 1];
        const raw = valueVector.get(rows - 1);
        value = last != null ? formatKpiNumber(last) : raw == null ? null : makeArrowValueFormatter(valueField).format(raw);
    }

    // The change of the last value against the row before it or the first row
    let change: number | null = null;
    const baseRow = spec.delta === KpiDelta.FIRST ? 0 : spec.delta === KpiDelta.PREVIOUS ? rows - 2 : -1;
    if (rows >= 2 && baseRow >= 0) {
        const last = numbers[rows - 1];
        const base = numbers[baseRow];
        if (last != null && base != null && base !== 0) change = (last - base) / Math.abs(base);
    }

    // The x values of the rows, numbers for a numeric or temporal x axis
    const xField = xIndex >= 0 ? fields[xIndex] : null;
    const xVector = xIndex >= 0 ? table.getChildAt(xIndex) : null;
    const xs: (number | null)[] = [];
    for (let row = 0; row < rows; ++row) xs.push(xField != null && xVector != null ? numberOf(xField.type, xVector.get(row), true) : null);
    let ordered: boolean | null = null;
    if (xField != null && (isNumeric(xField.type) || arrow.DataType.isTimestamp(xField.type) || arrow.DataType.isDate(xField.type))) {
        const known = xs.filter((x): x is number => x != null);
        ordered = known.every((x, i) => i === 0 || known[i - 1] <= x);
    }

    // The chart: the numbers over the x axis if it is numeric or temporal and ordered, otherwise in the order of the
    // rows
    const raw: [number | null, number][] = [];
    for (let row = 0; row < rows; ++row) {
        const y = numbers[row];
        if (y != null) raw.push([xs[row], y]);
    }
    const chart = spec.chart === KpiChart.NONE ? null : spec.chart === KpiChart.BAR ? 'bar' : 'line';
    // Bars are spaced evenly in the order of the rows
    const spaced = chart === 'bar' || ordered !== true || raw.some(([x]) => x == null);
    const placed = raw.map(([x, y], i): [number, number] => [spaced ? i : x!, y]);

    // The labels of the axes: the x of the first and the last point and of the base of the change, the range of y
    let axis: KpiAxis | null = null;
    const charted = numbers.flatMap((y, row) => y == null ? [] : [row]);
    // The bars rise from zero, so zero is in the range of y
    const ys = charted.map(row => numbers[row]!);
    const range = chart === 'bar' ? extent(ys, [0, 0]) : extent(ys);
    if (chart != null && charted.length >= 2) {
        const temporal = xField != null && (arrow.DataType.isTimestamp(xField.type) || arrow.DataType.isDate(xField.type));
        const dates = temporal ? xs.filter((x): x is number => x != null) : [];
        const format = temporal ? dateFormat(dates) : null;
        const xLabel = (row: number): string | null => {
            if (xField == null || xVector == null || row < 0 || row >= rows) return null;
            const x = xs[row];
            if (format != null) return x == null ? null : format.format(x);
            if (x != null) return formatKpiNumber(x);
            const value = xVector.get(row);
            return value == null ? null : makeArrowValueFormatter(xField).format(value);
        };
        axis = {
            xFirst: xLabel(charted[0]),
            xLast: xLabel(charted[charted.length - 1]),
            xBase: change != null ? xLabel(baseRow) : null,
            yMin: chart === 'bar' && range[0] === 0 ? null : formatKpiTick(range[0]),
            yMax: formatKpiTick(range[1]),
        };
    }
    return {
        label: valueField.name,
        value,
        change,
        chart,
        points: chart == null ? [] : normalize(placed, range),
        zero: range[1] > range[0] ? (0 - range[0]) / (range[1] - range[0]) : 0,
        missing: null,
        rows,
        numeric: isNumeric(valueField.type),
        xLabel: xField?.name ?? null,
        ordered,
        axis,
    };
}

/// Fit points into the unit square, y over its range, a flat line sits in the middle
function normalize(points: [number, number][], [minY, maxY]: [number, number]): [number, number][] {
    if (points.length < 2) return [];
    let [minX, maxX] = [Infinity, -Infinity];
    for (const [x] of points) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
    }
    const width = maxX - minX;
    const height = maxY - minY;
    return points.map(([x, y]) => [
        width > 0 ? (x - minX) / width : 0,
        height > 0 ? (y - minY) / height : 0.5,
    ]);
}

/// What is wrong with a KPI card of a result, for dashql vis: the card shows anyway, but likely not what was meant
export function kpiProblems(reading: KpiReading, columns: readonly string[]): string[] {
    if (reading.missing != null) {
        const name = reading.missing.replace(/^Result has no column /, '');
        return [`the column "${name}" of the tag is no column of the result, its columns are ${columns.join(', ') || 'none'}`];
    }
    const problems: string[] = [];
    if (reading.rows === 0) problems.push('the result has no rows, the card shows a dash');
    else if (reading.value == null) problems.push(`the last row has no value in ${reading.label}, the card shows a dash`);
    if (reading.rows > 1 && !reading.numeric) {
        problems.push(`${reading.label} is no column of numbers, the card shows its last value as text without change and chart: name the column of the figure with value=<column> or put it last`);
    }
    if (reading.ordered === false) {
        problems.push(`the rows are not in the order of ${reading.xLabel}, the card shows the last row and compares it with the row before it: add order by ${reading.xLabel}`);
    }
    return problems;
}
