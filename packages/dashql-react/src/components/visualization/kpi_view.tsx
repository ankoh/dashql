import * as React from 'react';

import type * as arrow from 'apache-arrow';
import { buffers } from '@akohn/dashql';
import { QueryExecutionStatus, type QueryExecutionState } from '@akohn/dashql/platform/query/query_execution_state';
import { formatKpiChange, kpiBase, readKpi } from '@akohn/dashql/platform/workbook/kpi_reading';
import * as styles from './kpi_view.module.css';
import { CardPlaceholder, QueryStatusPlaceholder } from '../card_placeholder.js';
import { useLogger } from '../../logger.js';

type KpiSpec = buffers.visualization.KpiSpecT;

export interface KpiViewProps {
    query: QueryExecutionState | null;
    /// The result table of the query: the value of its last row is the figure, its rows the chart behind it
    resultTable: arrow.Table | null;
    spec: KpiSpec | null;
}

/// The height of the chart in the units of its view box, the width is 100
const CHART_HEIGHT = 40;
/// The chart keeps a margin above its highest point
const CHART_TOP = 4;

/// The line and the area of the chart behind the value
function chartPaths(points: [number, number][]): { line: string; area: string } {
    const coordinates = points.map(([x, y]) => `${(x * 100).toFixed(2)},${(CHART_TOP + (1 - y) * (CHART_HEIGHT - CHART_TOP)).toFixed(2)}`);
    const line = `M${coordinates.join('L')}`;
    const area = `${line}L100,${CHART_HEIGHT}L0,${CHART_HEIGHT}Z`;
    return { line, area };
}

/// A KPI card: the value of the last row of the result, large, with its change and a chart of the value across the
/// rows behind it. A result of one row shows only the value.
export function KpiView(props: KpiViewProps): React.ReactElement {
    const logger = useLogger();
    const succeeded = props.query?.status === QueryExecutionStatus.SUCCEEDED;
    const table = succeeded ? props.resultTable : null;

    const reading = React.useMemo(() => {
        if (props.spec == null || table == null) return null;
        try {
            return readKpi(table, props.spec);
        } catch (e) {
            logger.error('cannot read the KPI of a result', { error: String(e) }, 'kpi_view');
            return null;
        }
    }, [props.spec, table, logger]);
    const paths = React.useMemo(() => reading != null && reading.points.length >= 2 ? chartPaths(reading.points) : null, [reading]);

    if (props.spec == null) {
        return <CardPlaceholder message="No visualization available" />;
    }
    if (!succeeded) {
        return <QueryStatusPlaceholder query={props.query} />;
    }
    if (reading == null) {
        return <CardPlaceholder message="No visualization available" />;
    }
    if (reading.missing != null) {
        return <CardPlaceholder message={reading.missing} />;
    }
    const direction = reading.change == null || reading.change === 0 ? 'flat' : reading.change > 0 ? 'up' : 'down';
    const base = kpiBase(props.spec) ?? 'the previous row';
    return (
        <div className={styles.root} data-testid="kpi-view">
            {paths != null && (
                <svg className={styles.chart} viewBox={`0 0 100 ${CHART_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true" data-testid="kpi-chart">
                    <path className={styles.area} d={paths.area} />
                    <path className={styles.line} d={paths.line} />
                </svg>
            )}
            <div className={styles.content}>
                <div className={styles.label}>{reading.label}</div>
                <div className={styles.figures}>
                    <span className={styles.value} data-testid="kpi-value">{reading.value ?? '–'}</span>
                    {reading.change != null && (
                        <span
                            className={styles.change}
                            data-direction={direction}
                            data-testid="kpi-change"
                            title={`Change against ${base}`}
                        >
                            {direction === 'up' ? '▲ ' : direction === 'down' ? '▼ ' : ''}{formatKpiChange(reading.change)}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}
