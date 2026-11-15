import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, vi } from 'vitest';

import { fakeReactWindowModule, ResizeObserverMock } from '../tests/mocks/view_mocks.js';

vi.stubGlobal('ResizeObserver', ResizeObserverMock);

import { QueryExecutionStatus, QueryType, type QueryExecutionState } from '@ankoh/dashql-runtime/query/query_execution_state';
import {
    getQueryTarget,
    QueryHistoryViewer,
    type QueryHistoryViewerDependencies,
    QueryTarget,
    type QueryEntry,
} from './query_history_viewer.js';

const dependencies = fakeReactWindowModule(React, vi.fn()) as QueryHistoryViewerDependencies;

/// A queued query as far as the history viewer reads it
function createExecution(queryType: QueryType, userProvided: boolean): QueryExecutionState {
    return {
        queryId: 1,
        status: QueryExecutionStatus.QUEUED,
        queryMetadata: {
            queryType,
            title: 'Shell Query',
            description: null,
            issuer: 'DashQL Shell',
            userProvided,
        },
        metrics: { lastUpdatedAt: null },
    } as unknown as QueryExecutionState;
}

describe('QueryHistoryViewer', () => {
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

    it('classifies connection and memory query targets', () => {
        expect(getQueryTarget(createExecution(QueryType.USER_PROVIDED, true))).toBe(QueryTarget.CONNECTION);
        expect(getQueryTarget(createExecution(QueryType.INTERNAL_SQLFRAME, false))).toBe(QueryTarget.MEMORY);
    });

    it('shows the source, target and title of each query', () => {
        const query = createExecution(QueryType.INTERNAL_SQLFRAME, false);
        const entries: QueryEntry[] = [{
            connectionId: 'shell',
            sourceName: 'Hyper',
            target: QueryTarget.MEMORY,
            queryId: query.queryId,
            query,
        }];

        act(() => root.render(<QueryHistoryViewer entries={entries} onClose={() => {}} dependencies={dependencies} />));

        const rows = container.querySelectorAll('[data-testid="query-history-row"]');
        expect(rows.length).toBe(1);
        expect(rows[0].textContent).toContain('Hyper');
        expect(rows[0].textContent).toContain(QueryTarget.MEMORY);
        expect(rows[0].textContent).toContain('Shell Query');
    });
});
