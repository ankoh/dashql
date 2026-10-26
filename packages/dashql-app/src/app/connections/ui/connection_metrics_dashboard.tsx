import type * as arrow from 'apache-arrow';
import * as React from 'react';
import type { TopLevelSpec } from 'vega-lite';

import type { EmbeddedClientContext } from '../../../platform/database/embedded_database.js';
import { stringifyError } from '../../../platform/logger/logger.js';
import { useLogger } from '../../../platform/logger/logger_provider.js';
import { ButtonSize, ButtonVariant, IconButton } from '../../../ui/foundations/button.js';
import { SegmentedControl, SegmentedControlSize } from '../../../ui/foundations/segmented_control.js';
import { SyncIcon } from '../../../ui/foundations/symbol_icon.js';
import { Tooltip } from '../../../ui/foundations/tooltip.js';
import { VegaLiteChart, type VegaSignals } from '../../../ui/vegalite/vegalite_chart.js';
import type { ChartColors } from '../../../ui/vegalite/vegalite_theme.js';
import type { HyperLogError, HyperQueryEnd, HyperResourceSample } from '../hyper/hyper_log_metrics.js';
import { overviewClientContext, queryEndsQuery } from '../hyper/hyper_log_metrics.js';
import { useHyperLogMetrics, useHyperLogRows, useHyperLogState } from '../hyper/hyper_log_metrics_provider.js';
import {
    bucketQueries,
    bucketSamples,
    computeQueryMetrics,
    computeResourceMetrics,
    formatClock,
    formatCount,
    formatDuration,
    formatLoad,
    formatMemory,
    METRICS_WINDOWS,
    QUERY_SCOPES,
    QueryScope,
    queriesInScope,
    type MetricsWindow,
    type QueryBucket,
    type SampleAggregate,
} from './connection_metrics.js';
import {
    bucketChartSpec,
    ROWS_DATASET,
    seriesSpec,
    WINDOW_END_SIGNAL,
    WINDOW_START_SIGNAL,
    type ChartSeries,
    type SeriesKind,
} from './connection_metric_specs.js';
import { recentQueriesSql, queryShapesSql } from './connection_query_sql.js';
import { QueryTable, type QueryTableProps } from './connection_query_table.js';
import * as styles from './connection_metrics_dashboard.module.css';

/// The labels of the query scopes
const QUERY_SCOPE_LABELS: Record<QueryScope, string> = {
    [QueryScope.User]: 'User',
    [QueryScope.App]: 'App',
    [QueryScope.All]: 'All',
};

/// The specs of the cards, their identity keeps the charts embedded
const COUNT_SPEC = bucketChartSpec('count', 'count', [
    { field: 'count', title: 'Queries' },
    { field: 'failed', title: 'Failed' },
]);
const LATENCY_SPEC = bucketChartSpec('elapsedP95', 'duration', [
    { field: 'elapsedP95Text', title: 'p95 elapsed' },
    { field: 'p95Window', title: 'p95 of' },
]);
const ROWS_SPEC = bucketChartSpec('processedRows', 'count', [
    { field: 'count', title: 'Queries' },
    { field: 'processedRowsText', title: 'Rows processed' },
]);
const CPU_TIME_SPEC = bucketChartSpec('meanCpuTime', 'duration', [
    { field: 'count', title: 'Queries' },
    { field: 'meanCpuTimeText', title: 'Mean CPU time' },
]);
const WAIT_TIME_SPEC = bucketChartSpec('meanWaitTime', 'duration', [
    { field: 'count', title: 'Queries' },
    { field: 'meanWaitTimeText', title: 'Mean wait time' },
]);
const PEAK_MEMORY_SPEC = bucketChartSpec('peakMemoryMb', 'memory', [
    { field: 'count', title: 'Queries' },
    { field: 'peakMemoryText', title: 'Peak memory' },
]);

const optionalValue = (value: number | null, format: (value: number) => string) => value == null ? '–' : format(value);

/// The time of day of a bucket, for the tooltips
const bucketClock = (bucket: { start: number; end: number }) => `${formatClock(bucket.start)} – ${formatClock(bucket.end)}`;

/// Are two buckets equal in every value?
function sameBucket<B extends object>(l: B, r: B): boolean {
    return (Object.keys(l) as (keyof B)[]).every(key => l[key] === r[key]);
}

