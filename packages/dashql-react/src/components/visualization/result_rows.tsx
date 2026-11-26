import * as React from 'react';
import type * as arrow from 'apache-arrow';

import { stringifyError } from '@akohn/dashql/platform/logger/logger';
import { QueryExecutionStatus } from '@akohn/dashql/platform/query/query_execution_state';
import type { QueryModel } from '../../models/query_model.js';
import { useLogger } from '../../logger.js';

// A card that shows a result as a whole, e.g. a KPI or a Markdown document, reads a bounded part of it from the compute
// database, never the whole result (docs/wip/result_windows.md).

/// The part of a result that a card reads
export type ResultPart = 'first' | 'last';

/// The rows that a card read of a result
export interface ResultRows {
    /// The rows that were read, in the order of the result, null while they are read or when the read failed
    table: arrow.Table | null;
    /// The rows of the whole result
    rows: number;
    /// Are the rows being read?
    reading: boolean;
}

const NO_ROWS: ResultRows = { table: null, rows: 0, reading: false };

/// Read the first or the last rows of the result of a query, at most `limit`, once the query succeeded and its result
/// is analyzed. The filters, the searches and the ordering of its grid don't apply. Reads again when the result or its
/// data frame changes.
export function useResultRows(model: QueryModel | null, part: ResultPart, limit: number): ResultRows {
    const logger = useLogger();
    const succeeded = model?.query.status === QueryExecutionStatus.SUCCEEDED;
    const computation = succeeded ? model?.computation ?? null : null;
    const rows = model?.query.resultTable?.rows ?? computation?.computation.dataTableRows ?? 0;
    const tableId = computation?.computation.tableId ?? null;
    const dataFrame = computation?.computation.dataFrame ?? null;
    const key = tableId == null || dataFrame == null ? null : `${tableId}:${dataFrame}:${part}:${limit}:${rows}`;
    const [state, setState] = React.useState<{ key: string; table: arrow.Table | null } | null>(null);
    // The latest read of the model, its identity changes with every change of the computation
    const previewRows = React.useRef(computation?.previewRows);
    previewRows.current = computation?.previewRows;

    React.useEffect(() => {
        const read = previewRows.current;
        if (key == null || read == null) return;
        let current = true;
        const offset = part === 'last' ? Math.max(0, rows - limit) : 0;
        read(offset, limit).then(
            table => {
                if (current) setState({ key, table });
            },
            (error: unknown) => {
                if (!current) return;
                logger.warn('Failed to read the rows of a result', { error: stringifyError(error) }, 'result_rows');
                setState({ key, table: null });
            },
        );
        return () => {
            current = false;
        };
    }, [key, part, limit, rows, logger]);

    if (!succeeded) return NO_ROWS;
    const read = state != null && state.key === key ? state : null;
    return { table: read?.table ?? null, rows, reading: read == null };
}
