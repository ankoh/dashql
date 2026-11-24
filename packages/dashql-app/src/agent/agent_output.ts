// The text that the `dashql` commands of an agent print: the page answers every call with text, the command line tool
// only prints it (docs/design/agent_integration.md). Results, errors with the statement they point at, the diagnostics
// of a script and what a KPI card shows.
import type * as arrow from 'apache-arrow';
import type * as core from '@akohn/dashql';

import { formatKpiChange, kpiBase, type KpiReading } from '@akohn/dashql/platform/workbook/kpi_reading';
import type { RunEvent } from '@akohn/dashql/platform/workbook/run_events';

/// "1 row", "2 rows"
export function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/// A duration in seconds, e.g. `0.4 s`
export function seconds(ms: number): string {
    return `${(Math.max(0, ms) / 1000).toFixed(1)} s`;
}

/// The summary of a run in one line, e.g. `2 ok, 1 failed, 1 not run`
export function summaryText(finished: Extract<RunEvent, { type: 'run_finished' }>, separator = ', '): string {
    const parts = [
        finished.ok > 0 || finished.failed + finished.cancelled + finished.notRun === 0 ? `${finished.ok} ok` : null,
        finished.failed > 0 ? `${finished.failed} failed` : null,
        finished.cancelled > 0 ? `${finished.cancelled} cancelled` : null,
        finished.notRun > 0 ? `${finished.notRun} not run` : null,
    ];
    return parts.filter(part => part != null).join(separator);
}

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

/// The schema and the first rows of a result, indented. The table may hold only the first rows of the result, `total`
/// counts all of them.
export function describeTable(table: arrow.Table, rows: number, total: number = table.numRows): string {
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
    if (shown < total) out += `  … ${total - shown} more\n`;
    return out;
}

/// The row count of a result
export function rowsText(rows: number | null): string {
    return rows == null ? 'no result' : plural(rows, 'row');
}

/// The line and the column that an error names, e.g. `line 1:8: Column 'x' cannot be resolved` of Trino
function errorPosition(error: string): { line: number; column: number } | null {
    const match = /^line (\d+):(\d+): /.exec(error);
    return match == null ? null : { line: Number(match[1]), column: Number(match[2]) };
}

/// An error, indented, with the line of the statement that it points at
export function errorText(error: string, statement: string | null): string {
    let out = `  ${error.replace(/\n/g, '\n  ')}\n`;
    const position = errorPosition(error);
    const line = position == null || statement == null ? null : statement.split('\n')[position.line - 1];
    if (position == null || line == null) return out;
    // Columns count characters, tabs show as one space to keep the caret aligned
    const text = line.replace(/\r$/, '').replaceAll('\t', ' ');
    const start = Math.min(position.column - 1, text.length);
    // The caret covers the word at the column, e.g. a name that can't be resolved
    const word = /^[\w$"]+/.exec(text.slice(start))?.[0].length ?? 1;
    out += `  │ ${text}\n  │ ${' '.repeat(start)}${'^'.repeat(word)}\n`;
    return out;
}

/// The text of the events of a run: the outcome of every script, nothing while the scripts run
export class RunText {
    /// The scripts whose results are printed, the others only when they fail
    private reported = new Set<string>();

    constructor(
        private readonly write: (text: string) => void,
        /// The rows of a result that are printed
        private readonly rows: number,
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
                const from = event.cached ? '  reused' : '';
                let out = `${event.script}  ok  ${rowsText(event.rows)}  ${seconds(event.ms)}${from}\n`;
                if (event.table != null) out += describeTable(event.table, this.rows, event.rows ?? event.table.numRows);
                if (event.file != null) out += `  ${event.file}\n`;
                this.write(out);
                break;
            }
            case 'script_failed':
                this.write(`${event.script}  failed  ${seconds(event.ms)}\n${errorText(event.error, event.statement)}`);
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
}

/// A diagnostic of a script, its offset and length in the characters of the text
export interface AgentDiagnostic {
    severity: 'error' | 'warning';
    /// What reported it, e.g. parser or analyzer
    source: string;
    message: string;
    /// Null when it points nowhere
    offset: number | null;
    length: number;
}

/// The 1-based line and column of an offset into a text
export function lineColumn(text: string, offset: number): [number, number] {
    let line = 1;
    let lineStart = 0;
    for (let i = 0; i < Math.min(offset, text.length); ++i) {
        if (text.charCodeAt(i) === 10) {
            line += 1;
            lineStart = i + 1;
        }
    }
    return [line, offset - lineStart + 1];
}

/// The diagnostics of a script: its name, then a line per finding with the line of the text it points at
export function diagnosticsText(name: string, text: string, diagnostics: readonly AgentDiagnostic[]): string {
    if (diagnostics.length === 0) return `${name}: no diagnostics\n`;
    const lines = text.split('\n');
    let out = `${name}: ${plural(diagnostics.filter(d => d.severity === 'error').length, 'error')}, ${plural(diagnostics.filter(d => d.severity === 'warning').length, 'warning')}\n`;
    for (const diagnostic of diagnostics) {
        const [first, ...rest] = diagnostic.message.split('\n');
        if (diagnostic.offset == null) {
            out += `  ${diagnostic.severity}  ${diagnostic.source}  ${first}\n`;
        } else {
            const [line, column] = lineColumn(text, diagnostic.offset);
            out += `  ${line}:${column}  ${diagnostic.severity}  ${diagnostic.source}  ${first}\n`;
            const source = (lines[line - 1] ?? '').replace(/\r$/, '').replaceAll('\t', ' ');
            const [endLine, endColumn] = lineColumn(text, diagnostic.offset + diagnostic.length);
            const width = Math.max(endLine === line ? endColumn - column : source.length - column + 1, 1);
            out += `    │ ${source}\n    │ ${' '.repeat(column - 1)}${'^'.repeat(width)}\n`;
        }
        for (const line of rest) out += `    ${line}\n`;
    }
    return out;
}

/// What a KPI card shows, in a line
export function describeKpi(reading: KpiReading, spec: core.buffers.visualization.KpiSpecT): string {
    const parts = [`${reading.label} ${reading.value ?? '–'}`];
    const base = kpiBase(spec);
    if (reading.rows < 2) {
        parts.push(reading.rows === 1 ? 'one row: no change and no chart' : 'no rows');
        return parts.join(', ');
    }
    if (reading.change != null) {
        const sign = reading.change > 0 ? '▲ ' : reading.change < 0 ? '▼ ' : '';
        parts.push(`${sign}${formatKpiChange(reading.change)} against ${base}`);
    } else if (base == null) {
        parts.push('no change (delta=none)');
    } else {
        parts.push(`no change: ${base} has no number or zero`);
    }
    if (reading.chart == null) {
        parts.push('no chart (chart=none)');
    } else if (reading.points.length < 2) {
        parts.push('no chart');
    } else if (reading.chart === 'bar') {
        parts.push(`${reading.points.length} bars in the order of the rows`);
    } else {
        const along = reading.xLabel != null && reading.ordered === true ? `over ${reading.xLabel}` : 'in the order of the rows';
        parts.push(`a chart of ${reading.points.length} points ${along}`);
    }
    return parts.join(', ');
}
