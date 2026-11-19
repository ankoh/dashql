import * as React from 'react';

import { QueryExecutionStatus, type QueryExecutionState } from '@akohn/dashql/platform/query/query_execution_state';
import { useComputation } from '@akohn/dashql-react/hooks';
import { useComputationModel } from '@akohn/dashql-react/models/computation_model';
import { TableSearchToolbar, useResultRowCounts, type ResultRowCounts } from '@akohn/dashql-react/components/query_result/query_result_toolbar';

// The search of the result of a query and its row counts over the computation of the result in the runtime, see
// TableSearchToolbar and useResultRowCounts of @akohn/dashql-react

interface Props {
    query: QueryExecutionState;
    children?: React.ReactNode;
}

/// The column and data search of the result of a query
export function QueryResultToolbar(props: Props): React.ReactNode {
    const computation = useComputationModel(useComputation(props.query.queryId));
    return <TableSearchToolbar computation={computation}>{props.children}</TableSearchToolbar>;
}

/// The rows of the result of a query
export function useQueryResultRowCounts(query: QueryExecutionState | null): ResultRowCounts {
    return useResultRowCounts(useComputationModel(useComputation(query?.queryId)));
}

/// Whether the query produced a materialized result, and its total row count. Shared so the footer's
/// preview and the Details tabs derive the "N rows" detail identically.
export function useResultRowCount(queryState: QueryExecutionState | null): { hasResult: boolean; totalRows: number | null } {
    const computation = useComputation(queryState?.queryId);
    const hasResult = queryState != null
        && queryState.status === QueryExecutionStatus.SUCCEEDED
        && computation != null;
    const totalRows = hasResult ? (computation?.dataTableRows ?? null) : null;
    return { hasResult, totalRows };
}
