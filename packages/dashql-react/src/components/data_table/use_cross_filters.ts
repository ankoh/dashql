import * as React from 'react';
import type * as core from '@akohn/dashql';

import type { ComputationView } from '@akohn/dashql';
import { ORDINAL_COLUMN, STRING_COLUMN, type OrdinalColumnAggregation, type StringColumnAggregation, type TableAggregation } from '@akohn/dashql/platform/compute/computation_types';
import { HistogramFilterCallback } from './histogram_cell.js';
import { MostFrequentValueFilterCallback } from './mostfrequent_cell.js';
import { DataTableLayout } from './data_table_layout.js';

/// Dispatch an action to the computation of the table
export type ComputationDispatch = (action: core.ComputationAction) => core.DispatchOutcome;

export interface CrossFilterController {
    /// The selections in the summaries of the column groups (shared, read from the computation)
    crossFilters: core.ComputationCrossFilter[];
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
/// The selection lives in the computation of the runtime, so brushing in any consumer updates the single selection.
/// The runtime filters the rows, orders them again and summarizes the columns over the selected rows; a request that
/// the computation already answers or that a running task answers runs nothing, consumers may ask at the same time.
export function useCrossFilters(
    computationState: ComputationView | null,
    dispatchComputation: ComputationDispatch,
    gridLayout: DataTableLayout,
): CrossFilterController {
    const crossFilters = computationState?.crossFilters ?? EMPTY_CROSS_FILTERS;

    // Keep the callbacks stable by reading layout / column groups through refs.
    const gridLayoutRef = React.useRef(gridLayout);
    const columnGroupsRef = React.useRef(computationState?.columnGroups ?? EMPTY_COLUMN_GROUPS);
    gridLayoutRef.current = gridLayout;
    columnGroupsRef.current = computationState?.columnGroups ?? EMPTY_COLUMN_GROUPS;

    const histogramFilter: HistogramFilterCallback = React.useCallback((_table: TableAggregation, columnIndex: number, _column: OrdinalColumnAggregation, brush: [number, number] | null) => {
        const columnGroupId = gridLayoutRef.current.columnGroupByColumnIndex[columnIndex];
        if (columnGroupsRef.current[columnGroupId]?.type !== ORDINAL_COLUMN) {
            return;
        }
        dispatchComputation({ kind: 'histogramFilter', value: { columnGroup: columnGroupId, selection: brush } });
    }, [dispatchComputation]);

    const mostFrequentValueFilter: MostFrequentValueFilterCallback = React.useCallback((_table: TableAggregation, columnIndex: number, _column: StringColumnAggregation, frequentValueId: number | null) => {
        const columnGroupId = gridLayoutRef.current.columnGroupByColumnIndex[columnIndex];
        const columnGroup = columnGroupsRef.current[columnGroupId];
        if (columnGroup?.type !== STRING_COLUMN || columnGroup.value.valueIdFieldName == null) {
            return;
        }
        // Selecting the selected value again clears the selection
        dispatchComputation({ kind: 'mostFrequentValueFilter', value: { columnGroup: columnGroupId, valueId: frequentValueId } });
    }, [dispatchComputation]);

    const requestFilteredColumnAggregation = React.useCallback((columnId: number) => {
        dispatchComputation({ kind: 'requestFilteredColumnAggregation', value: { columnGroup: columnId } });
    }, [dispatchComputation]);

    return {
        crossFilters,
        histogramFilter,
        mostFrequentValueFilter,
        requestFilteredColumnAggregation,
    };
}

/// The selection of a column group, null without one
export function crossFilterOf(crossFilters: core.ComputationCrossFilter[], columnGroup: number): core.ComputationCrossFilter | null {
    return crossFilters.find(filter => filter.column === columnGroup) ?? null;
}

const EMPTY_CROSS_FILTERS: core.ComputationCrossFilter[] = [];
const EMPTY_COLUMN_GROUPS: ComputationView['columnGroups'] = [];
