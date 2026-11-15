import * as arrow from "apache-arrow";

import { catalogTablesOfSchema, relationFilter, type CatalogTable, type ColumnMetadata, type RelationName } from './catalog_sql_generator.js';
import { quoteIdentifier } from '../../utils/sql_quote.js';

// The query of the columns of the relations of a Hyper and their tables, for the embedded database of the standalone
// shell. The catalog loader of the Rust runtime has its own (`catalog_loader/pg_attribute.rs`).

export type PgAttributeColumnsTable = arrow.Table<{
    table_schema: arrow.Utf8;
    table_name: arrow.Utf8;
    column_name: arrow.Utf8;
    ordinal_position: arrow.Int32;
    data_type: arrow.Utf8;
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
    /// The relations, all relations if absent
    relations?: RelationName[] | null;
}

/// The query of the columns of relations
export function pgAttributeQuery(scope: PgAttributeScope = {}): string {
    const pgCatalog = scope.queryDatabaseName == null
        ? 'pg_catalog'
        : `${quoteIdentifier(scope.queryDatabaseName)}.${quoteIdentifier('pg_catalog')}`;
    const relationsFilter = scope.relations != null ? `AND ${relationFilter('n.nspname', 'c.relname', scope.relations)}` : '';
    // A name without a schema doesn't mean a table of the system
    const systemFilter = scope.relations != null ? `AND n.nspname NOT IN ('pg_catalog', 'information_schema')` : '';
    return `
        SELECT
            n.nspname AS table_schema,
            c.relname AS table_name,
            a.attname AS column_name,
            a.attnum AS ordinal_position,
            t.typname AS data_type
        FROM ${pgCatalog}.pg_class c
        JOIN ${pgCatalog}.pg_namespace n ON n.oid = c.relnamespace
        JOIN ${pgCatalog}.pg_attribute a ON a.attrelid = c.oid
        JOIN ${pgCatalog}.pg_type t ON t.oid = a.atttypid
        WHERE c.relkind IN ('r', 'v', 'm', 'f', 'p')
          AND a.attnum > 0
          AND NOT a.attisdropped
        ${relationsFilter}
        ${systemFilter}
        ORDER BY n.nspname, c.relname, a.attnum
    `;
}
