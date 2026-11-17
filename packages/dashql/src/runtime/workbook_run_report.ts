// A run of a workbook that reports what happens as RunEvents: `dashql run` on its own runtime, and a tab that runs a
// workbook for the agent of a session (docs/wip/tab_driven_runs.md)
import type * as arrow from 'apache-arrow';

import type { ConnectionState } from '../platform/connections/connection_state.js';
import { LoggableException } from '../platform/logger/logger.js';
import type { RunEvent } from '../platform/workbook/run_events.js';
import type { ScriptRunEvent } from '../platform/workbook/workbook_execution.js';
import { scriptResultOwner, type WorkbookScripts } from '../platform/workbook/workbook_scripts.js';
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

/// What a connection is in the events of a run
function runConnectionLabel(conn: ConnectionState): string {
    const params = conn.params;
    if ('trino' in params) return `trino ${params.trino.endpoint}`;
    if ('hyper' in params) return params.hyper.protocol === 'WASM' ? 'the embedded hyper' : `hyper ${params.hyper.endpoint ?? ''}`.trim();
    if ('salesforce' in params) return 'salesforce';
    return 'dbcom';
}

/// The scripts of a run by their file names, `scripts/a.sql` names `a.sql`: every script without names. The names
/// that the workbook doesn't have in `unknown`.
export function runScriptsOf(workbook: WorkbookScripts, names: readonly string[]): { selected: string[]; requested: boolean; unknown: string[] } {
    const files = [...workbook.scriptOrder];
    const requested = new Set(names.map(name => name.split(/[\\/]/).pop() ?? name));
    const unknown = [...requested].filter(file => !files.includes(file));
    return { selected: requested.size === 0 ? files : files.filter(file => requested.has(file)), requested: requested.size > 0, unknown };
}

export interface ReportedRunOptions {
    /// What the events name the workbook, e.g. its folder
    label: string;
    /// The scripts that the run reports, all of them without names (runScriptsOf)
    scripts: readonly string[];
    refresh: boolean;
    /// Stops the run, it cancels the running queries
    signal: AbortSignal;
    /// How often the progress of the running queries is read, null for none
    progressIntervalMs: number | null;
    /// Set up a connection before the first statement, an error message if it can't be used. Without, the run takes
    /// the connections that can run.
    prepareConnection?: (conn: ConnectionState) => Promise<string | null>;
    /// The file of the result of a key in the query result cache, null without one
    resultFile?: (key: string) => Promise<string | null>;
    /// Reporting an event failed
    onReportError?: (error: unknown) => void;
}

/// What happened to a script, the summary counts it
type ScriptOutcome = 'ok' | 'failed' | 'cancelled' | 'not run';

/// How a reported run ended
export type ReportedRunEnd = 'ok' | 'failed' | 'interrupted';

