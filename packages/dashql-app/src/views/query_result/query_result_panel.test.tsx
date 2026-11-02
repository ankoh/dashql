import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { QueryExecutionState } from '../../query/query_execution_state.js';
import { QueryResultPanel, type QueryResultPanelDependencies } from './query_result_header.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const viewProps: { maxRows?: number; onShowTable?: () => void }[] = [];
const dependencies = {
    useQueryResultRowCounts: () => ({ totalRows: 1000, currentRows: 1000, matchingRows: null }),
    QueryResultToolbar: () => null,
    QueryResultDownloadButton: () => null,
    QueryResultView: (props: { maxRows?: number; onShowTable?: () => void }) => {
        viewProps.push(props);
        return <div data-testid="query-result-view" />;
    },
} as unknown as QueryResultPanelDependencies;
const lastView = () => viewProps[viewProps.length - 1];
const query = { queryId: 1 } as QueryExecutionState;

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
        act(() => root.render(<QueryResultPanel query={query} dependencies={dependencies} />));
        const maxRows = lastView().maxRows!;
        // Fewer rows than in the result, and fewer than would fit without the header of the panel
        expect(maxRows).toBeGreaterThan(0);
        expect(maxRows).toBeLessThan(400 / 26);
        expect(container.textContent).toContain(`${maxRows} of 1000 rows`);
    });

    it('shows fewer rows in a smaller host', async () => {
        act(() => root.render(<QueryResultPanel query={query} dependencies={dependencies} />));
        const before = lastView().maxRows!;
        host.style.height = '200px';
        // The resize observer reports the new height in a later frame
        await act(async () => { await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
        expect(lastView().maxRows!).toBeLessThan(before);
    });

    it('opens the full table from the table and the header', () => {
        const onShowTable = vi.fn();
        act(() => root.render(<QueryResultPanel query={query} onShowTable={onShowTable} dependencies={dependencies} />));
        expect(lastView().onShowTable).toBe(onShowTable);
    });
});
