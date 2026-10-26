import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, vi } from 'vitest';

import type { HyperLogError, HyperQueryEnd, HyperResourceSample } from '../hyper/hyper_log_metrics.js';
import { QueryScope } from './connection_metrics.js';
import { ConnectionMetricsView, type ConnectionMetricsViewDependencies } from './connection_metrics_dashboard.js';
import { recentQueriesSql, queryShapesSql } from './connection_query_sql.js';
import type { QueryTableProps } from './connection_query_table.js';

const NOW = 1_800_000_000_000;
const MINUTE = 60_000;
/// The query of the finished queries of the connection in the Hyper log
const QUERY_ENDS = 'SELECT * FROM query_ends';

/// The tables of the view are replaced, they run no queries
const NO_QUERY = async (): Promise<never> => { throw new Error('the test runs no queries'); };

/// The query of the table that the view rendered last
let shownSql: string | null = null;
/// The refreshes of the table that the view rendered last
let shownRefreshes = 0;

const QueryTable: React.FC<QueryTableProps> = ({ sql, refreshes = 0 }) => {
    shownSql = sql;
    shownRefreshes = refreshes;
    return <div data-testid="query-table" />;
};
const dependencies: ConnectionMetricsViewDependencies = { QueryTable };

interface ViewTestProps {
    queries: HyperQueryEnd[];
    samples?: HyperResourceSample[];
    now?: number;
    refresh?: () => Promise<void>;
    logError?: HyperLogError | null;
    resourceUsageLogged?: boolean | null;
}

const View: React.FC<ViewTestProps> = props => (
    <ConnectionMetricsView
        dependencies={dependencies}
        queries={props.queries}
        queryEnds={QUERY_ENDS}
        runQuery={NO_QUERY}
        refresh={props.refresh}
        samples={props.samples ?? []}
        logError={props.logError}
        resourceUsageLogged={props.resourceUsageLogged}
        engine={<span data-testid="connection-engine" />}
        now={props.now ?? NOW}
    />
);

function query(endedAt: number, succeeded = true, sentByApp = false): HyperQueryEnd {
    return {
        sessionId: 's',
        endedAt,
        succeeded,
        errorCode: succeeded ? null : '22012',
        errorMessage: succeeded ? null : 'division by zero',
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
        queryType: sentByApp ? 'sqlframe' : 'user',
        sentByApp,
    };
}

