import * as arrow from "apache-arrow";
import * as dashql from '@ankoh/dashql-core';

import { QueryExecutor } from '../query_executor.js';
import { QueryExecutionArgs } from '../query_execution_args.js';
import { DynamicConnectionDispatch } from "../connection_registry.js";
import { CATALOG_UPDATE_SCHEMA_SCRIPT, CATALOG_UPDATE_REGISTER_QUERY } from "../connection_state.js";
import { QueryType } from "../../query/query_execution_state.js";
import { catalogTablesOfSchema, packCatalogDescriptor, packCatalogTable, packRelationName, quoteLiteral, relationFilter, type CatalogTable, type ColumnMetadata, type RelationName } from './catalog_sql_generator.js';
import { beginCatalogBatch, type CatalogBatchOptions } from './catalog_batch.js';

export type InformationSchemaColumnsTable = arrow.Table<{
    table_catalog: arrow.Utf8;
    table_schema: arrow.Utf8;
    table_name: arrow.Utf8;
    column_name: arrow.Utf8;
    /// Trino types the ordinal position as bigint, its values are then BigInt
    ordinal_position: arrow.Int32 | arrow.Int64;
    is_nullable: arrow.Utf8;  // 'YES' or 'NO'
    data_type: arrow.Utf8;
}>;

/**
 * The tables of information_schema query results.
 * Builds a hierarchy of catalog -> schema -> table -> columns.
 */
function catalogTablesFromInformationSchema(result: InformationSchemaColumnsTable): CatalogTable[] {
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
                ordinalPosition: ordinalPosition != null ? Number(ordinalPosition) : columns.length,
                dataType: dataType ?? null,
            });
        }
    }

    return [...catalogs].flatMap(([catalogName, schemas]) =>
        [...schemas].flatMap(([schemaName, tables]) => catalogTablesOfSchema(catalogName, schemaName, tables)));
}

/// A catalog and the schemas of it whose columns are read, no schemas for all of them
export interface InformationSchemaScope {
    /// The catalog name
    catalog: string;
    /// The schema names, empty for all schemas of the catalog
    schemas: string[];
    /// The relations, all relations of the schemas if absent
    relations?: RelationName[];
}

/// Quote an identifier
function quoteIdentifier(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
}

/// The query of the columns of the scopes.
/// Every catalog has an information_schema of its own, the query reads the one of every catalog.
export function informationSchemaColumnsQuery(scopes: InformationSchemaScope[]): string {
    const condition = (scope: InformationSchemaScope) => {
        if (scope.relations != null) return `\nWHERE ${relationFilter('table_schema', 'table_name', scope.relations)}`;
        return scope.schemas.length > 0 ? `\nWHERE table_schema IN (${scope.schemas.map(quoteLiteral).join(', ')})` : '';
    };
    const select = (source: string, scope: InformationSchemaScope) => `SELECT
    table_catalog,
    table_schema,
    table_name,
    column_name,
    ordinal_position,
    is_nullable,
    data_type
FROM ${source}${condition(scope)}`;
    return scopes
        .map(scope => select(`${quoteIdentifier(scope.catalog)}.information_schema.columns`, scope))
        .join('\nUNION ALL\n');
}

export async function queryInformationSchema(connectionId: string, connectionDispatch: DynamicConnectionDispatch, updateId: number, scopes: InformationSchemaScope[], executor: QueryExecutor, abortSignal?: AbortSignal): Promise<InformationSchemaColumnsTable | null> {
    const query = informationSchemaColumnsQuery(scopes);

    const args: QueryExecutionArgs = {
        query: query,
        abortSignal,
        throwOnError: true,
        metadata: {
            queryType: QueryType.CATALOG_QUERY_INFORMATION_SCHEMA,
            title: "Information Schema",
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

    const queryResult = await queryExecution as InformationSchemaColumnsTable;
    return queryResult;
}

/// The scopes of relations: their catalogs
export function relationScopes(relations: RelationName[]): InformationSchemaScope[] {
    const catalogs = [...new Set(relations.map(relation => relation.databaseName))];
    return catalogs.map(catalog => ({ catalog, schemas: [], relations: relations.filter(relation => relation.databaseName === catalog) }));
}

/// Ask the information_schema about relations and update them in the catalog
export async function updateInformationSchemaRelations(
    connectionId: string,
    connectionDispatch: DynamicConnectionDispatch,
    updateId: number,
    relations: RelationName[],
    executor: QueryExecutor,
    catalog: dashql.DashQLCatalog,
    relationEntryId: number,
    options: CatalogBatchOptions = {},
): Promise<void> {
    const validate = beginCatalogBatch(catalog, options);
    const queryResult = await queryInformationSchema(connectionId, connectionDispatch, updateId, relationScopes(relations), executor, options.abortSignal);
    validate();
    const tables = queryResult == null ? [] : catalogTablesFromInformationSchema(queryResult);
    connectionDispatch(connectionId, { type: CATALOG_UPDATE_SCHEMA_SCRIPT, value: [updateId] });
    catalog.replaceTables(relationEntryId, dashql.buffers.catalog.CatalogLayer.CONNECTION, {
        relations: relations.map(packRelationName),
        tables: tables.map(packCatalogTable),
    });
}

export async function updateInformationSchemaCatalog(
    connectionId: string,
    connectionDispatch: DynamicConnectionDispatch,
    updateId: number,
    scopes: InformationSchemaScope[],
    executor: QueryExecutor,
    catalog: dashql.DashQLCatalog,
    relationEntryId: number,
    options: CatalogBatchOptions = {},
): Promise<void> {
    // Every information_schema belongs to a catalog, without one there is nothing to read
    if (scopes.length === 0) {
        throw new Error('no catalogs to read the information_schema of');
    }
    const validate = beginCatalogBatch(catalog, options);
    // Query the information schema. If the query errors it throws and propagates
    // to the caller so we never overwrite the existing catalog with partial data.
    const queryResult = await queryInformationSchema(connectionId, connectionDispatch, updateId, scopes, executor, options.abortSignal);
    validate();
    if (queryResult == null || queryResult.numRows === 0) {
        throw new Error('information_schema returned no catalog relations');
    }
    // An empty result after row-level filtering doesn't clobber a restored catalog
    const tables = catalogTablesFromInformationSchema(queryResult);
    if (tables.length === 0) {
        throw new Error('information_schema returned no usable catalog relations');
    }
    connectionDispatch(connectionId, { type: CATALOG_UPDATE_SCHEMA_SCRIPT, value: [updateId] });
    catalog.replaceDescriptor(relationEntryId, dashql.buffers.catalog.CatalogLayer.CONNECTION, packCatalogDescriptor(tables));
}
