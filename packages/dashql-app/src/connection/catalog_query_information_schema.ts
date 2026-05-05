import * as arrow from "apache-arrow";
import * as dashql from '../core/index.js';

import { QueryExecutor } from './query_executor.js';
import { QueryExecutionArgs } from './query_execution_args.js';
import { DynamicConnectionDispatch } from "./connection_registry.js";
import { CATALOG_UPDATE_SCHEMA_SCRIPT, CATALOG_UPDATE_REGISTER_QUERY, SET_CATALOG_SCRIPT } from "./connection_state.js";
import { QueryType } from "./query_execution_state.js";
import { CATALOG_DEFAULT_DESCRIPTOR_POOL_RANK } from "./catalog_update_state.js";
import { generateSchemaSQL, generateCatalogScriptHeader, CatalogSource, type ColumnMetadata } from './catalog_sql_generator.js';

export type InformationSchemaColumnsTable = arrow.Table<{
    table_catalog: arrow.Utf8;
    table_schema: arrow.Utf8;
    table_name: arrow.Utf8;
    column_name: arrow.Utf8;
    ordinal_position: arrow.Int32;
    is_nullable: arrow.Utf8;  // 'YES' or 'NO'
    data_type: arrow.Utf8;
}>;

/**
 * Generates SQL DDL from information_schema query results.
 * Builds a hierarchy of catalog -> schema -> table -> columns and generates CREATE TABLE statements.
 */
function generateCatalogSQLFromInformationSchema(result: InformationSchemaColumnsTable): string {
    // Build hierarchy: catalog -> schema -> table -> columns
    const catalogs = new Map<string, Map<string, Map<string, ColumnMetadata[]>>>();

    for (const batch of result.batches) {
        const colTableCatalog = batch.getChild("table_catalog")!;
        const colTableSchema = batch.getChild("table_schema")!;
        const colTableName = batch.getChild("table_name")!;
        const colColumnName = batch.getChild("column_name")!;
        const colOrdinalPos = batch.getChild("ordinal_position")!;
        const colDataType = batch.getChild("data_type")!;

        // Iterate over all rows in the batch
        for (let i = 0; i < batch.numRows; ++i) {
            const tableCatalog = colTableCatalog.at(i);
            const tableSchema = colTableSchema.at(i);
            const tableName = colTableName.at(i);
            const columnName = colColumnName.at(i);
            const ordinalPosition = colOrdinalPos.at(i);
            const dataType = colDataType.at(i);

            if (!tableCatalog || !tableSchema || !columnName || !tableName) {
                continue;
            }

            // Get or create catalog entry
            let schemaMap = catalogs.get(tableCatalog);
            if (!schemaMap) {
                schemaMap = new Map<string, Map<string, ColumnMetadata[]>>();
                catalogs.set(tableCatalog, schemaMap);
            }

            // Get or create schema entry
            let tableMap = schemaMap.get(tableSchema);
            if (!tableMap) {
                tableMap = new Map<string, ColumnMetadata[]>();
                schemaMap.set(tableSchema, tableMap);
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
    for (const [catalogName, catalogSchemas] of catalogs) {
        for (const [schemaName, schemaTables] of catalogSchemas) {
            const sql = generateSchemaSQL(catalogName, schemaName, schemaTables);
            if (sql.length > 0) {
                sqlStatements.push(sql);
            }
        }
    }

    return sqlStatements.join('\n\n');
}

export async function queryInformationSchema(sessionId: string, connectionDispatch: DynamicConnectionDispatch, updateId: number, catalogName: string, schemaNames: string[], executor: QueryExecutor): Promise<InformationSchemaColumnsTable | null> {
    const query = `
        SELECT
            table_catalog,
            table_schema,
            table_name,
            column_name,
            ordinal_position,
            is_nullable,
            data_type
        FROM information_schema.columns
        WHERE table_catalog = '${catalogName}'
        ${schemaNames.length > 0 ? `AND table_schema IN ('${schemaNames.join("','")}')` : ''}
    `;

    const args: QueryExecutionArgs = {
        query: query,
        metadata: {
            queryType: QueryType.CATALOG_QUERY_INFORMATION_SCHEMA,
            title: "Information Schema",
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

    const queryResult = await queryExecution as InformationSchemaColumnsTable;
    return queryResult;
}

export async function updateInformationSchemaCatalog(
    sessionId: string,
    connectionDispatch: DynamicConnectionDispatch,
    updateId: number,
    catalogName: string,
    schemaNames: string[],
    executor: QueryExecutor,
    catalog: dashql.DashQLCatalog,
    dql: dashql.DashQL,
    catalogScript: dashql.DashQLScript
): Promise<void> {
    // Query the information schema. If the query errors it throws and propagates
    // to the caller so we never overwrite the existing catalog script with partial data.
    const queryResult = await queryInformationSchema(sessionId, connectionDispatch, updateId, catalogName, schemaNames, executor);
    if (queryResult == null || queryResult.numRows === 0) {
        return;
    }

    // Generate SQL from query results before touching the script so an empty
    // result (after row-level filtering) doesn't clobber a restored catalog.
    const header = generateCatalogScriptHeader(CatalogSource.InformationSchema);
    const catalogSQL = generateCatalogSQLFromInformationSchema(queryResult);
    if (catalogSQL.length === 0) {
        return;
    }

    // Mark loading started
    connectionDispatch(sessionId, {
        type: CATALOG_UPDATE_SCHEMA_SCRIPT,
        value: [updateId]
    });

    // Update script content
    catalogScript.replaceText(`${header}${catalogSQL}`);
    catalogScript.analyze();

    // Drop old script from catalog if loaded, then reload
    try {
        catalog.dropScript(catalogScript);
    } catch (e) {
        // Script may not have been loaded yet - ignore error
    }
    catalog.loadScript(catalogScript, CATALOG_DEFAULT_DESCRIPTOR_POOL_RANK);
}
