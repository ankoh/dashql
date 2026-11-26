import * as React from 'react';

import { buffers } from '@akohn/dashql';
import { QueryExecutionStatus } from '@akohn/dashql/platform/query/query_execution_state';
import { formatKpiChange, kpiBase, KPI_CARD_ROWS, readKpi, type KpiReading } from '@akohn/dashql/platform/workbook/kpi_reading';
import type { QueryModel } from '../../models/query_model.js';
import * as styles from './kpi_view.module.css';
import { CardPlaceholder, QueryStatusPlaceholder } from '../card_placeholder.js';
import { useObservedSize } from '../size_observer.js';
import { useResultRows } from './result_rows.js';
import { CappedRows } from './capped_rows.js';
import { useLogger } from '../../logger.js';

type KpiSpec = buffers.visualization.KpiSpecT;

export interface KpiViewProps {
    /// The query: the value of the last row of its result is the figure, the last rows the chart behind it
    model: QueryModel | null;
    spec: KpiSpec | null;
}

/// The chart starts at this share of the height of the card, below the value, like the background charts of Grafana
/// and Kibana: the text overlaps the top of the chart at most
const CHART_TOP_SHARE = 0.45;
/// The chart keeps at least the top of the card for the label
const CHART_TOP_MIN = 30;
/// The chart keeps the bottom of the card for the labels of its x axis
const CHART_BOTTOM = 20;
/// The inset of the labels of the axes from the edges of the card
const LABEL_INSET = 8;
/// The labels of the right edge keep clear of the resize handle of a card
const LABEL_INSET_RIGHT = 20;
/// The gap between the bars, like the bars of the charts of DashQL (`binSpacing` of their Vega-Lite config)
const BAR_GAP = 1;

/// A bar of the chart in pixels
interface Bar {
    x: number;
    y: number;
    width: number;
    height: number;
}

/// The chart of a KPI card in pixels across the full width of the card: the line and its area or the bars, the lines
/// of the smallest and the largest value
interface ChartLayout {
    line: string | null;
    area: string | null;
    bars: Bar[];
    top: number;
    bottom: number;
}

function layoutChart(reading: KpiReading, width: number, height: number): ChartLayout | null {
    const points = reading.points;
    const top = Math.max(CHART_TOP_MIN, Math.round(height * CHART_TOP_SHARE));
    const bottom = height - CHART_BOTTOM;
    if (reading.chart == null || points.length < 2 || width < 40 || bottom - top < 12) return null;
    const yOf = (y: number) => top + (1 - y) * (bottom - top);
    if (reading.chart === 'bar') {
        // A band per row, the bar fills it but the gap
        const band = width / points.length;
        const gap = band > 3 * BAR_GAP ? BAR_GAP : 0;
        const base = yOf(reading.zero);
        const bars = points.map(([, y], i) => {
            const end = yOf(y);
            return { x: i * band, y: Math.min(base, end), width: Math.max(band - gap, 0.5), height: Math.max(Math.abs(end - base), 1) };
        });
        return { line: null, area: null, bars, top, bottom };
    }
    const coordinates = points.map(([x, y]) => `${(x * width).toFixed(1)},${yOf(y).toFixed(1)}`);
    const line = `M${coordinates.join('L')}`;
    const area = `${line}L${width},${height}L0,${height}Z`;
    return { line, area, bars: [], top, bottom };
}

