// The text of `dashql run`: the results, the errors with the statement they point at, and the plain reporter, which
// prints lines for agents and pipes
import type * as arrow from 'apache-arrow';

import { ReportColor, type ReportStyle } from '@akohn/dashql/platform/sql/sql_report';

import { summaryText, type RunEvent, type RunReporter } from './run_events.js';
import { pathBelow, plural, seconds } from './term.js';

/// The longest value of a cell
const MAX_CELL_LENGTH = 40;

/// A value in a cell
function cellText(value: unknown): string {
    let text: string;
    if (value == null) text = 'NULL';
    else if (value instanceof Date) text = value.toISOString();
    else if (typeof value === 'object') text = JSON.stringify(value, (_key, v) => typeof v === 'bigint' ? v.toString() : v);
    else text = String(value);
    text = text.replace(/\s+/g, ' ');
    return text.length > MAX_CELL_LENGTH ? `${text.slice(0, MAX_CELL_LENGTH - 1)}…` : text;
}

/// The schema and the first rows of a result, indented
export function describeTable(table: arrow.Table, rows: number): string {
    const fields = table.schema.fields;
    let out = `  ${fields.map(field => `${field.name} ${field.type}`).join(', ')}\n`;
    const shown = Math.min(rows, table.numRows);
    if (shown === 0 || fields.length === 0) return out;
    const columns = fields.map((field, c) => {
        const vector = table.getChildAt(c)!;
        const cells = Array.from({ length: shown }, (_, r) => cellText(vector.get(r)));
        return [field.name, ...cells];
    });
    const widths = columns.map(cells => Math.max(...cells.map(cell => cell.length)));
    for (let r = 0; r <= shown; ++r) {
        out += `  ${columns.map((cells, c) => cells[r].padEnd(widths[c])).join(' | ').trimEnd()}\n`;
        if (r === 0) out += `  ${widths.map(width => '-'.repeat(width)).join('-+-')}\n`;
    }
    if (shown < table.numRows) out += `  … ${table.numRows - shown} more\n`;
    return out;
}

/// The row count of a result
export function rowsText(table: arrow.Table | null): string {
    return table == null ? 'no result' : plural(table.numRows, 'row');
}

/// The line and the column that an error names, e.g. `line 1:8: Column 'x' cannot be resolved` of Trino
function errorPosition(error: string): { line: number; column: number } | null {
    const match = /^line (\d+):(\d+): /.exec(error);
    return match == null ? null : { line: Number(match[1]), column: Number(match[2]) };
}

/// An error, indented, with the line of the statement that it points at
export function errorText(error: string, statement: string | null, style: ReportStyle): string {
    let out = `  ${error.replace(/\n/g, '\n  ')}\n`;
    const position = errorPosition(error);
    const line = position == null || statement == null ? null : statement.split('\n')[position.line - 1];
    if (position == null || line == null) return out;
    // Columns count characters, tabs show as one space to keep the caret aligned
    const text = line.replace(/\r$/, '').replaceAll('\t', ' ');
    const start = Math.min(position.column - 1, text.length);
    // The caret covers the word at the column, e.g. a name that can't be resolved
    const word = /^[\w$"]+/.exec(text.slice(start))?.[0].length ?? 1;
    const bar = style.apply(ReportColor.Dim, '│');
    out += `  ${bar} ${text}\n  ${bar} ${' '.repeat(start)}${style.apply(ReportColor.Red, '^'.repeat(word))}\n`;
    return out;
}

/// Prints the outcome of every script in lines, nothing while the scripts run: what an agent reads
export class PlainRunReporter implements RunReporter {
    /// The scripts whose results are printed, the others only when they fail
    private reported = new Set<string>();

    constructor(
        private readonly write: (text: string) => void,
        private readonly style: ReportStyle,
        /// The rows of a result that are printed
        private readonly rows: number,
        /// The folder that the paths are relative to
        private readonly cwd: string,
    ) { }

    event(event: RunEvent): void {
        switch (event.type) {
            case 'run_started':
                this.reported = new Set(event.scripts);
                break;
            case 'connection_failed':
                this.write(`${event.connection}  failed\n  ${event.error}\n`);
                break;
            case 'script_done': {
                if (!this.reported.has(event.script)) break;
                const from = event.cached ? '  from the cache' : '';
                let out = `${event.script}  ok  ${rowsText(event.table)}  ${seconds(event.ms)}${from}\n`;
                if (event.table != null) out += describeTable(event.table, this.rows);
                if (event.file != null) out += `  ${pathBelow(event.file, this.cwd)}\n`;
                this.write(out);
                break;
            }
            case 'script_failed':
                this.write(`${event.script}  failed  ${seconds(event.ms)}\n${errorText(event.error, event.statement, this.style)}`);
                break;
            case 'script_cancelled':
                this.write(`${event.script}  cancelled\n`);
                break;
            case 'script_not_run':
                this.write(`${event.script}  not run  ${event.reason}\n`);
                break;
            case 'run_failed':
                this.write(`run  failed\n  ${event.error.replace(/\n/g, '\n  ')}\n`);
                break;
            case 'run_finished':
                this.write(`\n${summaryText(event)}\n`);
                break;
            default:
                break;
        }
    }

    close(): void { }
}
