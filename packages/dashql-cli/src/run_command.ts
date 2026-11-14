// dashql run: runs the scripts of a workbook folder on their connections, like the Run of each script in the app
import type * as arrow from 'apache-arrow';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import type * as connection from '@ankoh/dashql-jsonschema/connection.js';

import { EmbeddedDatabaseChannel, EmbeddedHyperDatabaseChannel } from '@ankoh/dashql-runtime/connections/embedded/embedded_database_channel';
import { performHealthCheck } from '@ankoh/dashql-runtime/connections/health_check';
import { HYPER_CHANNEL_READY, HYPER_CHANNEL_SETUP_FAILED, HYPER_CHANNEL_SETUP_STARTED } from '@ankoh/dashql-runtime/connections/hyper/hyper_connection_state';
import { TrinoApiClient } from '@ankoh/dashql-runtime/connections/trino/trino_api_client';
import { setupTrinoConnection } from '@ankoh/dashql-runtime/connections/trino/trino_connection_setup';
import type { ConnectionAction, ConnectionState } from '@ankoh/dashql-runtime/connections/connection_state';
import { TRINO_CHANNEL_SETUP_STARTED } from '@ankoh/dashql-runtime/connections/trino/trino_connection_state';
import type { QueryExecutor } from '@ankoh/dashql-runtime/connections/query_execution_args';
import { openNodeComputeDatabase, type NodeComputeDatabase } from '@ankoh/dashql-runtime/node/node_hyperdb';
import { createNodePlatform } from '@ankoh/dashql-runtime/node/node_platform';
import { NODE_FILE_SYSTEM } from '@ankoh/dashql-runtime/node/node_file_system';
import { LogLevel, type LogRecord } from '@ankoh/dashql-runtime/platform/logger/log_buffer';
import { LoggableException, Logger } from '@ankoh/dashql-runtime/platform/logger/logger';
import { createRuntime, type Runtime } from '@ankoh/dashql-runtime/runtime';
import { NativeStorageBackend } from '@ankoh/dashql-runtime/storage/native_storage_backend';
import { QUERY_RESULT_CACHE_DIRECTORY } from '@ankoh/dashql-runtime/storage/opfs_query_result_cache';
import { STORAGE_WORKBOOK_FILE } from '@ankoh/dashql-runtime/storage/storage_backend';
import {
    mergeRestoredWorkbookIntoConnections,
    mergeRestoredWorkbookIntoScripts,
    restoreSingleWorkbook,
} from '@ankoh/dashql-runtime/workbook/persistence/app_state_loader';
import { mirrorWorkbookAttachments } from '@ankoh/dashql-runtime/workbook/attachments/attachment_mirror';
import { computeScriptResultCacheKey, runPlannedScript } from '@ankoh/dashql-runtime/workbook/scripts/script_run';
import { createMountPrefix, planWorkbookScripts, prepareWorkbookScripts } from '@ankoh/dashql-runtime/workbook/scripts/workbook_execution';
import type { WorkbookScripts } from '@ankoh/dashql-runtime/workbook/scripts/workbook_scripts';
import { ensureWorkbookScriptAnalyzed } from '@ankoh/dashql-runtime/workbook/scripts/workbook_scripts_registry_state';

import { EXIT_FAILED, EXIT_OK, EXIT_USAGE, type CliProcess } from './cli_process.js';

export const RUN_USAGE = `Usage: dashql run [--rows <n>] [--refresh] [--verbose] <workbook-dir> [<script>...]

Runs scripts of a workbook folder on their connections, in the order of the workbook, all of them by default. Each
script runs like the Run of the script in DashQL: with the scripts it references. The run stops at the first script
that fails. Prints the schema, the row count and the first rows of every result (--rows, 10 by default), and the
Parquet file of the result in the query result cache.

The files of DashQL are in DASHQL_HOME (~/.dashql), with the layout of the storage of the app: the query result cache
in cache/, the attachments of the workbooks in workbooks/<id>/attachments. A script whose result is cached is not run
again unless a script it follows runs, --refresh runs every script.

Connections: Trino with basic auth. DASHQL_TRINO_USER and DASHQL_TRINO_PASSWORD override the user and the password
of the workbook.

--verbose prints the log of the runtime to stderr.`;

/// The rows of a result that are printed by default
const DEFAULT_ROWS = 10;
/// The longest value of a cell
const MAX_CELL_LENGTH = 40;

/// The files and the credentials of the process
export interface RunEnvironment {
    /// The folder of the files of DashQL, the root of the storage of the app
    home: string;
    trinoUser?: string;
    trinoPassword?: string;
}

