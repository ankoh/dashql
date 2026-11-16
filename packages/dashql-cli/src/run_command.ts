// dashql run: runs the scripts of a workbook folder on their connections, like the Run of the workbook in the app
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import type * as connection from '@ankoh/dashql-jsonschema/connection.js';

import { connectEmbeddedHyper } from '@ankoh/dashql/platform/connections/embedded_database_channel';
import type { ConnectionState } from '@ankoh/dashql/platform/connections/connection_state';
import { openNodeComputeDatabase, type NodeComputeDatabase } from '@ankoh/dashql/platform/node/node_hyperdb';
import { createNodePlatform } from '@ankoh/dashql/runtime/node/node_platform';
import { NODE_FILE_SYSTEM } from '@ankoh/dashql/platform/node/node_file_system';
import { LogLevel, type LogRecord } from '@ankoh/dashql/platform/logger/log_buffer';
import { LoggableException, Logger } from '@ankoh/dashql/platform/logger/logger';
import { createRuntime, type RunResult, type Runtime } from '@ankoh/dashql/runtime/runtime';
import { JOURNAL_TARGET, SESSION_JOURNAL_FOLDER, journalFilesMarker } from '@ankoh/dashql/platform/session/workbook_journal';
import { NativeStorageBackend } from '@ankoh/dashql/platform/storage/native_storage_backend';
import { QUERY_RESULT_CACHE_DIRECTORY } from '@ankoh/dashql/platform/storage/opfs_query_result_cache';
import { STORAGE_WORKBOOK_FILE } from '@ankoh/dashql/platform/storage/storage_backend';
import { mirrorWorkbookAttachments } from '@ankoh/dashql/platform/workbook/attachment_mirror';
import type { ScriptRunEvent } from '@ankoh/dashql/platform/workbook/workbook_execution';
import { scriptResultOwner, type WorkbookScripts } from '@ankoh/dashql/platform/workbook/workbook_scripts';

import { EXIT_FAILED, EXIT_INTERRUPTED, EXIT_OK, EXIT_USAGE, type CliProcess } from './cli_process.js';
import type { RunEvent, RunReporter } from './run_events.js';
import { JournalRunReporter } from './run_journal.js';
import { LiveRunReporter } from './run_live.js';
import { PlainRunReporter } from './run_output.js';
import { openSessionJournal, readSessionConnections, readSessionServer, SESSION_NAME_ENV, workbookFolderPaths, type SessionJournal } from './session_journal.js';
import { NoSessionLogins, RelayedConnections } from './run_relay.js';

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
user and the password of the workbook. In a session of dashql connect also Trino with OAuth and Salesforce: the process
of dashql connect logs in, the user clicks Log in in the tab of DashQL, and the run reaches them through it. There a
Trino connection with basic auth gets the password of the tab, unless DASHQL_TRINO_PASSWORD is set.

