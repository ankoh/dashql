import * as React from 'react';
import type { TopLevelSpec } from 'vega-lite';

import { SegmentedControl, SegmentedControlSize } from '../../../ui/foundations/segmented_control.js';
import { VegaLiteChart } from '../../../ui/vegalite/vegalite_chart.js';
import type { ChartColors } from '../../../ui/vegalite/vegalite_theme.js';
import type { HyperQueryEnd, HyperResourceSample } from '../hyper/hyper_log_metrics.js';
import { useHyperConnectionQueries, useHyperResourceSamples } from '../hyper/hyper_log_metrics_provider.js';
import {
    computeQueryMetrics,
    computeResourceMetrics,
    formatClock,
    formatCount,
    formatDuration,
    formatLoad,
    formatMemory,
    groupQueries,
    METRICS_WINDOWS,
    QUERY_SCOPES,
    QueryScope,
    queriesInScope,
} from './connection_metrics.js';
import {
    QUERY_FAILED,
    QUERY_SUCCEEDED,
    queryChartSpec,
    ROWS_DATASET,
    seriesSpec,
    WINDOW_END_SIGNAL,
    WINDOW_START_SIGNAL,
    type ChartSeries,
    type SeriesKind,
    type QueryMark,
} from './connection_metric_specs.js';
import * as styles from './connection_metrics_dashboard.module.css';

/// The labels of the query scopes
const QUERY_SCOPE_LABELS: Record<QueryScope, string> = {
    [QueryScope.User]: 'User',
    [QueryScope.System]: 'System',
    [QueryScope.All]: 'All',
};

/// The number of queries that the activity lists
const MAX_LISTED_QUERIES = 100;

/// The specs of the cards, their identity keeps the charts embedded
const QUERY_MARK: QueryMark = 'bar';
const LATENCY_SPEC = (colors: ChartColors) => queryChartSpec(colors, 'elapsed', 'duration', QUERY_MARK);
const ROWS_SPEC = (colors: ChartColors) => queryChartSpec(colors, 'processedRows', 'count', QUERY_MARK);
const PEAK_MEMORY_SPEC = (colors: ChartColors) => queryChartSpec(colors, 'peakMemoryMb', 'memory', QUERY_MARK);
const CPU_TIME_SPEC = (colors: ChartColors) => queryChartSpec(colors, 'cpuTime', 'duration', QUERY_MARK);
const WAIT_TIME_SPEC = (colors: ChartColors) => queryChartSpec(colors, 'waitTime', 'duration', QUERY_MARK);

/// A row of a series chart
interface SeriesRow {
    /// The time in milliseconds since the epoch
    t: number;
    /// The name of the series
    series: string;
    /// The value
    value: number;
}

/// A finished query as a row of the latency chart
interface QueryRow {
    /// The end of the query in milliseconds since the epoch
    t: number;
    /// The outcome, QUERY_SUCCEEDED or QUERY_FAILED
    outcome: string;
    /// The elapsed time in seconds
    elapsed: number | null;
    /// The rows that the query processed
    processedRows: number;
    /// The peak transaction memory in MB
    peakMemoryMb: number | null;
    /// The CPU time in seconds
    cpuTime: number;
    /// The wait time in seconds
    waitTime: number;
    /// The formatted values of the tooltip
    clock: string;
    elapsedText: string;
    peakMemoryText: string;
    processedRowsText: string;
    cpuTimeText: string;
    waitTimeText: string;
    query: string;
}

const optionalValue = (value: number | null, format: (value: number) => string) => value == null ? '–' : format(value);

/// The rows of the queries and samples, a row keeps its identity so the charts only receive new rows
const QUERY_ROWS = new WeakMap<HyperQueryEnd, QueryRow>();

