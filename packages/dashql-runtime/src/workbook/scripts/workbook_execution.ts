import type * as core from '@ankoh/dashql-core';
import type * as arrow from 'apache-arrow';

import type { CancelQuery, QueryExecutionArgs, QueryExecutor } from '../../connections/query_execution_args.js';
import type { ClientFunctionCallDescription } from '../../connections/clfn/clfn_spec.js';
import { QueryType, type PlannedStatement } from '../../query/query_execution_state.js';
import type { LoggerLike } from '../../platform/logger/logger.js';
import { PROJECT_WORKBOOK, scriptResultOwner, type WorkbookScripts } from './workbook_scripts.js';
import type { ModifyWorkbookScripts } from './workbook_scripts_registry_state.js';
import { yieldToBrowser } from '../../utils/yield_to_browser.js';
import type { ParquetDatabase } from '../../platform/hyperdb/hyperdb_parquet_export.js';
import { isQueryCacheMiss, type QueryResultCache } from '../../query/query_result_cache.js';

// The runs of workbooks are a service of the Rust runtime (`packages/dashql-core-runtime/src/workbook_run`): it
// analyzes and plans the scripts, serves the cached results and runs the plan. This module is its host: it hands the
// statements to the query executor, keeps the result tables and the files of a run, and holds the workbooks that run.

/// The run that holds a workbook, a run of the whole workbook or of one of its scripts
type WorkbookRunKind = 'workbook' | 'script';

/// The workbooks that a run holds. One run holds a workbook at a time, the app disables the runs of a held workbook.
const activeWorkbooks = new Map<string, WorkbookRunKind>();
const activeWorkbookListeners = new Set<() => void>();
const LOG_CTX = 'workbook_execution';

/// Does a run hold a workbook, a run of the whole workbook or of one of its scripts?
export function isWorkbookExecutionRunning(workbook: WorkbookScripts | string): boolean {
    return activeWorkbooks.has(typeof workbook === 'string' ? workbook : workbook.workbookId);
}

/// Subscribe to the runs that start and end, returns the unsubscribe
export function subscribeWorkbookExecutions(listener: () => void): () => void {
    activeWorkbookListeners.add(listener);
    return () => { activeWorkbookListeners.delete(listener); };
}

/// Hold a workbook for a run, false if a run holds it already. `releaseWorkbookExecution` ends the run.
export function acquireWorkbookExecution(workbook: WorkbookScripts | string, kind: WorkbookRunKind = 'script'): boolean {
    const workbookId = typeof workbook === 'string' ? workbook : workbook.workbookId;
    if (activeWorkbooks.has(workbookId)) return false;
    activeWorkbooks.set(workbookId, kind);
    for (const listener of [...activeWorkbookListeners]) listener();
    return true;
}

/// End the run of a workbook
export function releaseWorkbookExecution(workbook: WorkbookScripts | string): void {
    if (!activeWorkbooks.delete(typeof workbook === 'string' ? workbook : workbook.workbookId)) return;
    for (const listener of [...activeWorkbookListeners]) listener();
}

/// Wait until no run holds a workbook and hold it for a run of a script, e.g. a run of the agent, which can't see
/// that the workbook runs. Rejects if a run of the whole workbook holds it: that run takes every script and the user
/// decides when it ends.
export function waitForWorkbookExecution(workbookId: string): Promise<void> {
    return new Promise((resolve, reject) => {
        let unsubscribe = () => {};
        const attempt = () => {
            const holder = activeWorkbooks.get(workbookId);
            if (holder === 'workbook') {
                unsubscribe();
                reject(new Error('The workbook is running'));
            } else if (holder == null) {
                // The first waiter holds the workbook once it is released, before anybody else can start a run
                unsubscribe();
                acquireWorkbookExecution(workbookId);
                resolve();
            }
        };
        unsubscribe = subscribeWorkbookExecutions(attempt);
        attempt();
    });
}

export interface WorkbookExecutionState {
    phase: 'planning' | 'running' | 'stopping' | 'succeeded' | 'failed' | 'cancelled';
    totalScripts: number;
    completedScripts: number;
    /// The planned statements
    totalStatements: number;
    completedStatements: number;
    /// The script of the statement that started last
    activeFileName: string | null;
    activeStatementIndex: number | null;
    activeStatementCount: number | null;
    error: string | null;
    /// The scripts that the run left out because they need a connection that isn't connected, they have no cached
    /// result or follow a script that runs on such a connection
    skippedScripts: number;
    /// The file names of the skipped scripts
    skippedFiles: string[];
}

