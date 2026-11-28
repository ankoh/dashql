// A run of a workbook that reports what happens as RunEvents: the page runs a workbook for the `dashql run` and
// `dashql vis` of an agent (docs/design/agent_integration.md)
import * as arrow from 'apache-arrow';

import type * as core from '../core/index.js';
import type { ConnectionState } from '../platform/connections/connection_state.js';
import { LoggableException } from '../platform/logger/logger.js';
import type { RunEvent } from '../platform/workbook/run_events.js';
import type { ScriptRunEvent } from '../platform/workbook/workbook_execution.js';
import type { WorkbookScripts } from '../platform/workbook/workbook_scripts.js';
import type { RunResult, Runtime } from './runtime.js';

/// The message of an error: what Trino says, the status of a failed request, or why a request failed
export function describeRunError(error: unknown): string {
    if (error instanceof LoggableException) {
        const text = (value: unknown) => typeof value === 'string' && value.length > 0 ? value : null;
        const [errorMessage, status, message] = [text(error.keyValues.errorMessage), text(error.keyValues.status), text(error.keyValues.message)];
        if (errorMessage) return errorMessage;
        if (status) return `${error.message} (${status}${message ? ` ${message}` : ''})`;
        return error.message;
    }
    if (!(error instanceof Error)) return String(error);
    // fetch names the reason of a failed request only in the cause, e.g. a refused connection
    return error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message;
}

/// The scripts of a run by their names, every script without names: `scripts/A.sql`, `a.sql` and `A` name `a.sql`.
/// The names that the workbook doesn't have in `unknown`, without path and `.sql`. The core decides (`names.rs`,
/// `workbook_run/report.rs`).
export function runScriptsOf(instance: core.DashQL, workbook: WorkbookScripts, names: readonly string[]): core.RunScriptSelection {
    return instance.runScripts([...workbook.scriptOrder], [...names]);
}

export interface ReportedRunOptions {
    /// The scripts that the run reports, all of them without names (runScriptsOf)
    scripts: readonly string[];
    refresh: boolean;
    /// Stops the run, it cancels the running queries
    signal: AbortSignal;
    /// The first rows of a result that `script_done` carries, read from the data frame of its computation in the
    /// compute database (docs/wip/result_windows.md): the whole result doesn't pass through JavaScript for them
    rows: number;
    /// Set up a connection before the first statement, an error message if it can't be used. Without, the run takes
    /// the connections that can run.
    prepareConnection?: (conn: ConnectionState) => Promise<string | null>;
    /// The file of the stored result of a script of the workbook, null without one (docs/design/workbook_results.md)
    resultFile?: (script: string) => Promise<string | null>;
    /// Reporting an event failed
    onReportError?: (error: unknown) => void;
}

