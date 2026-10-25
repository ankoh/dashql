import type { HyperQueryEnd, HyperResourceSample } from '../hyper/hyper_log_metrics.js';

/// A time window of the connection metrics, ending now.
export interface MetricsWindow {
    /// The key of the window
    key: string;
    /// The duration of the window in milliseconds
    durationMs: number;
    /// The duration of a bucket of the charts in milliseconds, 60 buckets per window.
    /// A chart draws a bucket and not every query or sample, its marks do not grow with the queries.
    bucketMs: number;
    /// The time before the end of a bucket whose queries its p95 latency covers, 12 buckets.
    /// A bucket alone holds too few queries for a p95, its p95 would mostly be its slowest query.
    p95WindowMs: number;
}

/// The time windows that the metrics can show
export const METRICS_WINDOWS: readonly MetricsWindow[] = [
    { key: '5m', durationMs: 5 * 60_000, bucketMs: 5_000, p95WindowMs: 60_000 },
    { key: '15m', durationMs: 15 * 60_000, bucketMs: 15_000, p95WindowMs: 3 * 60_000 },
    { key: '1h', durationMs: 60 * 60_000, bucketMs: 60_000, p95WindowMs: 12 * 60_000 },
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
    App = 'app',
    /// All queries
    All = 'all',
}

/// The query scopes in the order of the picker
export const QUERY_SCOPES: readonly QueryScope[] = [QueryScope.User, QueryScope.App, QueryScope.All];

/// The queries of a scope, keeps the array of all queries
export function queriesInScope(queries: readonly HyperQueryEnd[], scope: QueryScope): readonly HyperQueryEnd[] {
    switch (scope) {
        case QueryScope.User: return queries.filter(query => !query.sentByApp);
        case QueryScope.App: return queries.filter(query => query.sentByApp);
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
    /// The mean CPU time of a query in seconds, null without queries
    meanCpuTime: number | null;
    /// The mean time that a query waited in seconds, null without queries
    meanWaitTime: number | null;
    /// The highest peak memory of the queries in MB, null without a recorded peak
    peakMemoryMb: number | null;
    /// The 95th percentile of the elapsed times in seconds, null without a recorded one
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

/// The recorded elapsed times of queries
const elapsedTimes = (queries: readonly HyperQueryEnd[]) => queries.flatMap(query => query.elapsed == null ? [] : [query.elapsed]);

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
        meanCpuTime: inWindow.length === 0 ? null : cpuTime / inWindow.length,
        meanWaitTime: inWindow.length === 0 ? null : waitTime / inWindow.length,
        peakMemoryMb: maxOrNull(inWindow.map(query => query.peakMemoryMb)),
        elapsedP95: percentile(elapsedTimes(inWindow), 0.95),
    };
}

/// The resource samples of the window before now
export function computeResourceMetrics(samples: readonly HyperResourceSample[], window: MetricsWindow, now: number): ResourceMetrics {
    const range = windowRange(window, now);
    const inWindow = inRange(samples, sample => sample.sampledAt, range);
    return { ...range, samples: inWindow, latest: inWindow.length > 0 ? inWindow[inWindow.length - 1] : null };
}

/// The queries that ended in a bucket of time
export interface QueryBucket {
    /// The start of the bucket in milliseconds since the epoch
    start: number;
    /// The end of the bucket, exclusive
    end: number;
    /// The queries that ended in the bucket
    count: number;
    /// The queries that failed
    failed: number;
    /// The 95th percentile of the elapsed times of the queries that ended in the p95 window before the end of the
    /// bucket, see MetricsWindow, null without a recorded one
    elapsedP95: number | null;
    /// The rows that the queries processed
    processedRows: number;
    /// The mean CPU time of a query in seconds
    meanCpuTime: number;
    /// The mean time that a query waited in seconds
    meanWaitTime: number;
    /// The highest peak memory in MB, null without a recorded one
    peakMemoryMb: number | null;
}