/// The Parquet files of the materialized script results of a run.
///
/// A statement of the embedded Hyper reads the result of a script of another connection from a Parquet file
/// (see docs/design/script_references.md). The files are files of the query result cache of the app, mounted at the
/// mount prefix of the plan. The result of a script whose key is reusable is a new file of its key, every other result
/// is a transient file. Hyper writes the files and reads the byte ranges a scan needs from disk. The run pins its
/// files, so eviction and other windows leave them alone.
export interface ExecutionMounts {
    /// The mount path of the files of the run, the mount prefix of the plan
    readonly prefix: string;
    /// The name of a new file of the result of a script, a file of its key if the key is reusable, a transient file
    /// otherwise
    fileName(key: string | null): string;
    /// Write a script result as Parquet file at a path below the prefix, returns the file
    writeTable(path: string, table: arrow.Table): Promise<Blob>;
    /// Keep a file that the run reads, e.g. a cached result
    use(path: string): Promise<void>;
    /// Release the files of the run. The files of keys stay in the cache, the transient files are removed. Writes
    /// and reads after the release fail.
    release(): Promise<void>;
}

/// The files of a run in the query result cache of the app
export function createExecutionMounts(cache: QueryResultCache, database: ParquetDatabase): ExecutionMounts {
    const pins: Array<() => Promise<void>> = [];
    const transient: string[] = [];
    let released = false;
    const fileName = (path: string) => {
        if (!path.startsWith(`${cache.mountPath}/`) || path.slice(cache.mountPath.length + 1).includes('/')) throw new Error(`The path ${path} is no file of the run`);
        return path.slice(cache.mountPath.length + 1);
    };
    /// Mount the files and pin a file until the release
    const keep = async (name: string) => {
        if (released) throw new Error(`The run ended, it no longer reads ${name}`);
        await cache.mount(database);
        const unpin = await cache.pin(name);
        if (released) {
            await unpin();
            throw new Error(`The run ended, it no longer reads ${name}`);
        }
        pins.push(unpin);
    };
    return {
        prefix: cache.mountPath,
        fileName: key => {
            if (key != null) return cache.newFileName(key);
            const name = cache.newTransientFileName();
            transient.push(name);
            return name;
        },
        writeTable: async (path, table) => {
            const name = fileName(path);
            await keep(name);
            return await cache.writeTable(database, table, name);
        },
        use: async path => {
            await keep(fileName(path));
        },
        release: async () => {
            released = true;
            await Promise.all(pins.splice(0, pins.length).map(release => release()));
            // Every listing removes them too, e.g. those of a window that was closed during its run
            await Promise.all(transient.splice(0, transient.length).map(name => cache.remove(name).catch(() => {})));
        },
    };
}

/// What happens to a script in a run. A script of the plan is `planned`, or `cached`, or `skipped`. A planned script
/// may still be skipped if its connection can't be set up. A planned script that starts is then `done`, `failed` or
/// `cancelled`. A planned script that never starts, e.g. because the run stopped first, gets no further event.
export type ScriptRunEvent =
    /// It runs once the scripts that it follows in the plan are done
    | { type: 'planned'; follows: string[] }
    /// The cache served its result instead of its connection, the query reads the cached file
    | { type: 'cached'; key: string; queryId: number }
    /// It doesn't run: its connection can't run or could not be set up, or it follows a script that doesn't run
    | { type: 'skipped'; reason: string }
    /// Its first statement started
    | { type: 'started' }
    /// Its statements are done: the key of its result in the query result cache if the key is reusable, the query of
    /// its last output, null without one
    | { type: 'done'; key: string | null; queryId: number | null }
    /// A statement of the script failed, the run stops
    | { type: 'failed'; error: unknown }
    /// The run stopped the script while it ran, e.g. after another script failed
    | { type: 'cancelled' };

/// A script that can't be planned, e.g. one that references an unknown script
export class ScriptPlanError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ScriptPlanError';
    }
}

/// A statement of a run as the Rust runtime hands it over
interface RunStatementRequest {
    connectionId: string;
    scriptKey: number;
    query: string;
    clientFunctionCall: ClientFunctionCallDescription | null;
    analyzeResults: boolean;
    publishResults: boolean;
    cacheable: boolean;
    refreshCache: boolean;
    cacheOnly: boolean;
    cacheSignature: string | null;
    title: string;
    description: string;
    issuer: string;
    planned: PlannedStatement;
}

