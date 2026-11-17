// The live view of `dashql run` on a terminal: what is settled is printed once and stays in the scrollback, a region
// below it shows what runs and what waits and is drawn again in place. No alternate screen, no input.
import { ReportColor, type ReportStyle } from '@akohn/dashql/platform/sql/sql_report';

import { describeTable, errorText, rowsText } from './run_output.js';
import { summaryText, type RunEvent, type RunReporter } from './run_events.js';
import { ANSI, clipLine, compactCount, seconds, shortPath, SYMBOLS, type Terminal } from './term.js';

/// How often the region is drawn again, for the spinners and the elapsed times
const FRAME_INTERVAL_MS = 100;
/// How long a frame of a spinner shows
const SPINNER_FRAME_MS = 80;
/// The lines of the region at most, the rest is counted in a last line
const MAX_REGION_LINES = 12;
/// The width of a progress bar
const BAR_WIDTH = 12;

/// The lines at the bottom of a terminal that are drawn again in place. The lines never wrap, so that the region
/// knows how many lines to erase.
export class LiveRegion {
    /// The lines that are drawn now
    private drawn = 0;
    private cursorHidden = false;

    constructor(
        private readonly write: (text: string) => void,
        private readonly terminal: Terminal,
    ) { }

    /// Print settled text above the region and draw the region with new lines
    update(settled: string, lines: readonly string[]): void {
        // The last column stays empty, some terminals wrap when a line fills it
        const width = Math.max(this.terminal.columns() - 1, 10);
        let out = this.cursorHidden ? '' : ANSI.hideCursor;
        this.cursorHidden = true;
        out += ANSI.eraseLines(this.drawn) + settled;
        for (const line of lines) out += `${clipLine(line, width)}\n`;
        this.drawn = lines.length;
        this.write(out);
    }

    /// Erase the region and show the cursor again
    end(): void {
        if (!this.cursorHidden && this.drawn === 0) return;
        this.write(ANSI.eraseLines(this.drawn) + ANSI.showCursor);
        this.drawn = 0;
        this.cursorHidden = false;
    }
}

/// A connection that is set up
interface ConnectionRow {
    connection: string;
    since: number;
}

/// A script of the plan that didn't settle yet
interface ScriptRow {
    script: string;
    follows: string[];
    /// When it started, null while it waits
    started: number | null;
    progress: { phase: string | null; percent: number | null; rows: number | null } | null;
}

/// Draws the live view of a run
export class LiveRunReporter implements RunReporter {
    private readonly region: LiveRegion;
    private readonly connections = new Map<string, ConnectionRow>();
    private readonly scripts = new Map<string, ScriptRow>();
    /// The scripts that settled, a script that follows them doesn't wait for them anymore
    private readonly settled = new Set<string>();
    /// The scripts whose results are printed, the others only when they fail
    private reported = new Set<string>();
    private finished = false;
    private timer: ReturnType<typeof setInterval> | null = null;

    constructor(
        write: (text: string) => void,
        terminal: Terminal,
        private readonly style: ReportStyle,
        /// The rows of a result that are printed
        private readonly rows: number,
        /// The folder that the paths are relative to
        private readonly cwd: string,
        private readonly now: () => number = () => performance.now(),
        /// Draw the region again every frame, the tests draw on events only
        animate = true,
    ) {
        this.region = new LiveRegion(write, terminal);
        if (animate) {
            this.timer = setInterval(() => this.draw(''), FRAME_INTERVAL_MS);
            this.timer.unref?.();
        }
    }

    private color(color: ReportColor, text: string): string {
        return this.style.apply(color, text);
    }

    private spinner(): string {
        const frames = SYMBOLS.spinner;
        return this.color(ReportColor.Cyan, frames[Math.floor(this.now() / SPINNER_FRAME_MS) % frames.length]);
    }

    private elapsed(since: number): string {
        return this.color(ReportColor.Dim, seconds(this.now() - since));
    }

    private bar(percent: number): string {
        const filled = Math.max(0, Math.min(BAR_WIDTH, Math.round(percent / 100 * BAR_WIDTH)));
        return this.color(ReportColor.Cyan, '█'.repeat(filled)) + this.color(ReportColor.Dim, '░'.repeat(BAR_WIDTH - filled));
    }

