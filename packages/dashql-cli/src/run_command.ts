// dashql run: runs the scripts of a workbook folder on their connections, like the Run of the workbook in the app
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type * as connection from '@akohn/dashql-jsonschema/connection.js';

import { connectEmbeddedHyper } from '@akohn/dashql/platform/connections/embedded_database_channel';
import type { ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import type { AgentSessionChartSize } from '@akohn/dashql/platform/session/agent_session_client';
import { openNodeComputeDatabase, type NodeComputeDatabase } from '@akohn/dashql/platform/node/node_hyperdb';
import { createNodePlatform } from '@akohn/dashql/runtime/node/node_platform';
import { NODE_FILE_SYSTEM } from '@akohn/dashql/platform/node/node_file_system';
import { LogLevel, type LogRecord } from '@akohn/dashql/platform/logger/log_buffer';
import { LoggableException, Logger } from '@akohn/dashql/platform/logger/logger';
import { createRuntime, type Runtime } from '@akohn/dashql/runtime/runtime';
import { describeRunError, runScriptsOf, runWorkbookReported, type ReportedRunEnd } from '@akohn/dashql/runtime/workbook_run_report';
import { NativeStorageBackend } from '@akohn/dashql/platform/storage/native_storage_backend';
import { QUERY_RESULT_CACHE_DIRECTORY } from '@akohn/dashql/platform/storage/opfs_query_result_cache';
import { STORAGE_SCRIPTS_FOLDER, STORAGE_WORKBOOK_FILE } from '@akohn/dashql/platform/storage/storage_backend';
import { SqlLinter } from './sql_lint.js';
import { formatReportFile } from './sql_report.js';
import { mirrorWorkbookAttachments } from './attachment_mirror.js';
import type { WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';

import { EXIT_FAILED, EXIT_INTERRUPTED, EXIT_OK, EXIT_USAGE, type CliProcess } from './cli_process.js';
import type { RunEvent, RunReporter } from './run_events.js';
import { LiveRunReporter } from './run_live.js';
import { PlainRunReporter } from './run_output.js';
import { runInTab } from './run_tab.js';
import { copiedWorkbookId, dashqlRoot, isWorkbookCopyFolder, isWorkspace, noWorkspace, readSession, sessionCopiesFolder } from './session_folder.js';

const RUN_USAGE = `Usage: dashql run [-w <dir>] [--rows <n>] [--refresh] [--plain] [--home <dir>] [--verbose] <workbook-dir>
                  [<script>...]

Runs the scripts of a workbook folder on their connections like the Run of the workbook in DashQL, all of them by
default, the named ones with the scripts they reference otherwise. Scripts of different connections run at the same
time, a script runs once the scripts it references are done. The run stops at the first statement that fails. Prints
the schema, the row count and the first rows of every result (--rows, 10 by default), and the Parquet file of the
result in the query result cache.

Scripts with syntax errors are printed with their errors before the run, as dashql lint prints them; the run fails
at their first statement that fails.

On a terminal the run shows what runs and what waits while it runs, otherwise and with --plain it prints a few lines
per script once it settled and a summary at the end.

A script whose result is cached is not run again unless a script it follows runs, --refresh runs every script. The
connections that statements run on are set up first, a result that the cache serves needs none. The scripts of a
connection that can't be set up are not run.

The files of DashQL are in a folder with the layout of the storage of the app: the query result cache in cache/, the
attachments of the workbooks in workbooks/<id>/attachments. It is --home, else the .dashql/ of the workspace, which
the run creates and which ignores itself.

Connections: Trino with basic auth and the embedded Hyper. DASHQL_TRINO_USER and DASHQL_TRINO_PASSWORD override the
user and the password of the workbook.

--workspace (-w) is the folder that you work in, the invoking directory by default: a workspace that dashql init or
dashql connect set up, another folder fails. While a session of dashql connect runs there
(.dashql/session/session.json), only the copies of the workbooks of its tab run
(.dashql/session/workbooks/<workbook id>), and they run in the tab: on the connections of the tab that the agent may
use, as far as the browser reaches them, and the tab shows the run. Every other folder fails, so nothing runs outside
the tab. The run fails when no tab follows the session. Without a session the folder runs in this process, a copy of a
tab only with the workspace of its session.

--verbose prints the log of the runtime to stderr.`;

/// The rows of a result that are printed by default
const DEFAULT_ROWS = 10;
/// How often the progress of the running queries is read for the live view
const LIVE_PROGRESS_INTERVAL_MS = 100;

/// The credentials of the process
export interface RunEnvironment {
    trinoUser?: string;
    trinoPassword?: string;
}

export function processRunEnvironment(): RunEnvironment {
    return {
        trinoUser: process.env.DASHQL_TRINO_USER || undefined,
        trinoPassword: process.env.DASHQL_TRINO_PASSWORD || undefined,
    };
}

interface RunArgs {
    workbook: string;
    workspace: string;
    scripts: string[];
    rows: number;
    refresh: boolean;
    home: string | null;
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
    let home: string | null = null;
    let workspace = '.';
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
        } else if (arg === '--home') {
            const value = args[++i];
            if (value == null || value.startsWith('-')) return '--home takes a folder';
            home = value;
        } else if (arg === '--workspace' || arg === '-w') {
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
    return { workbook, workspace, scripts, rows, refresh, home, plain, verbose };
}

/// The logger of a run: prints the records with --verbose
class RunLogger extends Logger {
    constructor(private readonly print: ((record: LogRecord) => void) | null) {
        super();
    }

    public destroy(): void { }

    protected flushPendingRecords(): void {
        const pending = this.pendingRecords;
        this.pendingRecords = [];
        for (const record of pending) {
            this.outputBuffer.push(record);
            this.print?.(record);
        }
    }
}

/// A log record in one line
function logLine(record: LogRecord): string {
    const values = Object.entries(record.keyValues).map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(',') : value}`).join(' ');
    return `${LogLevel[record.level].toLowerCase()} ${record.target}: ${record.message}${values.length > 0 ? ` ${values}` : ''}\n`;
}

/// Set up a connection and check that it answers, an error message if it can't be set up: Trino with basic auth and
/// the embedded Hyper, also a local cloud on it. The runtime sets it up, the embedded Hyper of the run is its channel.
async function setupConnection(rt: Runtime, conn: ConnectionState, env: RunEnvironment, hyper: NodeComputeDatabase | null, signal: AbortSignal): Promise<string | null> {
    const params = conn.params;
    if ('hyper' in params && (params.hyper.protocol ?? 'WASM') === 'WASM') {
        if (hyper == null) return 'the script runs on the embedded Hyper, which did not start';
        return await finishSetup(rt, conn, null, signal);
    }
    if ('salesforce' in params || 'dbcom' in params) {
        return 'the connection signs in to Salesforce, dashql run reaches it only in the tab of a session of dashql connect';
    }
    if (!('trino' in params)) return 'dashql run reaches Trino and the embedded Hyper only';
    const auth = params.trino.auth;
    if (auth?.authType === 'AUTH_OAUTH') return 'the connection signs in with OAuth, dashql run reaches it only in the tab of a session of dashql connect';
    // Basic auth: the user and the password of the environment, else the ones of the workbook. A connection saves the
    // params it was set up with once it is online, and saved params are written into the workbook. The connection keeps
    // the params of the workbook, the credentials stay in the channel.
    const channelParams: connection.TrinoConnectionParams = {
        ...(params.trino as connection.TrinoConnectionParams),
        auth: { authType: 'AUTH_BASIC', basic: { username: env.trinoUser ?? auth?.basic?.username ?? '', secret: env.trinoPassword ?? auth?.basic?.secret ?? '' } },
    };
    return await finishSetup(rt, conn, channelParams, signal);
}

/// Let the runtime set up a connection, an error message if it can't be set up
async function finishSetup(rt: Runtime, conn: ConnectionState, channelParams: connection.TrinoConnectionParams | null, signal: AbortSignal): Promise<string | null> {
    const cancel = () => rt.cancelSetup(conn.connectionId);
    signal.addEventListener('abort', cancel, { once: true });
    try {
        const outcome = await rt.setupConnection(conn.connectionId, { channelParams: channelParams == null ? undefined : { trino: channelParams } });
        if (outcome.status === 'succeeded') return null;
        return describeRunError(new LoggableException(outcome.message ?? 'the connection could not be set up', outcome.data, 'connection_setup'));
    } finally {
        signal.removeEventListener('abort', cancel);
    }
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

/// The exit code of how a run ended
function exitCode(end: ReportedRunEnd): number {
    return end === 'ok' ? EXIT_OK : end === 'interrupted' ? EXIT_INTERRUPTED : EXIT_FAILED;
}

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
    const workspace = path.resolve(cli.cwd, parsed.workspace);
    if (!isWorkspace(workspace)) {
        cli.stderr(`error: ${noWorkspace(parsed.workspace)}\n`);
        return EXIT_USAGE;
    }
    const dir = path.resolve(cli.cwd, parsed.workbook);
    if (!existsSync(path.join(dir, STORAGE_WORKBOOK_FILE))) {
        cli.stderr(`error: ${parsed.workbook} is no workbook folder, it has no ${STORAGE_WORKBOOK_FILE}\n`);
        return EXIT_USAGE;
    }

    // An interrupt stops the run: it cancels the running queries, also one during the start
    const stop = new AbortController();
    const interrupt = () => stop.abort();
    if (cli.interrupt?.aborted) interrupt();
    else cli.interrupt?.addEventListener('abort', interrupt, { once: true });
    // A terminal shows the live view, agents and pipes get lines
    const live = cli.terminal != null && !parsed.plain;
    const reporters: RunReporter[] = [live
        ? new LiveRunReporter(cli.stdout, cli.terminal!, cli.style, parsed.rows, cli.cwd)
        : new PlainRunReporter(cli.stdout, cli.style, parsed.rows, cli.cwd)];
    const emit = (event: RunEvent) => { for (const reporter of reporters) reporter.event(event); };
    try {
        await printSyntaxErrors(dir, parsed.scripts, cli);
        const run = { ...parsed, workspace, home: parsed.home == null ? null : path.resolve(cli.cwd, parsed.home) };
        return await runWorkbookFolder(run, dir, env, cli, stop.signal, emit, live);
    } finally {
        for (const reporter of reporters) reporter.close();
        cli.interrupt?.removeEventListener('abort', interrupt);
    }
}

/// Print the scripts of a workbook folder with syntax errors, as `dashql lint` prints them: the named ones, else all.
/// Names are not resolved, scripts read tables of their connections and results of other scripts.
async function printSyntaxErrors(dir: string, names: readonly string[], cli: CliProcess): Promise<void> {
    let files: string[];
    try {
        files = readdirSync(path.join(dir, STORAGE_SCRIPTS_FOLDER)).filter(file => file.endsWith('.sql')).sort();
    } catch {
        return;
    }
    const named = new Set(names.map(name => name.split(/[\\/]/).pop() ?? name));
    if (named.size > 0) files = files.filter(file => named.has(file));
    const linter = new SqlLinter(await cli.setupCore());
    for (const file of files) {
        const text = readFileSync(path.join(dir, STORAGE_SCRIPTS_FOLDER, file), 'utf8');
        const errors = linter.lint({ id: `${STORAGE_SCRIPTS_FOLDER}/${file}`, text })
            .filter(diagnostic => diagnostic.severity === 'error' && (diagnostic.stage === 'scan' || diagnostic.stage === 'parse'));
        if (errors.length > 0) cli.stdout(`${formatReportFile(`${STORAGE_SCRIPTS_FOLDER}/${file}`, text, errors, cli.style)}\n\n`);
    }
}

/// What a run of a workbook folder runs
export interface WorkbookFolderRun {
    /// The folder as the user named it, the events name the workbook by it
    workbook: string;
    /// The file names of the scripts that the run reports, all of them without names
    scripts: string[];
    /// The rows of a result that its event carries
    rows: number;
    refresh: boolean;
    verbose: boolean;
    /// The folder that the agent works in, absolute: the session of `dashql connect` there decides where it runs
    workspace: string;
    /// The folder of the files of DashQL, absolute, null for the `.dashql/` of the workspace (`dashqlRoot`)
    home: string | null;
    /// The size of the charts that the tab renders after the results, `dashql vis`; a run in this process renders none
    chart?: AgentSessionChartSize | null;
}

/// Run the scripts of a workbook folder and report the events of the run: while a session of dashql connect runs in
/// the workspace, a copy of its tab runs in the tab and no other folder runs; without a session the folder runs in this
/// process. Returns the exit code, errors go to stderr.
export async function runWorkbookFolder(
    run: WorkbookFolderRun,
    dir: string,
    env: RunEnvironment,
    cli: CliProcess,
    signal: AbortSignal,
    emit: (event: RunEvent) => void,
    live = false,
): Promise<number> {
    const session = readSession(run.workspace);
    if (session == null) {
        // A copy of a tab runs only in its tab
        if (isWorkbookCopyFolder(dir)) {
            cli.stderr(`error: ${run.workbook} is the copy of a workbook of the tab of DashQL, no session of dashql connect runs in ${run.workspace}: pass the --workspace of its session\n`);
            return EXIT_USAGE;
        }
        return await runHere(run, dir, env, cli, signal, emit, live);
    }
    // In a session the agent runs the copies of the tab, the tab runs them, and nothing else
    const copied = copiedWorkbookId(run.workspace, dir);
    if (copied == null) {
        cli.stderr(`error: ${run.workbook} is no copy of a workbook of the tab of DashQL and would run outside the tab, the session of dashql connect in ${run.workspace} runs only its copies in ${sessionCopiesFolder(run.workspace)}/\n`);
        return EXIT_USAGE;
    }
    try {
        const request = { workbookId: copied, label: run.workbook, scripts: run.scripts, refresh: run.refresh, rows: run.rows };
        const end = await runInTab(session, run.chart == null ? request : { ...request, chart: run.chart }, signal, emit);
        if (end === 'interrupted') cli.stderr('interrupted\n');
        return exitCode(end);
    } catch (error) {
        cli.stderr(`error: ${describeRunError(error)}\n`);
        return EXIT_FAILED;
    }
}

/// Run a workbook folder with a runtime of this process
async function runHere(
    parsed: WorkbookFolderRun,
    dir: string,
    env: RunEnvironment,
    cli: CliProcess,
    signal: AbortSignal,
    emit: (event: RunEvent) => void,
    live: boolean,
): Promise<number> {
    const logger = new RunLogger(parsed.verbose ? record => { if (record.level >= LogLevel.Info) cli.stderr(logLine(record)); } : null);
    const storage = new NativeStorageBackend(dir, NODE_FILE_SYSTEM);
    // The embedded Hyper writes the results into the query result cache of the root and reads the results of other
    // connections and the attachments. Without it the scripts on Trino still run, nothing is written.
    let hyper: NodeComputeDatabase | null = null;
    try {
        hyper = await openNodeComputeDatabase(dashqlRoot(parsed.workspace, parsed.home));
    } catch (error) {
        cli.stderr(`warning: the embedded Hyper did not start, results are not written: ${describeRunError(error)}\n`);
    }
    const embedded = hyper?.database ?? null;
    const platform = await createNodePlatform({ logger, storage, core: await cli.setupCore() });
    const runtime = createRuntime({
        ...platform,
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
                return await connectEmbeddedHyper(embedded, request.session);
            },
        },
    });
    try {
        let workbook: WorkbookScripts;
        try {
            workbook = await loadWorkbook(runtime, storage);
        } catch (error) {
            cli.stderr(`error: ${parsed.workbook} could not be loaded: ${describeRunError(error)}\n`);
            return EXIT_USAGE;
        }
        const { unknown } = runScriptsOf(runtime.core, workbook, parsed.scripts);
        if (unknown.length > 0) {
            cli.stderr(`error: the workbook has no script ${unknown.join(', ')}, its scripts are ${workbook.scriptOrder.join(', ') || 'none'}\n`);
            return EXIT_USAGE;
        }
        // The embedded Hyper reads the attachments from the root, like the app reads them from its storage
        if (hyper != null) await mirrorWorkbookAttachments(storage, workbook.workbookId);
        const end = await runWorkbookReported(runtime, workbook, {
            label: parsed.workbook,
            scripts: parsed.scripts,
            refresh: parsed.refresh,
            signal,
            progressIntervalMs: live ? LIVE_PROGRESS_INTERVAL_MS : null,
            // The results are printed, nothing shows their analysis
            analyze: false,
            prepareConnection: conn => setupConnection(runtime, conn, env, hyper, signal),
            resultFile: async key => {
                const entry = hyper == null ? null : await hyper.resultCache.lookup(key);
                return entry == null ? null : path.join(hyper!.root, QUERY_RESULT_CACHE_DIRECTORY, entry.name);
            },
            onReportError: error => logger.warn('Reporting a script failed', { error: describeRunError(error) }),
        }, emit);
        if (end === 'interrupted') cli.stderr('interrupted\n');
        return exitCode(end);
    } finally {
        await runtime.destroy();
        await hyper?.close();
    }
}