/// What the host of a run needs
export interface WorkbookRunHostArgs {
    workbook: WorkbookScripts;
    /// The live workbook, a run fails if it is gone or its scripts change meanwhile
    getWorkbook: () => WorkbookScripts | null;
    executeQuery: QueryExecutor;
    /// Cancel a query of a connection, the queries of a run are cancelled with their abort signals without it
    cancelQuery?: CancelQuery;
    modifyWorkbookScripts: ModifyWorkbookScripts;
    /// The abort signal of the queries of the run, the host cancels them with it too
    signal?: AbortSignal;
    /// The mounts of the materialized script results of the run, null without a compute database
    mounts: ExecutionMounts | null;
    /// Mount the attachments of a workbook in the embedded Hyper, absent without a compute database
    mountAttachments?: (workbookId: string) => Promise<void>;
    /// The result key of a script on a connection, names the files of the materialized results
    resultKey: (connectionId: string, signature: string) => Promise<string | null>;
    /// Does a connection cache query results? The run reuses and writes the results of the scripts with reusable keys.
    cachesResults: (connectionId: string) => boolean;
    /// The query result cache of the app, null if results aren't cached
    cache: QueryResultCache | null;
    /// Can the statements of a connection run? The scripts of a connection that can't, e.g. one that isn't connected,
    /// serve their cached results, the others are skipped with the scripts that follow them. All run if absent.
    canRun?: (connectionId: string) => boolean;
    maxConcurrentQueries?: (connectionId: string) => number;
    /// Set up the connections that statements run on before the first statement, all at once, e.g. the connections of
    /// the command line tool. The scripts of a connection that can't be set up are skipped.
    prepareConnection?: (connectionId: string) => Promise<void>;
    /// The state of the run
    onState?: (state: WorkbookExecutionState) => void;
    /// What happens to the scripts of the plan, by their file names
    onScript?: (file: string, event: ScriptRunEvent) => void;
    cooperate: () => Promise<void>;
    logger?: LoggerLike;
}

