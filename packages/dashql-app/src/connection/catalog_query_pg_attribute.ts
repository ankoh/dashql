import * as arrow from "apache-arrow";
import * as dashql from '../core/index.js';

import { QueryExecutor } from './query_executor.js';
import { QueryExecutionArgs } from './query_execution_args.js';
import { DynamicConnectionDispatch } from './connection_registry.js';
import { CATALOG_UPDATE_LOAD_DESCRIPTORS, CATALOG_UPDATE_REGISTER_QUERY, SET_CATALOG_SCRIPT } from "./connection_state.js";
import { QueryType } from './query_execution_state.js';
import { CATALOG_DEFAULT_DESCRIPTOR_POOL_RANK } from "./catalog_update_state.js";
import { generateSchemaSQL, type ColumnMetadata } from './catalog_sql_generator.js';

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
 * Generates SQL DDL from pg_attribute query results.
 * Builds a hierarchy of schema -> table -> columns and generates CREATE TABLE statements.
 */
function generateCatalogSQLFromPgAttribute(result: PgAttributeColumnsTable, databaseName: string): string {
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

    // Generate SQL for all schemas
    const sqlStatements: string[] = [];
    for (const [schemaName, schemaTables] of schemas) {
        const sql = generateSchemaSQL(databaseName, schemaName, schemaTables);
        if (sql.length > 0) {
            sqlStatements.push(sql);
        }
    }

    return sqlStatements.join('\n\n');
}

export async function queryPgAttribute(
    sessionId: string,
    connectionDispatch: DynamicConnectionDispatch,
    updateId: number,
    databaseName: string,
    schemaNames: string[],
    executor: QueryExecutor
): Promise<PgAttributeColumnsTable | null> {
    const query = `
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
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid
        JOIN pg_type t ON t.oid = a.atttypid
        LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
        WHERE c.relkind IN ('r', 'v', 'm', 'f', 'p')
          AND a.attnum > 0
          AND NOT a.attisdropped
        ${schemaNames.length > 0 ? `AND n.nspname IN ('${schemaNames.join("','")}')` : ''}
        ORDER BY n.nspname, c.relname, a.attnum
    `;

    const args: QueryExecutionArgs = {
        query: query,
        metadata: {
            queryType: QueryType.CATALOG_QUERY_PG_ATTRIBUTE,
            title: "Query Postgres Schema Columns",
            description: null,
            issuer: "Catalog Update",
            userProvided: false
        }
    };
    const [queryId, queryExecution] = executor(sessionId, args);
    connectionDispatch(sessionId, {
        type: CATALOG_UPDATE_REGISTER_QUERY,
        value: [updateId, queryId]
    });

    const queryResult = await queryExecution as PgAttributeColumnsTable;
    return queryResult;
}

export async function updatePgAttributeSchemaCatalog(
    sessionId: string,
    connectionDispatch: DynamicConnectionDispatch,
    updateId: number,
    databaseName: string,
    schemaNames: string[],
    executor: QueryExecutor,
    catalog: dashql.DashQLCatalog,
    dql: dashql.DashQL,
    catalogScript: dashql.DashQLScript
): Promise<void> {
    // Query pg_attribute
    const queryResult = await queryPgAttribute(sessionId, connectionDispatch, updateId, databaseName, schemaNames, executor);
    if (queryResult == null) {
        return;
    }

    // Mark loading started
    connectionDispatch(sessionId, {
        type: CATALOG_UPDATE_LOAD_DESCRIPTORS,
        value: [updateId]
    });

    // Generate SQL from query results
    const catalogSQL = generateCatalogSQLFromPgAttribute(queryResult, databaseName);

    // Update script content
    catalogScript.replaceText(catalogSQL);
    catalogScript.analyze();

    // Drop old script from catalog if loaded, then reload
    try {
        catalog.dropScript(catalogScript);
    } catch (e) {
        // Script may not have been loaded yet - ignore error
    }
    catalog.loadScript(catalogScript, CATALOG_DEFAULT_DESCRIPTOR_POOL_RANK);
}
