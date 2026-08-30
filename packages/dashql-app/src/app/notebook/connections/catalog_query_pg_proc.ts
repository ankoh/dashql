import * as arrow from "apache-arrow";

import { QueryExecutor } from './query_executor.js';
import { QueryExecutionArgs } from './query_execution_args.js';
import { DynamicConnectionDispatch } from './connection_registry.js';
import { CATALOG_UPDATE_REGISTER_QUERY } from "./connection_state.js";
import { QueryType } from './query_execution_state.js';
import { type FunctionMetadata, generateFunctionsSQL } from './catalog_function_sql_generator.js';

const CATALOG_QUERY_READ_TIMEOUT_MS = 60_000;

export type PgProcTable = arrow.Table<{
    function_schema: arrow.Utf8;
    function_name: arrow.Utf8;
    function_arguments: arrow.Utf8;
    return_type: arrow.Utf8;
    function_kind: arrow.Utf8;
}>;

export function generateCatalogSQLFromPgProc(result: PgProcTable, databaseName: string | null | undefined): string {
    const functions: FunctionMetadata[] = [];

    for (const batch of result.batches) {
        const colSchema = batch.getChild("function_schema")!;
        const colName = batch.getChild("function_name")!;
        const colArgs = batch.getChild("function_arguments")!;
        const colReturn = batch.getChild("return_type")!;
        const colKind = batch.getChild("function_kind")!;

        for (let i = 0; i < batch.numRows; ++i) {
            const schemaName = colSchema.at(i);
            const functionName = colName.at(i);
            const args = (colArgs.at(i) ?? '').trim();
            const returnType = colReturn.at(i);
            const kind = colKind.at(i);

            if (!functionName) {
                continue;
            }
            functions.push({
                schemaName,
                functionName,
                arguments: args ? `args ${args}` : '',
                returnType,
                isAggregate: kind === 'a',
            });
        }
    }

    return generateFunctionsSQL(databaseName, functions);
}

export async function queryPgProc(
    connectionId: string,
    connectionDispatch: DynamicConnectionDispatch,
    updateId: number,
    executor: QueryExecutor,
    abortSignal?: AbortSignal,
): Promise<PgProcTable | null> {
    const query = `
        SELECT
            n.nspname AS function_schema,
            p.proname AS function_name,
            pg_catalog.pg_get_function_arguments(p.oid) AS function_arguments,
            pg_catalog.pg_get_function_result(p.oid) AS return_type,
            p.prokind AS function_kind
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.prokind IN ('f', 'a', 'w', 'p')
        ORDER BY n.nspname, p.proname
    `;

    const args: QueryExecutionArgs = {
        query: query,
        abortSignal,
        readTimeoutMs: CATALOG_QUERY_READ_TIMEOUT_MS,
        throwOnError: true,
        metadata: {
            queryType: QueryType.CATALOG_QUERY_PG_PROC,
            title: "Query Postgres Functions",
            description: null,
            issuer: "Catalog Update",
            userProvided: false
        }
    };
    const [queryId, queryExecution] = executor(connectionId, args);
    connectionDispatch(connectionId, {
        type: CATALOG_UPDATE_REGISTER_QUERY,
        value: [updateId, queryId]
    });

    const queryResult = await queryExecution as PgProcTable;
    return queryResult;
}
