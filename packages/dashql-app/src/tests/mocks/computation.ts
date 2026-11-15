import { vi } from 'vitest';

import type * as arrow from 'apache-arrow';

import { createArrowFieldIndex, SCHEDULE_TASK, type ComputationAction, type TableComputationState } from '@ankoh/dashql-runtime/compute/computation_state';
import { ComputationStateVersion, type ColumnGroup, type ResultSearchState, type TaskVariant } from '@ankoh/dashql-runtime/compute/computation_types';
import { CrossFilters } from '@ankoh/dashql-runtime/compute/cross_filters';
import type { AsyncValue } from '@ankoh/dashql-runtime/utils/async_value';
import { mockDataFrame } from '@ankoh/dashql-runtime/testing/mocks/compute_query';
import { tableFromArrays } from '@ankoh/dashql-runtime/testing/arrow_fixtures';

/// A search without a pattern
export function createResultSearchState(): ResultSearchState {
    return {
        requestedPattern: '',
        appliedPattern: '',
        requestId: 0,
        appliedRequestId: 0,
        matchingColumnGroups: null,
        matchingRows: null,
        pending: false,
        error: null,
    };
}

/// The state of the computation of a table as a plain object, as the computations project it before their tasks ran
export function createTableComputationState(computationId: number, table: arrow.Table, tableColumns: ColumnGroup[], tableLifetime: AbortController): TableComputationState {
    return {
        tableId: computationId,
        connectionId: null,
        clientContext: null,
        tasks: {
            filteringTask: null,
            orderingTask: null,
            dataSearchTask: null,
            tableAggregationTask: null,
            systemColumnTask: null,
            columnAggregationTasks: Array(tableColumns.length + 1).fill(null),
            filteredColumnAggregationTasks: Array(tableColumns.length + 1).fill(null),
        },
        dataTable: table,
        version: new ComputationStateVersion(0, 0),
        dataTableFieldsByName: createArrowFieldIndex(table),
        columnGroups: tableColumns,
        columnAggregates: Array.from({ length: tableColumns.length }, () => null),
        rowNumberColumnGroup: null,
        rowNumberColumnName: null,
        dataTableLifetime: tableLifetime,
        dataTableOrdering: [],
        crossFilters: new CrossFilters(),
        dataFrame: null,
        filterTable: null,
        orderingTable: null,
        columnSearch: createResultSearchState(),
        dataSearch: createResultSearchState(),
        dataSearchTable: null,
        filteredColumnAggregates: Array.from({ length: tableColumns.length }, () => null),
        filteredColumnAggregatesOutdated: Array.from({ length: tableColumns.length }, () => false),
        tableAggregation: null,
    };
}

/// Table 1 with the column groups, a data frame of a table without a database and the row number column `rownum`
export function mockTableComputation(columnGroups: ColumnGroup[], fields: Partial<TableComputationState> = {}): TableComputationState {
    const table = tableFromArrays({ rownum: Int32Array.from([0, 1, 2]) });
    return {
        ...createTableComputationState(1, table, columnGroups, new AbortController()),
        dataFrame: mockDataFrame('input'),
        rowNumberColumnName: 'rownum',
        ...fields,
    };
}

/// A dispatch of computation actions that records the actions and the scheduled tasks.
/// The tasks of scheduleTask() settle when the test resolves or rejects their result.
export function recordingDispatch() {
    const actions: ComputationAction[] = [];
    const dispatch = vi.fn((action: ComputationAction) => { actions.push(action); });
    const scheduled = (type: symbol) => actions
        .filter(action => action.type === SCHEDULE_TASK)
        .map(action => action.value as TaskVariant & { result: AsyncValue<unknown, Error> })
        .filter(task => task.type === type);
    const ofType = (type: symbol) => actions.filter(action => action.type === type);
    return { dispatch, actions, scheduled, ofType };
}
