import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const mockState = {
    computationState: {
        tableComputations: {},
    } as any,
    dispatch: vi.fn(),
};

import { MOST_FREQUENT_FILTER, CrossFilters } from '../../../../../compute/cross_filters.js';
import { SET_CROSS_FILTERS } from '../../../../../compute/computation_state.js';
import { QueryExecutionStatus } from '../../../connections/query_execution_state.js';
import { QueryResultDetails, type QueryResultDetailsDependencies } from './query_result_details.js';

const dependencies = {
    QueryResultToolbar: () => null,
    QueryResultView: () => <div data-testid="query-result-view" />,
    useComputationRegistry: () => [mockState.computationState, mockState.dispatch],
    useQueryResultRowCounts: () => ({ totalRows: 3, currentRows: 3, matchingRows: null }),
} as QueryResultDetailsDependencies;

describe('QueryResultDetails', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        mockState.dispatch.mockReset();
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('clears all active cross-filters from the query results bar', () => {
        const crossFilters = new CrossFilters();
        crossFilters.columnFilters[1] = {
            type: MOST_FREQUENT_FILTER,
            value: { valueId: 7, filters: [] },
        };
        mockState.computationState = {
            tableComputations: {
                42: {
                    dataTable: { numRows: 3 },
                    crossFilters,
                },
            },
        };

        act(() => root.render(
            <QueryResultDetails
                query={{ queryId: 42, status: QueryExecutionStatus.SUCCEEDED } as any}
                debugMode={false}
                actions={<button type="button">Close</button>}
                dependencies={dependencies}
            />,
        ));

        const clearButton = container.querySelector<HTMLButtonElement>('button[aria-label="Clear all cross-filters"]');
        expect(clearButton).not.toBeNull();
        expect(clearButton!.disabled).toBe(false);
        expect(container.textContent).toContain('Close');

        act(() => clearButton!.click());

        expect(mockState.dispatch).toHaveBeenCalledTimes(1);
        const action = mockState.dispatch.mock.calls[0][0];
        expect(action.type).toBe(SET_CROSS_FILTERS);
        expect(action.value[0]).toBe(42);
        expect(action.value[1]).toBeInstanceOf(CrossFilters);
        expect(action.value[1].columnFilters).toEqual({});
    });

    it('disables the clear action when no cross-filters are active', () => {
        mockState.computationState = {
            tableComputations: {
                42: {
                    dataTable: { numRows: 3 },
                    crossFilters: new CrossFilters(),
                },
            },
        };

        act(() => root.render(
            <QueryResultDetails
                query={{ queryId: 42, status: QueryExecutionStatus.SUCCEEDED } as any}
                debugMode={false}
                dependencies={dependencies}
            />,
        ));

        expect(container.querySelector<HTMLButtonElement>('button[aria-label="Clear all cross-filters"]')?.disabled).toBe(true);
    });
});
