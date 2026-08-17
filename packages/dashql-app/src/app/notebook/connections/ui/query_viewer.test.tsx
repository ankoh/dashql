import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, vi } from 'vitest';

import { fakeReactWindowModule, ResizeObserverMock } from '../../../../test/view_mocks.js';

vi.mock('react-window', async () => fakeReactWindowModule(await import('react'), vi.fn()));
vi.stubGlobal('ResizeObserver', ResizeObserverMock);

import { createQueryExecutionState, QueryType } from '../query_execution_state.js';
import { getQueryTarget, QueryHistoryViewer, QueryTarget, type QueryEntry } from './query_viewer.js';

function createExecution(queryType: QueryType) {
    return createQueryExecutionState(
        1,
        1,
        'SELECT 1',
        {
            queryType,
            title: 'Shell Query',
            description: null,
            issuer: 'DashQL Shell',
            userProvided: true,
        },
        new AbortController(),
    );
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

    it('classifies local and remote query targets', () => {
        expect(getQueryTarget(createExecution(QueryType.INTERNAL_SQLFRAME))).toBe(QueryTarget.LOCAL);
        expect(getQueryTarget(createExecution(QueryType.USER_PROVIDED))).toBe(QueryTarget.REMOTE);
    });

    it('shows query sources and targets in separate columns', () => {
        const query = createExecution(QueryType.INTERNAL_SQLFRAME);
        const entries: QueryEntry[] = [{
            connectionId: 'shell',
            sourceName: 'Hyper',
            target: QueryTarget.LOCAL,
            queryId: query.queryId,
            query,
        }];

        act(() => root.render(<QueryHistoryViewer entries={entries} onClose={() => {}} />));

        expect(container.textContent).toContain('Source');
        expect(container.textContent).toContain('Target');
        expect(container.textContent).toContain('Hyper');
        expect(container.textContent).toContain('Local');
        expect(container.textContent).toContain('Title');
        expect(container.textContent).toContain('Shell Query');
    });
});