describe('ConnectionMetricsView', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        shownSql = null;
        shownRefreshes = 0;
        container = document.createElement('div');
        container.style.width = '800px';
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    function card(testId: string): HTMLElement {
        return container.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!;
    }

    /// The rows that the chart of a card draws
    function rows(testId: string): number {
        return Number(card(testId).querySelector('[data-dataset-rows]')!.getAttribute('data-dataset-rows'));
    }

    /// The query of the table of the activity, null without a table
    function listed(): string | null {
        return container.querySelector('[data-testid="query-table"]') == null ? null : shownSql;
    }

    /// Show a view of the queries of the activity
    function showQueries(view: 'top' | 'recent'): void {
        act(() => container.querySelector<HTMLButtonElement>(`[data-testid="recent-queries-view"] [data-view="${view}"]`)!.click());
    }

    it('shows the empty state without queries', () => {
        act(() => root.render(<View queries={[]} />));
        expect(container.querySelector('[data-testid="connection-metrics-empty"]')).not.toBeNull();
        for (const testId of ['recent-queries', 'metric-queries', 'metric-latency', 'metric-rows', 'metric-cpu-time', 'metric-wait-time', 'metric-peak-memory', 'metric-process-memory', 'metric-tracked-memory', 'metric-query-memory', 'metric-load']) {
            expect(card(testId)).not.toBeNull();
        }
        expect(rows('metric-latency')).toBe(0);
        expect(listed()).toBeNull();
    });

    it('describes the Hyper log field of every metric on its name', () => {
        act(() => root.render(<View queries={[]} />));
        const names = [...container.querySelectorAll<HTMLElement>('[data-testid="metric-source"]')];
        expect(names.length).toBe(10);
        const sources = names.map(name => document.getElementById(name.getAttribute('aria-describedby')!)!.textContent);
        // Each card names a field of its own
        expect(new Set(sources).size).toBe(10);
    });

    it('lists and draws the queries of the selected window', () => {
        const queries = [query(NOW - 10 * 60_000), query(NOW - 2_000), query(NOW - 1_000, false)];
        act(() => root.render(<View queries={queries} />));
        expect(container.querySelector('[data-testid="connection-metrics-empty"]')).toBeNull();
        // The default window of 5 minutes contains the newest queries, they ended in the same bucket of 5 seconds.
        // The charts draw a bar per bucket.
        expect(rows('metric-latency')).toBe(1);
        expect(rows('metric-queries')).toBe(1);
        expect(card('metric-queries').querySelector('[data-testid="metric-value"]')!.textContent).toBe('2');
        // The CPU time is the mean of the queries, every query takes 20ms
        expect(card('metric-cpu-time').querySelector('[data-testid="metric-value"]')!.textContent).toBe('20 ms');
        expect(card('metric-cpu-time').querySelector('[aria-label="mean"]')).not.toBeNull();
        expect(card('metric-latency').querySelector('[aria-label="95th percentile"]')!.textContent).toBe('p95');
        expect(card('metric-peak-memory').querySelector('[aria-label="maximum"]')!.textContent).toBe('max');
        expect(card('metric-queries').querySelector('[aria-label="total"]')!.textContent).toBe('Σ');
        expect(card('metric-rows').querySelector('[aria-label="total"]')!.textContent).toBe('Σ');
        // The newest queries are listed first
        expect(listed()).toBe(recentQueriesSql(QUERY_ENDS, QueryScope.All, NOW - 5 * MINUTE));
        showQueries('top');
        expect(listed()).toBe(queryShapesSql(QUERY_ENDS, QueryScope.All, NOW - 5 * MINUTE));

        const window15m = container.querySelector<HTMLButtonElement>('[data-testid="connection-metrics-window"] [data-window="15m"]')!;
        act(() => window15m.click());
        expect(window15m.getAttribute('aria-current')).toBe('true');
        expect(rows('metric-latency')).toBe(2);
        expect(listed()).toBe(queryShapesSql(QUERY_ENDS, QueryScope.All, NOW - 15 * MINUTE));
    });

    it('polls the log and queries the table again on a refresh', async () => {
        const refresh = vi.fn(async () => {});
        act(() => root.render(<View queries={[query(NOW - 1_000)]} refresh={refresh} />));
        const sql = listed();
        expect(shownRefreshes).toBe(0);
        await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="recent-queries-refresh"]')!.click());
        expect(refresh).toHaveBeenCalledTimes(1);
        await vi.waitFor(() => expect(shownRefreshes).toBe(1));
        expect(listed()).toBe(sql);
    });

    it('queries the table again only when the queries of the window change', () => {
        const queries = [query(NOW - 2 * MINUTE), query(NOW - 1_000)];
        act(() => root.render(<View queries={queries} />));
        const sql = listed();
        // The window slides, but it still holds the same queries
        act(() => root.render(<View queries={[...queries]} now={NOW + 30_000} />));
        expect(listed()).toBe(sql);
        // The oldest query left the window
        act(() => root.render(<View queries={queries} now={NOW + 4 * MINUTE} />));
        expect(listed()).toBe(recentQueriesSql(QUERY_ENDS, QueryScope.All, NOW - MINUTE));
    });

    it('does not query the table again for every own query of the overview', () => {
        const own = (endedAt: number, queryType: string) => ({ ...query(endedAt, true, true), queryType });
        // The newest own query ends in the middle of an interval of 15 seconds
        const start = Math.floor(NOW / 15_000) * 15_000 + 5_000;
        const queries = [query(start - MINUTE), own(start - 2_000, 'monitor')];
        act(() => root.render(<View queries={queries} now={start} />));
        const sql = listed();
        // The reads of the log and of the table follow within the same interval
        const reads = [...queries, own(start + 1_000, 'monitor'), own(start + 2_000, 'overview')];
        act(() => root.render(<View queries={reads} now={start + 3_000} />));
        expect(listed()).toBe(sql);
        // A query of the user is listed right away
        act(() => root.render(<View queries={[...reads, query(start + 3_000)]} now={start + 4_000} />));
        expect(listed()).toBe(recentQueriesSql(QUERY_ENDS, QueryScope.All, start + 4_000 - 5 * MINUTE));
        // The own queries are listed once their interval ends
        const later = [...reads, query(start + 3_000), own(start + 12_000, 'monitor')];
        act(() => root.render(<View queries={later} now={start + 13_000} />));
        expect(listed()).toBe(recentQueriesSql(QUERY_ENDS, QueryScope.All, start + 13_000 - 5 * MINUTE));
    });

    it('draws the queries of the selected scope', () => {
        // The queries end in buckets of their own
        const queries = [query(NOW - 13_000), query(NOW - 8_000, true, true), query(NOW - 3_000, false, true)];
        act(() => root.render(<View queries={queries} />));
        const scope = (key: string) => container.querySelector<HTMLButtonElement>(`[data-testid="connection-metrics-scope"] [data-scope="${key}"]`)!;
        // All queries are shown first
        expect(scope('all').getAttribute('aria-current')).toBe('true');
        expect(rows('metric-latency')).toBe(3);
        // The scope sits next to the time window
        expect(card('connection-metrics-scope').parentElement).toBe(card('connection-metrics-window').parentElement);
        act(() => scope('user').click());
        expect(scope('user').getAttribute('aria-current')).toBe('true');
        expect(rows('metric-latency')).toBe(1);
        expect(listed()).toBe(recentQueriesSql(QUERY_ENDS, QueryScope.User, NOW - 5 * MINUTE));
        act(() => scope('app').click());
        expect(rows('metric-latency')).toBe(2);
    });

    it('draws the resource samples of the window', () => {
        // The first sample did not record the tracked memory
        const samples: HyperResourceSample[] = [10_000, 5_000].map((age, i) => ({
            sampledAt: NOW - age,
            processMemoryMb: 256,
            transactionMemoryMb: 1,
            trackedMemoryMb: i === 0 ? null : 70,
            overallLoad: 0.5,
            schedulerLoad: 0.5,
            memoryLoad: 0.1,
        }));
        act(() => root.render(<View queries={[]} samples={samples} />));
        // A row per bucket with a sample that recorded the metric
        expect(rows('metric-process-memory')).toBe(2);
        expect(rows('metric-tracked-memory')).toBe(1);
        expect(rows('metric-query-memory')).toBe(2);
        expect(rows('metric-load')).toBe(2);
        const value = (testId: string) => card(testId).querySelector('[data-testid="metric-value"]')!.textContent;
        expect(value('metric-process-memory')).toBe('256 MB');
        expect(value('metric-tracked-memory')).toBe('70 MB');
        // The resources are engine wide, not of the connection
        const section = (testId: string) => card(testId).closest('section:not([data-testid^="metric-"])')!.getAttribute('data-testid');
        for (const testId of ['metric-process-memory', 'metric-tracked-memory', 'metric-query-memory', 'metric-load']) {
            expect(section(testId)).toBe('connection-metrics-engine');
        }
        expect(section('metric-latency')).toBe('connection-metrics-queries');
        // The engine is described in the header of its section
        expect(card('connection-engine').closest('section')!.getAttribute('data-testid')).toBe('connection-metrics-engine');
    });

    it('shows the error instead of the metrics when the log cannot be read', () => {
        const error: HyperLogError = { unreadable: true, message: 'Hyper introspection functions (e.g. hyper_log) are disabled' };
        act(() => root.render(<View queries={[query(NOW - MINUTE)]} logError={error} />));
        expect(card('connection-metrics-log-unavailable')).not.toBeNull();
        expect(card('connection-metrics-log-error').textContent).toBe(error.message);
        for (const testId of ['recent-queries', 'metric-queries', 'metric-latency', 'connection-metrics-engine', 'connection-engine']) {
            expect(card(testId)).toBeNull();
        }
        expect(listed()).toBeNull();
    });

    it('replaces the engine cards when the Hyper does not log its resource usage', () => {
        act(() => root.render(<View queries={[]} resourceUsageLogged={false} />));
        expect(card('connection-metrics-no-resource-usage')).not.toBeNull();
        expect(card('metric-process-memory')).toBeNull();
        expect(card('metric-queries')).not.toBeNull();

        // Samples of an earlier Hyper process are still drawn, as is everything while unknown
        const sample: HyperResourceSample = {
            sampledAt: NOW - 5_000, processMemoryMb: 256, transactionMemoryMb: 1, trackedMemoryMb: 70,
            overallLoad: 0.5, schedulerLoad: 0.5, memoryLoad: 0.1,
        };
        act(() => root.render(<View queries={[]} samples={[sample]} resourceUsageLogged={false} />));
        expect(card('connection-metrics-no-resource-usage')).toBeNull();
        expect(rows('metric-process-memory')).toBe(1);
        act(() => root.render(<View queries={[]} resourceUsageLogged={null} />));
        expect(card('connection-metrics-no-resource-usage')).toBeNull();
        expect(card('metric-process-memory')).not.toBeNull();
    });
});