/// The rows of buckets, a row keeps its identity while its bucket is unchanged.
/// A chart then only receives the rows of the buckets that changed, e.g. of the newest one.
function useBucketRows<B extends { start: number }, R>(buckets: readonly B[], toRow: (bucket: B) => R): R[] {
    const previous = React.useRef(new Map<number, { bucket: B; row: R }>());
    return React.useMemo(() => {
        const rows = new Map<number, { bucket: B; row: R }>();
        for (const bucket of buckets) {
            const known = previous.current.get(bucket.start);
            rows.set(bucket.start, known != null && sameBucket(known.bucket, bucket) ? known : { bucket, row: toRow(bucket) });
        }
        previous.current = rows;
        return [...rows.values()].map(entry => entry.row);
    }, [buckets]);
}

/// The queries of a bucket as a row of the query charts, with the formatted values of the tooltips
function queryBucketRow(bucket: QueryBucket, window: MetricsWindow) {
    return {
        t0: bucket.start,
        t1: bucket.end,
        clock: bucketClock(bucket),
        count: bucket.count,
        failed: bucket.failed,
        elapsedP95: bucket.elapsedP95,
        elapsedP95Text: optionalValue(bucket.elapsedP95, formatDuration),
        p95Window: `the last ${window.p95WindowMs / 60_000} min`,
        processedRows: bucket.processedRows,
        processedRowsText: formatCount(bucket.processedRows),
        meanCpuTime: bucket.meanCpuTime,
        meanCpuTimeText: formatDuration(bucket.meanCpuTime),
        meanWaitTime: bucket.meanWaitTime,
        meanWaitTimeText: formatDuration(bucket.meanWaitTime),
        peakMemoryMb: bucket.peakMemoryMb,
        peakMemoryText: optionalValue(bucket.peakMemoryMb, formatMemory),
    };
}

/// The fields of the query-end events that the query metrics read, see hyperLogQueryEndsTable
const QUERY_SOURCES = {
    queries: 'query-end: one per finished query',
    latency: 'query-end: elapsed',
    rows: 'query-end: processed-rows.total of pre-execution + execution',
    cpuTime: 'query-end: threads.cpu-time of pre-execution + execution',
    peakMemory: 'query-end: peak-transaction-memory-mb, the larger of pre-execution and execution',
    waitTime: 'query-end: threads.wait-time of pre-execution + execution',
};

/// A metric of the engine that Hyper samples, with a card of its own
interface EngineMetric {
    /// The name of the metric, also the series of its rows
    title: string;
    /// The test id of the card
    testId: string;
    /// The field of the resource-metrics events that the metric reads
    source: string;
    /// The value of a sample, null if the sample did not record it
    value: (sample: HyperResourceSample) => number | null;
    /// How a bucket of the chart combines the values of its samples
    aggregate: SampleAggregate;
    /// Format a value
    format: (value: number) => string;
    /// The spec of the chart
    spec: (colors: ChartColors) => TopLevelSpec;
}

function engineMetric(
    title: string,
    testId: string,
    source: string,
    kind: SeriesKind,
    value: (sample: HyperResourceSample) => number | null,
    aggregate: SampleAggregate,
    format: (value: number) => string,
): EngineMetric {
    const series: ChartSeries[] = [{ name: title, color: colors => colors.primary, area: true }];
    return { title, testId, source: `resource-metrics: ${source}`, value, aggregate, format, spec: colors => seriesSpec(colors, series, kind) };
}

/// The memory peaks of a bucket and its mean load
const ENGINE_METRICS: EngineMetric[] = [
    engineMetric('Process memory', 'metric-process-memory', 'memory.process_physical_memory_mb', 'memory', sample => sample.processMemoryMb, 'max', formatMemory),
    engineMetric('Tracked memory', 'metric-tracked-memory', 'mem-trackers.memory_tracked_current_usage_mb.global', 'memory', sample => sample.trackedMemoryMb, 'max', formatMemory),
    engineMetric('Query memory', 'metric-query-memory', 'mem-trackers.memory_tracked_current_usage_mb.global_transactions', 'memory', sample => sample.transactionMemoryMb, 'max', formatMemory),
    engineMetric('Load', 'metric-load', 'load.overall_load', 'load', sample => sample.overallLoad, 'mean', formatLoad),
];

interface EngineMetricCardProps {
    /// The metric
    metric: EngineMetric;
    /// The resource samples of the window, ordered by time
    samples: readonly HyperResourceSample[];
    /// The newest sample of the window
    latest: HyperResourceSample | null;
    /// The duration of a bucket of the chart
    bucketMs: number;
    /// The bounds of the window
    signals: VegaSignals;
}

