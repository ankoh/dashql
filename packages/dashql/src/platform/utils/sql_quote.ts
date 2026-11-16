// Quoting of names and texts in the SQL that DashQL generates, for Hyper, Trino and PostgreSQL alike

/// A quoted identifier
export function quoteIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
}

/// A string literal
export function quoteLiteral(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}
