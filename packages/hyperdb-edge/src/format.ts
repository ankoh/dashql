import type { StatementResult } from './run_statement.js';
import { cellText, readCell, sqlTypeName, type CellValue } from './values.js';

export type OutputFormat = 'table' | 'json' | 'csv';

export interface FormatOptions {
    readonly format: OutputFormat;
    /// The rows to print, 0 prints all
    readonly maxRows: number;
}

/// What a statement prints
export interface FormattedOutput {
    readonly stdout: string;
    /// A note for stderr, e.g. that --max-rows cut the rows of a csv
    readonly stderr?: string;
}

/// The kinds of statements whose row count says what they did
const COUNTED_KINDS = new Set(['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'COPY']);

/// Format the result of the statement with the given number, counted from 1
export function formatStatementResult(result: StatementResult, statement: number, options: FormatOptions): FormattedOutput {
    switch (options.format) {
        case 'table':
            return { stdout: formatTable(result, options.maxRows) };
        case 'json':
            return { stdout: formatJson(result, statement, options.maxRows) };
        case 'csv':
            return formatCsv(result, statement, options.maxRows);
    }
}

function shownRows(result: StatementResult, maxRows: number): number {
    const rows = result.table?.numRows ?? 0;
    return maxRows > 0 ? Math.min(rows, maxRows) : rows;
}

function columnNames(result: StatementResult): string[] {
    return result.table!.schema.fields.map(f => f.name);
}

function rowValues(result: StatementResult, row: number): CellValue[] {
    const table = result.table!;
    return table.schema.fields.map((_, column) => readCell(table, column, row));
}

/// psql's word for a statement without rows: its kind, and the rows that it changed if they say what it did
function statementTag(result: StatementResult): string {
    const kind = result.kind ?? 'OK';
    return COUNTED_KINDS.has(kind) && result.rowCount != null ? `${kind} ${result.rowCount}` : kind;
}

function formatTable(result: StatementResult, maxRows: number): string {
    if (result.table == null) return `${statementTag(result)}\n`;
    const names = columnNames(result);
    const shown = shownRows(result, maxRows);
    // A value with line breaks spans several lines, as the plan of EXPLAIN does
    const rows: string[][][] = [];
    for (let row = 0; row < shown; ++row) {
        rows.push(rowValues(result, row).map(value => cellText(value).replaceAll('\r\n', '\n').split('\n')));
    }
    const widths = names.map((name, column) =>
        Math.max(name.length, ...rows.map(cells => Math.max(...cells[column].map(line => line.length)))),
    );
    const formatLine = (cells: string[]) => cells.map((cell, column) => cell.padEnd(widths[column])).join(' | ').trimEnd();

    const lines = [formatLine(names), widths.map(w => '-'.repeat(w)).join('-+-')];
    for (const cells of rows) {
        const height = Math.max(...cells.map(lines => lines.length));
        for (let line = 0; line < height; ++line) {
            lines.push(formatLine(cells.map(cellLines => cellLines[line] ?? '')));
        }
    }
    const total = result.table.numRows;
    const count = `${total} ${total === 1 ? 'row' : 'rows'}`;
    lines.push(shown < total ? `(${count}, ${shown} shown)` : `(${count})`);
    return `${lines.join('\n')}\n`;
}

function formatJson(result: StatementResult, statement: number, maxRows: number): string {
    if (result.table == null) {
        const rowCount = result.rowCount == null ? null : Number(result.rowCount);
        return `${JSON.stringify({ statement, kind: result.kind, rowCount })}\n`;
    }
    const shown = shownRows(result, maxRows);
    const rows: CellValue[][] = [];
    for (let row = 0; row < shown; ++row) rows.push(rowValues(result, row));
    const output = {
        statement,
        kind: result.kind,
        columns: result.table.schema.fields.map(field => ({ name: field.name, type: sqlTypeName(field) })),
        rows,
        rowCount: result.table.numRows,
        truncated: shown < result.table.numRows,
    };
    return `${JSON.stringify(output)}\n`;
}

/// A field of RFC 4180: quoted if it holds a separator, a quote, a line break or surrounding spaces. An empty text is
/// quoted as well, so it differs from null, which is an empty field.
function csvField(text: string): string {
    if (text === '' || /[",\r\n]/.test(text) || text !== text.trim()) {
        return `"${text.replaceAll('"', '""')}"`;
    }
    return text;
}

function csvValue(value: CellValue): string {
    if (value === null) return '';
    return csvField(typeof value === 'object' ? JSON.stringify(value) : String(value));
}

function formatCsv(result: StatementResult, statement: number, maxRows: number): FormattedOutput {
    if (result.table == null) return { stdout: '' };
    const shown = shownRows(result, maxRows);
    const lines = [columnNames(result).map(csvField).join(',')];
    for (let row = 0; row < shown; ++row) {
        lines.push(rowValues(result, row).map(csvValue).join(','));
    }
    const total = result.table.numRows;
    const stdout = `${lines.join('\n')}\n`;
    if (shown < total) {
        return { stdout, stderr: `hyperdb-edge: statement ${statement} printed ${shown} of ${total} rows, --max-rows 0 prints all\n` };
    }
    return { stdout };
}
