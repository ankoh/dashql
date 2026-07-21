import * as React from 'react';

import { ComputationAction, SET_CROSS_FILTERS, TableComputationState } from '../../compute/computation_state.js';
import { CrossFilters } from '../../compute/cross_filters.js';
import { Dispatch } from '../../utils/variant.js';
import { ORDINAL_COLUMN, OrdinalColumnAggregation, StringColumnAggregation, TableAggregation, TableFilteringTask, TaskStatus, WithFilter, ColumnAggregationTask } from '../../compute/computation_types.js';
import { ScalarFilter } from '../../sql/sqlframe_builder.js';
import { HistogramFilterCallback } from './histogram_cell.js';
import { MostFrequentValueFilterCallback } from './mostfrequent_cell.js';
import { DataTableLayout } from './data_table_layout.js';
import { computeFilteredColumnAggregatesDispatched, filterTableDispatched } from '../../compute/computation_logic.js';

/// Compare two scalar filter lists for equality.
function scalarFiltersEqual(left: ScalarFilter[], right: ScalarFilter[]): boolean {
    if (left.length !== right.length) {
        return false;
    }
    for (let i = 0; i < left.length; ++i) {
        const a = left[i];
        const b = right[i];
        if (a.fieldName !== b.fieldName || a.op !== b.op || a.value !== b.value) {
            return false;
        }
    }
    return true;
}

export interface CrossFilterController {
    /// The active cross-filter selection (shared, read from the computation state)
    crossFilters: CrossFilters;
    /// Toggle/update a histogram filter for a column
    histogramFilter: HistogramFilterCallback;
    /// Toggle/update a most-frequent-value filter for a column
    mostFrequentValueFilter: MostFrequentValueFilterCallback;
    /// Request a filtered column aggregation for a column group
    requestFilteredColumnAggregation: (columnId: number) => void;
}

