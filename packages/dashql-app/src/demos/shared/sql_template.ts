/// A value of a placeholder in a SQL template
export type SqlTemplateValue = string | number;

/// A placeholder `:name`, but not the second colon of a cast `::type`
const PLACEHOLDER = /(?<![:\w]):([A-Za-z_]\w*)/g;

/// A value as a SQL literal
export function sqlLiteral(value: SqlTemplateValue | null): string {
    if (value == null) return 'null';
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) return 'null';
        return String(value);
    }
    return `'${value.replace(/'/g, "''")}'`;
}

/// Replace the placeholders `:name` of a SQL template with the literals of their values.
/// The templates are the SQL files of the demos, their string literals and comments contain no placeholders.
export function bindSqlTemplate(template: string, values: Readonly<Record<string, SqlTemplateValue>>): string {
    return template.replace(PLACEHOLDER, (_match, name: string) => {
        if (!(name in values)) throw new Error(`missing value of the SQL placeholder :${name}`);
        return sqlLiteral(values[name]);
    });
}
