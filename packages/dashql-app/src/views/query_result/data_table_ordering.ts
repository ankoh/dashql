import type * as arrow from 'apache-arrow';
import * as React from 'react';

import type { OrderByConstraint, TableComputationState } from '@ankoh/dashql-platform/compute/computation_types';
import type { ComputationDispatch } from './use_cross_filters.js';

export function getColumnSortDirection(field: string, ordering: OrderByConstraint[]): boolean | null {
    if (ordering.length !== 1 || ordering[0].field !== field) return null;
    return ordering[0].ascending ?? true;
}

export function getNextColumnSortDirection(field: string, ordering: OrderByConstraint[]): boolean | null {
    const currentDirection = getColumnSortDirection(field, ordering);
    if (currentDirection == null) return true;
    return currentDirection ? false : null;
}

/// The ordering of a table: a click on a column orders by it ascending, then descending, then not. The runtime orders
/// the rows, and orders them again when the filter or the data search changes.
export function useDataTableOrdering(
    table: TableComputationState,
    dataTable: arrow.Table,
    dispatchComputation: ComputationDispatch,
) {
    const activeOrderingConstraints = React.useMemo<OrderByConstraint[]>(() => {
        const taskOrdering = table.tasks.orderingTask?.orderingConstraints;
        return taskOrdering != null && taskOrdering.length > 0 ? taskOrdering : table.dataTableOrdering;
    }, [table.dataTableOrdering, table.tasks.orderingTask?.orderingConstraints]);

    const orderByColumn = React.useCallback((fieldId: number) => {
        const fieldName = dataTable.schema.fields[fieldId].name;
        const nextSortDirection = getNextColumnSortDirection(fieldName, activeOrderingConstraints);
        const constraints = nextSortDirection == null ? [] : [{ field: fieldName, ascending: nextSortDirection, nullsFirst: false }];
        dispatchComputation({ kind: 'orderBy', value: { constraints } });
    }, [activeOrderingConstraints, dataTable, dispatchComputation]);

    const getSortDirection = React.useCallback((fieldId: number) => {
        const fieldName = dataTable.schema.fields[fieldId].name;
        return getColumnSortDirection(fieldName, activeOrderingConstraints);
    }, [activeOrderingConstraints, dataTable.schema.fields]);

    return { orderByColumn, getSortDirection };
}
