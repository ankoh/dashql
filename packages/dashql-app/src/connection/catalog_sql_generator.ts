import * as dashql from '../core/index.js';

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

/// Quotes a SQL identifier using double quotes, escaping internal quotes.
/// Handles special characters, spaces, and reserved words.
export function quoteIdentifier(identifier: string): string {
    // Escape any double quotes in the identifier by doubling them (SQL standard)
    const escaped = identifier.replace(/"/g, '""');
    return `"${escaped}"`;
}

/// Maps SQL data types to simplified DashQL types.
/// Falls back to VARCHAR for unknown types.
export function mapDataType(sqlType: string | null | undefined): string {
    if (!sqlType) {
        return 'VARCHAR';
    }

    const normalized = sqlType.toLowerCase().trim();

    // Integer types
    if (normalized.includes('int') || normalized.includes('serial') || normalized.includes('bigserial')) {
        return 'INTEGER';
    }

    // Floating point types
    if (normalized.includes('float') || normalized.includes('double') ||
        normalized.includes('real') || normalized.includes('numeric') ||
        normalized.includes('decimal')) {
        return 'FLOAT';
    }

    // Boolean types
    if (normalized.includes('bool')) {
        return 'BOOLEAN';
    }

    // Date/time types
    if (normalized.includes('date') && !normalized.includes('time')) {
        return 'DATE';
    }
    if (normalized.includes('timestamp') || normalized.includes('datetime')) {
        return 'TIMESTAMP';
    }

    // Default to VARCHAR for text and unknown types
    return 'VARCHAR';
}

/// Generates a qualified table name (database.schema.table).
export function generateQualifiedTableName(
    databaseName: string | null | undefined,
    schemaName: string,
    tableName: string
): string {
    const db = databaseName || 'default';
    return `${quoteIdentifier(db)}.${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`;
}

/// Generates a CREATE TABLE SQL statement for a single table.
export function generateCreateTableSQL(
    databaseName: string | null | undefined,
    schemaName: string,
    tableName: string,
    columns: ColumnMetadata[]
): string {
    const qualifiedName = generateQualifiedTableName(databaseName, schemaName, tableName);

    // Sort columns by ordinal position
    const sortedColumns = [...columns].sort((a, b) => a.ordinalPosition - b.ordinalPosition);

    // Generate column definitions
    const columnDefs = sortedColumns.map(col => {
        const colName = quoteIdentifier(col.name);
        const colType = mapDataType(col.dataType);
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