function queryRow(query: HyperQueryEnd): QueryRow {
    let row = QUERY_ROWS.get(query);
    if (row == null) {
        row = {
            t: query.endedAt,
            outcome: query.succeeded ? QUERY_SUCCEEDED : QUERY_FAILED,
            elapsed: query.elapsed,
            processedRows: query.processedRows,
            peakMemoryMb: query.peakMemoryMb,
            cpuTime: query.cpuTime,
            waitTime: query.waitTime,
            clock: formatClock(query.endedAt),
            elapsedText: optionalValue(query.elapsed, formatDuration),
            peakMemoryText: optionalValue(query.peakMemoryMb, formatMemory),
            processedRowsText: formatCount(query.processedRows),
            cpuTimeText: formatDuration(query.cpuTime),
            waitTimeText: formatDuration(query.waitTime),
            query: query.succeeded ? query.query ?? '' : `${query.errorCode ?? 'failed'}: ${query.query ?? ''}`,
        };
        QUERY_ROWS.set(query, row);
    }
    return row;
}

/// A metric of the engine that Hyper samples, with a card of its own
interface EngineMetric {
    /// The name of the metric, also the series of its rows
    title: string;
    /// The test id of the card
    testId: string;
    /// The value of a sample, null if the sample did not record it
    value: (sample: HyperResourceSample) => number | null;
    /// Format a value
    format: (value: number) => string;
    /// The spec of the chart
    spec: (colors: ChartColors) => TopLevelSpec;
    /// The rows of the samples, cached by sample
    rows: WeakMap<HyperResourceSample, SeriesRow[]>;
}

function engineMetric(
    title: string,
    testId: string,
    kind: SeriesKind,
    value: (sample: HyperResourceSample) => number | null,
    format: (value: number) => string,
): EngineMetric {
    const series: ChartSeries[] = [{ name: title, color: colors => colors.primary, area: true }];
    return { title, testId, value, format, spec: colors => seriesSpec(colors, series, kind), rows: new WeakMap() };
}

const ENGINE_METRICS: EngineMetric[] = [
    engineMetric('Process memory', 'metric-process-memory', 'memory', sample => sample.processMemoryMb, formatMemory),
    engineMetric('Storage memory', 'metric-storage-memory', 'memory', sample => sample.storageMemoryMb, formatMemory),
    engineMetric('Query memory', 'metric-query-memory', 'memory', sample => sample.transactionMemoryMb, formatMemory),
    engineMetric('Load', 'metric-load', 'load', sample => sample.overallLoad, formatLoad),
];

/// The row of a sample in the chart of an engine metric
function engineRows(metric: EngineMetric, sample: HyperResourceSample): SeriesRow[] {
    let rows = metric.rows.get(sample);
    if (rows == null) {
        const value = metric.value(sample);
        rows = value == null ? [] : [{ t: sample.sampledAt, series: metric.title, value }];
        metric.rows.set(sample, rows);
    }
    return rows;
}

/// The current time, advanced once per period
function useNow(periodMs: number): number {
    const [now, setNow] = React.useState(() => Date.now());
    React.useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), periodMs);
        return () => clearInterval(timer);
    }, [periodMs]);
    return now;
}


interface MetricCardProps {
    /// The name of the metric
    title: string;
    /// The summary of the metric in the window, e.g. its total
    value: string;
    /// The test id of the card
    'data-testid': string;
    /// The chart
    children: React.ReactElement;
}

/// A metric with its summary in the window next to its name and a small plot of it
const MetricCard: React.FC<MetricCardProps> = props => (
    <section className={styles.card} aria-label={props.title} data-testid={props['data-testid']}>
        <header className={styles.card_header}>
            <h4 className={styles.card_title}>{props.title}</h4>
            <span className={styles.card_value} data-testid="metric-value">{props.value}</span>
        </header>
        {props.children}
    </section>
);

/// The views of the queries of the activity
enum ActivityView {
    /// The queries grouped by their shape, most elapsed time first
    Top = 'top',
    /// The runs, newest first
    Recent = 'recent',
    /// The runs, slowest first
    Slowest = 'slowest',
}

