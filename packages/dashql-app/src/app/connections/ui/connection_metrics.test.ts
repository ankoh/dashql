import type { HyperQueryEnd, HyperResourceSample } from '../hyper/hyper_log_metrics.js';
import {
    computeQueryMetrics,
    computeResourceMetrics,
    bucketQueries,
    bucketSamples,
    percentile,
    formatDuration,
    formatLoad,
    formatMemory,
    queriesInScope,
    QueryScope,
    type MetricsWindow,
} from './connection_metrics.js';

const WINDOW: MetricsWindow = { key: 'test', durationMs: 60_000, bucketMs: 10_000, p95WindowMs: 20_000 };

function query(endedAt: number, overrides: Partial<HyperQueryEnd> = {}): HyperQueryEnd {
    return {
        sessionId: 's',
        endedAt,
        succeeded: true,
        errorCode: null,
        errorMessage: null,
        statement: 'SELECT',
        query: 'select 1',
        elapsed: 0.01,
        threadTime: 0.02,
        cpuTime: 0.02,
        waitTime: 0,
        timeToSchedule: 0,
        peakMemoryMb: 0.25,
        rows: 1,
        processedRows: 0,
        queryType: 'user',
        sentByApp: false,
        ...overrides,
    };
}

describe('connection metrics', () => {
    it('ends the window now', () => {
        const metrics = computeQueryMetrics([], WINDOW, 1_000_005_000);
        expect(metrics).toMatchObject({ start: 1_000_005_000 - 60_000, end: 1_000_005_000, queries: [] });
        expect(metrics.elapsedP95).toBeNull();
        expect(metrics.peakMemoryMb).toBeNull();
        expect(metrics.meanCpuTime).toBeNull();
    });

    it('summarizes the queries that ended in the window', () => {
        const now = 1_000_005_000;
        const metrics = computeQueryMetrics([
            query(now - 120_000),
            query(now - 30_000, { elapsed: 2 }),
            query(now - 2_000, { succeeded: false, errorCode: '22012', threadTime: 0.25, peakMemoryMb: null }),
            query(now - 1_000, { threadTime: 0.5, peakMemoryMb: 4 }),
            query(now + 60_000),
        ], WINDOW, now);
        expect(metrics.queries.map(q => q.endedAt)).toEqual([now - 30_000, now - 2_000, now - 1_000]);
        expect(metrics.succeeded).toBe(2);
        expect(metrics.failed).toBe(1);
        expect(metrics.threadTime).toBeCloseTo(0.77);
        expect(metrics.peakMemoryMb).toBe(4);
        expect(metrics.elapsedP95).toBe(2);
        expect(metrics.meanCpuTime).toBeCloseTo(0.02);
    });

    it('selects the queries of a scope', () => {
        const queries = [query(1), query(2, { sentByApp: true }), query(3)];
        expect(queriesInScope(queries, QueryScope.User).map(q => q.endedAt)).toEqual([1, 3]);
        expect(queriesInScope(queries, QueryScope.App).map(q => q.endedAt)).toEqual([2]);
        expect(queriesInScope(queries, QueryScope.All)).toBe(queries);
    });

    it('selects the resource samples of the window', () => {
        const now = 1_000_005_000;
        const sample = (sampledAt: number, processMemoryMb: number): HyperResourceSample => ({
            sampledAt,
            processMemoryMb,
            transactionMemoryMb: null,
            storageMemoryMb: null,
            overallLoad: 0.5,
            schedulerLoad: 0.5,
            memoryLoad: 0,
        });
        const metrics = computeResourceMetrics([
            sample(now - 120_000, 512),
            sample(now - 2_000, 256),
            sample(now - 1_000, 288),
        ], WINDOW, now);
        expect(metrics.samples.map(s => s.processMemoryMb)).toEqual([256, 288]);
        expect(metrics.latest).toMatchObject({ sampledAt: now - 1_000, processMemoryMb: 288 });
        expect(computeResourceMetrics([], WINDOW, now).latest).toBeNull();
    });

    it('aggregates the queries per bucket', () => {
        const queries = [
            query(1_000_001_000, { elapsed: 0.5, processedRows: 10, peakMemoryMb: null }),
            query(1_000_009_999, { succeeded: false, elapsed: null, processedRows: 5, cpuTime: 0.25 }),
            query(1_000_010_000),
            query(1_000_045_000),
        ];
        const buckets = bucketQueries(queries, WINDOW, queries);
        expect(buckets.map(({ start, end, count, failed }) => ({ start, end, count, failed }))).toEqual([
            { start: 1_000_000_000, end: 1_000_010_000, count: 2, failed: 1 },
            { start: 1_000_010_000, end: 1_000_020_000, count: 1, failed: 0 },
            { start: 1_000_040_000, end: 1_000_050_000, count: 1, failed: 0 },
        ]);
        // The failed query recorded no elapsed time
        expect(buckets[0]).toMatchObject({ elapsedP95: 0.5, processedRows: 15, peakMemoryMb: 0.25 });
        // The CPU times of the queries are 0.02 and 0.25 seconds
        expect(buckets[0].meanCpuTime).toBeCloseTo(0.135);
        expect(bucketQueries([], WINDOW, [])).toEqual([]);
    });

    it('computes the p95 of a bucket over the queries of the p95 window before its end', () => {
        const end = 1_000_060_000;
        // 19 fast queries before the window, and a slow one in the last bucket
        const earlier = Array.from({ length: 19 }, (_, i) => query(end - 19_000 + i * 500, { elapsed: 0.01 }));
        const slow = query(end - 1_000, { elapsed: 1 });
        const history = [query(end - 30_000, { elapsed: 5 }), ...earlier, slow];
        const [bucket] = bucketQueries([slow], WINDOW, history);
        // The bucket alone would make the slow query its p95, the p95 window holds 20 queries.
        // The query before the p95 window of 20s is left out.
        expect(bucket).toMatchObject({ start: end - 10_000, count: 1, elapsedP95: 0.01 });
    });

    it('reuses the p95 of the p95 windows whose queries are unchanged', () => {
        const end = 1_000_060_000;
        const history = Array.from({ length: 40 }, (_, i) => query(end - 40_000 + i * 1_000, { elapsed: (i % 7) / 100 }));
        const cache = new Map<string, number | null>();
        bucketQueries(history, WINDOW, history, cache);
        // A slow query arrives in the newest bucket
        const grown = [...history, query(end - 500, { elapsed: 3 })];
        expect(bucketQueries(grown, WINDOW, grown, cache)).toEqual(bucketQueries(grown, WINDOW, grown));
        expect(cache.size).toBe(4);
    });

    it('computes nearest-rank percentiles', () => {
        expect(percentile([], 0.95)).toBeNull();
        expect(percentile([3], 0.95)).toBe(3);
        expect(percentile(Array.from({ length: 100 }, (_, i) => 100 - i), 0.95)).toBe(95);
        expect(percentile([1, 2], 0.5)).toBe(1);
    });

    it('aggregates the resource samples per bucket', () => {
        const sample = (sampledAt: number, processMemoryMb: number | null): HyperResourceSample => ({
            sampledAt,
            processMemoryMb,
            transactionMemoryMb: null,
            storageMemoryMb: null,
            overallLoad: processMemoryMb == null ? null : processMemoryMb / 1000,
            schedulerLoad: null,
            memoryLoad: null,
        });
        const samples = [sample(1_000_001_000, 100), sample(1_000_002_000, 300), sample(1_000_011_000, null), sample(1_000_021_000, 200)];
        expect(bucketSamples(samples, 10_000, s => s.processMemoryMb, 'max')).toEqual([
            { start: 1_000_000_000, end: 1_000_010_000, value: 300 },
            { start: 1_000_020_000, end: 1_000_030_000, value: 200 },
        ]);
        expect(bucketSamples(samples, 10_000, s => s.overallLoad, 'mean').map(b => b.value)).toEqual([0.2, 0.2]);
    });

    it('formats durations and memory sizes', () => {
        expect(formatDuration(0)).toBe('0 s');
        expect(formatDuration(0.00085)).toBe('850 µs');
        expect(formatDuration(0.01234)).toBe('12.3 ms');
        expect(formatDuration(1.2345)).toBe('1.23 s');
        expect(formatDuration(123)).toBe('2m 03s');
        expect(formatMemory(0.25)).toBe('0.25 MB');
        expect(formatMemory(1536)).toBe('1.5 GB');
        expect(formatLoad(0.426)).toBe('43%');
    });
});
