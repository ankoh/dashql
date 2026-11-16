// The journal of a session gets the markers of a run: a script started, its progress, its result
import {
    JOURNAL_TARGET,
    journalScriptProgressMarker,
    journalScriptResultMarker,
    journalScriptStartedMarker,
    type JournalMarker,
    type JournalWorkbookRef,
} from '@akohn/dashql/platform/session/workbook_journal';
import type { Logger } from '@akohn/dashql/platform/logger/logger';

import type { RunEvent, RunReporter } from './run_events.js';

/// How often a running script reports its progress to the journal at most
const PROGRESS_INTERVAL_MS = 1000;

/// Writes the markers of a run through the logger of the run, which appends to the journal of the session
export class JournalRunReporter implements RunReporter {
    /// The latest progress of every running script and when it was written
    private readonly progress = new Map<string, { text: string; at: number }>();

    constructor(
        private readonly logger: Logger,
        private readonly ref: JournalWorkbookRef,
        private readonly now: () => number = () => performance.now(),
    ) { }

    private mark(marker: (ref: JournalWorkbookRef) => JournalMarker): void {
        const { message, keyValues } = marker(this.ref);
        this.logger.info(message, keyValues, JOURNAL_TARGET);
    }

    event(event: RunEvent): void {
        switch (event.type) {
            case 'script_started':
                this.mark(ref => journalScriptStartedMarker(ref, event.script));
                break;
            case 'script_progress': {
                const running = { script: event.script, phase: event.phase, percent: event.percent, rows: event.rows };
                const text = JSON.stringify(running);
                const last = this.progress.get(event.script);
                if (last != null && (last.text === text || this.now() - last.at < PROGRESS_INTERVAL_MS)) break;
                this.progress.set(event.script, { text, at: this.now() });
                this.mark(ref => journalScriptProgressMarker(ref, running));
                break;
            }
            case 'script_done':
                this.mark(ref => journalScriptResultMarker(ref, {
                    script: event.script, key: event.file == null ? null : event.key, rows: event.table?.numRows ?? null, error: null, cached: event.cached,
                }));
                break;
            case 'script_failed':
                this.mark(ref => journalScriptResultMarker(ref, { script: event.script, key: null, rows: null, error: event.error, cached: false }));
                break;
            case 'script_cancelled':
                this.mark(ref => journalScriptResultMarker(ref, { script: event.script, key: null, rows: null, error: 'cancelled', cached: false }));
                break;
            case 'script_not_run':
                this.mark(ref => journalScriptResultMarker(ref, { script: event.script, key: null, rows: null, error: `not run: ${event.reason}`, cached: false }));
                break;
            default:
                break;
        }
    }

    close(): void { }
}