const ACTIVITY_VIEWS: readonly { view: ActivityView; label: string }[] = [
    { view: ActivityView.Top, label: 'Top' },
    { view: ActivityView.Recent, label: 'Recent' },
    { view: ActivityView.Slowest, label: 'Slowest' },
];

/// The query shapes of the window with their runs, most elapsed time first
const TopQueries: React.FC<{ queries: readonly HyperQueryEnd[] }> = ({ queries }) => {
    const groups = React.useMemo(() => groupQueries(queries).slice(0, MAX_LISTED_QUERIES), [queries]);
    const totalElapsed = groups.reduce((sum, group) => sum + group.totalElapsed, 0);
    return (
        <table className={styles.table}>
            <thead>
                <tr>
                    <th className={styles.table_query}>Query</th>
                    <th className={styles.table_number}>Runs</th>
                    <th className={styles.table_number}>Total</th>
                    <th className={styles.table_number}>Share</th>
                    <th className={styles.table_number}>Mean</th>
                    <th className={styles.table_number}>Rows</th>
                    <th className={styles.table_number}>Failed</th>
                </tr>
            </thead>
            <tbody>
                {groups.map(group => (
                    <tr key={group.shape} data-testid="query-group">
                        <td className={styles.table_query} title={group.query ?? undefined}>{group.query ?? ''}</td>
                        <td className={styles.table_number}>{formatCount(group.count)}</td>
                        <td className={styles.table_number}>{formatDuration(group.totalElapsed)}</td>
                        <td className={styles.table_number}>
                            {totalElapsed > 0 ? `${Math.round(group.totalElapsed / totalElapsed * 100)}%` : '–'}
                        </td>
                        <td className={styles.table_number}>{formatDuration(group.meanElapsed)}</td>
                        <td className={styles.table_number}>{group.processedRows > 0 ? formatCount(group.processedRows) : '–'}</td>
                        <td className={styles.table_number}>
                            {group.failed > 0 ? <span className={styles.status_failed}>{formatCount(group.failed)}</span> : '–'}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
};

/// The runs of the window, newest or slowest first
const QueryRuns: React.FC<{ queries: readonly HyperQueryEnd[]; slowest: boolean }> = ({ queries, slowest }) => {
    const listed = React.useMemo(() => {
        const sorted = slowest
            ? [...queries].sort((l, r) => (r.elapsed ?? 0) - (l.elapsed ?? 0))
            : [...queries].reverse();
        return sorted.slice(0, MAX_LISTED_QUERIES);
    }, [queries, slowest]);
    return (
        <table className={styles.table}>
            <thead>
                <tr>
                    <th className={styles.table_time}>Time</th>
                    <th className={styles.table_query}>Query</th>
                    <th className={styles.table_number}>Elapsed</th>
                    <th className={styles.table_number}>CPU</th>
                    <th className={styles.table_number}>Rows</th>
                    <th className={styles.table_number}>Memory</th>
                    <th className={styles.table_status}>Status</th>
                </tr>
            </thead>
            <tbody>
                {listed.map((query, i) => (
                    <tr key={i} data-testid="recent-query" data-state={query.succeeded ? 'succeeded' : 'failed'}>
                        <td className={styles.table_time}>{formatClock(query.endedAt)}</td>
                        <td className={styles.table_query} title={query.query ?? undefined}>{query.query ?? query.statement ?? ''}</td>
                        <td className={styles.table_number}>{optionalValue(query.elapsed, formatDuration)}</td>
                        <td className={styles.table_number}>{formatDuration(query.cpuTime)}</td>
                        <td className={styles.table_number}>{query.processedRows > 0 ? formatCount(query.processedRows) : '–'}</td>
                        <td className={styles.table_number}>{optionalValue(query.peakMemoryMb, formatMemory)}</td>
                        <td className={styles.table_status}>
                            {query.succeeded
                                ? <span className={styles.status_ok}>OK</span>
                                : <span className={styles.status_failed} title={query.errorMessage ?? undefined}>{query.errorCode ?? 'Failed'}</span>}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
};

/// The finished queries of the window, grouped by their shape or as runs
const QueryActivity: React.FC<{ queries: readonly HyperQueryEnd[] }> = ({ queries }) => {
    const [view, setView] = React.useState(ActivityView.Top);
    const failed = queries.reduce((n, query) => n + (query.succeeded ? 0 : 1), 0);
    return (
        <section className={styles.panel} aria-label="Queries" data-testid="recent-queries">
            <header className={styles.panel_header}>
                <h3 className={styles.panel_title}>Queries</h3>
                <span className={styles.panel_detail} data-testid="recent-queries-count">
                    {`${formatCount(queries.length)} runs${failed > 0 ? ` · ${formatCount(failed)} failed` : ''}`}
                </span>
                <SegmentedControl
                    aria-label="View"
                    data-testid="recent-queries-order"
                    size={SegmentedControlSize.XSmall}
                    onChange={index => setView(ACTIVITY_VIEWS[index].view)}
                >
                    {ACTIVITY_VIEWS.map(v => (
                        <SegmentedControl.Button key={v.view} selected={v.view === view} data-order={v.view}>{v.label}</SegmentedControl.Button>
                    ))}
                </SegmentedControl>
            </header>
            {queries.length === 0
                ? <p className={styles.panel_empty} data-testid="connection-metrics-empty">No finished queries in this window</p>
                : (
                    <div className={styles.table_scroll}>
                        {view === ActivityView.Top
                            ? <TopQueries queries={queries} />
                            : <QueryRuns queries={queries} slowest={view === ActivityView.Slowest} />}
                    </div>
                )}
        </section>
    );
};

interface Props {
    /// The id of the connection
    connectionId: string;
    /// The details of the connection, shown next to the queries
    details?: React.ReactNode;
}

/// The activity and the metrics of an embedded Hyper connection and of the embedded Hyper, from the Hyper log
export const ConnectionMetricsDashboard: React.FC<Props> = (props: Props) => {
    const queries = useHyperConnectionQueries(props.connectionId);
    const samples = useHyperResourceSamples();
    return <ConnectionMetricsView queries={queries} samples={samples} details={props.details} />;
};

interface ViewProps {
    /// The finished queries, ordered by their end
    queries: readonly HyperQueryEnd[];
    /// The resource samples of the Hyper process, ordered by time
    samples: readonly HyperResourceSample[];
    /// The details of the connection, shown next to the queries
    details?: React.ReactNode;
    /// The current time, the clock when not set
    now?: number;
}

/// The query metrics of a connection and the resource metrics of the engine in a sliding time window
export const ConnectionMetricsView: React.FC<ViewProps> = ({ queries, samples, details, now }) => {
    const [windowIndex, setWindowIndex] = React.useState(0);
    const window = METRICS_WINDOWS[windowIndex];
    const [scope, setScope] = React.useState(QueryScope.All);
    // The window slides every second
    const clock = useNow(1000);
    const end = now ?? clock;
    const scopedQueries = React.useMemo(() => queriesInScope(queries, scope), [queries, scope]);
    const metrics = React.useMemo(() => computeQueryMetrics(scopedQueries, window, end), [scopedQueries, window, end]);
    const resources = React.useMemo(() => computeResourceMetrics(samples, window, end), [samples, window, end]);
    const latest = resources.latest;

    const signals = React.useMemo(
        () => ({ [WINDOW_START_SIGNAL]: metrics.start, [WINDOW_END_SIGNAL]: metrics.end }),
        [metrics.start, metrics.end],
    );
    const datasets = React.useMemo(() => {
        return {
            latency: { [ROWS_DATASET]: metrics.queries.filter(query => query.elapsed != null).map(queryRow) },
            peakMemory: { [ROWS_DATASET]: metrics.queries.filter(query => query.peakMemoryMb != null).map(queryRow) },
            queries: { [ROWS_DATASET]: metrics.queries.map(queryRow) },
            engine: ENGINE_METRICS.map(metric => ({ [ROWS_DATASET]: resources.samples.flatMap(sample => engineRows(metric, sample)) })),
        };
    }, [metrics, resources.samples]);

    return (
        <div className={styles.overview} data-testid="connection-metrics">
            <div className={styles.toolbar}>
                <SegmentedControl
                    aria-label="Time window"
                    data-testid="connection-metrics-window"
                    size={SegmentedControlSize.Small}
                    onChange={setWindowIndex}
                >
                    {METRICS_WINDOWS.map((w, i) => (
                        <SegmentedControl.Button key={w.key} selected={i === windowIndex} data-window={w.key}>
                            {w.key}
                        </SegmentedControl.Button>
                    ))}
                </SegmentedControl>
            </div>
            <section className={styles.section} aria-label="Connection" data-testid="connection-metrics-connection">
                <header className={styles.section_header}>
                    <h3 className={styles.section_title}>Connection</h3>
                    <SegmentedControl
                        aria-label="Queries"
                        data-testid="connection-metrics-scope"
                        size={SegmentedControlSize.Small}
                        onChange={index => setScope(QUERY_SCOPES[index])}
                    >
                        {QUERY_SCOPES.map(s => (
                            <SegmentedControl.Button key={s} selected={s === scope} data-scope={s}>
                                {QUERY_SCOPE_LABELS[s]}
                            </SegmentedControl.Button>
                        ))}
                    </SegmentedControl>
                </header>
                <div className={styles.grid}>
                    <MetricCard
                        title="Latency"
                        value={optionalValue(metrics.elapsedP95, formatDuration)}
                        data-testid="metric-latency"
                    >
                        <VegaLiteChart className={styles.chart} spec={LATENCY_SPEC} datasets={datasets.latency} signals={signals} />
                    </MetricCard>
                    <MetricCard title="Rows processed" value={formatCount(metrics.processedRows)} data-testid="metric-rows">
                        <VegaLiteChart className={styles.chart} spec={ROWS_SPEC} datasets={datasets.queries} signals={signals} />
                    </MetricCard>
                    <MetricCard title="CPU time" value={formatDuration(metrics.cpuTime)} data-testid="metric-cpu-time">
                        <VegaLiteChart className={styles.chart} spec={CPU_TIME_SPEC} datasets={datasets.queries} signals={signals} />
                    </MetricCard>
                    <MetricCard title="Wait time" value={formatDuration(metrics.waitTime)} data-testid="metric-wait-time">
                        <VegaLiteChart className={styles.chart} spec={WAIT_TIME_SPEC} datasets={datasets.queries} signals={signals} />
                    </MetricCard>
                    <MetricCard title="Peak memory" value={optionalValue(metrics.peakMemoryMb, formatMemory)} data-testid="metric-peak-memory">
                        <VegaLiteChart className={styles.chart} spec={PEAK_MEMORY_SPEC} datasets={datasets.peakMemory} signals={signals} />
                    </MetricCard>
                </div>
                <div className={styles.activity}>
                    <QueryActivity queries={metrics.queries} />
                    {details}
                </div>
            </section>
            <section className={styles.section} aria-label="Engine" data-testid="connection-metrics-engine">
                <header className={styles.section_header}>
                    <h3 className={styles.section_title}>Engine</h3>
                    <span className={styles.section_detail}>Hyper process, shared by all embedded connections</span>
                </header>
                <div className={styles.grid}>
                    {ENGINE_METRICS.map((metric, i) => (
                        <MetricCard
                            key={metric.testId}
                            title={metric.title}
                            value={optionalValue(latest == null ? null : metric.value(latest), metric.format)}
                            data-testid={metric.testId}
                        >
                            <VegaLiteChart className={styles.chart} spec={metric.spec} datasets={datasets.engine[i]} signals={signals} />
                        </MetricCard>
                    ))}
                </div>
            </section>
        </div>
    );
};
