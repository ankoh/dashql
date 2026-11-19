import { vi } from 'vitest';
import type * as core from '@akohn/dashql';

import type { ColumnGroup, ResultSearchState, TableComputationState } from '@akohn/dashql/platform/compute/computation_types';

/// A search without a pattern
export function createResultSearchState(): ResultSearchState {
    return {
        requestedPattern: '',
        appliedPattern: '',
        requestId: 0,
        appliedRequestId: 0,
        matchingColumnGroups: null,
        hasMatchingRows: false,
        pending: false,
        error: null,
    };
}

/// A value column of a column group
export function valueColumn(name: string, inputFieldType: string, fields: Partial<core.ComputationValueColumn> = {}): core.ComputationValueColumn {
    return {
        inputFieldName: name,
        inputFieldType,
        inputFieldNullable: true,
        statsFields: null,
        binFieldName: null,
        binCount: 0,
        valueIdFieldName: null,
        ...fields,
    };
}

/// The view of the computation of table 1 before its tasks ran: the table by the handle 1, the data frame 1 and the
/// row number column `rownum`
export function mockTableComputation(columnGroups: ColumnGroup[], fields: Partial<TableComputationState> = {}): TableComputationState {
    return {
        tableId: 1,
        revision: 1,
        connectionId: null,
        clientContext: null,
        tasks: {
            filteringTask: null,
            orderingTask: null,
            dataSearchTask: null,
            tableAggregationTask: null,
            systemColumnTask: null,
            columnAggregationTasks: Array(columnGroups.length).fill(null),
            filteredColumnAggregationTasks: Array(columnGroups.length).fill(null),
        },
        version: { data: 0, filter: 0 },
        dataTable: 1,
        dataTableRows: 3,
        dataTableFields: [],
        dataFrame: 1,
        columnGroups,
        dataTableOrdering: [],
        crossFilters: [],
        filterTable: null,
        orderingTable: null,
        columnSearch: createResultSearchState(),
        dataSearch: createResultSearchState(),
        dataSearchTable: null,
        rowNumberColumnGroup: null,
        rowNumberColumnName: 'rownum',
        tableAggregation: null,
        columnAggregates: Array.from({ length: columnGroups.length }, () => null),
        filteredColumnAggregates: Array.from({ length: columnGroups.length }, () => null),
        filteredColumnAggregatesOutdated: Array.from({ length: columnGroups.length }, () => false),
        ...fields,
    };
}

/// A dispatch of the actions of a computation that records them
export function recordingDispatch() {
    const actions: core.RuntimeAction[] = [];
    const dispatch = vi.fn((action: core.RuntimeAction): core.DispatchOutcome => {
        actions.push(action);
        return { ok: true, changed: true, error: null, id: null };
    });
    const ofKind = <K extends core.RuntimeAction['kind']>(kind: K) =>
        actions.filter((action): action is Extract<core.RuntimeAction, { kind: K }> => action.kind === kind);
    return { dispatch, actions, ofKind };
}