/// The card of a metric of the engine, its chart draws a point per bucket at the middle of the bucket
const EngineMetricCard: React.FC<EngineMetricCardProps> = ({ metric, samples, latest, bucketMs, signals }) => {
    const buckets = React.useMemo(
        () => bucketSamples(samples, bucketMs, metric.value, metric.aggregate),
        [samples, bucketMs, metric],
    );
    const rows = useBucketRows(buckets, bucket => ({ t: (bucket.start + bucket.end) / 2, series: metric.title, value: bucket.value }));
    const datasets = React.useMemo(() => ({ [ROWS_DATASET]: rows }), [rows]);
    return (
        <MetricCard
            title={metric.title}
            source={metric.source}
            value={optionalValue(latest == null ? null : metric.value(latest), metric.format)}
            data-testid={metric.testId}
        >
            <VegaLiteChart className={styles.chart} spec={metric.spec} datasets={datasets} signals={signals} />
        </MetricCard>
    );
};

/// The current time, advanced once per period
function useNow(periodMs: number): number {
    const [now, setNow] = React.useState(() => Date.now());
    React.useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), periodMs);
        return () => clearInterval(timer);
    }, [periodMs]);
    return now;
}


/// The aggregate of the summary of a card, shown in front of it
interface CardAggregate {
    /// The symbol of the aggregate
    symbol: string;
    /// The name of the aggregate, e.g. for screen readers
    label: string;
    /// The class that sizes the symbol so that all aggregates weigh the same
    sizeClass?: string;
}

const MEAN: CardAggregate = { symbol: '⌀', label: 'mean' };
const P95: CardAggregate = { symbol: 'p95', label: '95th percentile', sizeClass: styles.card_aggregate_word };
const MAX: CardAggregate = { symbol: 'max', label: 'maximum', sizeClass: styles.card_aggregate_word };
const TOTAL: CardAggregate = { symbol: 'Σ', label: 'total', sizeClass: styles.card_aggregate_capital };

interface MetricCardProps {
    /// The name of the metric
    title: string;
    /// The Hyper log field that the metric reads, shown on hover of the name
    source: string;
    /// The summary of the metric in the window, e.g. its total
    value: string;
    /// The aggregate of the summary, e.g. MEAN
    aggregate?: CardAggregate;
    /// The test id of the card
    'data-testid': string;
    /// The chart
    children: React.ReactElement;
}

/// A metric with its summary in the window next to its name and a small plot of it
const MetricCard: React.FC<MetricCardProps> = props => (
    <section className={styles.card} aria-label={props.title} data-testid={props['data-testid']}>
        <header className={styles.card_header}>
            <Tooltip type="description" direction="n" text={props.source}>
                <h4 className={styles.card_title} data-testid="metric-source">{props.title}</h4>
            </Tooltip>
            <span className={styles.card_value}>
                {props.aggregate != null && <span className={props.aggregate.sizeClass != null ? `${styles.card_aggregate} ${props.aggregate.sizeClass}` : styles.card_aggregate} aria-label={props.aggregate.label}>{props.aggregate.symbol}</span>}
                <span data-testid="metric-value">{props.value}</span>
            </span>
        </header>
        {props.children}
    </section>
);

/// The views of the queries of the activity
enum ActivityView {
    /// The queries, newest first
    Recent = 'recent',
    /// The queries grouped by their shape, most elapsed time first
    Top = 'top',
}

const ACTIVITY_VIEWS: readonly { view: ActivityView; label: string }[] = [
    { view: ActivityView.Recent, label: 'Recent' },
    { view: ActivityView.Top, label: 'Top' },
];

/// The queries, the previous array while the queries are the same
function useStableQueries(queries: readonly HyperQueryEnd[]): readonly HyperQueryEnd[] {
    const previous = React.useRef(queries);
    const prev = previous.current;
    if (prev !== queries && (prev.length !== queries.length || prev.some((query, i) => query !== queries[i]))) {
        previous.current = queries;
    }
    return previous.current;
}

/// The kinds of the queries that the overview and the log monitor run themselves, every poll adds some
const OWN_QUERY_TYPES = new Set(['overview', 'monitor']);
/// The interval in which the table of the queries follows the own queries of the overview
const OWN_QUERIES_REFRESH_MS = 15_000;

