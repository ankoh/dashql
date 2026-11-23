import * as React from 'react';
import { act } from '../../testing/react_act.js';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

import { buffers } from '@akohn/dashql';
import type * as arrow from 'apache-arrow';
import { QueryExecutionStatus, type QueryExecutionState } from '@akohn/dashql/platform/query/query_execution_state';
import { tableFromArrays } from '@akohn/dashql/platform/testing/arrow_fixtures';
import { TestLogger } from '@akohn/dashql/platform/testing/test_logger';
import { KpiView } from './kpi_view.js';
import { LoggerContext } from '../../logger.js';

const Spec = buffers.visualization.KpiSpecT;
const Delta = buffers.visualization.KpiDelta;

const SUCCEEDED = { queryId: 1, status: QueryExecutionStatus.SUCCEEDED } as QueryExecutionState;

function spec(value: string | null = null, x: string | null = null, delta = Delta.PREVIOUS) {
    return new Spec(value, x, delta);
}

describe('KpiView', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    function render(table: arrow.Table | null, kpi = spec(), query: QueryExecutionState | null = SUCCEEDED) {
        act(() => root.render(
            <LoggerContext.Provider value={new TestLogger()}>
                <KpiView query={query} resultTable={table} spec={kpi} />
            </LoggerContext.Provider>,
        ));
    }

    const text = (testId: string) => container.querySelector(`[data-testid="${testId}"]`)?.textContent ?? null;

    it('shows the value, its change and the chart', () => {
        render(tableFromArrays({ day: new Int32Array([1, 2]), revenue: new Int32Array([100, 110]) }));
        expect(text('kpi-value')).toBe('110');
        expect(text('kpi-change')).toBe('▲ +10%');
        expect(container.querySelector('[data-testid="kpi-change"]')!.getAttribute('data-direction')).toBe('up');
        expect(container.querySelector('[data-testid="kpi-chart"]')).not.toBeNull();
    });

    it('shows a single row without change and chart, and a dash without rows', () => {
        render(tableFromArrays({ total: new Int32Array([42]) }));
        expect(text('kpi-value')).toBe('42');
        expect(text('kpi-change')).toBeNull();
        expect(container.querySelector('[data-testid="kpi-chart"]')).toBeNull();
        render(tableFromArrays({ total: new Int32Array([]) }));
        expect(text('kpi-value')).toBe('–');
    });

    it('fits the chart to the card once the query succeeds and after a rerun', async () => {
        container.style.width = '300px';
        container.style.height = '150px';
        const table = tableFromArrays({ day: new Int32Array([1, 2]), revenue: new Int32Array([100, 110]) });
        const running = { queryId: 1, status: QueryExecutionStatus.RUNNING } as QueryExecutionState;
        const chartWidth = () => container.querySelector('[data-testid="kpi-chart"]')?.getAttribute('width') ?? null;
        // The card mounts while its query runs, the view of the result comes later
        render(null, spec(), running);
        render(table);
        expect(chartWidth()).toBe('300');
        container.style.width = '360px';
        await vi.waitFor(() => expect(chartWidth()).toBe('360'));
        // A rerun replaces the view of the result, the chart follows the size of the new one
        render(null, spec(), { ...running, queryId: 2 } as QueryExecutionState);
        render(table, spec(), { queryId: 2, status: QueryExecutionStatus.SUCCEEDED } as QueryExecutionState);
        expect(chartWidth()).toBe('360');
        container.style.width = '320px';
        await vi.waitFor(() => expect(chartWidth()).toBe('320'));
    });

    it('shows a placeholder for a missing column and a query that did not succeed', () => {
        render(tableFromArrays({ total: new Int32Array([1]) }), spec('revenue'));
        expect(text('card-placeholder')).toContain('Result has no column revenue');
        render(null, spec(), { queryId: 1, status: QueryExecutionStatus.RUNNING } as QueryExecutionState);
        expect(container.querySelector('[data-testid="kpi-view"]')).toBeNull();
        expect(container.querySelector('[data-testid="card-placeholder"]')).not.toBeNull();
    });
});
