import type { TopLevelSpec } from 'vega-lite';

import type { ChartColors } from '../../../ui/vegalite/vegalite_theme.js';

/// The params of the bounds of the time window, in milliseconds since the epoch
export const WINDOW_START_SIGNAL = 'windowStart';
export const WINDOW_END_SIGNAL = 'windowEnd';

/// The dataset of the rows of a chart
export const ROWS_DATASET = 'rows';

/// The outcomes of queries, see QueryRow
export const QUERY_SUCCEEDED = 'Succeeded';
export const QUERY_FAILED = 'Failed';

// The axis labels are compact for small charts and leave out the zero of the baseline

/// An axis label of a duration in seconds, e.g. 850µs, 12ms, 1.2s
const DURATION_LABEL = "datum.value == 0 ? '' : datum.value >= 1 ? format(datum.value, '~r') + 's'"
    + " : datum.value >= 0.001 ? format(datum.value * 1000, '~r') + 'ms'"
    + " : format(datum.value * 1000000, '~r') + 'µs'";
/// An axis label of a memory size in MB, e.g. 64MB, 1.5GB
const MEMORY_LABEL = "datum.value == 0 ? '' : datum.value >= 1024 ? format(datum.value / 1024, '~r') + 'GB' : format(datum.value, '~r') + 'MB'";
/// An axis label of a count, e.g. 12, 1.2k, 3M
const COUNT_LABEL = "datum.value == 0 ? '' : format(datum.value, '~s')";
/// An axis label of a load, e.g. 50%
const LOAD_LABEL = "datum.value == 0 ? '' : format(datum.value, '.0%')";

/// The y axis of a small chart: a gridline at the baseline and one above it
const Y_AXIS = { tickCount: 2, labelPadding: 3 };

const WINDOW_PARAMS = [
    { name: WINDOW_START_SIGNAL, value: 0 },
    { name: WINDOW_END_SIGNAL, value: 1 },
];

/// The x channel of the time of a row in the sliding window
const TIME_X = {
    field: 't',
    type: 'temporal',
    title: null,
    scale: { domainMin: { expr: WINDOW_START_SIGNAL }, domainMax: { expr: WINDOW_END_SIGNAL } },
    axis: { format: '%H:%M', tickCount: 3, labelPadding: 3, labelSeparation: 8 },
} as const;

const QUERY_TOOLTIP = [
    { field: 'clock', title: 'Time' },
    { field: 'outcome', title: 'Outcome' },
    { field: 'elapsedText', title: 'Elapsed' },
    { field: 'peakMemoryText', title: 'Peak memory' },
    { field: 'processedRowsText', title: 'Rows processed' },
    { field: 'cpuTimeText', title: 'CPU time' },
    { field: 'waitTimeText', title: 'Wait time' },
    { field: 'query', title: 'Query' },
];

/// The kind of a value of queries, it picks the axis labels
export type QueryValueKind = 'duration' | 'count' | 'memory';

const QUERY_VALUE_LABELS: Record<QueryValueKind, string> = {
    duration: DURATION_LABEL,
    count: COUNT_LABEL,
    memory: MEMORY_LABEL,
};

/// A rule at the row nearest to the pointer with a tooltip of that row
function hoverRule(colors: ChartColors, tooltip: object[]) {
    return {
        data: { name: ROWS_DATASET },
        params: [{
            name: 'hover',
            select: { type: 'point', encodings: ['x'], nearest: true, on: 'pointerover', clear: 'pointerout' },
        }],
        mark: { type: 'rule', color: colors.title },
        encoding: {
            x: TIME_X,
            opacity: { condition: { param: 'hover', empty: false, value: 1 }, value: 0 },
            tooltip,
        },
    };
}

/// The mark of the queries in a query chart
export type QueryMark = 'bar' | 'line';

/// A value per finished query over time in a single color, e.g. its elapsed time or its processed rows.
/// Bars draw a thin bar per query, lines connect the queries.
export function queryChartSpec(colors: ChartColors, field: string, kind: QueryValueKind, mark: QueryMark): TopLevelSpec {
    const y = {
        field,
        type: 'quantitative',
        title: null,
        axis: { ...Y_AXIS, labelExpr: QUERY_VALUE_LABELS[kind] },
    };
    const layers = mark === 'bar'
        ? [{
            data: { name: ROWS_DATASET },
            mark: { type: 'bar', width: 3, clip: true },
            encoding: { x: TIME_X, y },
        }]
        : [
            {
                data: { name: ROWS_DATASET },
                mark: { type: 'area', opacity: 0.1, clip: true },
                encoding: { x: TIME_X, y },
            },
            {
                data: { name: ROWS_DATASET },
                mark: { type: 'line', clip: true },
                encoding: { x: TIME_X, y },
            },
        ];
    return { params: WINDOW_PARAMS, layer: [...layers, hoverRule(colors, QUERY_TOOLTIP)] } as TopLevelSpec;
}

/// The kind of the values of a series chart, it picks the axis labels and the tooltip format
export type SeriesKind = 'memory' | 'load';

const SERIES_LABELS: Record<SeriesKind, string> = {
    memory: MEMORY_LABEL,
    load: LOAD_LABEL,
};
const SERIES_TOOLTIP_FORMATS: Record<SeriesKind, string> = {
    memory: '.4~r',
    load: '.0%',
};

/// A series of a series chart
export interface ChartSeries {
    /// The name of the series in the rows and the tooltip
    name: string;
    /// The color of the series
    color: (colors: ChartColors) => string;
    /// Draw an area wash under the line
    area?: boolean;
}

/// A line per series over time, with a rule and a tooltip of all series at the time nearest to the pointer.
/// The rows are `{ t, series, value }`.
export function seriesSpec(colors: ChartColors, series: readonly ChartSeries[], kind: SeriesKind): TopLevelSpec {
    const color = {
        field: 'series',
        type: 'nominal',
        scale: { domain: series.map(s => s.name), range: series.map(s => s.color(colors)) },
        legend: null,
    };
    const y = {
        field: 'value',
        type: 'quantitative',
        title: null,
        scale: kind === 'load' ? { domain: [0, 1] } : { zero: true },
        axis: { ...Y_AXIS, labelExpr: SERIES_LABELS[kind] },
    };
    const areas = series.filter(s => s.area).map(s => s.name);
    return {
        params: WINDOW_PARAMS,
        layer: [
            ...(areas.length > 0 ? [{
                data: { name: ROWS_DATASET },
                transform: [{ filter: { field: 'series', oneOf: areas } }],
                mark: { type: 'area', opacity: 0.1, clip: true },
                encoding: { x: TIME_X, y, color },
            }] : []),
            {
                data: { name: ROWS_DATASET },
                mark: { type: 'line', clip: true },
                encoding: { x: TIME_X, y, color },
            },
            {
                ...hoverRule(colors, [
                    { field: 't', type: 'temporal', format: '%H:%M:%S', title: 'Time' },
                    ...series.map(s => ({ field: s.name, type: 'quantitative', format: SERIES_TOOLTIP_FORMATS[kind], title: s.name })),
                ]),
                transform: [{ pivot: 'series', value: 'value', groupby: ['t'] }],
            },
        ],
    } as TopLevelSpec;
}
