import type * as arrow from 'apache-arrow';

/// The rows that `run` prints by default
export const DEFAULT_RUN_ROWS = 20;
/// The rows of a page of `result`
export const RESULT_PAGE_ROWS = 50;
/// A value is cut after this many characters
const MAX_VALUE_CHARACTERS = 200;

/// A column of a result
export interface AgentResultColumn {
    name: string;
    type: string;
}

/// A slice of a result, the structured output of `run` and `result`
export interface AgentResultSlice {
    columns: AgentResultColumn[];
    /// The rows of the slice, values as JSON
    rows: unknown[][];
    /// The total number of rows
    rowCount: number;
    /// The first row of the slice, zero-based
    offset: number;
}

/// A value as JSON
function jsonValue(value: unknown): unknown {
    if (value == null) return null;
    if (typeof value === 'bigint') {
        return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
    }
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Uint8Array) return `<${value.length} bytes>`;
    if (typeof value === 'object') {
        const json = (value as { toJSON?: () => unknown }).toJSON;
        if (typeof json === 'function') return jsonValue(json.call(value));
        if (Array.isArray(value)) return value.map(jsonValue);
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsonValue(v)]));
    }
    return value;
}

/// A value as text in a tab-separated row
function textValue(value: unknown): string {
    if (value == null) return 'NULL';
    let text = typeof value === 'string' ? value : JSON.stringify(value);
    text = text.replace(/[\t\r\n]/g, ' ');
    return text.length > MAX_VALUE_CHARACTERS ? `${text.slice(0, MAX_VALUE_CHARACTERS - 1)}…` : text;
}

/// Read rows of a result
export function sliceResult(table: arrow.Table, offset: number, limit: number): AgentResultSlice {
    const columns = table.schema.fields.map(field => ({ name: field.name, type: String(field.type) }));
    const rows: unknown[][] = [];
    const end = Math.min(table.numRows, offset + limit);
    for (let row = offset; row < end; ++row) {
        const values: unknown[] = [];
        for (let col = 0; col < table.numCols; ++col) {
            values.push(jsonValue(table.getChildAt(col)?.get(row)));
        }
        rows.push(values);
    }
    return { columns, rows, rowCount: table.numRows, offset };
}

/// Render a slice of a result as tab-separated text with a summary line
export function formatResultSlice(slice: AgentResultSlice, scriptName: string): string {
    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const lines = [`${plural(slice.rowCount, 'row')}, ${plural(slice.columns.length, 'column')}`];
    if (slice.columns.length > 0) {
        lines.push(slice.columns.map(c => `${c.name} (${c.type})`).join('\t'));
        for (const row of slice.rows) lines.push(row.map(textValue).join('\t'));
    }
    const shownEnd = slice.offset + slice.rows.length;
    if (slice.rows.length > 0 && (slice.offset > 0 || shownEnd < slice.rowCount)) {
        lines.push(`(rows ${slice.offset + 1}-${shownEnd} of ${slice.rowCount})`);
    }
    if (shownEnd < slice.rowCount) {
        const nextPage = Math.floor(shownEnd / RESULT_PAGE_ROWS) + 1;
        lines.push(`More rows: dashql agent result ${scriptName} --page ${nextPage}`);
    }
    return lines.join('\n');
}
