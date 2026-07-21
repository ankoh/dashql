import * as React from 'react';
import * as arrow from 'apache-arrow';
import type { TopLevelSpec } from 'vega-lite';

import * as styles from './visualization.module.css';
import { QueryExecutionState, QueryExecutionStatus } from '../../connection/query_execution_state.js';
import { useComputationRegistry } from '../../compute/computation_registry.js';
import { resolveVisibleRowIndices } from '../query_result/visible_rows.js';

interface Props {
    query: QueryExecutionState | null;
    vegaLiteSpec: TopLevelSpec | null;
}

/// Convert an arrow row object to a vega-compatible plain object.
function arrowRowToObject(row: any, fields: readonly arrow.Field[]): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    for (const field of fields) {
        const value = row[field.name];
        // Convert BigInts to numbers for vega compatibility
        if (typeof value === 'bigint') {
            obj[field.name] = Number(value);
        } else if (value instanceof Date) {
            obj[field.name] = value.toISOString();
        } else {
            obj[field.name] = value;
        }
    }
    return obj;
}

function arrowTableToRows(table: arrow.Table): Record<string, unknown>[] {
    const rows: Record<string, unknown>[] = [];
    for (const row of table) {
        rows.push(arrowRowToObject(row, table.schema.fields));
    }
    return rows;
}

/// Gather only the visible rows (by 0-based index into the table) as vega objects.
function arrowRowsAtIndices(table: arrow.Table, indices: Int32Array): Record<string, unknown>[] {
    const rows: Record<string, unknown>[] = [];
    const fields = table.schema.fields;
    for (let i = 0; i < indices.length; ++i) {
        const row = table.get(indices[i]);
        if (row == null) continue;
        rows.push(arrowRowToObject(row, fields));
    }
    return rows;
}

export function VegaLiteView(props: Props): React.ReactElement {
    const containerRef = React.useRef<HTMLDivElement | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const [computationState] = useComputationRegistry();

    const succeeded = props.query?.status === QueryExecutionStatus.SUCCEEDED;
    const spec = props.vegaLiteSpec;
    const queryId = props.query?.queryId ?? null;

    // Prefer the analyzed data table (it carries the cross-filter row-id indirection); fall back
    // to the raw result table when there is no computation registered. The analyzed table is a
    // superset of the result columns (system / umap columns are ignored by the spec).
    const tableComputation = queryId != null ? computationState.tableComputations[queryId] ?? null : null;
    const dataTable = tableComputation?.dataTable ?? (succeeded ? props.query?.resultTable ?? null : null);

    // Re-embed whenever the active cross-filter / ordering changes.
    const filterTable = tableComputation?.filterTable ?? null;
    const orderingTable = tableComputation?.orderingTable ?? null;
    const rows = React.useMemo<Record<string, unknown>[] | null>(() => {
        if (!succeeded || !dataTable) return null;
        const visibleRows = resolveVisibleRowIndices(tableComputation);
        return visibleRows != null ? arrowRowsAtIndices(dataTable, visibleRows) : arrowTableToRows(dataTable);
    }, [succeeded, dataTable, tableComputation, filterTable, orderingTable]);

    React.useEffect(() => {
        const el = containerRef.current;
        if (!el || !spec || !rows) return;

        let disposed = false;
        let view: { finalize: () => void } | null = null;
        const withData = { ...spec, data: { values: rows } } as TopLevelSpec & { width?: unknown };
        // Always grow to container width
        if (withData.width === undefined) withData.width = 'container';
        // Lazy-load vega-embed (and vega-interpreter, which avoids the
        // CSP-violating `Function()` eval that vega's default expression
        // compiler does) to keep them out of the import graph for non-vis paths.
        Promise.all([import('vega-embed'), import('vega-interpreter')]).then(([embed, interp]) => {
            if (disposed) return;
            // `ast: true` makes vega parse expressions to an AST and gates the
            // `expr` option on, so vega-interpreter actually replaces the
            // default `new Function()` evaluator (which CSP forbids).
            return embed.default(el, withData, {
                actions: false,
                renderer: 'canvas',
                ast: true,
                expr: interp.expressionInterpreter,
                config: { background: 'transparent' },
            });
        }).then(result => {
            if (!result) return;
            if (disposed) {
                result.view.finalize();
                return;
            }
            view = result.view as unknown as { finalize: () => void };
            setError(null);
        }).catch((e: unknown) => {
            setError(e instanceof Error ? e.message : String(e));
        });
        return () => {
            disposed = true;
            if (view) view.finalize();
            if (el) el.replaceChildren();
        };
    }, [spec, rows]);

    if (!spec) {
        return <div className={styles.empty}>No visualization available</div>;
    }
    if (!succeeded) {
        return <div className={styles.empty}>Run the query to see the visualization</div>;
    }
    if (!dataTable) {
        return <div className={styles.empty}>Result is empty</div>;
    }

    return (
        <div className={styles.root}>
            {error && <div className={styles.error}>{error}</div>}
            <div ref={containerRef} className={styles.chart} />
        </div>
    );
}