/// The chart behind the value: a faint line and area or faint bars across the full width of the lower part of the
/// card, the labels of its axes inset at the edges
function KpiChart(props: { reading: KpiReading; width: number; height: number }): React.ReactElement | null {
    const gradient = React.useId();
    const layout = layoutChart(props.reading, props.width, props.height);
    const axis = props.reading.axis;
    if (layout == null) return null;
    const right = props.width - LABEL_INSET;
    const xLabelY = props.height - 7;
    return (
        <svg className={styles.chart} width={props.width} height={props.height} aria-hidden="true" data-testid="kpi-chart">
            <defs>
                <linearGradient id={gradient} x1="0" y1={layout.top} x2="0" y2={props.height} gradientUnits="userSpaceOnUse">
                    <stop offset="0" className={styles.area_top} />
                    <stop offset="1" className={styles.area_bottom} />
                </linearGradient>
            </defs>
            <line className={styles.rule} x1={0} x2={props.width} y1={layout.top} y2={layout.top} />
            <line className={styles.rule} x1={0} x2={props.width} y1={layout.bottom} y2={layout.bottom} />
            {layout.area != null && <path d={layout.area} fill={`url(#${gradient})`} />}
            {layout.line != null && <path className={styles.line} d={layout.line} />}
            {layout.bars.map((bar, i) => (
                <rect
                    key={i}
                    className={i === layout.bars.length - 1 ? styles.bar_last : styles.bar}
                    x={bar.x}
                    y={bar.y}
                    width={bar.width}
                    height={bar.height}
                />
            ))}
            {axis != null && (
                <g className={styles.axis}>
                    <text x={right} y={layout.top - 4} textAnchor="end">{axis.yMax}</text>
                    {axis.yMin != null && <text x={right} y={layout.bottom - 4} textAnchor="end">{axis.yMin}</text>}
                    {axis.xFirst != null && <text x={LABEL_INSET} y={xLabelY}>{axis.xFirst}</text>}
                    {axis.xLast != null && <text x={props.width - LABEL_INSET_RIGHT} y={xLabelY} textAnchor="end">{axis.xLast}</text>}
                </g>
            )}
        </svg>
    );
}

/// A KPI card: the value of the last row of the result, large, with its change and a chart of the value across the
/// rows behind it. A result of one row shows only the value. The card reads the last rows of the result, at most
/// `KPI_CARD_ROWS`.
export function KpiView(props: KpiViewProps): React.ReactElement {
    const logger = useLogger();
    const rootRef = React.useRef<HTMLDivElement>(null);
    const size = useObservedSize(rootRef);
    const query = props.model?.query ?? null;
    const succeeded = query?.status === QueryExecutionStatus.SUCCEEDED;
    const { table, rows, reading: readingRows } = useResultRows(props.model, 'last', KPI_CARD_ROWS, false);

    const reading = React.useMemo(() => {
        if (props.spec == null || table == null) return null;
        try {
            return readKpi(table, props.spec);
        } catch (e) {
            logger.error('cannot read the KPI of a result', { error: String(e) }, 'kpi_view');
            return null;
        }
    }, [props.spec, table, logger]);

    if (props.spec == null) {
        return <CardPlaceholder message="No visualization available" />;
    }
    if (!succeeded) {
        return <QueryStatusPlaceholder query={query} />;
    }
    if (readingRows) {
        return <CardPlaceholder />;
    }
    if (reading == null) {
        return <CardPlaceholder message="No visualization available" />;
    }
    if (reading.missing != null) {
        return <CardPlaceholder message={reading.missing} />;
    }
    const direction = reading.change == null || reading.change === 0 ? 'flat' : reading.change > 0 ? 'up' : 'down';
    const base = kpiBase(props.spec) ?? 'the previous row';
    const versus = reading.axis?.xBase;
    return (
        <div className={styles.root} ref={rootRef} data-testid="kpi-view">
            {size != null && <KpiChart reading={reading} width={size.width} height={size.height} />}
            {table != null && rows > table.numRows && <CappedRows className={styles.capped} part="last" shown={table.numRows} rows={rows} />}
            <div className={styles.content}>
                <div className={styles.label}>{reading.label}</div>
                <div className={styles.value} data-testid="kpi-value">{reading.value ?? '–'}</div>
                {reading.change != null && (
                    <div className={styles.change_row} title={`Change against ${base}`}>
                        <span className={styles.change} data-direction={direction} data-testid="kpi-change">
                            {direction === 'up' ? '▲ ' : direction === 'down' ? '▼ ' : ''}{formatKpiChange(reading.change)}
                        </span>
                        {versus != null && <span className={styles.versus}>vs {versus}</span>}
                    </div>
                )}
            </div>
        </div>
    );
}
