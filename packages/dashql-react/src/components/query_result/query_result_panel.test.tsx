import * as React from 'react';
import { act } from '../../testing/react_act.js';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QueryExecutionStatus, type QueryExecutionState } from '@akohn/dashql/platform/query/query_execution_state';
import { QueryResultHeader, QueryResultPanel } from './query_result_header.js';
import { fakeComputationModel, fakeQueryModel } from '../../testing/fake_models.js';
import { mockTableComputation } from '../../testing/computation_mocks.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const viewProps: { maxRows?: number }[] = [];
const lastView = () => viewProps[viewProps.length - 1];
const query = { queryId: 1, status: QueryExecutionStatus.SUCCEEDED, resultTable: { id: 1, rows: 3 } } as unknown as QueryExecutionState;
/// A result of 1000 rows
const model = fakeQueryModel(query, { computation: fakeComputationModel(mockTableComputation([], { dataTableRows: 1000 })) });

/// The panel with the header of the model over a table that records the rows it shows
function Panel(props: { query: QueryExecutionState | null; onShowTable?: () => void }) {
    return (
        <QueryResultPanel
            query={props.query}
            header={maxRows => <QueryResultHeader model={model} maxRows={maxRows} onShowTable={props.onShowTable} />}
            table={maxRows => {
                viewProps.push({ maxRows });
                return <div data-testid="query-result-view" />;
            }}
        />
    );
}

describe('QueryResultPanel', () => {
    let container: HTMLDivElement;
    let host: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        viewProps.length = 0;
        container = document.createElement('div');
        host = document.createElement('div');
        host.style.height = '400px';
        container.appendChild(host);
        document.body.appendChild(container);
        root = createRoot(host);
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('shows the rows that fit into its host and counts them in the header', () => {
        act(() => root.render(<Panel query={query} />));
        const maxRows = lastView().maxRows!;
        // Fewer rows than in the result, and fewer than would fit without the header of the panel
        expect(maxRows).toBeGreaterThan(0);
        expect(maxRows).toBeLessThan(400 / 26);
        expect(container.textContent).toContain(`${maxRows} of 1000 rows`);
    });

    it('shows fewer rows in a smaller host', async () => {
        act(() => root.render(<Panel query={query} />));
        const before = lastView().maxRows!;
        host.style.height = '200px';
        // The resize observer reports the new height in a later frame
        await act(async () => { await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
        expect(lastView().maxRows!).toBeLessThan(before);
    });

    it('opens the full table from the header', () => {
        const onShowTable = vi.fn();
        act(() => root.render(<Panel query={query} onShowTable={onShowTable} />));
        act(() => container.querySelector<HTMLButtonElement>('[data-testid="tab-header-expand"]')!.click());
        expect(onShowTable).toHaveBeenCalled();
    });

    it('shows the logo with the status until the query has rows', () => {
        const placeholder = () => container.querySelector('[data-testid="card-placeholder"]');
        act(() => root.render(<Panel query={null} />));
        expect(placeholder()?.textContent).toBe('Run the query to see the result');
        expect(placeholder()?.querySelector('svg use')).not.toBeNull();
        // The hint is quieter than a status
        const hintClass = placeholder()!.querySelector('span')!.className;
        const running = { queryId: 2, status: QueryExecutionStatus.RUNNING, resultTable: null } as QueryExecutionState;
        act(() => root.render(<Panel query={running} />));
        expect(placeholder()?.textContent).toBe('Running the query…');
        expect(placeholder()!.querySelector('span')!.className).not.toBe(hintClass);
        const failed = { ...running, status: QueryExecutionStatus.FAILED } as QueryExecutionState;
        act(() => root.render(<Panel query={failed} />));
        expect(placeholder()?.textContent).toBe('The query failed');
        expect(container.querySelector('[data-testid="query-result-view"]')).toBeNull();
        act(() => root.render(<Panel query={query} />));
        expect(placeholder()).toBeNull();
        expect(container.querySelector('[data-testid="query-result-view"]')).not.toBeNull();
    });
});