/// A key that changes when the table of the queries is outdated: with the other queries, and every
/// OWN_QUERIES_REFRESH_MS with the own queries of the overview. The table then does not refresh for its own reads.
function refreshKey(queries: readonly HyperQueryEnd[]): string {
    let others = 0;
    let newestOther = 0;
    let newestOwn = 0;
    for (const query of queries) {
        if (OWN_QUERY_TYPES.has(query.queryType ?? '')) {
            newestOwn = Math.max(newestOwn, query.endedAt);
        } else {
            ++others;
            newestOther = Math.max(newestOther, query.endedAt);
        }
    }
    return `${others}:${newestOther}:${Math.floor(newestOwn / OWN_QUERIES_REFRESH_MS)}`;
}

interface QueryActivityProps {
    /// The finished queries of the window and the scope
    queries: readonly HyperQueryEnd[];
    /// The finished queries of the connection in the extract of the Hyper log, see queryEndsQuery()
    queryEnds: string | null;
    /// Run a query over the extract
    runQuery: (sql: string) => Promise<arrow.Table>;
    /// The scope of the queries
    scope: QueryScope;
    /// The start of the window in milliseconds since the epoch
    windowStart: number;
    /// The client context of the queries of the table, e.g. to attribute them to the connection
    clientContext: EmbeddedClientContext | null;
    /// Read the events of the Hyper log that were logged since the last poll, before the table is queried again
    refresh?: () => Promise<void>;
    /// The table of the queries
    QueryTable: React.FC<QueryTableProps>;
}

/// The finished queries of the window, grouped by their shape or newest first
const QueryActivity: React.FC<QueryActivityProps> = props => {
    const [view, setView] = React.useState(ActivityView.Recent);
    const [refreshes, setRefreshes] = React.useState(0);
    const [refreshing, setRefreshing] = React.useState(false);
    const logger = useLogger();
    const { refresh } = props;
    // Query the table again even when the poll fails, e.g. for the events of the previous polls
    const onRefresh = React.useCallback(async () => {
        setRefreshing(true);
        try {
            await refresh?.();
        } catch (e) {
            logger.warn('Failed to refresh the queries of the connection overview', { error: stringifyError(e) }, 'connection_overview');
        }
        setRefreshes(n => n + 1);
        setRefreshing(false);
    }, [refresh, logger]);
    const queries = useStableQueries(props.queries);
    // The window slides every second, but the query of the table only changes when it is outdated.
    // Until then, the earlier start selects the same queries.
    const key = React.useMemo(() => refreshKey(queries), [queries]);
    const sql = React.useMemo(() => {
        if (props.queryEnds == null) return null;
        const query = view === ActivityView.Top ? queryShapesSql : recentQueriesSql;
        return query(props.queryEnds, props.scope, props.windowStart);
    }, [key, view, props.queryEnds, props.scope]);
    return (
        <section className={styles.panel} aria-label="Queries" data-testid="recent-queries">
            <header className={styles.panel_header}>
                <h3 className={styles.panel_title}>Queries</h3>
                <SegmentedControl
                    aria-label="View"
                    data-testid="recent-queries-view"
                    size={SegmentedControlSize.XSmall}
                    onChange={index => setView(ACTIVITY_VIEWS[index].view)}
                >
                    {ACTIVITY_VIEWS.map(v => (
                        <SegmentedControl.Button key={v.view} selected={v.view === view} data-view={v.view}>{v.label}</SegmentedControl.Button>
                    ))}
                </SegmentedControl>
                <IconButton
                    variant={ButtonVariant.Invisible}
                    size={ButtonSize.Small}
                    onClick={() => void onRefresh()}
                    disabled={refreshing}
                    aria-label="Refresh"
                    data-testid="recent-queries-refresh"
                >
                    <SyncIcon size={14} />
                </IconButton>
            </header>
            {queries.length === 0
                ? <p className={styles.panel_empty} data-testid="connection-metrics-empty">No finished queries in this window</p>
                : <div className={styles.panel_table}>{sql != null && <props.QueryTable sql={sql} clientContext={props.clientContext} runQuery={props.runQuery} refreshes={refreshes} />}</div>}
        </section>
    );
};

