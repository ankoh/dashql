import * as arrow from "apache-arrow";

import { QueryExecutor } from '../query_executor.js';
import { QueryExecutionArgs } from '../query_execution_args.js';
import { DynamicConnectionDispatch } from '../connection_registry.js';
import { CATALOG_UPDATE_REGISTER_QUERY } from "../connection_state.js";
import { QueryType } from '../../query/query_execution_state.js';
import { catalogTablesOfSchema, quoteIdentifier, relationFilter, type CatalogTable, type ColumnMetadata, type RelationName } from './catalog_sql_generator.js';

const LOG_CTX = "catalog_pg";
export const CATALOG_QUERY_READ_TIMEOUT_MS = 60_000;

export type PgAttributeColumnsTable = arrow.Table<{
    table_schema: arrow.Utf8;
    table_name: arrow.Utf8;
    column_name: arrow.Utf8;
    ordinal_position: arrow.Int32;
    data_type: arrow.Utf8;
    is_nullable: arrow.Utf8;
    numeric_precision: arrow.Int32;
    numeric_scale: arrow.Int32;
}>;

/**
 * The tables of pg_attribute query results.
 * Builds a hierarchy of schema -> table -> columns.
 */
export function catalogTablesFromPgAttribute(result: PgAttributeColumnsTable, databaseName: string): CatalogTable[] {
    // Build hierarchy: schema -> table -> columns
    const schemas = new Map<string, Map<string, ColumnMetadata[]>>();

    for (const batch of result.batches) {
        const colTableSchema = batch.getChild("table_schema")!;
        const colTableName = batch.getChild("table_name")!;
        const colColumnName = batch.getChild("column_name")!;
        const colOrdinalPos = batch.getChild("ordinal_position")!;
        const colDataType = batch.getChild("data_type")!;

        // Iterate over all rows in the batch
        for (let i = 0; i < batch.numRows; ++i) {
            const tableSchema = colTableSchema.at(i);
            const tableName = colTableName.at(i);
            const columnName = colColumnName.at(i);
            const ordinalPosition = colOrdinalPos.at(i);
            const dataType = colDataType.at(i);

            if (!tableSchema || !columnName || !tableName) {
                continue;
            }

            // Get or create schema entry
            let tableMap = schemas.get(tableSchema);
            if (!tableMap) {
                tableMap = new Map<string, ColumnMetadata[]>();
                schemas.set(tableSchema, tableMap);
            }

            // Get or create table entry
            let columns = tableMap.get(tableName);
            if (!columns) {
                columns = [];
                tableMap.set(tableName, columns);
            }

            // Add column metadata
            columns.push({
                name: columnName,
                ordinalPosition: ordinalPosition ?? columns.length,
                dataType: dataType ?? null,
            });
        }
    }

    return [...schemas].flatMap(([schemaName, tables]) => catalogTablesOfSchema(databaseName, schemaName, tables));
}

/// What a query of pg_attribute reads
export interface PgAttributeScope {
    /// The database to read the catalog of, the default database if absent
    queryDatabaseName?: string | null;
    /// The schemas, all schemas if empty
    schemaNames?: string[];
    /// The relations, all relations if absent
    relations?: RelationName[] | null;
    /// Leave out the schemas of the database system?
    userSchemasOnly?: boolean;
}

/// The query of the columns of relations
export function pgAttributeQuery(scope: PgAttributeScope = {}): string {
    const pgCatalog = scope.queryDatabaseName == null
        ? 'pg_catalog'
        : `${quoteIdentifier(scope.queryDatabaseName)}.${quoteIdentifier('pg_catalog')}`;
    const schemaNames = scope.schemaNames ?? [];
    const schemaFilter = schemaNames.length > 0
        ? `AND n.nspname IN (${schemaNames.map(name => `'${name.replace(/'/g, "''")}'`).join(', ')})`
        : '';
    const relationsFilter = scope.relations != null ? `AND ${relationFilter('n.nspname', 'c.relname', scope.relations)}` : '';
    const systemFilter = scope.userSchemasOnly ? `AND n.nspname NOT IN ('pg_catalog', 'information_schema')` : '';
    return `
        SELECT
            n.nspname AS table_schema,
            c.relname AS table_name,
            a.attname AS column_name,
            a.attnum AS ordinal_position,
            t.typname AS data_type,
            CASE
                WHEN a.attnotnull THEN 'NO'
                ELSE 'YES'
            END AS is_nullable,
            CASE
                WHEN a.atttypid = ANY (ARRAY[21, 23, 20]) THEN a.atttypmod - 4
                WHEN a.atttypid = 1700 THEN ((a.atttypmod - 4) >> 16) & 65535
                ELSE NULL
            END AS numeric_precision,
            CASE
                WHEN a.atttypid = 1700 THEN (a.atttypmod - 4) & 65535
                ELSE NULL
            END AS numeric_scale
        FROM ${pgCatalog}.pg_class c
        JOIN ${pgCatalog}.pg_namespace n ON n.oid = c.relnamespace
        JOIN ${pgCatalog}.pg_attribute a ON a.attrelid = c.oid
        JOIN ${pgCatalog}.pg_type t ON t.oid = a.atttypid
        LEFT JOIN ${pgCatalog}.pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
        WHERE c.relkind IN ('r', 'v', 'm', 'f', 'p')
          AND a.attnum > 0
          AND NOT a.attisdropped
        ${schemaFilter}
        ${relationsFilter}
        ${systemFilter}
        ORDER BY n.nspname, c.relname, a.attnum
    `;
}

export async function queryPgAttribute(
    connectionId: string,
    connectionDispatch: DynamicConnectionDispatch,
    updateId: number,
    databaseName: string,
    schemaNames: string[],
    executor: QueryExecutor,
    queryDatabaseName: string | null = null,
    abortSignal?: AbortSignal,
    relations: RelationName[] | null = null,
): Promise<PgAttributeColumnsTable | null> {
    const query = pgAttributeQuery({ queryDatabaseName, schemaNames, relations });

    const args: QueryExecutionArgs = {
        query: query,
        abortSignal,
        readTimeoutMs: CATALOG_QUERY_READ_TIMEOUT_MS,
        throwOnError: true,
        metadata: {
            queryType: QueryType.CATALOG_QUERY_PG_ATTRIBUTE,
            title: "Query Postgres Schema Columns",
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

    const queryResult = await queryExecution as PgAttributeColumnsTable;
    return queryResult;
}
