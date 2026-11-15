// dashql run: runs the scripts of a workbook folder on their connections, like the Run of the workbook in the app
import type * as arrow from 'apache-arrow';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import type * as connection from '@ankoh/dashql-jsonschema/connection.js';

import { connectEmbeddedHyper } from '@ankoh/dashql-runtime/connections/embedded/embedded_database_channel';
import type { ConnectionState } from '@ankoh/dashql-runtime/connections/connection_state';
import type { QueryExecutor } from '@ankoh/dashql-runtime/connections/query_execution_args';
import { openNodeComputeDatabase, type NodeComputeDatabase } from '@ankoh/dashql-runtime/node/node_hyperdb';
import { createNodePlatform } from '@ankoh/dashql-runtime/node/node_platform';
import { NODE_FILE_SYSTEM } from '@ankoh/dashql-runtime/node/node_file_system';
import { LogLevel, type LogRecord } from '@ankoh/dashql-runtime/platform/logger/log_buffer';
import { LoggableException, Logger } from '@ankoh/dashql-runtime/platform/logger/logger';
import { createRuntime, type Runtime } from '@ankoh/dashql-runtime/runtime';
import { JOURNAL_TARGET, SESSION_JOURNAL_FOLDER, journalFilesMarker } from '@ankoh/dashql-runtime/session/workbook_journal';
import { NativeStorageBackend } from '@ankoh/dashql-runtime/storage/native_storage_backend';
import { QUERY_RESULT_CACHE_DIRECTORY } from '@ankoh/dashql-runtime/storage/opfs_query_result_cache';
import { STORAGE_WORKBOOK_FILE } from '@ankoh/dashql-runtime/storage/storage_backend';
import {
    mergeRestoredWorkbookIntoScripts,
    restoreSingleWorkbook,
} from '@ankoh/dashql-runtime/workbook/persistence/app_state_loader';
import { mirrorWorkbookAttachments } from '@ankoh/dashql-runtime/workbook/attachments/attachment_mirror';
import { runWorkbookExecution, type ScriptRunEvent, type WorkbookExecutionState } from '@ankoh/dashql-runtime/workbook/scripts/workbook_execution';
import { scriptResultOwner, type WorkbookScripts } from '@ankoh/dashql-runtime/workbook/scripts/workbook_scripts';

import { EXIT_FAILED, EXIT_INTERRUPTED, EXIT_OK, EXIT_USAGE, type CliProcess } from './cli_process.js';
import type { RunEvent, RunReporter } from './run_events.js';
import { JournalRunReporter } from './run_journal.js';
import { LiveRunReporter } from './run_live.js';
import { PlainRunReporter } from './run_output.js';
import { openSessionJournal, workbookFolderPaths, type SessionJournal } from './session_journal.js';

const RUN_USAGE = `Usage: dashql run [--rows <n>] [--refresh] [--plain] [--workspace <dir>] [--verbose] <workbook-dir> [<script>...]

Runs the scripts of a workbook folder on their connections like the Run of the workbook in DashQL, all of them by
default, the named ones with the scripts they reference otherwise. Scripts of different connections run at the same
time, a script runs once the scripts it references are done. The run stops at the first statement that fails. Prints
the schema, the row count and the first rows of every result (--rows, 10 by default), and the Parquet file of the
result in the query result cache.

On a terminal the run shows what runs and what waits while it runs, otherwise and with --plain it prints a few lines
per script once it settled and a summary at the end.

A script whose result is cached is not run again unless a script it follows runs, --refresh runs every script. The
connections that statements run on are set up first, a result that the cache serves needs none. The scripts of a
connection that can't be set up are not run.

The files of DashQL are in a folder with the layout of the storage of the app: the query result cache in cache/, the
attachments of the workbooks in workbooks/<id>/attachments. It is DASHQL_HOME, or the .dashql/ of the workspace, which
dashql session serve creates in the folder of its session, or ~/.dashql. The workspace is the folder that the harness
works in, the invoking directory unless --workspace names it. In a session, run appends its log to the journal there.

Connections: Trino with basic auth and the embedded Hyper. DASHQL_TRINO_USER and DASHQL_TRINO_PASSWORD override the
user and the password of the workbook.

--verbose prints the log of the runtime to stderr.`;