    /// The lines of the region: the connections that are set up, the running scripts, the waiting scripts
    frame(): string[] {
        if (this.finished) return [];
        const lines: string[] = [];
        for (const row of this.connections.values()) {
            lines.push(`${this.spinner()} ${row.connection}  connecting  ${this.elapsed(row.since)}`);
        }
        const rows = [...this.scripts.values()];
        const width = Math.max(0, ...rows.map(row => row.script.length));
        for (const row of rows) {
            if (row.started == null) continue;
            const parts = [`${this.spinner()} ${row.script.padEnd(width)}`];
            const progress = row.progress;
            if (progress?.phase != null) parts.push(progress.phase);
            if (progress?.percent != null) parts.push(`${this.bar(progress.percent)} ${String(Math.round(progress.percent)).padStart(3)}%`);
            if (progress?.rows != null) parts.push(`${compactCount(progress.rows)} rows`);
            parts.push(this.elapsed(row.started));
            lines.push(parts.join('  '));
        }
        for (const row of rows) {
            if (row.started != null) continue;
            const waitsFor = row.follows.filter(script => !this.settled.has(script));
            const why = waitsFor.length > 0 ? `waits for ${waitsFor.join(', ')}` : 'queued';
            lines.push(this.color(ReportColor.Dim, `${SYMBOLS.waiting} ${row.script.padEnd(width)}  ${why}`));
        }
        if (lines.length === 0) lines.push(`${this.spinner()} planning`);
        if (lines.length > MAX_REGION_LINES) {
            const rest = lines.length - (MAX_REGION_LINES - 1);
            lines.splice(MAX_REGION_LINES - 1, lines.length, this.color(ReportColor.Dim, `  … ${rest} more`));
        }
        return lines;
    }

    private draw(settled: string): void {
        this.region.update(settled, this.frame());
    }

    private ok(text: string): string {
        return `${this.color(ReportColor.Green, SYMBOLS.ok)} ${text}`;
    }

    private failed(text: string): string {
        return `${this.color(ReportColor.Red, SYMBOLS.failed)} ${text}  ${this.color(ReportColor.Red, 'failed')}`;
    }

    private settle(script: string): void {
        this.scripts.delete(script);
        this.settled.add(script);
    }

    event(event: RunEvent): void {
        let out = '';
        switch (event.type) {
            case 'run_started':
                this.reported = new Set(event.scripts);
                out = `${this.color(ReportColor.Bold, `dashql run ${event.workbook}`)}${this.color(ReportColor.Dim, ` · ${event.scripts.length === 1 ? '1 script' : `${event.scripts.length} scripts`}`)}\n`;
                break;
            case 'connection_setup':
                this.connections.set(event.connection, { connection: event.connection, since: this.now() });
                break;
            case 'connection_ready':
                this.connections.delete(event.connection);
                out = `${this.ok(event.connection)}  ready  ${this.color(ReportColor.Dim, seconds(event.ms))}\n`;
                break;
            case 'connection_failed':
                this.connections.delete(event.connection);
                out = `${this.failed(event.connection)}\n  ${event.error}\n`;
                break;
            case 'script_planned':
                this.scripts.set(event.script, { script: event.script, follows: event.follows, started: null, progress: null });
                break;
            case 'script_started': {
                const row = this.scripts.get(event.script) ?? { script: event.script, follows: [], started: null, progress: null };
                row.started = this.now();
                this.scripts.set(event.script, row);
                break;
            }
            case 'script_progress': {
                const row = this.scripts.get(event.script);
                if (row != null) row.progress = { phase: event.phase, percent: event.percent, rows: event.rows };
                break;
            }
            case 'script_done': {
                this.settle(event.script);
                if (!this.reported.has(event.script)) break;
                const from = event.cached ? `  ${this.color(ReportColor.Dim, 'from the cache')}` : '';
                out = `${this.ok(event.script)}  ${rowsText(event.rows)}  ${this.color(ReportColor.Dim, seconds(event.ms))}${from}\n`;
                if (event.table != null) out += describeTable(event.table, this.rows, event.rows ?? event.table.numRows);
                if (event.file != null) out += `  ${this.color(ReportColor.Dim, shortPath(event.file, this.cwd))}\n`;
                break;
            }
            case 'script_failed':
                this.settle(event.script);
                out = `${this.failed(event.script)}  ${this.color(ReportColor.Dim, seconds(event.ms))}\n${errorText(event.error, event.statement, this.style)}`;
                break;
            case 'script_cancelled':
                this.settle(event.script);
                out = `${this.color(ReportColor.Dim, `${SYMBOLS.notRun} ${event.script}  cancelled  ${seconds(event.ms)}`)}\n`;
                break;
            case 'script_not_run':
                this.settle(event.script);
                out = `${this.color(ReportColor.Dim, `${SYMBOLS.notRun} ${event.script}  not run  ${event.reason}`)}\n`;
                break;
            case 'run_failed':
                out = `${this.failed('run')}\n  ${event.error.replace(/\n/g, '\n  ')}\n`;
                break;
            case 'run_finished': {
                this.finished = true;
                const failed = event.failed + event.cancelled + event.notRun > 0;
                const summary = summaryText(event, ' · ');
                const prefix = event.interrupted ? 'interrupted · ' : '';
                out += `\n${this.color(failed ? ReportColor.Red : ReportColor.Green, `${prefix}${summary}`)}${this.color(ReportColor.Dim, ` · ${seconds(event.ms)}`)}\n`;
                break;
            }
        }
        this.draw(out);
    }

    close(): void {
        if (this.timer != null) clearInterval(this.timer);
        this.timer = null;
        this.region.end();
    }
}
