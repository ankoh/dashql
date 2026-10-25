import type * as arrow from 'apache-arrow';
import * as React from 'react';

import { analyzeTable } from '../../../compute/analyze_table.js';
import { useComputationDispatch, useComputationRegistry, useComputationStore } from '../../../compute/computation_registry.js';
import { DELETE_COMPUTATION } from '../../../compute/computation_state.js';
import { scheduleTask } from '../../../compute/computation_tasks.js';
import { TABLE_ORDERING_TASK } from '../../../compute/computation_types.js';
import { useComputeDatabase } from '../../../compute/compute_connection_provider.js';
import type { EmbeddedClientContext } from '../../../platform/database/embedded_database.js';
import { stringifyError } from '../../../platform/logger/logger.js';
import { useLogger } from '../../../platform/logger/logger_provider.js';
import { allocateQueryId } from '../../../query/tracked_query_execution.js';
import { DataTable } from '../../session/compute/ui/query_result/data_table.js';
import { TableColumnHeader } from '../../session/compute/ui/query_result/data_table_cell.js';
import { createOrderingTask } from '../../session/compute/ui/query_result/data_table_ordering.js';

const LOG_CTX = 'connection_overview';

/// Run a query in the compute database and register its analyzed result as a computation, for the data table.
/// The queries of the computation run with the client context. The table shows no column plots, the analysis skips
/// the column aggregates.
/// The result of a changed query replaces the computation of the previous one once it is analyzed and ordered like
/// the previous one, so that the table never shows a result that is still being analyzed. A query that changes while
/// another one runs runs next, the queries in between are skipped. A changed refresh count runs the query again.
/// Returns the id of the computation, null until the first result.
function useQueryComputation(
    sql: string,
    runQuery: (sql: string) => Promise<arrow.Table>,
    clientContext: EmbeddedClientContext | null,
    refreshes: number,
): number | null {
    const dispatch = useComputationDispatch();
    const computations = useComputationStore();
    const database = useComputeDatabase();
    const logger = useLogger();
    const [tableId, setTableId] = React.useState<number | null>(null);
    const state = React.useRef({
        /// The shown computation
        shown: null as number | null,
        /// The run of the newest query that did not start yet
        next: null as (() => Promise<void>) | null,
        /// Is a run pending or running?
        pumping: false,
        unmounted: false,
    });

    // Delete the shown computation with the table
    React.useEffect(() => {
        const current = state.current;
        current.unmounted = false;
        return () => {
            current.unmounted = true;
            if (current.shown != null) dispatch({ type: DELETE_COMPUTATION, value: [current.shown] });
            current.shown = null;
        };
    }, [dispatch]);

    React.useEffect(() => {
        if (database == null) return;
        const current = state.current;
        current.next = async () => {
            const table = await runQuery(sql);
            const id = allocateQueryId();
            try {
                // The table has no connection, the client context attributes the queries of its computation
                await analyzeTable(id, table, dispatch, database, logger, undefined, null, { clientContext, columnAggregates: false });
                const previous = current.shown;
                const ordering = previous == null ? [] : computations.current.tableComputations[previous]?.dataTableOrdering ?? [];
                const fields = new Set(table.schema.fields.map(field => field.name));
                if (ordering.length > 0 && ordering.every(constraint => fields.has(constraint.field))) {
                    const task = createOrderingTask(computations.current.tableComputations[id], ordering);
                    if (task != null) await scheduleTask(TABLE_ORDERING_TASK, task, dispatch);
                }
            } catch (e) {
                dispatch({ type: DELETE_COMPUTATION, value: [id] });
                throw e;
            }
            if (current.unmounted) {
                dispatch({ type: DELETE_COMPUTATION, value: [id] });
                return;
            }
            const previous = current.shown;
            current.shown = id;
            setTableId(id);
            if (previous != null) dispatch({ type: DELETE_COMPUTATION, value: [previous] });
        };
        if (current.pumping) return;
        // Run the newest query, one run after another
        current.pumping = true;
        void (async () => {
            while (current.next != null && !current.unmounted) {
                const run = current.next;
                current.next = null;
                await run().catch(e => {
                    logger.warn('Failed to query a table of the connection overview', { error: stringifyError(e) }, LOG_CTX);
                });
            }
            current.pumping = false;
        })();
    }, [sql, refreshes, runQuery, clientContext, database, dispatch, computations, logger]);
    return tableId;
}

export interface QueryTableProps {
    /// The query of the table, a changed query runs again
    sql: string;
    /// The client context of the query, e.g. to attribute it to a connection in the Hyper log
    clientContext: EmbeddedClientContext | null;
    /// Run the query of the table, e.g. on the reader of the monitoring database of a connection
    runQuery: (sql: string) => Promise<arrow.Table>;
    /// The refreshes of the table by the user, a changed count runs the query again
    refreshes?: number;
}

/// The result of a query in the data table of query results, e.g. to sort it or to show the SQL of a query
export const QueryTable: React.FC<QueryTableProps> = ({ sql, clientContext, runQuery, refreshes = 0 }) => {
    const [computations, dispatch] = useComputationRegistry();
    const tableId = useQueryComputation(sql, runQuery, clientContext, refreshes);
    const computation = tableId == null ? null : computations.tableComputations[tableId] ?? null;
    if (computation == null) return null;
    return (
        <DataTable
            table={computation}
            dispatchComputation={dispatch}
            debugMode={false}
            columnHeader={TableColumnHeader.OnlyColumnName}
            compact
        />
    );
};