/// The rows of a result that are printed by default
const DEFAULT_ROWS = 10;
/// How often the progress of the running queries is read, for the live view and for the journal
const LIVE_PROGRESS_INTERVAL_MS = 100;
const JOURNAL_PROGRESS_INTERVAL_MS = 1000;

/// The files and the credentials of the process
export interface RunEnvironment {
    /// The folder of the files of DashQL (DASHQL_HOME), null for the `.dashql/` of the workspace, which
    /// `dashql session serve` creates in the folder of its session, or `~/.dashql`
    home: string | null;
    trinoUser?: string;
    trinoPassword?: string;
}

export function processRunEnvironment(): RunEnvironment {
    return {
        home: process.env.DASHQL_HOME || null,
        trinoUser: process.env.DASHQL_TRINO_USER || undefined,
        trinoPassword: process.env.DASHQL_TRINO_PASSWORD || undefined,
    };
}

interface RunArgs {
    workbook: string;
    /// The folder that the harness works in, the invoking directory by default
    workspace: string | null;
    scripts: string[];
    rows: number;
    refresh: boolean;
    /// Print lines also on a terminal
    plain: boolean;
    verbose: boolean;
}

/// Parse the arguments, an error message if they are invalid
function parseRunArgs(args: string[]): RunArgs | string {
    let rows = DEFAULT_ROWS;
    let verbose = false;
    let refresh = false;
    let plain = false;
    let workspace: string | null = null;
    const positional: string[] = [];
    for (let i = 0; i < args.length; ++i) {
        const arg = args[i];
        if (arg === '--rows') {
            const value = args[++i];
            if (value == null || !/^\d+$/.test(value)) return '--rows takes a number';
            rows = Number(value);
        } else if (arg === '--verbose') {
            verbose = true;
        } else if (arg === '--refresh') {
            refresh = true;
        } else if (arg === '--plain') {
            plain = true;
        } else if (arg === '--workspace') {
            const value = args[++i];
            if (value == null || value.startsWith('-')) return '--workspace takes a folder';
            workspace = value;
        } else if (arg.startsWith('-')) {
            return `unknown option ${arg}`;
        } else {
            positional.push(arg);
        }
    }
    if (positional.length === 0) return 'missing the workbook folder';
    const [workbook, ...scripts] = positional;
    return { workbook, workspace, scripts, rows, refresh, plain, verbose };
}

/// The logger of a run: prints the records with --verbose, writes them from info on into the journal of a session
class RunLogger extends Logger {
    constructor(
        private readonly print: ((record: LogRecord) => void) | null,
        private readonly journal: SessionJournal | null,
    ) {
        super();
    }

    public destroy(): void { }

    protected flushPendingRecords(): void {
        const pending = this.pendingRecords;
        this.pendingRecords = [];
        for (const record of pending) {
            this.outputBuffer.push(record);
            this.print?.(record);
            if (record.level >= LogLevel.Info) this.journal?.write(record);
        }
    }
}