/// The reason why the Hyper log of a connection cannot be read, in place of its queries
const LogUnavailablePanel: React.FC<{ error: HyperLogError }> = ({ error }) => (
    <section className={styles.panel} aria-label="Queries" data-testid="connection-metrics-log-unavailable">
        <header className={styles.panel_header}>
            <h3 className={styles.panel_title}>Queries</h3>
        </header>
        <div className={styles.panel_notice}>
            <p>
                {error.unreadable
                    ? <>This Hyper does not allow reading its log. The metrics need <code>hyper_log()</code>, which Hyper enables with <code>experimental_hyper_introspection_functions</code>.</>
                    : 'Reading the Hyper log failed. The metrics resume when the connection is set up again.'}
            </p>
            <p className={styles.panel_notice_detail} data-testid="connection-metrics-log-error">{error.message}</p>
        </div>
    </section>
);

/// The components of the view, replaced in tests
export interface ConnectionMetricsViewDependencies {
    /// The table of the queries
    QueryTable: React.FC<QueryTableProps>;
}

const DEFAULT_DEPENDENCIES: ConnectionMetricsViewDependencies = { QueryTable };

interface Props {
    /// The id of the connection
    connectionId: string;
    /// The facts about the Hyper of the connection, shown in the header of the engine
    engine?: React.ReactNode;
}

/// The activity and the metrics of a Hyper connection and of its Hyper, from the extract of the Hyper log
export const ConnectionMetricsDashboard: React.FC<Props> = (props: Props) => {
    const logMetrics = useHyperLogMetrics();
    const { queries, samples } = useHyperLogRows(props.connectionId);
    const logState = useHyperLogState(props.connectionId);
    const { queryEnds: queryEndsTable, clockOffsetMs } = logState;
    const queryEnds = React.useMemo(
        () => queryEndsTable == null || clockOffsetMs == null ? null : queryEndsQuery(queryEndsTable, clockOffsetMs),
        [queryEndsTable, clockOffsetMs],
    );
    const clientContext = React.useMemo(() => overviewClientContext(props.connectionId), [props.connectionId]);
    const runQuery = React.useCallback(async (sql: string) => {
        if (logMetrics == null) throw new Error('the Hyper log is not monitored');
        return await logMetrics.query(props.connectionId, sql);
    }, [logMetrics, props.connectionId]);
    const refresh = React.useCallback(async () => {
        await logMetrics?.poll(props.connectionId);
    }, [logMetrics, props.connectionId]);
    return (
        <ConnectionMetricsView
            queries={queries}
            queryEnds={queryEnds}
            runQuery={runQuery}
            refresh={refresh}
            clientContext={clientContext}
            samples={samples}
            logError={logState.error}
            resourceUsageLogged={logState.resourceUsageLogged}
            engine={props.engine}
        />
    );
};

interface ViewProps {
    /// The finished queries, ordered by their end
    queries: readonly HyperQueryEnd[];
    /// The finished queries in the extract of the Hyper log, see queryEndsQuery(), null without the extract
    queryEnds: string | null;
    /// Run a query over the extract
    runQuery: (sql: string) => Promise<arrow.Table>;
    /// Read the events of the Hyper log that were logged since the last poll
    refresh?: () => Promise<void>;
    /// The client context of the queries of the view, e.g. to attribute them to the connection
    clientContext?: EmbeddedClientContext | null;
    /// The resource samples of the Hyper process, ordered by time
    samples: readonly HyperResourceSample[];
    /// Why the Hyper log cannot be read, the view then only shows the error
    logError?: HyperLogError | null;
    /// Does the Hyper log its resource usage? Null while unknown, see HyperLogState.resourceUsageLogged
    resourceUsageLogged?: boolean | null;
    /// The facts about the Hyper of the connection, shown in the header of the engine
    engine?: React.ReactNode;
    /// The current time, the clock when not set
    now?: number;
    /// The components of the view
    dependencies?: ConnectionMetricsViewDependencies;
}

