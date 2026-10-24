import type { HyperQueryEnd, HyperResourceSample } from '../hyper/hyper_log_metrics.js';

/// A time window of the connection metrics, ending now.
export interface MetricsWindow {
    /// The key of the window
    key: string;
    /// The duration of the window in milliseconds
    durationMs: number;
}

/// The time windows that the metrics can show
export const METRICS_WINDOWS: readonly MetricsWindow[] = [
    { key: '5m', durationMs: 5 * 60_000 },
    { key: '15m', durationMs: 15 * 60_000 },
    { key: '1h', durationMs: 60 * 60_000 },
];

/// A time range in milliseconds since the epoch.
export interface TimeRange {
    /// The start of the range
    start: number;
    /// The end of the range, exclusive
    end: number;
}

/// The queries that the metrics show
export enum QueryScope {
    /// The queries of the user, e.g. of scripts
    User = 'user',
    /// The queries that the app runs, e.g. the SQLFrame queries of computations
    System = 'system',
    /// All queries
    All = 'all',
}

/// The query scopes in the order of the picker
export const QUERY_SCOPES: readonly QueryScope[] = [QueryScope.User, QueryScope.System, QueryScope.All];

/// The queries of a scope, keeps the array of all queries
export function queriesInScope(queries: readonly HyperQueryEnd[], scope: QueryScope): readonly HyperQueryEnd[] {
    switch (scope) {
        case QueryScope.User: return queries.filter(query => !query.system);
        case QueryScope.System: return queries.filter(query => query.system);
        case QueryScope.All: return queries;
    }
}

/// The metrics of the queries that ended in a window.
export interface QueryMetrics extends TimeRange {
    /// The queries that ended in the window, ordered by their end
    queries: HyperQueryEnd[];
    /// The queries that succeeded
    succeeded: number;
    /// The queries that failed
    failed: number;
    /// The thread time of the queries in seconds
    threadTime: number;
    /// The rows that the queries processed
    processedRows: number;
    /// The CPU time of the queries in seconds
    cpuTime: number;
    /// The time that the queries waited in seconds
    waitTime: number;
    /// The highest peak memory of the queries in MB, null without a recorded peak
    peakMemoryMb: number | null;
    /// The 95th percentile of the elapsed times in seconds, null without queries
    elapsedP95: number | null;
}

/// The resource samples of the Hyper process in a window.
export interface ResourceMetrics extends TimeRange {
    /// The samples in the window, ordered by time
    samples: HyperResourceSample[];
    /// The newest sample in the window
    latest: HyperResourceSample | null;
}

/// The nearest-rank percentile of values, null for no values
export function percentile(values: number[], p: number): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((l, r) => l - r);
    return sorted[Math.max(Math.ceil(p * sorted.length) - 1, 0)];
}

function maxOrNull(values: (number | null)[]): number | null {
    let max: number | null = null;
    for (const value of values) {
        if (value != null && (max == null || value > max)) max = value;
    }
    return max;
}

/// The window that ends now
export function windowRange(window: MetricsWindow, now: number): TimeRange {
    return { start: now - window.durationMs, end: now };
}

/// The items in a time range, the items are ordered by time
function inRange<T>(items: readonly T[], time: (item: T) => number, range: TimeRange): T[] {
    const first = items.findIndex(item => time(item) >= range.start);
    if (first < 0) return [];
    const result: T[] = [];
    for (let i = first; i < items.length && time(items[i]) < range.end; ++i) result.push(items[i]);
    return result;
}

/// The metrics of the queries that ended in the window before now
export function computeQueryMetrics(queries: readonly HyperQueryEnd[], window: MetricsWindow, now: number): QueryMetrics {
    const range = windowRange(window, now);
    const inWindow = inRange(queries, query => query.endedAt, range);
    let succeeded = 0;
    let threadTime = 0;
    let processedRows = 0;
    let cpuTime = 0;
    let waitTime = 0;
    for (const query of inWindow) {
        if (query.succeeded) ++succeeded;
        threadTime += query.threadTime;
        processedRows += query.processedRows;
        cpuTime += query.cpuTime;
        waitTime += query.waitTime;
    }
    return {
        ...range,
        queries: inWindow,
        succeeded,
        failed: inWindow.length - succeeded,
        threadTime,
        processedRows,
        cpuTime,
        waitTime,
        peakMemoryMb: maxOrNull(inWindow.map(query => query.peakMemoryMb)),
        elapsedP95: percentile(inWindow.flatMap(query => query.elapsed == null ? [] : [query.elapsed]), 0.95),
    };
}

