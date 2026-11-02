import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CLEAR_TABLE_ORDERING, type TableComputationState } from '../../compute/computation_state.js';
import { TABLE_ORDERING_TASK, TaskStatus, type TableOrderingTask } from '../../compute/computation_types.js';
import { mockTableComputation, recordingDispatch } from '../../tests/mocks/computation.js';
import { createTestRoot } from '../../tests/react_root.js';
import { createOrderingTask, getColumnSortDirection, getNextColumnSortDirection, useDataTableOrdering } from './data_table_ordering.js';

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

    function renderOrdering(table: TableComputationState) {
        const recorded = recordingDispatch();
        const current = { ordering: null as ReturnType<typeof useDataTableOrdering> | null };
        function Probe(props: { table: TableComputationState }) {
            current.ordering = useDataTableOrdering(props.table, recorded.dispatch);
            return null;
        }
        root = createTestRoot();
        const render = (next: TableComputationState) => root!.render(React.createElement(Probe, { table: next }));
        render(table);
        return { ...recorded, current, render };
    }
    const orderedTasks = (scheduled: (type: symbol) => { value: unknown }[]) =>
        scheduled(TABLE_ORDERING_TASK).map(task => (task.value as TableOrderingTask).orderingConstraints);

    it('needs a data frame and a row number column to order a table', () => {
        expect(createOrderingTask(mockTableComputation([], { dataFrame: null }), [])).toBeNull();
        expect(createOrderingTask(mockTableComputation([]), [{ field: 'rownum' }])).toMatchObject({ tableId: 1, rowNumberColumnName: 'rownum' });
    });

    it('orders a table by the requested ordering once while the task runs', async () => {
        const ordering = [{ field: 'rownum', ascending: false }];
        const table = mockTableComputation([], { dataTableOrdering: ordering });
        const { scheduled, render } = renderOrdering(table);
        await vi.waitFor(() => expect(orderedTasks(scheduled)).toEqual([ordering]));

        const running = { ...createOrderingTask(table, ordering)!, progress: { status: TaskStatus.TASK_RUNNING, startedAt: new Date(), completedAt: null, failedAt: null, failedWithError: null } };
        render({ ...table, tasks: { ...table.tasks, orderingTask: running } });
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(orderedTasks(scheduled)).toHaveLength(1);
    });

    it('cycles the order of a column from ascending to descending to the original order', async () => {
        const unordered = renderOrdering(mockTableComputation([]));
        unordered.current.ordering!.orderByColumn(0);
        expect(orderedTasks(unordered.scheduled)).toEqual([[{ field: 'rownum', ascending: true, nullsFirst: false }]]);
        expect(unordered.current.ordering!.getSortDirection(0)).toBeNull();
        root!.unmount();
        root = null;

        const descending = renderOrdering(mockTableComputation([], { dataTableOrdering: [{ field: 'rownum', ascending: false }] }));
        expect(descending.current.ordering!.getSortDirection(0)).toBe(false);
        descending.current.ordering!.orderByColumn(0);
        expect(descending.ofType(CLEAR_TABLE_ORDERING).map(action => action.value)).toEqual([1]);
    });
});