/// The host of a run of the Rust runtime over the services of the app
function createRunHost(args: WorkbookRunHostArgs): core.WorkbookRunHost {
    const { workbook, logger } = args;
    const { workbookId } = workbook;
    // The executions of the statements, a materialized result is written from its table
    const executions = new Map<number, Promise<arrow.Table | null>>();
    // The cancellations of the statements
    const cancellations = new Map<number, AbortController>();
    // The cached files that the run keeps
    const retained = new Map<number, () => Promise<void>>();
    let nextRetained = 0;
    // The changes of the workbook are projected once per turn
    let projecting = false;
    return {
        now: () => Date.now(),
        setTimer: (ms, callback) => setTimeout(callback, ms),
        clearTimer: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
        log: (level, message, details) => logger?.[level](message, JSON.parse(details), LOG_CTX),
        execute: text => {
            const request = JSON.parse(text) as RunStatementRequest;
            let ready = () => {};
            const readiness = new Promise<void>(resolve => { ready = resolve; });
            const cancellation = new AbortController();
            const signal = args.signal;
            const abort = () => cancellation.abort(signal?.reason);
            if (signal?.aborted) abort();
            else signal?.addEventListener('abort', abort, { once: true });
            const queryArgs: QueryExecutionArgs = {
                query: request.query,
                cacheable: request.cacheable,
                throwOnError: true,
                abortSignal: cancellation.signal,
                clientFunctionCall: request.clientFunctionCall ?? undefined,
                analyzeResults: request.analyzeResults,
                publishResults: request.publishResults,
                onResultsReady: () => ready(),
                ...(request.refreshCache ? { refreshCache: true } : {}),
                ...(request.cacheOnly ? { cacheOnly: true } : {}),
                ...(request.cacheSignature != null ? { cacheSignature: request.cacheSignature } : {}),
                metadata: {
                    queryType: QueryType.USER_PROVIDED, userProvided: true, workbookId,
                    resultOwner: scriptResultOwner(workbookId, request.scriptKey),
                    title: request.title, description: request.description, issuer: request.issuer, planned: request.planned,
                },
            };
            let queryId: number;
            let execution: Promise<arrow.Table | null>;
            try {
                [queryId, execution] = args.executeQuery(request.connectionId, queryArgs);
            } catch (e) {
                signal?.removeEventListener('abort', abort);
                throw e;
            }
            executions.set(queryId, execution);
            cancellations.set(queryId, cancellation);
            // A failed statement never reports its result as ready, the run learns of the failure first
            const done = execution.then(
                (table): core.WorkbookRunStatementEnd => {
                    ready();
                    return { hasResult: table != null };
                },
                (error: unknown): core.WorkbookRunStatementEnd => ({ error, cacheMiss: isQueryCacheMiss(error) }),
            ).finally(() => {
                signal?.removeEventListener('abort', abort);
                cancellations.delete(queryId);
            });
            return { queryId, ready: readiness, done };
        },
        cancel: async (connectionId, queryId) => {
            cancellations.get(queryId)?.abort();
            try {
                await args.cancelQuery?.(connectionId, queryId);
            } catch {
                // A cancellation that fails leaves the query to end on its own
            }
        },
        resultKey: (connectionId, signature) => args.resultKey(connectionId, signature),
        cachesResults: connectionId => args.cachesResults(connectionId),
        canRun: connectionId => args.canRun?.(connectionId) ?? true,
        maxConcurrentQueries: connectionId => args.maxConcurrentQueries?.(connectionId) ?? 1,
        preparesConnections: () => args.prepareConnection != null,
        prepareConnection: connectionId => args.prepareConnection!(connectionId),
        hasCache: () => args.cache != null,
        cacheRetain: async key => {
            const file = await args.cache!.retain(key);
            if (file == null) return null;
            const id = ++nextRetained;
            retained.set(id, file.release);
            return { id, name: file.entry.name };
        },
        cacheRelease: async id => {
            const release = retained.get(id);
            retained.delete(id);
            await release?.().catch(() => {});
        },
        mountPrefix: () => args.mounts?.prefix ?? null,
        mountFileName: key => args.mounts!.fileName(key),
        mountWrite: async (path, queryId) => {
            const table = await executions.get(queryId);
            if (table == null) throw new Error('The statement has no result');
            await args.mounts!.writeTable(path, table);
            return table.numRows;
        },
        mountUse: path => args.mounts!.use(path),
        mountRelease: async () => {
            await args.mounts?.release();
        },
        mountsAttachments: () => args.mountAttachments != null,
        mountAttachments: () => args.mountAttachments!(workbookId),
        workbookLive: () => {
            const live = args.getWorkbook();
            return live != null && live.workbookId === workbookId && live.instance === workbook.instance && live.native === workbook.native;
        },
        workbookChanged: () => {
            if (projecting) return;
            projecting = true;
            queueMicrotask(() => {
                projecting = false;
                void args.modifyWorkbookScripts({ type: PROJECT_WORKBOOK, value: null });
            });
        },
        state: text => args.onState?.(JSON.parse(text) as WorkbookExecutionState),
        scriptEvent: (file, text, error) => {
            if (args.onScript == null) return;
            const event = JSON.parse(text) as ScriptRunEvent | { type: 'failed'; failure: core.WorkbookRunFailure };
            if (event.type === 'failed' && 'failure' in event) {
                args.onScript(file, { type: 'failed', error: error ?? new Error(event.failure.message) });
            } else {
                args.onScript(file, event as ScriptRunEvent);
            }
        },
        cooperate: () => args.cooperate(),
    };
}

/// The options of a run on the Rust runtime
export interface WorkbookRunPlan {
    /// A run of the workbook or of the script `target`
    run: 'workbook' | 'script';
    target?: string;
    /// The scripts of the plan with what they need, every script if absent
    targets?: number[];
    /// Run the scripts that a change of these inputs affects
    inputs?: readonly string[];
    /// Read no cached results
    refresh: boolean;
    /// Report the state of the run
    reportsState: boolean;
}

/// Run a plan of the scripts of a workbook on the Rust runtime. Settles once the run ended, an abort of the signal
/// stops it.
export async function runWorkbookPlan(args: WorkbookRunHostArgs & { plan: WorkbookRunPlan }): Promise<core.WorkbookRunOutcome> {
    const native = args.workbook.native;
    if (native == null) throw new Error('the scripts of the workbook have no Rust workbook, create them with createWorkbookScripts');
    const { plan } = args;
    const run = native.workbook.run(createRunHost(args), {
        run: plan.run, target: plan.target ?? null, targets: plan.targets ?? null, inputs: plan.inputs ?? null,
        refresh: plan.refresh, reportsState: plan.reportsState,
    });
    const signal = args.signal;
    const stop = () => run.cancel();
    if (signal?.aborted) stop();
    else signal?.addEventListener('abort', stop, { once: true });
    try {
        return await run.outcome;
    } finally {
        signal?.removeEventListener('abort', stop);
    }
}