/// Cross-filter controller shared by every view of a table (the result table header
/// plots and the visualization tab's aggregation bar).
///
/// The selection lives on the shared `TableComputationState.crossFilters`, so brushing
/// in any consumer updates the single selection and drives one `filterTable`. The
/// filtering effect below is guarded so that mounting this hook from multiple consumers
/// at once (e.g. the Data and Visualization tabs in split mode) does not schedule
/// duplicate filtering tasks.
export function useCrossFilters(
    computationState: TableComputationState | null,
    dispatchComputation: Dispatch<ComputationAction>,
    gridLayout: DataTableLayout,
): CrossFilterController {
    const crossFilters = computationState?.crossFilters ?? EMPTY_CROSS_FILTERS;
    const tableId = computationState?.tableId ?? null;

    // Keep the callbacks stable by reading layout / column groups / state through refs.
    const gridLayoutRef = React.useRef(gridLayout);
    const columnGroupsRef = React.useRef(computationState?.columnGroups ?? EMPTY_COLUMN_GROUPS);
    const crossFiltersRef = React.useRef(crossFilters);
    const stateRef = React.useRef(computationState);
    gridLayoutRef.current = gridLayout;
    columnGroupsRef.current = computationState?.columnGroups ?? EMPTY_COLUMN_GROUPS;
    crossFiltersRef.current = crossFilters;
    stateRef.current = computationState;

    const histogramFilter: HistogramFilterCallback = React.useCallback((_table: TableAggregation, columnIndex: number, _column: OrdinalColumnAggregation, brush: [number, number] | null) => {
        if (tableId == null) {
            return;
        }
        const columnGroupId = gridLayoutRef.current.columnGroupByColumnIndex[columnIndex];
        const columnGroup = columnGroupsRef.current[columnGroupId];
        if (columnGroup == null || columnGroup.type != ORDINAL_COLUMN) {
            return;
        }
        const current = crossFiltersRef.current;
        if (current.containsHistogramFilter(columnGroupId, brush)) {
            return;
        }
        const cloned = current.clone();
        cloned.addHistogramFilter(columnGroupId, columnGroup.value, brush);
        dispatchComputation({ type: SET_CROSS_FILTERS, value: [tableId, cloned] });
    }, [dispatchComputation, tableId]);

    const mostFrequentValueFilter: MostFrequentValueFilterCallback = React.useCallback((_table: TableAggregation, _columnIndex: number, _column: StringColumnAggregation, _frequentValueId: number | null) => {
        // XXX Implement most-frequent-value filtering with ScalarFilter
    }, []);

    const crossFilterTransforms = React.useMemo(
        () => crossFilters.createFilterTransforms(),
        [crossFilters],
    );

    // Filter the immutable base table whenever cross-filters change.
    // Guarded so concurrent consumers of the shared selection don't double-schedule.
    React.useEffect(() => {
        if (!computationState || !computationState.dataFrame || !computationState.rowNumberColumnName) {
            return;
        }
        // Already reflected by the current filter table?
        const currentFilterFilters = computationState.tasks.filteringTask?.filters;
        const filterUpToDate =
            computationState.filterTable != null
            && computationState.filterTable.version.filterMatches(computationState.version)
            && currentFilterFilters != null
            && scalarFiltersEqual(currentFilterFilters, crossFilterTransforms);
        if (filterUpToDate) {
            return;
        }
        // Empty selection with no active filter table? Nothing to do.
        if (crossFilterTransforms.length === 0 && computationState.filterTable == null) {
            return;
        }
        // A filtering task for exactly these transforms is already running?
        const runningTask = computationState.tasks.filteringTask;
        const hasUpToDateRunningTask =
            runningTask?.progress.status === TaskStatus.TASK_RUNNING
            && runningTask.tableVersion.filterMatches(computationState.version)
            && scalarFiltersEqual(runningTask.filters, crossFilterTransforms);
        if (hasUpToDateRunningTask) {
            return;
        }
        const filteringTask: TableFilteringTask = {
            tableId: computationState.tableId,
            tableVersion: computationState.version,
            inputDataTable: computationState.dataTable,
            inputDataTableFieldIndex: computationState.dataTableFieldsByName,
            inputDataFrame: computationState.dataFrame,
            filters: crossFilterTransforms,
            rowNumberColumnName: computationState.rowNumberColumnName,
        };
        void filterTableDispatched(filteringTask, dispatchComputation);
    }, [
        computationState?.dataFrame,
        computationState?.dataTable,
        computationState?.dataTableFieldsByName,
        computationState?.rowNumberColumnName,
        computationState?.tableId,
        computationState?.version,
        computationState?.filterTable,
        computationState?.tasks.filteringTask,
        crossFilterTransforms,
        dispatchComputation,
    ]);

    const requestFilteredColumnAggregation = React.useCallback((columnId: number) => {
        const state = stateRef.current;
        if (state == null) {
            return;
        }
        const tableAggregation = state.tableAggregation;
        const filterTable = state.filterTable;
        const inputDataFrame = state.dataFrame;
        const columnEntry = state.columnGroups[columnId];
        const unfilteredAggregate = state.columnAggregates[columnId];
        if (tableAggregation == null || filterTable == null || inputDataFrame == null || columnEntry == null || unfilteredAggregate == null) {
            return;
        }

        const currentTask = state.tasks.filteredColumnAggregationTasks[columnId];
        const hasUpToDateRunningTask = currentTask?.progress.status === TaskStatus.TASK_RUNNING
            && currentTask.filterTable.version.filterMatches(filterTable.version);
        if (hasUpToDateRunningTask) {
            return;
        }

        const task: WithFilter<ColumnAggregationTask> = {
            tableId: state.tableId,
            tableVersion: state.version,
            columnId,
            tableAggregate: tableAggregation,
            columnEntry,
            inputDataFrame,
            filterTable,
            unfilteredAggregate,
        };
        void computeFilteredColumnAggregatesDispatched(task, dispatchComputation);
    }, [dispatchComputation]);

    return {
        crossFilters,
        histogramFilter,
        mostFrequentValueFilter,
        requestFilteredColumnAggregation,
    };
}

const EMPTY_CROSS_FILTERS = new CrossFilters();
const EMPTY_COLUMN_GROUPS: TableComputationState['columnGroups'] = [];
