import * as React from 'react';
import type * as arrow from 'apache-arrow';

import { stringifyError } from '@akohn/dashql/platform/logger/logger';
import { QueryExecutionStatus, type QueryExecutionState } from '@akohn/dashql/platform/query/query_execution_state';
import type { QueryModel } from '../../models/query_model.js';
import { useLogger } from '../../logger.js';
import { CardPlaceholder, QueryStatusPlaceholder } from '../card_placeholder.js';

// A card that shows a result as a whole, e.g. a KPI or a Markdown document, reads a bounded part of it from the compute
// database, never the whole result (docs/wip/result_windows.md).

/// The part of a result that a card reads
export type ResultPart = 'first' | 'last';

/// How far a card is with the rows of a result: its query did not succeed (yet), the rows are being read, the read
/// failed, or the rows are there
export type ResultRowsStatus = 'waiting' | 'reading' | 'failed' | 'ready';

/// The rows that a card read of a result
export interface ResultRows {
    status: ResultRowsStatus;
    /// The rows that were read, in the order of the result, set once the status is ready
    table: arrow.Table | null;
    /// The rows of the whole result
    rows: number;
    /// Why the read failed, set once the status is failed
    error: string | null;
}

const NO_ROWS: ResultRows = { status: 'waiting', table: null, rows: 0, error: null };

/// Read the first or the last rows of the result of a query, at most `limit`, once the query succeeded and its result
/// is analyzed. The filters, the searches and the ordering of its grid don't apply. With `rowNumbers` the row numbers
/// follow the fields, e.g. for the cross filters of a chart. Reads again when the result or its data frame changes.
export function useResultRows(model: QueryModel | null, part: ResultPart, limit: number, rowNumbers: boolean): ResultRows {
    const logger = useLogger();
    const succeeded = model?.query.status === QueryExecutionStatus.SUCCEEDED;
    const computation = succeeded ? model?.computation ?? null : null;
    const rows = model?.query.resultTable?.rows ?? computation?.computation.dataTableRows ?? 0;
    const tableId = computation?.computation.tableId ?? null;
    const dataFrame = computation?.computation.dataFrame ?? null;
    const key = tableId == null || dataFrame == null ? null : `${tableId}:${dataFrame}:${part}:${limit}:${rows}:${rowNumbers}`;
    const [state, setState] = React.useState<{ key: string; table: arrow.Table | null; error: string | null } | null>(null);
    // The latest read of the model, its identity changes with every change of the computation
    const previewRows = React.useRef(computation?.previewRows);
    previewRows.current = computation?.previewRows;

    React.useEffect(() => {
        const read = previewRows.current;
        if (key == null || read == null) return;
        let current = true;
        const offset = part === 'last' ? Math.max(0, rows - limit) : 0;
        read(offset, limit, rowNumbers).then(
            table => {
                if (current) setState({ key, table, error: null });
            },
            (error: unknown) => {
                if (!current) return;
                logger.warn('Failed to read the rows of a result', { error: stringifyError(error) }, 'result_rows');
                setState({ key, table: null, error: stringifyError(error) });
            },
        );
        return () => {
            current = false;
        };
    }, [key, part, limit, rows, rowNumbers, logger]);

    if (!succeeded) return NO_ROWS;
    const read = state != null && state.key === key ? state : null;
    if (read == null) return { status: 'reading', table: null, rows, error: null };
    if (read.table == null) return { status: 'failed', table: null, rows, error: read.error };
    return { status: 'ready', table: read.table, rows, error: null };
}

/// The placeholder of a card without its rows: what its query does, the faint logo while the rows are read, or why
/// the read failed
export function ResultRowsPlaceholder(props: { query: QueryExecutionState | null; rows: ResultRows }): React.ReactElement {
    switch (props.rows.status) {
        case 'waiting':
            return <QueryStatusPlaceholder query={props.query} />;
        case 'failed':
            return <CardPlaceholder message={`Failed to read the rows: ${props.rows.error}`} />;
        default:
            return <CardPlaceholder />;
    }
}
