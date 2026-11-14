import * as flatbuffers from 'flatbuffers';
import * as dashql from '@ankoh/dashql-core';

export const DEFAULT_DATABASE_NAME = 'hyper';

/// Column metadata for SQL generation
export interface ColumnMetadata {
    name: string;
    ordinalPosition: number;
    dataType?: string | null;
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

/// A relation of a connection
export interface RelationName {
    databaseName: string;
    /// The schema, empty if a statement didn't name one. The connection decides which schema that is, it can be a
    /// temporary schema or one of the search path, so a name without a schema matches every schema.
    schemaName: string;
    /// The table, empty for everything in the schema
    tableName: string;
}

/// The condition of a metadata query that selects relations
export function relationFilter(schemaColumn: string, tableColumn: string, relations: RelationName[]): string {
    const relation = (r: RelationName) => {
        const parts = [
            ...(r.schemaName ? [`${schemaColumn} = ${quoteLiteral(r.schemaName)}`] : []),
            ...(r.tableName ? [`${tableColumn} = ${quoteLiteral(r.tableName)}`] : []),
        ];
        return `(${parts.join(' AND ')})`;
    };
    return `(${relations.map(relation).join(' OR ')})`;
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
/// Temporary relations don't outlive the database session, a restart must not bring them back.
export function generateRelationsFile(descriptor: dashql.buffers.catalog.CatalogDescriptorT | null): string {
    const tables = catalogTablesOfDescriptor(descriptor).filter(table => !table.schemaName.toLowerCase().startsWith('pg_temp'));
    return `-- DashQL Connection Relations.
-- This file is auto-generated and can only be updated through a catalog refresh.

${generateCatalogTablesSQL(tables)}
`;
}

/// What the file with the relations of a connection doesn't say
export interface CatalogStateFile {
    /// The relations of executed statements that the connection didn't answer about yet
    pending: RelationName[];
    /// The relations that the connection reported as gone, a declaration in a script doesn't provide them
    gone: RelationName[];
}

/// A relation name of the core
export function readRelationName(name: dashql.buffers.analyzer.QualifiedTableNameT, defaultDatabase = ''): RelationName {
    return {
        databaseName: String(name.databaseName ?? '') || defaultDatabase,
        schemaName: String(name.schemaName ?? ''),
        tableName: String(name.tableName ?? ''),
    };
}

/// Read the file with the catalog state, a file that can't be read holds nothing
export function parseCatalogStateFile(text: string | null): CatalogStateFile {
    const isRelation = (r: any): r is RelationName => typeof r?.databaseName === 'string' && typeof r?.schemaName === 'string' && typeof r?.tableName === 'string';
    try {
        const parsed = JSON.parse(text ?? '');
        return {
            pending: Array.isArray(parsed?.pending) ? parsed.pending.filter(isRelation) : [],
            gone: Array.isArray(parsed?.gone) ? parsed.gone.filter(isRelation) : [],
        };
    } catch {
        return { pending: [], gone: [] };
    }
}

export enum CatalogSource {
    InformationSchema = 0,
    PgClass = 1,
    SalesforceMetadataApi = 2,
    Hyper = 3,
    Unknown = 4,
}