/// The resource samples of the window before now
export function computeResourceMetrics(samples: readonly HyperResourceSample[], window: MetricsWindow, now: number): ResourceMetrics {
    const range = windowRange(window, now);
    const inWindow = inRange(samples, sample => sample.sampledAt, range);
    return { ...range, samples: inWindow, latest: inWindow.length > 0 ? inWindow[inWindow.length - 1] : null };
}

/// The finished queries of one shape, e.g. the runs of a query with different literals
export interface QueryGroup {
    /// The shape of the queries, or the query text when Hyper logged no hash
    shape: string;
    /// The text of the newest query
    query: string | null;
    /// The runs
    count: number;
    /// The runs that failed
    failed: number;
    /// The elapsed time of all runs in seconds
    totalElapsed: number;
    /// The mean elapsed time of a run in seconds
    meanElapsed: number;
    /// The CPU time of all runs in seconds
    cpuTime: number;
    /// The rows that all runs processed
    processedRows: number;
    /// The highest peak memory of a run in MB
    peakMemoryMb: number | null;
}

/// Group the queries by their shape, the groups with the most elapsed time first
export function groupQueries(queries: readonly HyperQueryEnd[]): QueryGroup[] {
    const groups = new Map<string, QueryGroup>();
    for (const query of queries) {
        const shape = query.queryShape ?? `text:${query.query ?? ''}`;
        let group = groups.get(shape);
        if (group == null) {
            group = { shape, query: null, count: 0, failed: 0, totalElapsed: 0, meanElapsed: 0, cpuTime: 0, processedRows: 0, peakMemoryMb: null };
            groups.set(shape, group);
        }
        // The queries are ordered by their end, the last one is the newest
        group.query = query.query ?? group.query;
        group.count += 1;
        group.failed += query.succeeded ? 0 : 1;
        group.totalElapsed += query.elapsed ?? 0;
        group.cpuTime += query.cpuTime;
        group.processedRows += query.processedRows;
        group.peakMemoryMb = maxOrNull([group.peakMemoryMb, query.peakMemoryMb]);
    }
    for (const group of groups.values()) group.meanElapsed = group.totalElapsed / group.count;
    return [...groups.values()].sort((l, r) => r.totalElapsed - l.totalElapsed);
}

/// Format a duration in seconds, e.g. 850 µs, 12.3 ms, 1.24 s, 2m 03s
export function formatDuration(seconds: number): string {
    if (seconds === 0) return '0 s';
    if (seconds < 1e-3) return `${Math.round(seconds * 1e6)} µs`;
    if (seconds < 1) return `${Number((seconds * 1e3).toPrecision(3))} ms`;
    if (seconds < 60) return `${Number(seconds.toPrecision(3))} s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${Math.round(seconds - minutes * 60).toString().padStart(2, '0')}s`;
}

/// Format a memory size in MB, e.g. 0.25 MB, 512 MB, 1.5 GB
export function formatMemory(mb: number): string {
    if (mb >= 1024) return `${Number((mb / 1024).toPrecision(3))} GB`;
    return `${Number(mb.toPrecision(3))} MB`;
}

/// Format a count compactly, e.g. 12, 1.3K, 2.1M
export function formatCount(count: number): string {
    if (count < 1000) return Math.round(count).toString();
    if (count < 1e6) return `${Number((count / 1e3).toPrecision(2))}K`;
    return `${Number((count / 1e6).toPrecision(2))}M`;
}

/// Format a load between 0 and 1 as a percentage, e.g. 42%
export function formatLoad(load: number): string {
    return `${Math.round(load * 100)}%`;
}

/// Format the time of day, e.g. 14:03:20
export function formatClock(epochMs: number): string {
    return new Date(epochMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}
