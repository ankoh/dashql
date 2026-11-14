import { tableFromIPC, type Table } from 'apache-arrow';
import type { HyperDBConnection, QueryInfo, QueryOptions } from 'hyperdb-wasm';

/// What a statement did
export interface StatementResult {
    /// The kind of the statement as Hyper names it, e.g. SELECT, INSERT or CREATE
    readonly kind: string | null;
    /// Whether the statement returns rows, as a query or EXPLAIN do
    readonly producesRows: boolean;
    /// The rows of the result, or the rows that the statement inserted, changed, deleted or copied
    readonly rowCount: bigint | null;
    /// The result, only of statements that return rows
    readonly table: Table | null;
    readonly info: QueryInfo;
}

/// Run any statement. queryIPC() works for statements with and without rows, an empty buffer means no rows, and the
/// info of the query says what the statement was.
export async function runStatement(
    connection: Pick<HyperDBConnection, 'queryIPC'>,
    sql: string,
    options?: QueryOptions,
): Promise<StatementResult> {
    const operation = connection.queryIPC(sql, options);
    // The info rejects as well when the statement fails, the error reaches the caller through the result
    operation.info.catch(() => {});
    const bytes = await operation;
    const info = await operation.info;
    const table = info.producesRows && bytes.byteLength > 0 ? tableFromIPC(bytes) : null;
    return {
        kind: info.statementKind,
        producesRows: info.producesRows,
        rowCount: table != null ? BigInt(table.numRows) : info.rowCount,
        table,
        info,
    };
}