/// The query metrics of a connection and the resource metrics of the engine in a sliding time window
export const ConnectionMetricsView: React.FC<ViewProps> = ({ queries, queryEnds, runQuery, refresh, clientContext = null, samples, logError = null, resourceUsageLogged = null, engine, now, dependencies = DEFAULT_DEPENDENCIES }) => {
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
    // The p95 windows of the scope, they keep their p95 while their queries are unchanged
    const p95Cache = React.useMemo(() => new Map<string, number | null>(), [scope]);
    const buckets = React.useMemo(
        () => bucketQueries(metrics.queries, window, scopedQueries, p95Cache),
        [metrics.queries, window, scopedQueries, p95Cache],
    );
    const bucketRows = useBucketRows(buckets, bucket => queryBucketRow(bucket, window));

    const signals = React.useMemo(
        () => ({ [WINDOW_START_SIGNAL]: metrics.start, [WINDOW_END_SIGNAL]: metrics.end }),
        [metrics.start, metrics.end],
    );
    // The query charts draw the same buckets
    const datasets = React.useMemo(() => ({ [ROWS_DATASET]: bucketRows }), [bucketRows]);

    // Without the log, there are no metrics to draw
    if (logError != null) {
        return (
            <div className={styles.overview} data-testid="connection-metrics">
                <LogUnavailablePanel error={logError} />
            </div>
        );
    }
    return (
        <div className={styles.overview} data-testid="connection-metrics">
            <section className={styles.section} aria-label="Activity" data-testid="connection-metrics-queries">
                <header className={styles.section_header}>
                    <h3 className={styles.section_label}>Activity</h3>
                    <span className={styles.section_spacer} />
                    <SegmentedControl
                        aria-label="Scope"
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
                </header>
                <div className={`${styles.grid} ${styles.query_cards}`}>
                    <MetricCard title="Queries" source={QUERY_SOURCES.queries} aggregate={TOTAL} value={formatCount(metrics.queries.length)} data-testid="metric-queries">
                        <VegaLiteChart className={styles.chart} spec={COUNT_SPEC} datasets={datasets} signals={signals} />
                    </MetricCard>
                    <MetricCard
                        title="Latency"
                        source={QUERY_SOURCES.latency}
                        aggregate={P95}
                        value={optionalValue(metrics.elapsedP95, formatDuration)}
                        data-testid="metric-latency"
                    >
                        <VegaLiteChart className={styles.chart} spec={LATENCY_SPEC} datasets={datasets} signals={signals} />
                    </MetricCard>
                    <MetricCard title="Rows processed" source={QUERY_SOURCES.rows} aggregate={TOTAL} value={formatCount(metrics.processedRows)} data-testid="metric-rows">
                        <VegaLiteChart className={styles.chart} spec={ROWS_SPEC} datasets={datasets} signals={signals} />
                    </MetricCard>
                    <MetricCard title="CPU time" source={QUERY_SOURCES.cpuTime} aggregate={MEAN} value={optionalValue(metrics.meanCpuTime, formatDuration)} data-testid="metric-cpu-time">
                        <VegaLiteChart className={styles.chart} spec={CPU_TIME_SPEC} datasets={datasets} signals={signals} />
                    </MetricCard>
                    <MetricCard title="Peak memory" source={QUERY_SOURCES.peakMemory} aggregate={MAX} value={optionalValue(metrics.peakMemoryMb, formatMemory)} data-testid="metric-peak-memory">
                        <VegaLiteChart className={styles.chart} spec={PEAK_MEMORY_SPEC} datasets={datasets} signals={signals} />
                    </MetricCard>
                    <MetricCard title="Wait time" source={QUERY_SOURCES.waitTime} aggregate={MEAN} value={optionalValue(metrics.meanWaitTime, formatDuration)} data-testid="metric-wait-time">
                        <VegaLiteChart className={styles.chart} spec={WAIT_TIME_SPEC} datasets={datasets} signals={signals} />
                    </MetricCard>
                </div>
                <QueryActivity
                    queries={metrics.queries}
                    queryEnds={queryEnds}
                    runQuery={runQuery}
                    scope={scope}
                    windowStart={metrics.start}
                    clientContext={clientContext}
                    refresh={refresh}
                    QueryTable={dependencies.QueryTable}
                />
            </section>
            <section className={styles.section} aria-label="Engine" data-testid="connection-metrics-engine">
                <header className={styles.section_header}>
                    <h3 className={styles.section_label}>Engine</h3>
                    {engine != null && <span className={styles.section_detail}>{engine}</span>}
                </header>
                {resourceUsageLogged === false && samples.length === 0
                    ? (
                        <p className={styles.section_empty} data-testid="connection-metrics-no-resource-usage">
                            This Hyper does not log its resource usage. Hyper logs it every <code>log_resource_usage_interval</code>.
                        </p>
                    )
                    : (
                        <div className={`${styles.grid} ${styles.engine_cards}`}>
                            {ENGINE_METRICS.map(metric => (
                                <EngineMetricCard
                                    key={metric.testId}
                                    metric={metric}
                                    samples={resources.samples}
                                    latest={latest}
                                    bucketMs={window.bucketMs}
                                    signals={signals}
                                />
                            ))}
                        </div>
                    )}
            </section>
        </div>
    );
};