/// A log record in one line
function logLine(record: LogRecord): string {
    const values = Object.entries(record.keyValues).map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(',') : value}`).join(' ');
    return `${LogLevel[record.level].toLowerCase()} ${record.target}: ${record.message}${values.length > 0 ? ` ${values}` : ''}\n`;
}

/// The message of an error: what Trino says, the status of a failed request, or why a request failed
function describeError(error: unknown): string {
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

/// What a connection is in the output
function connectionLabel(conn: ConnectionState): string {
    const params = conn.params;
    if ('trino' in params) return `trino ${params.trino.endpoint}`;
    if ('hyper' in params) return params.hyper.protocol === 'WASM' ? 'the embedded hyper' : `hyper ${params.hyper.endpoint ?? ''}`.trim();
    if ('salesforce' in params) return 'salesforce';
    return 'dbcom';
}

/// Set up a connection and check that it answers, an error message if it can't be set up: Trino with basic auth and the
/// embedded Hyper, also a local cloud on it. The runtime sets it up, the embedded Hyper of the run is its channel.
async function setupConnection(rt: Runtime, conn: ConnectionState, env: RunEnvironment, hyper: NodeComputeDatabase | null, signal: AbortSignal): Promise<string | null> {
    const params = conn.params;
    let options: { channelParams?: connection.TrinoConnectionParams } = {};
    if ('hyper' in params && (params.hyper.protocol ?? 'WASM') === 'WASM') {
        if (hyper == null) return 'the script runs on the embedded Hyper, which did not start';
    } else if (!('trino' in params)) {
        return `dashql run reaches Trino and the embedded Hyper only, this script runs on ${connectionLabel(conn)}`;
    } else {
        const auth = params.trino.auth;
        if (auth?.authType === 'AUTH_OAUTH') {
            return 'the connection signs in with OAuth, dashql run supports basic auth only';
        }
        // A connection saves the params it was set up with once it is online, and saved params are written into the
        // workbook. The connection keeps the params of the workbook, the credentials of the environment stay in the channel.
        const channelParams: connection.TrinoConnectionParams = {
            ...(params.trino as connection.TrinoConnectionParams),
            auth: {
                authType: 'AUTH_BASIC',
                basic: {
                    username: env.trinoUser ?? auth?.basic?.username ?? '',
                    secret: env.trinoPassword ?? auth?.basic?.secret ?? '',
                },
            },
        };
        options = { channelParams };
    }
    const cancel = () => rt.coreRuntime.cancelSetup(conn.connectionId);
    signal.addEventListener('abort', cancel, { once: true });
    try {
        const outcome = await rt.coreRuntime.setupConnection(conn.connectionId, {
            channelParams: options.channelParams == null ? undefined : { trino: options.channelParams },
        });
        if (outcome.status === 'succeeded') return null;
        return describeError(new LoggableException(outcome.message ?? 'the connection could not be set up', outcome.data, 'connection_setup'));
    } finally {
        signal.removeEventListener('abort', cancel);
    }
}

/// The root of the files of DashQL of a workspace: its `.dashql/`, which `dashql session serve` creates in the folder of
/// its session, or `~/.dashql` outside a session
function dashqlRootOf(workspace: string): string {
    const root = path.join(workspace, SESSION_JOURNAL_FOLDER);
    return existsSync(root) ? root : path.join(homedir(), SESSION_JOURNAL_FOLDER);
}

/// Load the workbook of a folder into the runtime
async function loadWorkbook(rt: Runtime, storage: NativeStorageBackend): Promise<WorkbookScripts> {
    // The folder is the workbook, its file names its id
    const { workbookId } = await storage.loadWorkbook('');
    const core = await rt.platform.setupCore('run');
    rt.coreRuntime.setCore(core);
    rt.storageWriter.provideCore(core);
    // The connections save through the writer of the runtime
    await rt.storageWriter.withNativeWriter(async native => rt.coreRuntime.setStorageWriter(native));
    const restored = await restoreSingleWorkbook(rt.coreRuntime, storage, rt.logger, workbookId, rt.coreRuntime.registry(), rt.storageWriter);
    rt.workbooks.store.update(registry => mergeRestoredWorkbookIntoScripts(registry, restored));
    return restored.workbookScripts;
}

/// A query of the run
interface RunQuery {
    connectionId: string;
    /// The script of the query, null for a query of no script, e.g. a health check
    script: string | null;
    /// The statement that was sent
    statement: string;
    execution: Promise<arrow.Table | null>;
}

/// What happened to a script, the summary counts it
type ScriptOutcome = 'ok' | 'failed' | 'cancelled' | 'not run';

/// Run `dashql run` with its arguments, returns the exit code
export async function runRun(args: string[], cli: CliProcess, env: RunEnvironment = processRunEnvironment()): Promise<number> {
    if (args.includes('-h') || args.includes('--help')) {
        cli.stdout(`${RUN_USAGE}\n`);
        return EXIT_OK;
    }
    const parsed = parseRunArgs(args);
    if (typeof parsed === 'string') {
        cli.stderr(`error: ${parsed}\n\n${RUN_USAGE}\n`);
        return EXIT_USAGE;
    }
    const dir = path.resolve(cli.cwd, parsed.workbook);
    // The folder that the harness works in, the folder of its session
    const workspace = path.resolve(cli.cwd, parsed.workspace ?? '.');
    if (!existsSync(path.join(dir, STORAGE_WORKBOOK_FILE))) {
        cli.stderr(`error: ${parsed.workbook} is no workbook folder, it has no ${STORAGE_WORKBOOK_FILE}\n`);
        return EXIT_USAGE;
    }

    // An interrupt stops the run: it cancels the running queries, also one during the start
    const stop = new AbortController();
    const interrupt = () => stop.abort();
    if (cli.interrupt?.aborted) interrupt();
    else cli.interrupt?.addEventListener('abort', interrupt, { once: true });

    // In a session the log of the run goes into its journal, with markers of what changed
    const journal = openSessionJournal(workspace, dir);
    const logger = new RunLogger(parsed.verbose ? record => { if (record.level >= LogLevel.Info) cli.stderr(logLine(record)); } : null, journal);
    const storage = new NativeStorageBackend(dir, NODE_FILE_SYSTEM);
    // The embedded Hyper writes the results into the query result cache of the root and reads the results of other
    // connections and the attachments. Without it the scripts on Trino still run, nothing is written.
    let hyper: NodeComputeDatabase | null = null;
    try {
        hyper = await openNodeComputeDatabase(env.home ?? dashqlRootOf(workspace));
    } catch (error) {
        cli.stderr(`warning: the embedded Hyper did not start, results are not written: ${describeError(error)}\n`);
    }
    const embedded = hyper?.database ?? null;
    const runtime = createRuntime({
        ...createNodePlatform({ logger, storage }),
        setupCore: () => cli.setupCore(),
        computeDatabase: embedded,
        resultCache: hyper?.resultCache ?? null,
        // The embedded Hyper of the run is the channel of its connections to the embedded Hyper
        channels: {
            connect: async (_connectionId, request) => {
                if (request.type !== 'hyper' || request.kind !== 'embedded' || embedded == null) {
                    throw new Error('dashql run connects the embedded Hyper only');
                }
                return await connectEmbeddedHyper(embedded, request.params);
            },
        },
    });
    const reporters: RunReporter[] = [];
    let progressTimer: ReturnType<typeof setInterval> | null = null;
    try {
        // A run doesn't describe the connections, it only runs the scripts
        runtime.coreRuntime.runCatalogLoader(false);
        let workbook: WorkbookScripts;
        try {
            workbook = await loadWorkbook(runtime, storage);
        } catch (error) {
            cli.stderr(`error: ${parsed.workbook} could not be loaded: ${describeError(error)}\n`);
            return EXIT_USAGE;
        }
        const { workbookId } = workbook;

        // The scripts by their file names, `scripts/a.sql` names `a.sql`
        const files = [...workbook.scriptOrder];
        const unknown = parsed.scripts.map(script => path.basename(script)).filter(file => !files.includes(file));
        if (unknown.length > 0) {
            cli.stderr(`error: the workbook has no script ${unknown.join(', ')}, its scripts are ${files.join(', ') || 'none'}\n`);
            return EXIT_USAGE;
        }
        const requested = new Set(parsed.scripts.map(script => path.basename(script)));
        const selected = requested.size === 0 ? files : files.filter(file => requested.has(file));
        // The script of a query by the owner of its result
        const scriptOfOwner = new Map(files.map(file => [scriptResultOwner(workbookId, workbook.scriptRefs[file].scriptId), file]));

        // The embedded Hyper reads the attachments from the root, like the app reads them from its storage
        if (hyper != null) await mirrorWorkbookAttachments(storage, workbookId);

        // A terminal shows the live view, agents and pipes get lines. The journal of a session gets the markers.
        const live = cli.terminal != null && !parsed.plain;
        reporters.push(live
            ? new LiveRunReporter(cli.stdout, cli.terminal!, cli.style, parsed.rows, cli.cwd)
            : new PlainRunReporter(cli.stdout, cli.style, parsed.rows, cli.cwd));
        if (journal != null) {
            const ref = { workbook: journal.workbook, workbookId };
            // The files of the folder, the agent may have changed them
            const { message, keyValues } = journalFilesMarker(ref, await workbookFolderPaths(storage));
            logger.info(message, keyValues, JOURNAL_TARGET);
            reporters.push(new JournalRunReporter(logger, ref));
        }
        const emit = (event: RunEvent) => { for (const reporter of reporters) reporter.event(event); };
        const runStarted = performance.now();
        emit({ type: 'run_started', workbook: parsed.workbook, scripts: selected });

        // The connections are set up before the first statement, all at once. A failure is reported here, the run
        // leaves out the scripts of the connection.
        const prepareConnection = async (connectionId: string) => {
            const conn = runtime.coreRuntime.connection(connectionId);
            if (conn == null) throw new Error(`the workbook has no connection ${connectionId}`);
            const label = connectionLabel(conn);
            const started = performance.now();
            emit({ type: 'connection_setup', connection: label });
            const failure = await setupConnection(runtime, conn, env, hyper, stop.signal);
            if (failure != null) {
                emit({ type: 'connection_failed', connection: label, error: stop.signal.aborted ? 'interrupted' : failure });
                throw new Error(failure);
            }
            emit({ type: 'connection_ready', connection: label, ms: performance.now() - started });
        };

        // The queries of the run with their scripts. The results are printed, the run doesn't analyze them.
        const queries = new Map<number, RunQuery>();
        const running = new Set<number>();
        // The statement that failed in a script, the error points into it
        const failedStatements = new Map<string, string>();
        const execute: QueryExecutor = (connectionId, queryArgs) => {
            const [queryId, execution] = runtime.coreRuntime.execute(connectionId, { ...queryArgs, analyzeResults: false });
            const script = scriptOfOwner.get(queryArgs.metadata.resultOwner ?? '') ?? null;
            queries.set(queryId, { connectionId, script, statement: queryArgs.query, execution });
            running.add(queryId);
            execution.then(
                () => { running.delete(queryId); },
                () => {
                    running.delete(queryId);
                    if (script != null && !failedStatements.has(script)) failedStatements.set(script, queryArgs.query);
                });
            return [queryId, execution];
        };

        // The progress of the running queries, sent when it changed
        const lastProgress = new Map<string, string>();
        const sampleProgress = () => {
            for (const queryId of running) {
                const query = queries.get(queryId)!;
                if (query.script == null) continue;
                const update = runtime.coreRuntime.query(queryId)?.latestProgressUpdate;
                if (update == null) continue;
                const progress = { phase: update.phase ?? null, percent: update.progressPercent ?? null, rows: update.rowsProcessed ?? null };
                const text = JSON.stringify(progress);
                if (lastProgress.get(query.script) === text) continue;
                lastProgress.set(query.script, text);
                emit({ type: 'script_progress', script: query.script, ...progress });
            }
        };
        if (live || journal != null) {
            progressTimer = setInterval(sampleProgress, live ? LIVE_PROGRESS_INTERVAL_MS : JOURNAL_PROGRESS_INTERVAL_MS);
        }

        // What happened to the scripts. The events of the runtime arrive in order, a result is read before it is
        // reported, so the reports wait for each other.
        const outcomes = new Map<string, ScriptOutcome>();
        const startedAt = new Map<string, number>();
        const elapsed = (script: string) => performance.now() - (startedAt.get(script) ?? runStarted);
        let reports = Promise.resolve();
        const report = (task: () => Promise<RunEvent | null>) => {
            reports = reports.then(task).then(event => { if (event != null) emit(event); }, error => {
                logger.warn('Reporting a script failed', { error: describeError(error) });
            });
        };
        const resultOf = async (script: string, queryId: number | null, key: string | null, cached: boolean): Promise<RunEvent> => {
            const ms = elapsed(script);
            const table = queryId == null ? null : await (queries.get(queryId)?.execution ?? Promise.resolve(null));
            // The executor writes the result into the cache after the query resolved
            await runtime.coreRuntime.flushCacheWrites();
            const entry = hyper == null || key == null ? null : await hyper.resultCache.lookup(key);
            const file = entry == null ? null : path.join(hyper!.root, QUERY_RESULT_CACHE_DIRECTORY, entry.name);
            return { type: 'script_done', script, ms, table, cached, key: entry?.key ?? null, file };
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
                    report(async () => ({ type: 'script_failed', script, ms, error: describeError(event.error), statement: failedStatements.get(script) ?? null }));
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

        let state: WorkbookExecutionState | null = null;
        if (!stop.signal.aborted) {
            const services = runtime.execution.scriptRunServices;
            await runWorkbookExecution({
                workbook: runtime.workbooks.store.current.workbookScriptsMap.get(workbookId)!,
                getWorkbook: () => runtime.workbooks.store.current.workbookScriptsMap.get(workbookId) ?? null,
                targets: requested.size === 0 ? undefined : selected.map(file => files.indexOf(file)),
                executeQuery: execute,
                cancelQuery: (connectionId, queryId) => runtime.coreRuntime.cancel(connectionId, queryId),
                modifyWorkbookScripts: action => runtime.workbooks.dispatch(workbookId, action),
                signal: stop.signal,
                onState: next => { state = next; },
                mounts: services.createMounts(),
                mountAttachments: services.mountAttachments,
                resultKey: services.cacheKey,
                cachesResults: services.cachesResults,
                cache: services.cache,
                refresh: parsed.refresh,
                maxConcurrentQueries: services.maxConcurrentQueries,
                prepareConnection,
                onScript,
                logger,
            });
        }
        await reports;
        if (progressTimer != null) clearInterval(progressTimer);
        progressTimer = null;

        const interrupted = stop.signal.aborted;
        const final = state as WorkbookExecutionState | null;
        // An error of the run itself, e.g. a script that can't be planned; a failed script reported its own
        const scriptFailed = [...outcomes.values()].includes('failed');
        let error: string | null = null;
        if (!interrupted && !scriptFailed) {
            if (final == null) error = 'the workbook is running elsewhere';
            else if (final.phase === 'failed') error = final.error ?? 'the run failed';
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
        if (interrupted) {
            cli.stderr('interrupted\n');
            return EXIT_INTERRUPTED;
        }
        const allOk = error == null && selected.every(script => outcomes.get(script) === 'ok') && tally('failed') + tally('cancelled') + tally('not run') === 0;
        return allOk ? EXIT_OK : EXIT_FAILED;
    } finally {
        if (progressTimer != null) clearInterval(progressTimer);
        for (const reporter of reporters) reporter.close();
        cli.interrupt?.removeEventListener('abort', interrupt);
        await runtime.destroy();
        await hyper?.close();
    }
}
