import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach } from 'vitest';

import type { HyperQueryEnd, HyperResourceSample } from '../hyper/hyper_log_metrics.js';
import { ConnectionMetricsView } from './connection_metrics_dashboard.js';

const NOW = 1_800_000_000_000;

function query(endedAt: number, succeeded = true, system = false): HyperQueryEnd {
    return {
        sessionId: 's',
        endedAt,
        succeeded,
        errorCode: succeeded ? null : '22012',
        errorMessage: succeeded ? null : 'division by zero',
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
        system,
    };
}

describe('ConnectionMetricsView', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
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

    /// The queries that the activity lists
    function listed(): number {
        return container.querySelectorAll('[data-testid="recent-query"]').length;
    }

    /// Show a view of the queries of the activity
    function showQueries(view: 'top' | 'recent' | 'slowest'): void {
        act(() => container.querySelector<HTMLButtonElement>(`[data-testid="recent-queries-order"] [data-order="${view}"]`)!.click());
    }

    it('shows the empty state without queries', () => {
        act(() => root.render(<ConnectionMetricsView queries={[]} samples={[]} now={NOW} />));
        expect(container.querySelector('[data-testid="connection-metrics-empty"]')).not.toBeNull();
        for (const testId of ['recent-queries', 'metric-latency', 'metric-rows', 'metric-cpu-time', 'metric-wait-time', 'metric-peak-memory', 'metric-process-memory', 'metric-storage-memory', 'metric-query-memory', 'metric-load']) {
            expect(card(testId)).not.toBeNull();
        }
        expect(rows('metric-latency')).toBe(0);
        expect(listed()).toBe(0);
    });

    it('lists and draws the queries of the selected window', () => {
        const queries = [query(NOW - 10 * 60_000), query(NOW - 2_000), query(NOW - 1_000, false)];
        act(() => root.render(<ConnectionMetricsView queries={queries} samples={[]} now={NOW} />));
        expect(container.querySelector('[data-testid="connection-metrics-empty"]')).toBeNull();
        // The default window of 5 minutes contains the newest queries, the newest is listed first
        expect(rows('metric-latency')).toBe(2);
        showQueries('recent');
        expect(listed()).toBe(2);
        expect(container.querySelector('[data-testid="recent-query"]')!.getAttribute('data-state')).toBe('failed');

        const window15m = container.querySelector<HTMLButtonElement>('[data-testid="connection-metrics-window"] [data-window="15m"]')!;
        act(() => window15m.click());
        expect(window15m.getAttribute('aria-current')).toBe('true');
        expect(rows('metric-latency')).toBe(3);
        expect(listed()).toBe(3);
    });

    it('lists the slowest queries first on request', () => {
        const slow = { ...query(NOW - 3_000), elapsed: 5 };
        const queries = [slow, query(NOW - 2_000), query(NOW - 1_000)];
        act(() => root.render(<ConnectionMetricsView queries={queries} samples={[]} now={NOW} />));
        showQueries('slowest');
        const first = container.querySelector('[data-testid="recent-query"]')!;
        expect(first.textContent).toContain('5 s');
    });

    it('groups the queries by their shape by default', () => {
        const queries = [
            { ...query(NOW - 3_000), queryShape: 'a', query: 'SELECT 1', elapsed: 2 },
            { ...query(NOW - 2_000), queryShape: 'b', query: 'SELECT x', elapsed: 0.5 },
            { ...query(NOW - 1_000), queryShape: 'a', query: 'SELECT 2', elapsed: 1 },
        ];
        act(() => root.render(<ConnectionMetricsView queries={queries} samples={[]} now={NOW} />));
        const groups = container.querySelectorAll('[data-testid="query-group"]');
        expect(groups).toHaveLength(2);
        // The shape with the most elapsed time first, with the text of its newest run
        expect(groups[0].textContent).toContain('SELECT 2');
        expect(listed()).toBe(0);
    });

    it('draws the queries of the selected scope', () => {
        const queries = [query(NOW - 3_000), query(NOW - 2_000, true, true), query(NOW - 1_000, false, true)];
        act(() => root.render(<ConnectionMetricsView queries={queries} samples={[]} now={NOW} />));
        const scope = (key: string) => container.querySelector<HTMLButtonElement>(`[data-testid="connection-metrics-scope"] [data-scope="${key}"]`)!;
        // All queries are shown first
        expect(scope('all').getAttribute('aria-current')).toBe('true');
        expect(rows('metric-latency')).toBe(3);
        act(() => scope('user').click());
        expect(scope('user').getAttribute('aria-current')).toBe('true');
        expect(rows('metric-latency')).toBe(1);
        showQueries('recent');
        expect(listed()).toBe(1);
        act(() => scope('system').click());
        expect(rows('metric-latency')).toBe(2);
    });

    it('draws the resource samples of the window', () => {
        // The first sample did not record the storage memory
        const samples: HyperResourceSample[] = [10_000, 5_000].map((age, i) => ({
            sampledAt: NOW - age,
            processMemoryMb: 256,
            transactionMemoryMb: 1,
            storageMemoryMb: i === 0 ? null : 70,
            overallLoad: 0.5,
            schedulerLoad: 0.5,
            memoryLoad: 0.1,
        }));
        act(() => root.render(<ConnectionMetricsView queries={[]} samples={samples} now={NOW} />));
        // A row per sample that recorded the metric
        expect(rows('metric-process-memory')).toBe(2);
        expect(rows('metric-storage-memory')).toBe(1);
        expect(rows('metric-query-memory')).toBe(2);
        expect(rows('metric-load')).toBe(2);
        const value = (testId: string) => card(testId).querySelector('[data-testid="metric-value"]')!.textContent;
        expect(value('metric-process-memory')).toBe('256 MB');
        expect(value('metric-storage-memory')).toBe('70 MB');
        // The resources are engine wide, not of the connection
        const section = (testId: string) => card(testId).closest('section:not([data-testid^="metric-"])')!.getAttribute('data-testid');
        for (const testId of ['metric-process-memory', 'metric-storage-memory', 'metric-query-memory', 'metric-load']) {
            expect(section(testId)).toBe('connection-metrics-engine');
        }
        expect(section('metric-latency')).toBe('connection-metrics-connection');
    });
});
