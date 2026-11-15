// The events of `dashql run`: the command runs the workbook and reports what happens, a reporter shows it. The plain
// reporter prints lines for agents and pipes, the live reporter draws a view on a terminal, the journal reporter writes
// the markers of a session.
import type * as arrow from 'apache-arrow';

/// What happens in a run
export type RunEvent =
    /// The run starts, with the scripts that it reports results of: the named ones, every one by default
    | { type: 'run_started'; workbook: string; scripts: string[] }
    /// A connection that statements run on is set up, by its label, e.g. `trino http://localhost:8080`
    | { type: 'connection_setup'; connection: string }
    | { type: 'connection_ready'; connection: string; ms: number }
    | { type: 'connection_failed'; connection: string; error: string }
    /// A script runs once the scripts that it follows are done
    | { type: 'script_planned'; script: string; follows: string[] }
    | { type: 'script_started'; script: string }
    /// The latest progress of a query of a running script
    | { type: 'script_progress'; script: string; phase: string | null; percent: number | null; rows: number | null }
    /// A script ran or the cache served its result: the result, its key and its file in the query result cache
    | { type: 'script_done'; script: string; ms: number; table: arrow.Table | null; cached: boolean; key: string | null; file: string | null }
    /// A statement of a script failed: the error and the statement that was sent
    | { type: 'script_failed'; script: string; ms: number; error: string; statement: string | null }
    /// The run stopped a running script, e.g. after another script failed
    | { type: 'script_cancelled'; script: string; ms: number }
    /// A script that the run reports did not run, and why
    | { type: 'script_not_run'; script: string; reason: string }
    /// The run itself failed, e.g. a script can't be planned. A failed script is reported as such.
    | { type: 'run_failed'; error: string }
    /// The run is over: what happened to the scripts that it reports
    | { type: 'run_finished'; ms: number; ok: number; failed: number; cancelled: number; notRun: number; interrupted: boolean };

/// Shows the events of a run
export interface RunReporter {
    event(event: RunEvent): void;
    /// The run is over, e.g. stop drawing
    close(): void;
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