/// Run the scripts of a workbook and report what happens. The events arrive in order: a result is read before it is
/// reported, so the reports wait for each other. The run ends with run_finished.
export async function runWorkbookReported(runtime: Runtime, workbook: WorkbookScripts, options: ReportedRunOptions, emit: (event: RunEvent) => void): Promise<void> {
    const { workbookId } = workbook;
    const files = [...workbook.scriptOrder];
    const { selected, requested } = runScriptsOf(runtime.core, workbook, options.scripts);
    const { signal } = options;
    const runStarted = performance.now();
    emit({ type: 'run_started', scripts: selected });

    // The connections are set up before the first statement, all at once. A failure is reported here, the run leaves
    // out the scripts of the connection.
    const prepare = options.prepareConnection;
    const prepareConnection = prepare == null ? undefined : async (connectionId: string) => {
        const conn = runtime.connection(connectionId);
        if (conn == null) throw new Error(`the workbook has no connection ${connectionId}`);
        const failure = await prepare(conn);
        if (failure != null) {
            emit({ type: 'connection_failed', connection: runtime.core.runConnectionLabel(conn.params), error: signal.aborted ? 'interrupted' : failure });
            throw new Error(failure);
        }
    };

    // A query as the runtime holds it now
    const queryOf = (queryId: number) => {
        const view = runtime.module.views('query', [queryId])[0] ?? null;
        return view === 'busy' ? null : view;
    };

    // The outcomes of the scripts in the order of their events, the core sums them up
    const outcomes: core.ReportedScript[] = [];
    const settle = (script: string, outcome: core.ReportedScriptOutcome) => outcomes.push({ script, outcome });
    const startedAt = new Map<string, number>();
    const elapsed = (script: string) => performance.now() - (startedAt.get(script) ?? runStarted);
    let reports = Promise.resolve();
    const report = (task: () => Promise<RunEvent | null>) => {
        reports = reports.then(task).then(event => { if (event != null) emit(event); }, error => options.onReportError?.(error));
    };
    /// The schema and the first rows of the result of a query, null without a computation: a result without columns
    /// has none. The computation of a result has the id of its query, the preview waits for the data frame of an
    /// analysis that runs and reads the rows in the order of the result.
    const firstRows = async (queryId: number): Promise<arrow.Table | null> => {
        if (runtime.store.get('computation', queryId) == null) return null;
        try {
            return arrow.tableFromIPC(await runtime.previewResult(queryId, 0, options.rows, false));
        } catch (error) {
            // The event reports the result without its rows, the rows and the file still tell what it is
            options.onReportError?.(error);
            return null;
        }
    };
    const resultOf = async (script: string, queryId: number | null, cached: boolean): Promise<RunEvent> => {
        const ms = elapsed(script);
        // The history of the connection counts the rows of the result of the query
        const rows = queryId == null ? null : queryOf(queryId)?.resultTable?.rows ?? null;
        const table = queryId == null || rows == null ? null : await firstRows(queryId);
        // The executor writes the stored result after the query resolved
        await runtime.module.flushResultWrites();
        const file = queryId == null || options.resultFile == null ? null : await options.resultFile(script);
        return { type: 'script_done', script, ms, queryId, rows, table, cached, file };
    };
    const onScript = (script: string, event: ScriptRunEvent) => {
        switch (event.type) {
            case 'started':
                startedAt.set(script, performance.now());
                report(async () => ({ type: 'script_started', script }));
                break;
            case 'cached':
            case 'done': {
                settle(script, 'ok');
                const cached = event.type === 'cached';
                report(() => resultOf(script, event.queryId, cached));
                break;
            }
            case 'failed': {
                settle(script, 'failed');
                const ms = elapsed(script);
                // The statement that failed, the error points into it
                const statement = event.queryId == null ? null : queryOf(event.queryId)?.queryText ?? null;
                report(async () => ({ type: 'script_failed', script, ms, error: describeRunError(event.error), statement }));
                break;
            }
            case 'cancelled': {
                settle(script, 'cancelled');
                const ms = elapsed(script);
                report(async () => ({ type: 'script_cancelled', script, ms }));
                break;
            }
            case 'skipped':
                settle(script, 'notRun');
                report(async () => ({ type: 'script_not_run', script, reason: event.reason }));
                break;
            case 'blocked':
                settle(script, 'notRun');
                report(async () => ({ type: 'script_not_run', script, reason: `${event.by} failed` }));
                break;
            default:
                break;
        }
    };

    // The run stops with the signal
    const stopRun = () => runtime.stopRun(workbookId);
    signal.addEventListener('abort', stopRun, { once: true });
    let run: RunResult | null = null;
    try {
        if (!signal.aborted) {
            run = await runtime.runWorkbook(workbookId, {
                targets: requested ? selected.map(file => files.indexOf(file)) : undefined,
                refresh: options.refresh,
                // The feed shows the results of the run as those of its own runs, the rows come from their analyses
                analyze: true,
            }, { onScript, prepareConnection });
        }
    } finally {
        signal.removeEventListener('abort', stopRun);
    }
    await reports;

    const interrupted = signal.aborted;
    const failure = run?.outcome.failure;
    const end = runtime.core.finishRunReport({
        selected,
        outcomes,
        interrupted,
        refused: run == null || run.outcome.refused != null,
        failure: failure != null && failure.kind !== 'cancelled' ? failure.message : undefined,
    });
    if (end.runError != null) emit({ type: 'run_failed', error: end.runError });
    for (const { script, reason } of end.notRun) emit({ type: 'script_not_run', script, reason });
    emit({
        type: 'run_finished', ms: performance.now() - runStarted, interrupted,
        ok: end.ok, failed: end.failed, cancelled: end.cancelled, notRun: end.notRunCount,
    });
}

