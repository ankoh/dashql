import * as React from 'react';
import type * as arrow from 'apache-arrow';

import type { Runtime } from '@akohn/dashql/runtime/runtime';
import { QueryExecutionStatus, type QueryExecutionState } from '@akohn/dashql/platform/query/query_execution_state';
import { RuntimeContextProvider, useOptionalRuntime } from '../runtime/runtime_hooks.js';

/// The Arrow tables of the results of the tests, by their handle
const TABLES = new Map<number, arrow.Table>();
/// Far from the handles of a runtime above
let NEXT_HANDLE = 1_000_000;

/// A runtime that holds only the tables of the results, for views that read the result of a query
const RESULT_TABLE_RUNTIME = {
    table: (handle: number | null | undefined) => (handle == null ? undefined : TABLES.get(handle)),
} as unknown as Runtime;

/// The result of a query as its view holds it, a handle of the table. `WithResultTables` lets the views read it.
export function resultTableOf(table: arrow.Table): { id: number; rows: number };
export function resultTableOf(table: arrow.Table | null): { id: number; rows: number } | null;
export function resultTableOf(table: arrow.Table | null): { id: number; rows: number } | null {
    if (table == null) return null;
    const id = NEXT_HANDLE++;
    TABLES.set(id, table);
    return { id, rows: table.numRows };
}

/// A succeeded query with a table as its result, `WithResultTables` lets the views read it
export function succeededQuery(table: arrow.Table, queryId: number = 1): QueryExecutionState {
    return {
        queryId,
        status: QueryExecutionStatus.SUCCEEDED,
        resultTable: resultTableOf(table),
    } as unknown as QueryExecutionState;
}

/// The views below read the results of the queries of `succeededQuery` and `resultTableOf`. Below a runtime, they
/// read everything else from that runtime.
export function WithResultTables(props: { children: React.ReactNode }) {
    const above = useOptionalRuntime();
    const runtime = React.useMemo(() => {
        if (above == null) return RESULT_TABLE_RUNTIME;
        const table = (handle: number | null | undefined) => (handle == null ? undefined : TABLES.get(handle)) ?? above.table(handle);
        return new Proxy(above, {
            get: (target, key) => {
                if (key === 'table') return table;
                const value = Reflect.get(target, key, target);
                return typeof value === 'function' ? value.bind(target) : value;
            },
        });
    }, [above]);
    return <RuntimeContextProvider value={runtime}>{props.children}</RuntimeContextProvider>;
}
