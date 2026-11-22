import type * as arrow from 'apache-arrow';
import * as React from 'react';

import { useComputation, useComputeReady, useTableComputation } from '@akohn/dashql-react/hooks';
import { useComputationModel } from '@akohn/dashql-react/models/computation_model';
import type { EmbeddedClientContext } from '@akohn/dashql/platform/embedded_database';
import { DataTableView } from '../../results/data_table_view.js';
import { TableColumnHeader } from '@akohn/dashql-react/components/data_table/data_table';

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

/// The result of a query in the data table of query results, e.g. to sort it or to show the SQL of a query. The result
/// of a changed query or a refresh replaces the shown one once it is analyzed and ordered like it, see
/// useTableComputation(). The queries of the computation run with the client context.
export const QueryTable: React.FC<QueryTableProps> = ({ sql, clientContext, runQuery, refreshes = 0 }) => {
    const computeReady = useComputeReady();
    const load = React.useCallback(async () => {
        // A changed refresh count is a new load that runs the query again
        void refreshes;
        return await runQuery(sql);
    }, [sql, runQuery, refreshes]);
    const computation = useTableComputation(computeReady ? load : null, clientContext);
    const model = useComputationModel(useComputation(computation.status === 'ready' ? computation.tableId : null));
    if (model == null) return null;
    return (
        <DataTableView
            model={model}
            columnHeader={TableColumnHeader.OnlyColumnName}
            compact
        />
    );
};