/// Run the scripts of a workbook and report what happens. The events arrive in order: a result is read before it is
/// reported, so the reports wait for each other. The run ends with run_finished.
export async function runWorkbookReported(runtime: Runtime, workbook: WorkbookScripts, options: ReportedRunOptions, emit: (event: RunEvent) => void): Promise<ReportedRunEnd> {
    const { workbookId } = workbook;
    const files = [...workbook.scriptOrder];
    const { selected, requested } = runScriptsOf(workbook, options.scripts);
    // The script of a query by the owner of its result
    const scriptOfOwner = new Map(files.map(file => [scriptResultOwner(workbookId, workbook.scriptRefs[file].scriptId), file]));
    const { signal } = options;
    const runStarted = performance.now();
    emit({ type: 'run_started', workbook: options.label, scripts: selected });

    // The connections are set up before the first statement, all at once. A failure is reported here, the run leaves
    // out the scripts of the connection.
    const prepare = options.prepareConnection;
    const prepareConnection = prepare == null ? undefined : async (connectionId: string) => {
        const conn = runtime.connection(connectionId);
        if (conn == null) throw new Error(`the workbook has no connection ${connectionId}`);
        const label = runConnectionLabel(conn);
        const started = performance.now();
        emit({ type: 'connection_setup', connection: label });
        const failure = await prepare(conn);
        if (failure != null) {
            emit({ type: 'connection_failed', connection: label, error: signal.aborted ? 'interrupted' : failure });
            throw new Error(failure);
        }
        emit({ type: 'connection_ready', connection: label, ms: performance.now() - started });
    };

    // A query as the runtime holds it now
    const queryOf = (queryId: number) => {
        const view = runtime.module.views('query', [queryId])[0] ?? null;
        return view === 'busy' ? null : view;
    };
    // The progress of the running queries of the scripts, read from the views of the store a while after a query
    // changed and sent when it changed
    let stopProgress: (() => void) | null = null;
    if (options.progressIntervalMs != null) {
        const lastProgress = new Map<string, string>();
        const sampleProgress = () => {
            for (const conn of runtime.store.all('connection').values()) {
                for (const queryId of conn.queriesActiveOrdered) {
                    const query = runtime.store.get('query', queryId);
                    const script = scriptOfOwner.get(query?.queryMetadata.resultOwner ?? '');
                    const update = query?.latestProgressUpdate;
                    if (script == null || update == null) continue;
                    const progress = { phase: update.phase ?? null, percent: update.progressPercent ?? null, rows: update.rowsProcessed ?? null };
                    const text = JSON.stringify(progress);
                    if (lastProgress.get(script) === text) continue;
                    lastProgress.set(script, text);
                    emit({ type: 'script_progress', script, ...progress });
                }
            }
        };
        let sample: ReturnType<typeof setTimeout> | null = null;
        const unsubscribe = runtime.store.subscribeKind('query', () => {
            sample ??= setTimeout(() => {
                sample = null;
                sampleProgress();
            }, options.progressIntervalMs!);
        });
        stopProgress = () => {
            unsubscribe();
            if (sample != null) clearTimeout(sample);
            sample = null;
        };
    }

    try {
        const outcomes = new Map<string, ScriptOutcome>();
        const startedAt = new Map<string, number>();
        const elapsed = (script: string) => performance.now() - (startedAt.get(script) ?? runStarted);
        let reports = Promise.resolve();
        const report = (task: () => Promise<RunEvent | null>) => {
            reports = reports.then(task).then(event => { if (event != null) emit(event); }, error => options.onReportError?.(error));
        };
        const resultOf = async (script: string, queryId: number | null, key: string | null, cached: boolean): Promise<RunEvent> => {
            const ms = elapsed(script);
            // The history of the connection keeps the result table of the query
            const table: arrow.Table | null = queryId == null ? null : runtime.table(queryOf(queryId)?.resultTable?.id) ?? null;
            // The executor writes the result into the cache after the query resolved
            await runtime.module.flushCacheWrites();
            const file = key == null || options.resultFile == null ? null : await options.resultFile(key);
            return { type: 'script_done', script, ms, rows: table?.numRows ?? null, table, cached, key, file };
        };
        const onScript = (script: string, event: ScriptRunEvent) => {
            switch (event.type) {
                case 'planned':
                    report(async () => ({ type: 'script_planned', script, follows: event.follows }));
                    break;
                case 'started':
                    startedAt.set(script, performance.now());
                    report(async () => ({ type: 'script_started', script }));
                    break;
                case 'cached':
                case 'done': {
                    outcomes.set(script, 'ok');
                    const cached = event.type === 'cached';
                    report(() => resultOf(script, event.queryId, event.key, cached));
                    break;
                }
                case 'failed': {
                    outcomes.set(script, 'failed');
                    const ms = elapsed(script);
                    // The statement that failed, the error points into it
                    const statement = event.queryId == null ? null : queryOf(event.queryId)?.queryText ?? null;
                    report(async () => ({ type: 'script_failed', script, ms, error: describeRunError(event.error), statement }));
                    break;
                }
                case 'cancelled': {
                    outcomes.set(script, 'cancelled');
                    const ms = elapsed(script);
                    report(async () => ({ type: 'script_cancelled', script, ms }));
                    break;
                }
                case 'skipped':
                    outcomes.set(script, 'not run');
                    report(async () => ({ type: 'script_not_run', script, reason: event.reason }));
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
                    // The results are reported, the run doesn't analyze them
                    analyze: false,
                }, { onScript, prepareConnection });
            }
        } finally {
            signal.removeEventListener('abort', stopRun);
        }
        await reports;
        stopProgress?.();

        const interrupted = signal.aborted;
        // An error of the run itself, e.g. a script that can't be planned; a failed script reported its own
        const scriptFailed = [...outcomes.values()].includes('failed');
        let error: string | null = null;
        if (!interrupted && !scriptFailed) {
            if (run == null || run.outcome.refused != null) error = 'the workbook is running elsewhere';
            else if (run.outcome.failure != null && run.outcome.failure.kind !== 'cancelled') error = run.outcome.failure.message;
        }
        if (error != null) emit({ type: 'run_failed', error });
        // The scripts that the run reports and that didn't settle
        for (const script of selected) {
            if (outcomes.has(script)) continue;
            outcomes.set(script, 'not run');
            const reason = interrupted ? 'interrupted' : scriptFailed ? 'the run stopped' : 'the run failed';
            emit({ type: 'script_not_run', script, reason });
        }
        const tally = (outcome: ScriptOutcome) => [...outcomes.entries()].filter(([script, value]) => value === outcome && (outcome !== 'ok' || selected.includes(script))).length;
        emit({
            type: 'run_finished', ms: performance.now() - runStarted, interrupted,
            ok: tally('ok'), failed: tally('failed'), cancelled: tally('cancelled'), notRun: tally('not run'),
        });
        if (interrupted) return 'interrupted';
        const allOk = error == null && selected.every(script => outcomes.get(script) === 'ok') && tally('failed') + tally('cancelled') + tally('not run') === 0;
        return allOk ? 'ok' : 'failed';
    } finally {
        stopProgress?.();
    }
}
