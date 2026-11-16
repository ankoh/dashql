import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { TableComputationState } from '@ankoh/dashql-platform/compute/computation_types';
import { tableFromArrays } from '@ankoh/dashql-platform/testing/arrow_fixtures';
import { mockTableComputation, recordingDispatch } from '../../tests/mocks/computation.js';
import { createTestRoot } from '../../tests/react_root.js';
import { getColumnSortDirection, getNextColumnSortDirection, useDataTableOrdering } from './data_table_ordering.js';

describe('data table ordering', () => {
    it('sorts an unordered column ascending first', () => {
        expect(getColumnSortDirection('score', [])).toBeNull();
        expect(getNextColumnSortDirection('score', [])).toBe(true);
    });

    it('cycles the active column from ascending to descending to unsorted', () => {
        const ascending = [{ field: 'score', ascending: true }];
        const descending = [{ field: 'score', ascending: false }];

        expect(getNextColumnSortDirection('score', ascending)).toBe(false);
        expect(getNextColumnSortDirection('score', descending)).toBeNull();
    });

    it('treats an omitted direction as ascending', () => {
        const ordering = [{ field: 'score' }];

        expect(getColumnSortDirection('score', ordering)).toBe(true);
        expect(getNextColumnSortDirection('score', ordering)).toBe(false);
    });

    it('starts a different column in ascending order', () => {
        const ordering = [{ field: 'name', ascending: false }];

        expect(getColumnSortDirection('score', ordering)).toBeNull();
        expect(getNextColumnSortDirection('score', ordering)).toBe(true);
    });
});

describe('useDataTableOrdering', () => {
    let root: ReturnType<typeof createTestRoot> | null = null;
    afterEach(() => {
        root?.unmount();
        root = null;
    });
    const DATA_TABLE = tableFromArrays({ rownum: Int32Array.from([0, 1, 2]) });

    function renderOrdering(table: TableComputationState) {
        const recorded = recordingDispatch();
        const current = { ordering: null as ReturnType<typeof useDataTableOrdering> | null };
        function Probe(props: { table: TableComputationState }) {
            current.ordering = useDataTableOrdering(props.table, DATA_TABLE, recorded.dispatch);
            return null;
        }
        root = createTestRoot();
        root.render(React.createElement(Probe, { table }));
        return { ...recorded, current };
    }

    it('cycles the order of a column from ascending to descending to the original order', () => {
        const unordered = renderOrdering(mockTableComputation([]));
        unordered.current.ordering!.orderByColumn(0);
        expect(unordered.ofKind('orderBy').map(action => action.value.constraints)).toEqual([[{ field: 'rownum', ascending: true, nullsFirst: false }]]);
        expect(unordered.current.ordering!.getSortDirection(0)).toBeNull();
        root!.unmount();
        root = null;

        const descending = renderOrdering(mockTableComputation([], { dataTableOrdering: [{ field: 'rownum', ascending: false }] }));
        expect(descending.current.ordering!.getSortDirection(0)).toBe(false);
        descending.current.ordering!.orderByColumn(0);
        expect(descending.ofKind('orderBy').map(action => action.value.constraints)).toEqual([[]]);
    });

    it('shows the ordering that a running task computes', () => {
        const table = mockTableComputation([]);
        const running = renderOrdering({
            ...table,
            tasks: {
                ...table.tasks,
                orderingTask: {
                    taskId: 1,
                    tableVersion: table.version,
                    orderingConstraints: [{ field: 'rownum', ascending: true }],
                    progress: { status: 1, startedAt: 0, completedAt: null, failedAt: null, failedWithError: null },
                },
            },
        });
        expect(running.current.ordering!.getSortDirection(0)).toBe(true);
        // The runtime orders the rows, rendering asks for nothing
        expect(running.actions).toEqual([]);
    });
});