--verbose prints the log of the runtime to stderr.`;

/// The redirect page of the login of a Salesforce connection in a run: the run logs in with a stand-in, nothing opens
/// the page, the setup needs one
const RELAYED_OAUTH_REDIRECT = 'https://dashql.app/oauth.html';

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
    /// The session of `dashql connect` that the command runs in (DASHQL_SESSION), its journal gets the log
    session?: string | null;
    /// The server of that session (DASHQL_SESSION_ENDPOINT, DASHQL_SESSION_TOKEN), else the folder of the session names it
    sessionEndpoint?: string;
    sessionToken?: string;
}

export function processRunEnvironment(): RunEnvironment {
    return {
        home: process.env.DASHQL_HOME || null,
        trinoUser: process.env.DASHQL_TRINO_USER || undefined,
        trinoPassword: process.env.DASHQL_TRINO_PASSWORD || undefined,
        session: process.env[SESSION_NAME_ENV] || null,
        sessionEndpoint: process.env.DASHQL_SESSION_ENDPOINT || undefined,
        sessionToken: process.env.DASHQL_SESSION_TOKEN || undefined,
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

/// Set up a connection and check that it answers, an error message if it can't be set up: Trino and the embedded Hyper,
/// also a local cloud on it, and in a session of dashql connect Salesforce. The runtime sets it up, the embedded Hyper
/// of the run is its channel. In a session, the connections that log in through the tab go through the process of
/// dashql connect: it logs in, the user in the tab, and the requests go through its relay.
async function setupConnection(
    rt: Runtime,
    conn: ConnectionState,
    env: RunEnvironment,
    hyper: NodeComputeDatabase | null,
    relayed: RelayedConnections | null,
    signal: AbortSignal,
): Promise<string | null> {
    const params = conn.params;
    const login = async () => {
        try {
            return await relayed!.login(conn.connectionId, connectionLabel(conn), params, signal);
        } catch (error) {
            return error instanceof NoSessionLogins ? null : `the login failed: ${describeError(error)}`;
        }
    };
    if ('hyper' in params && (params.hyper.protocol ?? 'WASM') === 'WASM') {
        if (hyper == null) return 'the script runs on the embedded Hyper, which did not start';
        return await finishSetup(rt, conn, {}, signal);
    }
    if ('salesforce' in params || 'dbcom' in params) {
        if (relayed == null) return 'the connection signs in to Salesforce, dashql run reaches it in a session of dashql connect only';
        const logged = await login();
        if (logged == null) return 'the connection signs in to Salesforce, the session logs in to nothing, start it with dashql connect';
        if (typeof logged === 'string') return logged;
        // The redirect page of the stand-in login is never opened, the setup needs one
        return await finishSetup(rt, conn, { oauthRedirect: RELAYED_OAUTH_REDIRECT }, signal);
    }
    if (!('trino' in params)) {
        return `dashql run reaches Trino, Salesforce and the embedded Hyper only, this script runs on ${connectionLabel(conn)}`;
    }
    const auth = params.trino.auth;
    if (auth?.authType === 'AUTH_OAUTH') {
        if (relayed == null) return 'the connection signs in with OAuth, dashql run reaches it in a session of dashql connect only';
        const logged = await login();
        if (logged == null) return 'the connection signs in with OAuth, the session logs in to nothing, start it with dashql connect';
        if (typeof logged === 'string') return logged;
        return await finishSetup(rt, conn, {}, signal);
    }
    // Basic auth: the password of the environment, else the one of the tab through the relay, else the one of the
    // workbook. A connection saves the params it was set up with once it is online, and saved params are written into
    // the workbook. The connection keeps the params of the workbook, the credentials stay in the channel.
    let username = env.trinoUser ?? auth?.basic?.username ?? '';
    let secret = env.trinoPassword ?? auth?.basic?.secret ?? '';
    if (env.trinoPassword == null && relayed != null) {
        const logged = await login();
        if (typeof logged === 'string') return logged;
        if (logged != null) {
            // The relay puts the user and the password of the tab in, the user keys the cached results
            username = logged.principal ?? username;
            secret = '';
        }
    }
    const channelParams: connection.TrinoConnectionParams = {
        ...(params.trino as connection.TrinoConnectionParams),
        auth: { authType: 'AUTH_BASIC', basic: { username, secret } },
    };
    return await finishSetup(rt, conn, { channelParams }, signal);
}

/// Let the runtime set up a connection, an error message if it can't be set up
async function finishSetup(
    rt: Runtime,
    conn: ConnectionState,
    options: { channelParams?: connection.TrinoConnectionParams; oauthRedirect?: string },
    signal: AbortSignal,
): Promise<string | null> {
    const cancel = () => rt.cancelSetup(conn.connectionId);
    signal.addEventListener('abort', cancel, { once: true });
    try {
        const outcome = await rt.setupConnection(conn.connectionId, {
            channelParams: options.channelParams == null ? undefined : { trino: options.channelParams },
            oauthRedirect: options.oauthRedirect,
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

/// Load the workbook of a folder into the runtime: the storage of the runtime is the folder, the runtime restores its
/// workbook with the connections that it names
async function loadWorkbook(rt: Runtime, storage: NativeStorageBackend): Promise<WorkbookScripts> {
    // The folder is the workbook, its file names its id. A folder of an older version of the app is brought to the
    // current format first.
    await rt.module.migrateWorkbookFolder('');
    const { workbookId } = await storage.loadWorkbook('');
    await rt.restoreWorkbook(workbookId);
    const workbook = rt.store.get('workbook', workbookId);
    if (workbook == null) throw new Error(`the workbook ${workbookId} was not restored`);
    return workbook;
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
    const journal = openSessionJournal(workspace, dir, env.session ?? null);
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
    // In a session of dashql connect, the connections that log in through the tab go through the process of dashql connect
    const server = readSessionServer(workspace, env.session ?? null, { endpoint: env.sessionEndpoint, token: env.sessionToken });
    const relayed = server == null ? null : new RelayedConnections(server);
    const platform = await createNodePlatform({ logger, storage, core: await cli.setupCore(), oauthFlow: relayed?.oauthFlow() });
    const runtime = createRuntime({
        ...platform,
        http: relayed?.http() ?? platform.http,
        computeDatabase: embedded == null ? null : async () => embedded,
        resultCache: hyper?.resultCache ?? null,
        // A run doesn't describe the connections, it only runs the scripts
        catalogLoader: false,
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
    let stopProgress: (() => void) | null = null;
    try {
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
            const conn = runtime.connection(connectionId);
            if (conn == null) throw new Error(`the workbook has no connection ${connectionId}`);
            const label = connectionLabel(conn);
            const started = performance.now();
            emit({ type: 'connection_setup', connection: label });
            // The tab of the session lets the agent use the connections that the user picked
            const allowed = readSessionConnections(workspace, env.session ?? null);
            const failure = allowed != null && !allowed.connections.some(other => other.connectionId === connectionId)
                ? 'the tab of DashQL does not let the agent use this connection, the user can allow it in the prompt'
                : await setupConnection(runtime, conn, env, hyper, relayed, stop.signal);
            if (failure != null) {
                emit({ type: 'connection_failed', connection: label, error: stop.signal.aborted ? 'interrupted' : failure });
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
        if (live || journal != null) {
            const interval = live ? LIVE_PROGRESS_INTERVAL_MS : JOURNAL_PROGRESS_INTERVAL_MS;
            let sample: ReturnType<typeof setTimeout> | null = null;
            const unsubscribe = runtime.store.subscribeKind('query', () => {
                sample ??= setTimeout(() => {
                    sample = null;
                    sampleProgress();
                }, interval);
            });
            stopProgress = () => {
                unsubscribe();
                if (sample != null) clearTimeout(sample);
                sample = null;
            };
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
            // The history of the connection keeps the result table of the query
            const table = queryId == null ? null : runtime.table(queryOf(queryId)?.resultTable?.id) ?? null;
            // The executor writes the result into the cache after the query resolved
            await runtime.module.flushCacheWrites();
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
                    // The statement that failed, the error points into it
                    const statement = event.queryId == null ? null : queryOf(event.queryId)?.queryText ?? null;
                    report(async () => ({ type: 'script_failed', script, ms, error: describeError(event.error), statement }));
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

        // The run stops on an interrupt
        const stopRun = () => runtime.stopRun(workbookId);
        stop.signal.addEventListener('abort', stopRun, { once: true });
        let run: RunResult | null = null;
        try {
            if (!stop.signal.aborted) {
                run = await runtime.runWorkbook(workbookId, {
                    targets: requested.size === 0 ? undefined : selected.map(file => files.indexOf(file)),
                    refresh: parsed.refresh,
                    // The results are printed, the run doesn't analyze them
                    analyze: false,
                }, { onScript, prepareConnection });
            }
        } finally {
            stop.signal.removeEventListener('abort', stopRun);
        }
        await reports;
        stopProgress?.();
        stopProgress = null;

        const interrupted = stop.signal.aborted;
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
        if (interrupted) {
            cli.stderr('interrupted\n');
            return EXIT_INTERRUPTED;
        }
        const allOk = error == null && selected.every(script => outcomes.get(script) === 'ok') && tally('failed') + tally('cancelled') + tally('not run') === 0;
        return allOk ? EXIT_OK : EXIT_FAILED;
    } finally {
        stopProgress?.();
        for (const reporter of reporters) reporter.close();
        cli.interrupt?.removeEventListener('abort', interrupt);
        await runtime.destroy();
        await hyper?.close();
    }
}
