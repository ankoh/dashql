import type { HyperQueryEnd, HyperResourceSample } from '../hyper/hyper_log_metrics.js';
import {
    computeQueryMetrics,
    computeResourceMetrics,
    formatDuration,
    formatLoad,
    formatMemory,
    groupQueries,
    percentile,
    queriesInScope,
    QueryScope,
    type MetricsWindow,
} from './connection_metrics.js';

const WINDOW: MetricsWindow = { key: 'test', durationMs: 60_000 };

function query(endedAt: number, overrides: Partial<HyperQueryEnd> = {}): HyperQueryEnd {
    return {
        sessionId: 's',
        endedAt,
        succeeded: true,
        errorCode: null,
        errorMessage: null,
        statement: 'SELECT',
        queryShape: 'shape',
        query: 'select 1',
        elapsed: 0.01,
        threadTime: 0.02,
        cpuTime: 0.02,
        waitTime: 0,
        timeToSchedule: 0,
        peakMemoryMb: 0.25,
        rows: 1,
        processedRows: 0,
        system: false,
        ...overrides,
    };
}

describe('connection metrics', () => {
    it('ends the window now', () => {
        const metrics = computeQueryMetrics([], WINDOW, 1_000_005_000);
        expect(metrics).toMatchObject({ start: 1_000_005_000 - 60_000, end: 1_000_005_000, queries: [] });
        expect(metrics.elapsedP95).toBeNull();
        expect(metrics.peakMemoryMb).toBeNull();
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
    });

    it('selects the queries of a scope', () => {
        const queries = [query(1), query(2, { system: true }), query(3)];
        expect(queriesInScope(queries, QueryScope.User).map(q => q.endedAt)).toEqual([1, 3]);
        expect(queriesInScope(queries, QueryScope.System).map(q => q.endedAt)).toEqual([2]);
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

    it('groups the queries by their shape', () => {
        const groups = groupQueries([
            query(1, { queryShape: 'a', query: 'SELECT 1', elapsed: 1, processedRows: 10, peakMemoryMb: 2 }),
            query(2, { queryShape: 'b', query: 'SELECT x', elapsed: 0.5 }),
            query(3, { queryShape: 'a', query: 'SELECT 2', elapsed: 2, succeeded: false, processedRows: 5, peakMemoryMb: 1 }),
            query(4, { queryShape: null, query: 'ATTACH', elapsed: 0.1 }),
        ]);
        expect(groups.map(g => g.shape)).toEqual(['a', 'b', 'text:ATTACH']);
        expect(groups[0]).toMatchObject({ query: 'SELECT 2', count: 2, failed: 1, totalElapsed: 3, meanElapsed: 1.5, processedRows: 15, peakMemoryMb: 2 });
    });

    it('computes nearest-rank percentiles', () => {
        expect(percentile([], 0.95)).toBeNull();
        expect(percentile([3], 0.95)).toBe(3);
        expect(percentile(Array.from({ length: 100 }, (_, i) => 100 - i), 0.95)).toBe(95);
        expect(percentile([1, 2], 0.5)).toBe(1);
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
