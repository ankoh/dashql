import type { TopLevelSpec } from 'vega-lite';

import type { ChartColors } from '../../ui/vegalite/vegalite_theme.js';

/// The params of the bounds of the time window, in milliseconds since the epoch
export const WINDOW_START_SIGNAL = 'windowStart';
export const WINDOW_END_SIGNAL = 'windowEnd';

/// The dataset of the rows of a chart
export const ROWS_DATASET = 'rows';

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
    axis: { format: '%H:%M:%S', tickCount: 4, labelPadding: 3, labelSeparation: 8 },
} as const;

/// The y axis of a small chart
const Y_AXIS = { tickCount: 3, labelPadding: 3 };

/// The price of a symbol per second, `{ t, open, high, low, close }`: the range of the second as a band and the close as a line.
/// A rule with a tooltip marks the second nearest to the pointer.
export function priceChartSpec(colors: ChartColors): TopLevelSpec {
    const y = { type: 'quantitative', title: null, scale: { zero: false }, axis: Y_AXIS };
    return {
        params: WINDOW_PARAMS,
        layer: [
            {
                data: { name: ROWS_DATASET },
                mark: { type: 'area', opacity: 0.15, clip: true, color: colors.primary },
                encoding: { x: TIME_X, y: { ...y, field: 'low' }, y2: { field: 'high' } },
            },
            {
                data: { name: ROWS_DATASET },
                mark: { type: 'line', clip: true, strokeWidth: 2, color: colors.primary },
                encoding: { x: TIME_X, y: { ...y, field: 'close' } },
            },
            {
                data: { name: ROWS_DATASET },
                params: [{
                    name: 'hover',
                    select: { type: 'point', encodings: ['x'], nearest: true, on: 'pointerover', clear: 'pointerout' },
                }],
                mark: { type: 'rule', color: colors.title },
                encoding: {
                    x: TIME_X,
                    opacity: { condition: { param: 'hover', empty: false, value: 1 }, value: 0 },
                    tooltip: [
                        { field: 't', type: 'temporal', format: '%H:%M:%S', title: 'Time' },
                        { field: 'close', type: 'quantitative', format: ',.6~r', title: 'Close' },
                        { field: 'high', type: 'quantitative', format: ',.6~r', title: 'High' },
                        { field: 'low', type: 'quantitative', format: ',.6~r', title: 'Low' },
                        { field: 'size', type: 'quantitative', format: ',.4~r', title: 'Size' },
                    ],
                },
            },
        ],
    } as TopLevelSpec;
}

/// The trades per second, `{ t, trades }`, as bars that span their second
export function throughputChartSpec(colors: ChartColors): TopLevelSpec {
    return {
        params: WINDOW_PARAMS,
        data: { name: ROWS_DATASET },
        transform: [{ calculate: 'datum.t + 1000', as: 't1' }],
        // A gap of 1px between the bars
        mark: { type: 'bar', clip: true, xOffset: 0.5, x2Offset: -0.5, color: colors.primary },
        encoding: {
            x: TIME_X,
            x2: { field: 't1' },
            y2: { datum: 0 },
            y: {
                field: 'trades',
                type: 'quantitative',
                title: null,
                axis: { ...Y_AXIS, labelExpr: "datum.value == 0 ? '' : format(datum.value, '~s')", tickMinStep: 1 },
            },
            tooltip: [
                { field: 't', type: 'temporal', format: '%H:%M:%S', title: 'Time' },
                { field: 'trades', type: 'quantitative', format: ',', title: 'Trades' },
            ],
        },
    } as TopLevelSpec;
}
