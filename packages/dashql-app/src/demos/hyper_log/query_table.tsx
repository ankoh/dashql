import type * as arrow from 'apache-arrow';
import * as React from 'react';

import { useComputation, useComputeReady, useRuntime } from '@akohn/dashql-react/hooks';
import { useComputationModel } from '@akohn/dashql-react/models/computation_model';
import type { EmbeddedClientContext } from '@akohn/dashql/platform/embedded_database';
import { stringifyError } from '@akohn/dashql/platform/logger/logger';
import { useLogger } from '../../host/logger_provider.js';
import { DataTableView } from '../../results/data_table_view.js';
import { TableColumnHeader } from '@akohn/dashql-react/components/data_table/data_table';

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
    const runtime = useRuntime();
    const computeReady = useComputeReady();
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
            if (current.shown != null) runtime.dispatch({ computation: current.shown }, { kind: 'deleteComputation' });
            current.shown = null;
        };
    }, [runtime]);

    React.useEffect(() => {
        if (!computeReady) return;
        const current = state.current;
        current.next = async () => {
            const table = await runQuery(sql);
            const id = runtime.allocateId();
            try {
                // The table has no connection, the client context attributes the queries of its computation. It is
                // ordered like the previous one, an ordering of fields that the table doesn't have is skipped.
                const previous = current.shown;
                const ordering = previous == null ? [] : runtime.store.get('computation', previous)?.dataTableOrdering ?? [];
                await runtime.analyzeTable(id, table, { clientContext, columnAggregates: false, ordering });
            } catch (e) {
                runtime.dispatch({ computation: id }, { kind: 'deleteComputation' });
                throw e;
            }
            if (current.unmounted) {
                runtime.dispatch({ computation: id }, { kind: 'deleteComputation' });
                return;
            }
            const previous = current.shown;
            current.shown = id;
            setTableId(id);
            if (previous != null) runtime.dispatch({ computation: previous }, { kind: 'deleteComputation' });
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
    }, [sql, refreshes, runQuery, clientContext, computeReady, runtime, logger]);
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
    const tableId = useQueryComputation(sql, runQuery, clientContext, refreshes);
    const model = useComputationModel(useComputation(tableId));
    if (model == null) return null;
    return (
        <DataTableView
            model={model}
            columnHeader={TableColumnHeader.OnlyColumnName}
            compact
        />
    );
};
