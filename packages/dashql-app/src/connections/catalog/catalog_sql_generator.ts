import * as flatbuffers from 'flatbuffers';
import * as dashql from '@ankoh/dashql-core';

export const DEFAULT_DATABASE_NAME = 'hyper';

/// Column metadata for SQL generation
export interface ColumnMetadata {
    name: string;
    ordinalPosition: number;
    dataType?: string | null;
}

/// Table metadata for SQL generation
export interface TableMetadata {
    tableName: string;
    columns: ColumnMetadata[];
}

/// Schema metadata for SQL generation
export interface SchemaMetadata {
    databaseName: string | null;
    schemaName: string;
    tables: TableMetadata[];
}

export function quoteIdentifier(identifier: string): string {
    const escaped = identifier.replace(/"/g, '""');
    return `"${escaped}"`;
}

/// The type of a column of a generated CREATE TABLE.
/// A backend can name any type, such as `USER-DEFINED` or `numeric(10,2)`, and some of those aren't SQL types.
/// A quoted name always parses, and the catalog keeps its text.
export function quoteDataType(sqlType: string | null | undefined): string {
    return quoteIdentifier(sqlType?.trim() || 'unknown');
}

/// Quote a string literal
export function quoteLiteral(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}

/// A relation of a connection, fully qualified
export interface RelationName {
    databaseName: string;
    schemaName: string;
    tableName: string;
}

/// The condition of a metadata query that selects relations
export function relationFilter(schemaColumn: string, tableColumn: string, relations: RelationName[]): string {
    return `(${relations.map(r => `(${schemaColumn} = ${quoteLiteral(r.schemaName)} AND ${tableColumn} = ${quoteLiteral(r.tableName)})`).join(' OR ')})`;
}

/// Generates a qualified table name (database.schema.table).
export function generateQualifiedTableName(
    databaseName: string | null | undefined,
    schemaName: string,
    tableName: string
): string {
    const db = databaseName || DEFAULT_DATABASE_NAME;
    return `${quoteIdentifier(db)}.${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`;
}

/// Generates a CREATE TABLE SQL statement for a single table.
export function generateCreateTableSQL(
    databaseName: string | null | undefined,
    schemaName: string | null,
    tableName: string,
    columns: ColumnMetadata[]
): string {
    const qualifiedName = schemaName == null
        ? quoteIdentifier(tableName)
        : generateQualifiedTableName(databaseName, schemaName, tableName);

    // Sort columns by ordinal position
    const sortedColumns = [...columns].sort((a, b) => a.ordinalPosition - b.ordinalPosition);

    // Generate column definitions
    const columnDefs = sortedColumns.map(col => {
        const colName = quoteIdentifier(col.name);
        const colType = quoteDataType(col.dataType);
        return `    ${colName} ${colType}`;
    }).join(',\n');

    return `CREATE TABLE ${qualifiedName} (\n${columnDefs}\n);`;
}

/// Generates CREATE TABLE SQL statements for all tables in a schema.
export function generateSchemaSQL(
    databaseName: string | null | undefined,
    schemaName: string,
    tables: Map<string, ColumnMetadata[]>
): string {
    const sqlStatements: string[] = [];

    // Sort tables by name for consistent output
    const sortedTableNames = Array.from(tables.keys()).sort();

    for (const tableName of sortedTableNames) {
        const columns = tables.get(tableName)!;
        const sql = generateCreateTableSQL(databaseName, schemaName, tableName, columns);
        sqlStatements.push(sql);
    }

    return sqlStatements.join('\n\n');
}

/// A table that a connection reported
export interface CatalogTable extends RelationName {
    columns: ColumnMetadata[];
}

/// The tables of a schema, sorted by name
export function catalogTablesOfSchema(databaseName: string, schemaName: string, tables: Map<string, ColumnMetadata[]>): CatalogTable[] {
    return Array.from(tables.keys()).sort().map(tableName => ({ databaseName, schemaName, tableName, columns: tables.get(tableName)! }));
}

/// The name of a relation for the core
export function packRelationName(relation: RelationName): dashql.buffers.analyzer.QualifiedTableNameT {
    return new dashql.buffers.analyzer.QualifiedTableNameT(0, relation.databaseName, relation.schemaName, relation.tableName);
}

/// A table of a catalog descriptor, its columns in the order of the connection
export function packCatalogTable(table: CatalogTable): dashql.buffers.analyzer.TableT {
    const packed = new dashql.buffers.analyzer.TableT();
    packed.tableName = packRelationName(table);
    packed.tableColumns = [...table.columns]
        .sort((a, b) => a.ordinalPosition - b.ordinalPosition)
        .map(column => new dashql.buffers.analyzer.TableColumnT(0, column.name, null, column.dataType ?? null));
    return packed;
}

/// A catalog descriptor of tables
export function packCatalogDescriptor(tables: CatalogTable[]): Uint8Array {
    const descriptor = new dashql.buffers.catalog.CatalogDescriptorT(tables.map(packCatalogTable), []);
    const builder = new flatbuffers.Builder();
    builder.finish(descriptor.pack(builder));
    return builder.asUint8Array();
}

/// The tables of a catalog descriptor
export function catalogTablesOfDescriptor(descriptor: dashql.buffers.catalog.CatalogDescriptorT | null): CatalogTable[] {
    return (descriptor?.tables ?? []).map(table => ({
        databaseName: String(table.tableName?.databaseName ?? ''),
        schemaName: String(table.tableName?.schemaName ?? ''),
        tableName: String(table.tableName?.tableName ?? ''),
        columns: table.tableColumns.map((column, ordinalPosition) => ({
            name: String(column.columnName ?? ''),
            ordinalPosition,
            dataType: column.columnType == null ? null : String(column.columnType),
        })),
    }));
}

/// CREATE TABLE statements of tables, the catalog of a connection on disk
export function generateCatalogTablesSQL(tables: CatalogTable[]): string {
    return tables.map(table => generateCreateTableSQL(table.databaseName, table.schemaName, table.tableName, table.columns)).join('\n\n');
}

/// The file with the relations of a connection. The catalog holds descriptors, this text is only written and read.
export function generateRelationsFile(descriptor: dashql.buffers.catalog.CatalogDescriptorT | null): string {
    return `-- DashQL Connection Relations.
-- This file is auto-generated and can only be updated through a catalog refresh.

${generateCatalogTablesSQL(catalogTablesOfDescriptor(descriptor))}
`;
}

/// Generates unqualified CREATE TABLE statements for all supplied tables.
export function generateUnqualifiedSchemaSQL(tables: Map<string, ColumnMetadata[]>): string {
    return Array.from(tables.keys())
        .sort()
        .map(tableName => generateCreateTableSQL(null, null, tableName, tables.get(tableName)!))
        .join('\n\n');
}

export enum CatalogSource {
    InformationSchema = 0,
    PgClass = 1,
    SalesforceMetadataApi = 2,
    Hyper = 3,
    Unknown = 4,
}

export function generateCatalogScriptHeaderForSource(source: string, updatedAt: Date = new Date()): string {
    return `-- DashQL Connection Relations.
-- This file is auto-generated and can only be updated through a catalog refresh.
--
-- Catalog Source: ${source}
-- Last Refresh: ${updatedAt.toISOString()}

`;
}

/// Generates a SQL comment header for catalog scripts with the update timestamp and method.
export function generateCatalogScriptHeader(method: CatalogSource, updatedAt: Date = new Date()): string {
    let methodStr: string;
    switch (method) {
        case CatalogSource.InformationSchema: methodStr = 'SQL information_schema'; break;
        case CatalogSource.PgClass: methodStr = 'SQL pg_class'; break;
        case CatalogSource.SalesforceMetadataApi: methodStr = 'Salesforce Connect /ssot/metadata API'; break;
        case CatalogSource.Hyper: methodStr = 'Hyper attached databases'; break;
        default: methodStr = '-'; break;
    }
    return generateCatalogScriptHeaderForSource(methodStr, updatedAt);
}

/// Generates SQL for multiple schemas.
export function generateCatalogSQL(schemas: SchemaMetadata[]): string {
    const sqlStatements: string[] = [];

    for (const schema of schemas) {
        const tablesMap = new Map<string, ColumnMetadata[]>();
        for (const table of schema.tables) {
            tablesMap.set(table.tableName, table.columns);
        }

        const schemaSQL = generateSchemaSQL(
            schema.databaseName,
            schema.schemaName,
            tablesMap
        );

        if (schemaSQL.length > 0) {
            sqlStatements.push(schemaSQL);
        }
    }

    return sqlStatements.join('\n\n');
}
