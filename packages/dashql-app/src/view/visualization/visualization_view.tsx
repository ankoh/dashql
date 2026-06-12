import * as React from 'react';
import * as arrow from 'apache-arrow';
import type { TopLevelSpec } from 'vega-lite';

import * as styles from './visualization_view.module.css';
import { QueryExecutionState, QueryExecutionStatus } from '../../connection/query_execution_state.js';

interface Props {
    query: QueryExecutionState | null;
    vegaLiteSpec: TopLevelSpec | null;
}

function arrowTableToRows(table: arrow.Table): Record<string, unknown>[] {
    const rows: Record<string, unknown>[] = [];
    for (const row of table) {
        const obj: Record<string, unknown> = {};
        for (const field of table.schema.fields) {
            const value = (row as any)[field.name];
            // Convert BigInts to numbers for vega compatibility
            if (typeof value === 'bigint') {
                obj[field.name] = Number(value);
            } else if (value instanceof Date) {
                obj[field.name] = value.toISOString();
            } else {
                obj[field.name] = value;
            }
        }
        rows.push(obj);
    }
    return rows;
}

export function VisualizationView(props: Props): React.ReactElement {
    const containerRef = React.useRef<HTMLDivElement | null>(null);
    const [error, setError] = React.useState<string | null>(null);

    const succeeded = props.query?.status === QueryExecutionStatus.SUCCEEDED;
    const resultTable = succeeded ? props.query?.resultTable ?? null : null;
    const spec = props.vegaLiteSpec;

    React.useEffect(() => {
        const el = containerRef.current;
        if (!el || !spec || !resultTable) return;

        let disposed = false;
        let view: { finalize: () => void } | null = null;
        const withData = { ...spec, data: { values: arrowTableToRows(resultTable) } } as TopLevelSpec & { width?: unknown };
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
    }, [spec, resultTable]);

    if (!spec) {
        return <div className={styles.empty}>No visualization available</div>;
    }
    if (!succeeded) {
        return <div className={styles.empty}>Run the query to see the visualization</div>;
    }
    if (!resultTable) {
        return <div className={styles.empty}>Result is empty</div>;
    }

    return (
        <div className={styles.root}>
            {error && <div className={styles.error}>{error}</div>}
            <div ref={containerRef} className={styles.chart} />
        </div>
    );
}