/// The error of a failed run: what the host failed with, a plan error or an error of the runtime
export function workbookRunError(outcome: core.WorkbookRunOutcome): unknown {
    const failure = outcome.failure;
    if (failure == null) return null;
    if (failure.hostValue && outcome.error != null) return outcome.error;
    if (failure.kind === 'plan') return new ScriptPlanError(failure.message);
    if (failure.kind === 'cancelled') return new DOMException(failure.message, 'AbortError');
    return new Error(failure.message);
}

/// Run every script of a workbook, or the scripts that a change of inputs affects, and report the state of the run
export async function runWorkbookExecution(args: {
    workbook: WorkbookScripts;
    getWorkbook: () => WorkbookScripts | null;
    executeQuery: QueryExecutor;
    cancelQuery: CancelQuery;
    modifyWorkbookScripts: ModifyWorkbookScripts;
    signal: AbortSignal;
    onState: (state: WorkbookExecutionState) => void;
    /// The mounts of the materialized script results of the run, null without a compute database
    mounts?: ExecutionMounts | null;
    /// Mount the attachments of a workbook in the embedded Hyper, absent without a compute database
    mountAttachments?: (workbookId: string) => Promise<void>;
    /// The result key of a script on a connection, names the files of the materialized results
    resultKey?: (connectionId: string, signature: string) => Promise<string | null>;
    /// Does a connection cache query results? The run reuses and writes the results of the scripts with reusable keys.
    cachesResults?: (connectionId: string) => boolean;
    /// The query result cache of the app, null if results aren't cached
    cache?: QueryResultCache | null;
    /// Read no cached results: every script runs, the results with reusable keys become the newest files of their keys
    refresh?: boolean;
    /// Run only these scripts with what they need, by their indexes in the order of the workbook
    targets?: number[];
    /// Run only the scripts that the change of these inputs affects
    inputs?: readonly string[];
    /// Can the statements of a connection run? See `WorkbookRunHostArgs`.
    canRun?: (connectionId: string) => boolean;
    /// Set up the connections that statements run on, see `WorkbookRunHostArgs`
    prepareConnection?: (connectionId: string) => Promise<void>;
    /// What happens to the scripts of the plan, see `WorkbookRunHostArgs`
    onScript?: (file: string, event: ScriptRunEvent) => void;
    /// Allows tests to control cooperative scheduling without relying on timer timing.
    yieldToBrowser?: () => Promise<void>;
    /// Maximum concurrently running backend queries on a connection.
    maxConcurrentQueries?: (connectionId: string) => number;
    /// Logs the plan and its statements
    logger?: LoggerLike;
}): Promise<void> {
    const { workbook } = args;
    if (!acquireWorkbookExecution(workbook, 'workbook')) return;
    try {
        const outcome = await runWorkbookPlan({
            workbook, getWorkbook: args.getWorkbook, executeQuery: args.executeQuery, cancelQuery: args.cancelQuery,
            modifyWorkbookScripts: args.modifyWorkbookScripts, signal: args.signal,
            mounts: args.mounts ?? null, mountAttachments: args.mountAttachments,
            resultKey: args.resultKey ?? (async () => null), cachesResults: args.cachesResults ?? (() => false),
            cache: args.cache ?? null, canRun: args.canRun, maxConcurrentQueries: args.maxConcurrentQueries,
            prepareConnection: args.prepareConnection, onState: args.onState, onScript: args.onScript,
            cooperate: args.yieldToBrowser ?? yieldToBrowser, logger: args.logger,
            plan: { run: 'workbook', targets: args.targets, inputs: args.inputs, refresh: args.refresh ?? false, reportsState: true },
        });
        if (outcome.failure != null && outcome.failure.kind !== 'cancelled') {
            args.logger?.info('The run of a workbook failed', { workbookId: workbook.workbookId, error: outcome.failure.message }, LOG_CTX);
        }
    } finally {
        releaseWorkbookExecution(workbook);
    }
}
