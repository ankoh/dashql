import { lineColumn, type SqlDiagnostic, type SqlDiagnosticSeverity } from './sql_lint.js';

export enum ReportColor {
    Bold,
    Dim,
    Red,
    Yellow,
    Green,
    Cyan,
}

const ANSI: Record<ReportColor, [number, number]> = {
    [ReportColor.Bold]: [1, 22],
    [ReportColor.Dim]: [2, 22],
    [ReportColor.Red]: [31, 39],
    [ReportColor.Green]: [32, 39],
    [ReportColor.Yellow]: [33, 39],
    [ReportColor.Cyan]: [36, 39],
};

/// Applies text styles with ANSI escapes, they do not change the visible width
export class ReportStyle {
    constructor(readonly colors: boolean) {}

    apply(color: ReportColor, text: string): string {
        if (!this.colors) return text;
        const [on, off] = ANSI[color];
        return `\x1b[${on}m${text}\x1b[${off}m`;
    }
}

/// "warning"
const LABEL_WIDTH = 7;
/// "analyze", "failure"
const STAGE_WIDTH = 7;

function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/// A duration in milliseconds, in seconds from one second on
export function formatDuration(ms: number): string {
    return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function severityColor(severity: SqlDiagnosticSeverity): ReportColor {
    return severity === 'error' ? ReportColor.Red : ReportColor.Yellow;
}

/// The source line of a diagnostic and the underline of its span
function codeFrame(text: string, diagnostic: SqlDiagnostic): [string, string] | null {
    const location = diagnostic.location;
    if (location == null) return null;
    // Columns count code points, tabs show as a single space to keep the caret aligned
    let line = text.split('\n')[location.line - 1] ?? '';
    if (line.endsWith('\r')) line = line.slice(0, -1);
    line = line.replaceAll('\t', ' ');
    const [endLine, endColumnOnLine] = lineColumn(text, location.offset + location.length);
    const endColumn = endLine === location.line ? endColumnOnLine : [...line].length + 1;
    const width = Math.max(endColumn - location.column, 1);
    return [line, `${' '.repeat(location.column - 1)}${'^'.repeat(width)}`];
}

/// The diagnostics of one script: its name, then an indented line per finding with its source line
export function formatReportFile(file: string, text: string, diagnostics: SqlDiagnostic[], style: ReportStyle): string {
    const locations = diagnostics.map(d => d.location != null ? `${d.location.line}:${d.location.column}` : '');
    const locationWidth = Math.max(0, ...locations.map(location => location.length));
    const indent = ' '.repeat(2 + locationWidth + 2);
    const continuation = ' '.repeat(indent.length + LABEL_WIDTH + 2 + STAGE_WIDTH + 2);
    const out = [style.apply(ReportColor.Bold, file)];
    diagnostics.forEach((diagnostic, i) => {
        const color = severityColor(diagnostic.severity);
        const [first, ...rest] = diagnostic.message.split('\n');
        out.push(`  ${style.apply(ReportColor.Cyan, locations[i].padEnd(locationWidth))}  ${style.apply(color, diagnostic.severity.padEnd(LABEL_WIDTH))}  ${style.apply(ReportColor.Dim, diagnostic.stage.padEnd(STAGE_WIDTH))}  ${first}`);
        for (const line of rest) out.push(`${continuation}${line}`);
        const frame = codeFrame(text, diagnostic);
        if (frame != null) {
            const bar = style.apply(ReportColor.Dim, '│');
            out.push(`${indent}${bar} ${frame[0]}`);
            out.push(`${indent}${bar} ${style.apply(color, frame[1])}`);
        }
    });
    return out.join('\n');
}

/// "3 files, 1 error, 0 warnings"
export function formatReportSummary(files: number, errors: number, warnings: number, style: ReportStyle): string {
    const count = (n: number, word: string, color: ReportColor) => style.apply(n > 0 ? color : ReportColor.Green, plural(n, word));
    return `${plural(files, 'file')}, ${count(errors, 'error', ReportColor.Red)}, ${count(warnings, 'warning', ReportColor.Yellow)}`;
}

/// Where the time of a run went
export function formatReportTimings(lintMs: number, style: ReportStyle): string {
    return `${style.apply(ReportColor.Dim, 'dashql-core')}  scan, parse and analyze ${formatDuration(lintMs)}`;
}
