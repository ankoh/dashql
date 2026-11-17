// The events of `dashql run`: the command runs the workbook and reports what happens, a reporter shows it. The plain
// reporter prints lines for agents and pipes, the live reporter draws a view on a terminal. The events are the ones of
// the shared package, a tab that runs the workbook of a session sends the same.
import type { RunEvent } from '@akohn/dashql/platform/workbook/run_events';

export type { RunEvent };

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