export function processRunEnvironment(): RunEnvironment {
    return {
        home: process.env.DASHQL_HOME || path.join(homedir(), '.dashql'),
        trinoUser: process.env.DASHQL_TRINO_USER || undefined,
        trinoPassword: process.env.DASHQL_TRINO_PASSWORD,
    };
}

interface RunArgs {
    workbook: string;
    scripts: string[];
    rows: number;
    refresh: boolean;
    verbose: boolean;
}

/// Parse the arguments, an error message if they are invalid
function parseRunArgs(args: string[]): RunArgs | string {
    let rows = DEFAULT_ROWS;
    let verbose = false;
    let refresh = false;
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
        } else if (arg.startsWith('-')) {
            return `unknown option ${arg}`;
        } else {
            positional.push(arg);
        }
    }
    if (positional.length === 0) return 'missing the workbook folder';
    const [workbook, ...scripts] = positional;
    return { workbook, scripts, rows, refresh, verbose };
}

/// The logger of a run, prints the records with --verbose
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

/// The message of an error: what Trino says, the status of a failed request, or why a request failed
export function describeError(error: unknown): string {
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

/// Set up the connection to the embedded Hyper on a session of its database, like the app
async function setupEmbeddedHyper(rt: Runtime, conn: ConnectionState, hyper: NodeComputeDatabase): Promise<string | null> {
    const params = conn.params;
    if (!('hyper' in params)) return null;
    const dispatch = (action: ConnectionAction) => rt.connections.dispatch(conn.connectionId, action);
    const abort = new AbortController();
    try {
        dispatch({ type: HYPER_CHANNEL_SETUP_STARTED, value: params.hyper as connection.HyperConnectionParams });
        const session = await hyper.database.connect({ defaultDatabase: 'hyper' });
        const channel = new EmbeddedHyperDatabaseChannel(new EmbeddedDatabaseChannel(session));
        dispatch({ type: HYPER_CHANNEL_READY, value: [channel, params.hyper as connection.HyperConnectionParams] });
        await performHealthCheck(rt.executor.execute, conn.connectionId, { type: 'hyper', channel }, dispatch, abort.signal);
    } catch (error) {
        dispatch({ type: HYPER_CHANNEL_SETUP_FAILED, value: { message: describeError(error) } });
        return describeError(error);
    }
    return null;
}

/// Set up a connection and check that it answers, an error message if it can't be set up: Trino with basic auth and the
/// embedded Hyper
async function setupConnection(rt: Runtime, conn: ConnectionState, env: RunEnvironment, hyper: NodeComputeDatabase | null): Promise<string | null> {
    const params = conn.params;
    if ('hyper' in params && params.hyper.protocol === 'WASM') {
        if (hyper == null) return 'the script runs on the embedded Hyper, which did not start';
        return await setupEmbeddedHyper(rt, conn, hyper);
    }
    if (!('trino' in params)) {
        return `dashql run reaches Trino and the embedded Hyper only, this script runs on ${connectionLabel(conn)}`;
    }
    const auth = params.trino.auth;
    if (auth?.authType === 'AUTH_OAUTH') {
        return 'the connection signs in with OAuth, dashql run supports basic auth only';
    }
    const stored = params.trino as connection.TrinoConnectionParams;
    const trino: connection.TrinoConnectionParams = {
        ...stored,
        auth: {
            authType: 'AUTH_BASIC',
            basic: {
                username: env.trinoUser ?? auth?.basic?.username ?? '',
                secret: env.trinoPassword ?? auth?.basic?.secret ?? '',
            },
        },
    };
    const { logger, http, oauthFlow } = rt.platform;
    // A connection saves the params it was set up with once it is online, and saved params are written into the
    // workbook. The connection sees the params of the workbook, the credentials of the environment stay in the channel.
    const dispatch = (action: ConnectionAction) => rt.connections.dispatch(conn.connectionId,
        action.type === TRINO_CHANNEL_SETUP_STARTED ? { type: TRINO_CHANNEL_SETUP_STARTED, value: stored } : action);
    const abort = new AbortController();
    try {
        const channel = await setupTrinoConnection(dispatch, logger, trino, {}, new TrinoApiClient(logger, http), http, oauthFlow, false, abort.signal);
        await performHealthCheck(rt.executor.execute, conn.connectionId, { type: 'trino', channel }, dispatch, abort.signal);
    } catch (error) {
        return describeError(error);
    }
    return null;
}

/// A value in a cell
function cellText(value: unknown): string {
    let text: string;
    if (value == null) text = 'NULL';
    else if (value instanceof Date) text = value.toISOString();
    else if (typeof value === 'object') text = JSON.stringify(value, (_key, v) => typeof v === 'bigint' ? v.toString() : v);
    else text = String(value);
    text = text.replace(/\s+/g, ' ');
    return text.length > MAX_CELL_LENGTH ? `${text.slice(0, MAX_CELL_LENGTH - 1)}…` : text;
}

/// The schema and the first rows of a result
function describeTable(table: arrow.Table, rows: number): string {
    const fields = table.schema.fields;
    let out = `  ${fields.map(field => `${field.name} ${field.type}`).join(', ')}\n`;
    const shown = Math.min(rows, table.numRows);
    if (shown === 0 || fields.length === 0) return out;
    const columns = fields.map((field, c) => {
        const vector = table.getChildAt(c)!;
        const cells = Array.from({ length: shown }, (_, r) => cellText(vector.get(r)));
        return [field.name, ...cells];
    });
    const widths = columns.map(cells => Math.max(...cells.map(cell => cell.length)));
    for (let r = 0; r <= shown; ++r) {
        out += `  ${columns.map((cells, c) => cells[r].padEnd(widths[c])).join(' | ').trimEnd()}\n`;
        if (r === 0) out += `  ${widths.map(width => '-'.repeat(width)).join('-+-')}\n`;
    }
    if (shown < table.numRows) out += `  … ${table.numRows - shown} more\n`;
    return out;
}

/// Count something in the output
function count(n: number, noun: string): string {
    return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/// The connections that the plan of a script runs statements on: its own and those of the scripts it materializes. A
/// script that can't be planned needs its own, its run reports why. The scripts are analyzed and published into the
/// catalogs first, like a run does, the planner refuses stale analyses.
async function plannedConnections(workbook: WorkbookScripts, file: string): Promise<string[]> {
    const files = [...workbook.scriptOrder];
    const scripts = files.map(name => workbook.scripts[workbook.scriptRefs[name].scriptId]);
    const target = files.indexOf(file);
    const own = scripts[target].connection.connectionId;
    try {
        await prepareWorkbookScripts(scripts, async () => { });
        const { graph } = planWorkbookScripts({ instance: workbook.instance, scripts, files, mountPrefix: createMountPrefix(), targets: [target], workbook });
        if (!graph.valid) return [own];
        return [...new Set([own, ...graph.nodes.map(node => scripts[node.script].connection.connectionId)])];
    } catch {
        return [own];
    }
}

/// The file of the result of a script in the query result cache, null if its result is not cached. A file that is older
/// than the run served the result.
async function resultFile(rt: Runtime, hyper: NodeComputeDatabase, workbook: WorkbookScripts, scriptKey: number, startedAt: number): Promise<{ path: string; served: boolean } | null> {
    // The executor writes the result after the query resolved
    await rt.executor.flushCacheWrites();
    const script = workbook.scripts[scriptKey];
    if (script == null) return null;
    const key = await computeScriptResultCacheKey(rt.execution.scriptRunServices, workbook, script);
    const entry = key == null ? null : await hyper.resultCache.lookup(key);
    if (entry == null) return null;
    return { path: path.join(hyper.root, QUERY_RESULT_CACHE_DIRECTORY, entry.name), served: entry.cachedAtMs < startedAt };
}

/// Load the workbook of a folder into the runtime
async function loadWorkbook(rt: Runtime, storage: NativeStorageBackend): Promise<WorkbookScripts> {
    // The folder is the workbook, its file names its id
    const { workbookId } = await storage.loadWorkbook('');
    const restored = await restoreSingleWorkbook(rt.core, storage, rt.logger, workbookId, rt.connections.store.current);
    rt.connections.store.update(registry => mergeRestoredWorkbookIntoConnections(registry, restored));
    rt.workbooks.store.update(registry => mergeRestoredWorkbookIntoScripts(registry, restored));
    return restored.workbookScripts;
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
    const dir = path.resolve(cli.cwd, parsed.workbook);
    if (!existsSync(path.join(dir, STORAGE_WORKBOOK_FILE))) {
        cli.stderr(`error: ${parsed.workbook} is no workbook folder, it has no ${STORAGE_WORKBOOK_FILE}\n`);
        return EXIT_USAGE;
    }

    const logger = new RunLogger(parsed.verbose ? record => { if (record.level >= LogLevel.Info) cli.stderr(logLine(record)); } : null);
    const storage = new NativeStorageBackend(dir, NODE_FILE_SYSTEM);
    // The embedded Hyper writes the results into the query result cache of the root and reads the results of other
    // connections and the attachments. Without it the scripts still run, nothing is written.
    let hyper: NodeComputeDatabase | null = null;
    try {
        hyper = await openNodeComputeDatabase(env.home);
    } catch (error) {
        cli.stderr(`warning: the embedded Hyper did not start, results are not written: ${describeError(error)}\n`);
    }
    const rt = await createRuntime({
        ...createNodePlatform({ logger, storage }),
        setupCore: () => cli.setupCore(),
        computeDatabase: hyper?.database ?? null,
        resultCache: hyper?.resultCache ?? null,
    });
    try {
        // A run doesn't describe the connections, it only runs the scripts
        rt.catalogLoader.stop();
        let workbook: WorkbookScripts;
        try {
            workbook = await loadWorkbook(rt, storage);
        } catch (error) {
            cli.stderr(`error: ${parsed.workbook} could not be loaded: ${describeError(error)}\n`);
            return EXIT_USAGE;
        }
        const { workbookId } = workbook;
        // The embedded Hyper reads the attachments from the root, like the app reads them from its storage
        if (hyper != null) await mirrorWorkbookAttachments(storage, workbookId);

        // The scripts by their file names, `scripts/a.sql` names `a.sql`
        const files = [...workbook.scriptOrder];
        const unknown = parsed.scripts.map(script => path.basename(script)).filter(file => !files.includes(file));
        if (unknown.length > 0) {
            cli.stderr(`error: the workbook has no script ${unknown.join(', ')}, its scripts are ${files.join(', ') || 'none'}\n`);
            return EXIT_USAGE;
        }
        const requested = new Set(parsed.scripts.map(script => path.basename(script)));
        const selected = requested.size === 0 ? files : files.filter(file => requested.has(file));
        const scriptOf = (file: string) => workbook.scripts[workbook.scriptRefs[file].scriptId];

        // The connections are set up once, when a plan first runs statements on them
        const ready = new Set<string>();
        // The results are printed, the run doesn't analyze them
        const execute: QueryExecutor = (connectionId, queryArgs) => rt.executor.execute(connectionId, { ...queryArgs, analyzeResults: false });
        const modify = (action: Parameters<Runtime['workbooks']['dispatch']>[1]) => rt.workbooks.dispatch(workbookId, action);
        const current = () => rt.workbooks.store.current.workbookScriptsMap.get(workbookId)!;
        let succeeded = 0;
        for (const file of selected) {
            const started = performance.now();
            const startedAt = Date.now();
            let table: arrow.Table | null;
            try {
                const script = await ensureWorkbookScriptAnalyzed(current(), scriptOf(file).scriptKey, modify);
                if (script == null) throw new Error('the script could not be analyzed');
                for (const connectionId of await plannedConnections(current(), file)) {
                    if (ready.has(connectionId)) continue;
                    const conn = rt.connections.store.current.connections.get(connectionId);
                    if (conn == null) throw new Error(`the workbook has no connection ${connectionId}`);
                    const failure = await setupConnection(rt, conn, env, hyper);
                    if (failure != null) {
                        cli.stdout(`${connectionLabel(conn)}  failed\n  ${failure}\n`);
                        return EXIT_FAILED;
                    }
                    ready.add(connectionId);
                }
                table = await runPlannedScript(rt.execution.scriptRunServices, current(), script, execute, modify, { logger, refresh: parsed.refresh });
            } catch (error) {
                cli.stdout(`${file}  failed\n  ${describeError(error).replace(/\n/g, '\n  ')}\n`);
                const skipped = selected.length - succeeded - 1;
                if (skipped > 0) cli.stdout(`\n${count(skipped, 'script')} not run\n`);
                return EXIT_FAILED;
            }
            const seconds = ((performance.now() - started) / 1000).toFixed(1);
            const cached = hyper == null ? null : await resultFile(rt, hyper, current(), scriptOf(file).scriptKey, startedAt);
            const from = cached?.served ? '  from the cache' : '';
            if (table == null) {
                cli.stdout(`${file}  ok  no result  ${seconds} s\n`);
            } else {
                cli.stdout(`${file}  ok  ${count(table.numRows, 'row')}  ${seconds} s${from}\n${describeTable(table, parsed.rows)}`);
            }
            if (cached != null) cli.stdout(`  ${cached.path}\n`);
            ++succeeded;
        }
        return EXIT_OK;
    } finally {
        await rt.destroy();
        await hyper?.close();
    }
}
