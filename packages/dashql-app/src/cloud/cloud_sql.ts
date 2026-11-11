import { quoteIdentifier } from '../connections/catalog/catalog_sql_generator.js';

// The statements that the cloud store sends to the cloud connection. See docs/design/cloud.md.

/// A string literal
export function quoteLiteral(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}

/// A qualified name, every part quoted
export function qualifiedName(...parts: string[]): string {
    return parts.map(quoteIdentifier).join('.');
}

/// A column of a table in the cloud
export interface CloudColumn {
    name: string;
    /// The Hyper type
    type: string;
    nullable: boolean;
}

/// A CREATE TABLE statement
export function createTableSQL(table: string, columns: readonly CloudColumn[]): string {
    const definitions = columns.map(column => `${quoteIdentifier(column.name)} ${column.type}${column.nullable ? '' : ' NOT NULL'}`);
    return `CREATE TABLE ${table} (${definitions.join(', ')})`;
}

/// The INSERT statements of rows that hold the text of their values, null for NULL.
/// The values travel as string literals and are cast to the types of the columns once per column, so every type that
/// Hyper reads from its text form travels the same way. A statement holds rows until the next one would make it longer
/// than `maxLength` characters, a single row may make it longer.
export function* insertStatements(
    table: string,
    columns: readonly CloudColumn[],
    rows: Iterable<ReadonlyArray<string | null>>,
    maxLength: number,
): Generator<string> {
    const aliases = columns.map((_, index) => `c${index}`);
    const head = `INSERT INTO ${table} (${columns.map(column => quoteIdentifier(column.name)).join(', ')}) `
        + `SELECT ${columns.map((column, index) => `CAST(v.${aliases[index]} AS ${column.type})`).join(', ')} FROM (VALUES `;
    const tail = `) AS v(${aliases.join(', ')})`;
    let tuples: string[] = [];
    let length = head.length + tail.length;
    for (const row of rows) {
        if (row.length !== columns.length) {
            throw new Error(`Expected ${columns.length} values, found ${row.length}`);
        }
        const tuple = `(${row.map(value => value == null ? 'NULL' : quoteLiteral(value)).join(', ')})`;
        if (tuples.length > 0 && length + tuple.length + 2 > maxLength) {
            yield `${head}${tuples.join(', ')}${tail}`;
            tuples = [];
            length = head.length + tail.length;
        }
        tuples.push(tuple);
        length += tuple.length + 2;
    }
    if (tuples.length > 0) {
        yield `${head}${tuples.join(', ')}${tail}`;
    }
}