/// Iterate the buckets of items that are ordered by time, aligned to multiples of their duration
function forEachBucket<T>(items: readonly T[], time: (item: T) => number, bucketMs: number, visit: (start: number, items: T[]) => void): void {
    let start: number | null = null;
    let bucket: T[] = [];
    for (const item of items) {
        const itemStart = Math.floor(time(item) / bucketMs) * bucketMs;
        if (itemStart !== start) {
            if (start != null) visit(start, bucket);
            start = itemStart;
            bucket = [];
        }
        bucket.push(item);
    }
    if (start != null) visit(start, bucket);
}

/// Aggregate the queries of a window per bucket, the buckets are aligned to multiples of their duration and empty ones
/// are left out. The p95 of a bucket covers the queries of the history in the p95 window before its end, also those
/// before the window. The queries and the history, e.g. all queries of a scope, are ordered by their end.
/// The cache keeps the p95 of the p95 windows of the last call: the history only grows at its end, a later call only
/// computes the p95 of the windows whose queries changed, e.g. of the newest bucket.
export function bucketQueries(
    queries: readonly HyperQueryEnd[],
    window: MetricsWindow,
    history: readonly HyperQueryEnd[],
    cache: Map<string, number | null> = new Map(),
): QueryBucket[] {
    const used = new Map<string, number | null>();
    /// The p95 of history[from, to), identified by its bounds, its first and last query and its size
    const p95 = (end: number, from: number, to: number) => {
        const key = from === to ? `${end}` : `${end}:${history[from].endedAt}:${history[to - 1].endedAt}:${to - from}`;
        const value = cache.has(key) ? cache.get(key)! : percentile(elapsedTimes(history.slice(from, to)), 0.95);
        used.set(key, value);
        return value;
    };
    const { bucketMs, p95WindowMs } = window;
    const buckets: QueryBucket[] = [];
    // The queries in the p95 window of the current bucket are history[from, to)
    let from = 0;
    let to = 0;
    forEachBucket(queries, query => query.endedAt, bucketMs, (start, inBucket) => {
        const end = start + bucketMs;
        while (from < history.length && history[from].endedAt < end - p95WindowMs) ++from;
        to = Math.max(to, from);
        while (to < history.length && history[to].endedAt < end) ++to;
        const bucket: QueryBucket = {
            start,
            end,
            count: inBucket.length,
            failed: 0,
            elapsedP95: p95(end, from, to),
            processedRows: 0,
            meanCpuTime: 0,
            meanWaitTime: 0,
            peakMemoryMb: maxOrNull(inBucket.map(query => query.peakMemoryMb)),
        };
        for (const query of inBucket) {
            bucket.failed += query.succeeded ? 0 : 1;
            bucket.processedRows += query.processedRows;
            bucket.meanCpuTime += query.cpuTime / inBucket.length;
            bucket.meanWaitTime += query.waitTime / inBucket.length;
        }
        buckets.push(bucket);
    });
    cache.clear();
    for (const [key, value] of used) cache.set(key, value);
    return buckets;
}

/// A value of the resource samples in a bucket of time
export interface SampleBucket {
    /// The start of the bucket in milliseconds since the epoch
    start: number;
    /// The end of the bucket, exclusive
    end: number;
    /// The value of the bucket
    value: number;
}

/// How a bucket combines the values of its samples
export type SampleAggregate = 'max' | 'mean';

/// Aggregate a value of the resource samples per bucket, the buckets without a recorded value are left out.
/// The samples are ordered by time.
export function bucketSamples(
    samples: readonly HyperResourceSample[],
    bucketMs: number,
    value: (sample: HyperResourceSample) => number | null,
    aggregate: SampleAggregate,
): SampleBucket[] {
    const buckets: SampleBucket[] = [];
    forEachBucket(samples, sample => sample.sampledAt, bucketMs, (start, inBucket) => {
        const values = inBucket.flatMap(sample => {
            const v = value(sample);
            return v == null ? [] : [v];
        });
        if (values.length === 0) return;
        const combined = aggregate === 'max'
            ? Math.max(...values)
            : values.reduce((sum, v) => sum + v, 0) / values.length;
        buckets.push({ start, end: start + bucketMs, value: combined });
    });
    return buckets;
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
