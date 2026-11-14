/// Quote a name for SQL, e.g. of a database or a table
export function quoteIdentifier(name: string): string {
    return `"${name.replaceAll('"', '""')}"`;
}

/// Quote a text as a SQL string literal
export function quoteLiteral(value: string): string {
    return `'${value.replaceAll("'", "''")}'`;
}
