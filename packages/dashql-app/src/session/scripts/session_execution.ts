import * as core from '@ankoh/dashql-core';
import type * as arrow from 'apache-arrow';

import type { CancelQuery, QueryExecutor } from '../../connections/query_executor.js';
import type { QueryExecutionArgs } from '../../connections/query_execution_args.js';
import type { ClientFunctionCallDescription } from '../../connections/clfn/clfn_spec.js';
import { QueryType, type PlannedStatement } from '../../query/query_execution_state.js';
import type { LoggerLike } from '../../platform/logger/logger.js';
import { APPLY_PLANNER_ANALYSIS, REGISTER_QUERY, REGISTER_SCRIPT_RESULT, SET_SCRIPT_EXECUTION_VISUALIZATION, scriptResultOwner, type ScriptData, type SessionScripts } from './session_scripts.js';
import { resolveCompiledVisualization } from './script_compilation.js';
import { scriptDisplayName } from './script_types.js';
import type { ModifySessionScripts } from './session_scripts_registry.js';
import { yieldToBrowser } from '../../utils/yield_to_browser.js';
import type { ParquetDatabase } from '../../platform/hyperdb/hyperdb_parquet_export.js';
import { isQueryCacheMiss, type QueryResultCache } from '../../query/query_result_cache.js';
import { affectedScriptIndices, sessionPlanRequest } from '../inputs/session_inputs.js';

/// The run that holds a session, a run of the whole session or of one of its scripts
type SessionRunKind = 'session' | 'script';

/// The sessions that a run holds. One run holds a session at a time, the app disables the runs of a held session.
const activeSessions = new Map<string, SessionRunKind>();
const activeSessionListeners = new Set<() => void>();
const PREPARATION_YIELD_INTERVAL = 8;
const EXECUTION_YIELD_INTERVAL = 8;
const DEFAULT_MAX_CONCURRENT_QUERIES = 1;
const NONE = 0xffffffff;
const LOG_CTX = 'session_execution';

/// Does a run hold a session, a run of the whole session or of one of its scripts?
export function isSessionExecutionRunning(session: SessionScripts | string): boolean {
    return activeSessions.has(typeof session === 'string' ? session : session.sessionId);
}

/// Subscribe to the runs that start and end, returns the unsubscribe
export function subscribeSessionExecutions(listener: () => void): () => void {
    activeSessionListeners.add(listener);
    return () => { activeSessionListeners.delete(listener); };
}

/// Hold a session for a run, false if a run holds it already. `releaseSessionExecution` ends the run.
export function acquireSessionExecution(session: SessionScripts | string, kind: SessionRunKind = 'script'): boolean {
    const sessionId = typeof session === 'string' ? session : session.sessionId;
    if (activeSessions.has(sessionId)) return false;
    activeSessions.set(sessionId, kind);
    for (const listener of [...activeSessionListeners]) listener();
    return true;
}

/// End the run of a session
export function releaseSessionExecution(session: SessionScripts | string): void {
    if (!activeSessions.delete(typeof session === 'string' ? session : session.sessionId)) return;
    for (const listener of [...activeSessionListeners]) listener();
}

/// Wait until no run holds a session and hold it for a run of a script, e.g. a run of the agent, which can't see
/// that the session runs. Rejects if a run of the whole session holds it: that run takes every script and the user
/// decides when it ends.
export function waitForSessionExecution(sessionId: string): Promise<void> {
    return new Promise((resolve, reject) => {
        let unsubscribe = () => {};
        const attempt = () => {
            const holder = activeSessions.get(sessionId);
            if (holder === 'session') {
                unsubscribe();
                reject(new Error('The session is running'));
            } else if (holder == null) {
                // The first waiter holds the session once it is released, before anybody else can start a run
                unsubscribe();
                acquireSessionExecution(sessionId);
                resolve();
            }
        };
        unsubscribe = subscribeSessionExecutions(attempt);
        attempt();
    });
}

export interface SessionExecutionState {
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

/// The result key of a script of a plan
interface ScriptResultKey {
    /// The key, the files of the results of the script are named after it
    key: string;
    /// The signature that the key derives from: the signature of the AST of the script and the keys of the scripts it
    /// references, one per line. The executor derives the key from it.
    signature: string;
    /// May a run read a file of the key instead of running the script? The script is cacheable, its connection
    /// caches results and so do the scripts it references.
    reusable: boolean;
}

/// The result keys of the scripts of a plan. The key of a script covers its connection, its AST and the keys of the
/// scripts it references (docs/design/query_cache.md). Null for scripts that aren't planned or whose connection has
/// no key.
export async function computeScriptResultKeys(
    graph: core.buffers.execution.ExecutionGraphT,
    keyOf: (scriptIndex: number, signature: string) => Promise<string | null>,
    cachesResults: (scriptIndex: number) => boolean,
): Promise<Array<ScriptResultKey | null>> {
    const keys = new Map<number, Promise<ScriptResultKey | null>>();
    const resultKey = (index: number, depth: number): Promise<ScriptResultKey | null> => {
        let pending = keys.get(index);
        if (pending == null) {
            pending = (async () => {
                const script = graph.scripts[index];
                if (script == null || !script.planned || depth > graph.scripts.length) return null;
                const references = await Promise.all((script.referencedScripts ?? []).map(r => resultKey(r, depth + 1)));
                if (references.some(reference => reference == null)) return null;
                // The signature of a script without references is the signature of its AST
                const signature = [String(script.signature ?? ''), ...references.map(reference => reference!.key)].join('\n');
                const key = await keyOf(index, signature);
                if (key == null) return null;
                const reusable = script.cacheable && cachesResults(index) && references.every(reference => reference!.reusable);
                return { key, signature, reusable };
            })();
            keys.set(index, pending);
        }
        return pending;
    };
    return await Promise.all(graph.scripts.map((_script, index) => resultKey(index, 0)));
}

/// The mount prefix of a plan without the mounts of the query result cache. Its materializations can't run, the plan
/// fails if it has any.
export function createMountPrefix(): string {
    return `/mnt/external/dashql-run-${crypto.randomUUID()}`;
}

/// A plan of the scripts of a session
interface SessionScriptsPlan {
    /// The execution graph, `graph.scripts[i]` is the script `i` of the request
    graph: core.buffers.execution.ExecutionGraphT;
    /// The connection ids, `node.connection` indexes them
    connectionIds: string[];
}

/// Plan the scripts of a session across their connections. Without targets, the plan covers every script.
export function planSessionScripts(args: {
    instance: core.DashQL;
    scripts: readonly ScriptData[];
    files: readonly string[];
    mountPrefix: string;
    targets?: number[];
    materialized?: number[];
    /// The name of the file of the materialized result of a script below the mount prefix
    materializationFile?: (scriptIndex: number) => string | undefined;
    /// The session, its attachments are table parameters of the scripts
    session?: Pick<SessionScripts, 'sessionId' | 'attachments'>;
}): SessionScriptsPlan {
    const request = sessionPlanRequest(args.scripts, args.files, args.session);
    const graph = args.instance.planSession({
        ...request,
        scripts: request.scripts.map((script, index) => ({ ...script, materializationFile: args.materializationFile?.(index) })),
        targets: args.targets,
        materialized: args.materialized,
        mountPrefix: args.mountPrefix,
    }).unpack();
    const connectionIds = request.connections.map(c => c.id);
    return { graph, connectionIds };
}

/// The errors of an invalid plan, e.g. `bar.sql: unknown script or attachment :foo`
export function describePlanErrors(graph: core.buffers.execution.ExecutionGraphT, files: readonly string[]): string {
    const diagnostics = graph.diagnostics.filter(diagnostic => diagnostic.error);
    const messages = (diagnostics.length > 0 ? diagnostics : graph.diagnostics).map(diagnostic => {
        const message = String(diagnostic.message ?? '');
        const file = diagnostic.script !== NONE ? files[diagnostic.script] : undefined;
        return file != null && !message.startsWith(file) ? `${file}: ${message}` : message;
    });
    return messages.join('; ') || 'Invalid session execution plan';
}

/// The run of a plan: of the whole session or of a target script
interface PlanRun {
    kind: 'session' | 'script';
    /// The file of the target of a run of a script
    target: string | null;
}

/// Where the statements of a plan come from, one per node
export function describePlannedStatements(graph: core.buffers.execution.ExecutionGraphT, files: readonly string[], run: PlanRun): PlannedStatement[] {
    const statementsOf = new Map<number, number[]>();
    graph.nodes.forEach((node, index) => {
        const statements = statementsOf.get(node.script) ?? [];
        statements.push(index);
        statementsOf.set(node.script, statements);
    });
    const after = graph.nodes.map(() => [] as Array<{ node: number; reason: string }>);
    for (const edge of graph.edges) {
        const reason = core.buffers.execution.ExecutionGraphEdgeReason[edge.reason] ?? String(edge.reason);
        if (!after[edge.to]?.some(e => e.node === edge.from && e.reason === reason)) after[edge.to]?.push({ node: edge.from, reason });
    }
    const materializations = graph.materializations ?? [];
    return graph.nodes.map((node, index) => {
        const statements = statementsOf.get(node.script)!;
        return {
            run: run.kind,
            target: run.target,
            node: index,
            script: files[node.script] ?? `script ${node.script}`,
            statement: statements.indexOf(index) + 1,
            statements: statements.length,
            statementType: core.buffers.parser.StatementType[node.statementType] ?? String(node.statementType),
            result: node.scriptResult,
            cached: false,
            inlined: (node.inlinedScripts ?? []).map(script => files[script] ?? `script ${script}`),
            scans: (node.inputs ?? []).map(m => materializations[m]).filter(m => m != null).map(m => ({
                script: files[m.script] ?? `script ${m.script}`, path: String(m.path ?? ''), cached: m.node === NONE,
            })),
            materializes: node.materialization !== NONE ? String(materializations[node.materialization]?.path ?? '') : null,
            after: after[index],
        };
    });
}

/// The title of a planned statement in the query history, e.g. `bar.sql 2/3 · inlines foo.sql`
function plannedStatementTitle(statement: PlannedStatement): string {
    const parts = [`${statement.script} ${statement.statement}/${statement.statements}`];
    if (statement.cached) parts.push('cached result');
    if (statement.inlined.length > 0) parts.push(`inlines ${statement.inlined.join(', ')}`);
    if (statement.scans.length > 0) parts.push(`scans ${statement.scans.map(scan => scan.cached ? `${scan.script} (cached)` : scan.script).join(', ')}`);
    if (statement.materializes != null) parts.push('materialized');
    return parts.join(' · ');
}

/// The description of a planned statement in the query history
function plannedStatementDescription(statement: PlannedStatement): string {
    const parts = [`${statement.statementType} ${statement.statement} of ${statement.statements} of ${statement.script}`
        + (statement.result ? ', the result of the script' : '')
        + (statement.run === 'session' ? ', run of the session' : `, run of ${statement.target}`)];
    if (statement.cached) parts.push('served from the query result cache');
    if (statement.inlined.length > 0) parts.push(`inlines the queries of ${statement.inlined.join(', ')}`);
    for (const scan of statement.scans) parts.push(`scans the ${scan.cached ? 'cached' : 'materialized'} result of ${scan.script} at ${scan.path}`);
    if (statement.materializes != null) parts.push(`writes its result to ${statement.materializes}`);
    if (statement.after.length > 0) parts.push(`runs after ${statement.after.map(e => `node ${e.node} (${e.reason})`).join(', ')}`);
    return parts.join('; ');
}

/// The log fields of a planned statement
export function plannedStatementLogFields(statement: PlannedStatement): Record<string, string> {
    return {
        run: statement.run === 'session' ? 'session' : `script ${statement.target}`,
        node: String(statement.node),
        script: statement.script,
        statement: `${statement.statement}/${statement.statements}`,
        statementType: statement.statementType,
        result: String(statement.result),
        cached: String(statement.cached),
        inlined: statement.inlined.join(', '),
        scans: statement.scans.map(scan => `${scan.script}${scan.cached ? ' (cached)' : ''}: ${scan.path}`).join(', '),
        materializes: statement.materializes ?? '',
        after: statement.after.map(e => `${e.node} ${e.reason}`).join(', '),
    };
}

/// The query metadata of a planned statement, the history shows where the statement comes from
export function plannedStatementMetadata(statement: PlannedStatement): { title: string; description: string; issuer: string; planned: PlannedStatement } {
    return {
        title: plannedStatementTitle(statement),
        description: plannedStatementDescription(statement),
        issuer: statement.run === 'session' ? 'Session run' : `Run of ${statement.target}`,
        planned: statement,
    };
}

/// Log a plan before it runs: its statements and the materialized results
function logPlan(logger: LoggerLike | undefined, sessionId: string, graph: core.buffers.execution.ExecutionGraphT, files: readonly string[], run: PlanRun, statements: PlannedStatement[]): void {
    if (logger == null) return;
    const materializations = graph.materializations ?? [];
    logger.info('Running a plan of session scripts', {
        sessionId,
        run: run.kind === 'session' ? 'session' : `script ${run.target}`,
        scripts: graph.scripts.filter(script => script.planned).length.toString(),
        nodes: graph.nodes.length.toString(),
        edges: graph.edges.length.toString(),
        materializations: materializations.map(m => `${files[m.script]}: ${m.node === NONE ? 'cached' : `node ${m.node}`} -> ${m.path}`).join(', '),
        inlined: statements.filter(s => s.inlined.length > 0).map(s => `${s.node} ${s.script} inlines ${s.inlined.join(' ')}`).join(', '),
    }, LOG_CTX);
}

/// Check a plan before anything of it runs: the visualizations of its outputs decode, including outputs that the run
/// discards. Returns the visualizations of the outputs by node.
async function checkExecutionGraph(plan: SessionScriptsPlan, cooperate: () => Promise<void>) {
    const { graph } = plan;
    const visualizations = new Map<number, ReturnType<typeof resolveCompiledVisualization>>();
    for (const [index, node] of graph.nodes.entries()) {
        if (!node.producesOutput) continue;
        const visualization = node.visualization
            ? resolveCompiledVisualization(String(node.sql ?? ''), node.visualization, node.statementId) : null;
        if (node.visualization && !visualization) {
            throw new Error('Invalid captured visualization metadata');
        }
        visualizations.set(index, visualization);
        if ((index + 1) % PREPARATION_YIELD_INTERVAL === 0) await cooperate();
    }
    return visualizations;
}

/// The shared state of a run: the running queries and their cancellations
export interface RunQueries {
    /// The running queries with their connections
    active: Map<number, { connectionId: string; execution: Promise<unknown> }>;
    /// The cancellations of the queries
    cancellations: Map<number, Promise<void>>;
}

/// Run the nodes of an execution graph across their connections.
///
/// A node starts when its predecessors are done, at most `maxConcurrentQueries` nodes run on a connection at once.
/// The node of a materialized script writes its result as Parquet file and mounts it before the nodes that scan it
/// start. The last output of every script registers as the result of the script. A failed or cancelled run cancels
/// the running nodes and settles once they are done, it writes no more files.
export async function runExecutionGraph(args: {
    plan: SessionScriptsPlan;
    scripts: readonly ScriptData[];
    files: readonly string[];
    sessionId: string;
    executeQuery: QueryExecutor;
    modifySessionScripts: ModifySessionScripts;
    signal: AbortSignal;
    queries: RunQueries;
    /// Cancel the running nodes, e.g. once a node failed
    cancelActive: () => void;
    /// Throws if the session or a planned script changed, `checkVersions` compares the text versions too
    validate: (checkVersions: boolean) => void;
    mounts: ExecutionMounts | null;
    /// Mount the attachments of a session in the embedded Hyper, absent without a compute database
    mountAttachments?: (sessionId: string) => Promise<void>;
    cooperate: () => Promise<void>;
    emit: (update: Partial<SessionExecutionState>, increment?: { statements?: number; scripts?: number }) => void;
    maxConcurrentQueries?: (connectionId: string) => number;
    /// Adjust the execution of the result node of a script, e.g. to cache it
    resultQueryArgs?: (scriptIndex: number) => Partial<QueryExecutionArgs>;

    /// The run of the plan, the logs and the query history show where the statements come from
    run: PlanRun;
    logger?: LoggerLike;
}): Promise<Array<number | null>> {
    const { plan: { graph, connectionIds }, scripts, files, sessionId, signal, queries, logger } = args;
    const plannedStatements = describePlannedStatements(graph, files, args.run);
    args.emit({ phase: 'running', totalStatements: graph.nodes.length });
    const visualizations = await checkExecutionGraph(args.plan, args.cooperate);
    // Validate after notifications, but before the first backend call. Later edits belong to the next run.
    args.validate(true);
    const materializations = graph.materializations ?? [];
    if (materializations.length > 0 && args.mounts == null) {
        throw new Error('Scripts of other connections need the compute database to scan their results');
    }
    // The statements that scan attachments read them from the mount of the session
    if (graph.nodes.some(node => (node.attachments?.length ?? 0) > 0)) {
        if (args.mountAttachments == null) throw new Error('Scripts that read attachments need the compute database');
        await args.mountAttachments(sessionId);
    }
    logPlan(logger, sessionId, graph, files, args.run, plannedStatements);
    // The results that the host provides, e.g. cached results, are read in place
    for (const materialization of materializations) {
        if (materialization.node === NONE) await args.mounts!.use(String(materialization.path ?? ''));
    }
    const predecessorCount = graph.nodes.map(() => 0);
    const successors = graph.nodes.map(() => [] as number[]);
    const uniqueEdges = new Set<string>();
    for (const edge of graph.edges) {
        const key = `${edge.from}:${edge.to}`;
        if (uniqueEdges.has(key)) continue;
        uniqueEdges.add(key);
        predecessorCount[edge.to]++;
        successors[edge.from].push(edge.to);
    }
    const statementIndexes = scripts.map(() => [] as number[]);
    const outputNodeIndexes = scripts.map(() => -1);
    const outputQueryIds = scripts.map(() => null as number | null);
    const settledStatementCounts = scripts.map(() => 0);
    for (const [nodeIndex, node] of graph.nodes.entries()) {
        statementIndexes[node.script].push(nodeIndex);
        if (node.producesOutput) outputNodeIndexes[node.script] = nodeIndex;
    }
    const ready = graph.nodes.map((_node, index) => index).filter(index => predecessorCount[index] === 0);
    const running = connectionIds.map(() => 0);
    const maxConcurrent = connectionIds.map(connectionId => Math.max(1, args.maxConcurrentQueries?.(connectionId) ?? DEFAULT_MAX_CONCURRENT_QUERIES));
    const completions: Promise<void>[] = [];
    let runningTotal = 0;
    let settled = 0;
    let failure: unknown = null;
    let notify: (() => void) | null = null;
    const wait = () => new Promise<void>(resolve => { notify = resolve; });
    const wake = () => { const resolve = notify; notify = null; resolve?.(); };
    const launch = (nodeIndex: number) => {
        const node = graph.nodes[nodeIndex];
        const connectionId = connectionIds[node.connection];
        const scriptIndex = node.script;
        const script = scripts[scriptIndex];
        const statementIndex = statementIndexes[scriptIndex].indexOf(nodeIndex);
        const output = outputNodeIndexes[scriptIndex] === nodeIndex;
        const visualization = visualizations.get(nodeIndex) ?? null;
        // A materialized result must be mounted before the nodes that scan it start
        const materialization = node.materialization !== NONE ? materializations[node.materialization] : null;
        let released = false;
        const release = () => {
            if (released) return;
            released = true;
            running[node.connection]--;
            runningTotal--;
            for (const successor of successors[nodeIndex]) if (--predecessorCount[successor] === 0) ready.push(successor);
            ready.sort((a, b) => a - b);
            wake();
        };
        args.validate(false);
        args.emit({ activeFileName: files[scriptIndex],
            activeStatementIndex: statementIndex + 1, activeStatementCount: statementIndexes[scriptIndex].length });
        running[node.connection]++;
        runningTotal++;
        const planned = plannedStatements[nodeIndex];
        const extra = node.scriptResult ? args.resultQueryArgs?.(scriptIndex) ?? {} : {};
        const [queryId, execution] = args.executeQuery(connectionId, {
            query: String(node.sql ?? ''), cacheable: false, throwOnError: true, abortSignal: signal,
            clientFunctionCall: node.clientFunctionCall != null ? JSON.parse(String(node.clientFunctionCall)) as ClientFunctionCallDescription : undefined,
            analyzeResults: output, publishResults: output || materialization != null,
            onResultsReady: materialization == null ? release : undefined,
            ...extra,
            metadata: {
                queryType: QueryType.USER_PROVIDED, userProvided: true, sessionId, resultOwner: scriptResultOwner(sessionId, script.scriptKey),
                ...extra.metadata,
                ...plannedStatementMetadata(planned),
            },
        });
        logger?.info('Running a planned statement', {
            sessionId, query: queryId.toString(), connectionId, ...plannedStatementLogFields(planned),
            cacheable: String(extra.cacheable ?? false), refreshCache: String(extra.refreshCache ?? false),
        }, LOG_CTX);
        queries.active.set(queryId, { connectionId, execution });
        args.modifySessionScripts({ type: REGISTER_QUERY, value: [script.scriptKey, queryId] });
        if (output) args.modifySessionScripts({ type: SET_SCRIPT_EXECUTION_VISUALIZATION, value: [script.scriptKey, visualization] });
        const completion = execution.then(async table => {
            if (materialization != null) {
                // A failed or cancelled run writes no more files
                if (failure != null) throw failure;
                signal.throwIfAborted();
                if (table == null) throw new Error(`${files[scriptIndex]} has no result that other scripts could read`);
                await args.mounts!.writeTable(String(materialization.path ?? ''), table);
                logger?.info('Wrote a materialized script result', {
                    sessionId, query: queryId.toString(), script: files[scriptIndex], path: String(materialization.path ?? ''), rows: table.numRows.toString(),
                }, LOG_CTX);
            }
            // Executors that do not implement result readiness retain the historical behavior.
            release();
            if (output) {
                await args.modifySessionScripts({ type: SET_SCRIPT_EXECUTION_VISUALIZATION, value: [script.scriptKey, visualization] });
                if (table != null) await args.modifySessionScripts({ type: REGISTER_SCRIPT_RESULT, value: [script.scriptKey, queryId] });
                outputQueryIds[scriptIndex] = queryId;
            }
            queries.active.delete(queryId);
            await queries.cancellations.get(queryId);
            queries.cancellations.delete(queryId);
            if (signal.aborted) {
                wake();
                return;
            }
            args.emit({}, { statements: 1 });
            settledStatementCounts[scriptIndex]++;
            if (settledStatementCounts[scriptIndex] === statementIndexes[scriptIndex].length) args.emit({}, { scripts: 1 });
            if (++settled % EXECUTION_YIELD_INTERVAL === 0) await args.cooperate();
            wake();
        }).catch(error => {
            release();
            queries.active.delete(queryId);
            // The failures of cancelled nodes are no failures of the run
            const first = failure == null && !signal.aborted;
            logger?.[first ? 'warn' : 'info'](first ? 'A planned statement failed' : 'A planned statement stopped', {
                sessionId, query: queryId.toString(), connectionId, ...plannedStatementLogFields(planned),
                error: error instanceof Error ? error.message : String(error),
            }, LOG_CTX);
            if (first) { failure = error; args.cancelActive(); }
            wake();
            throw error;
        });
        completion.catch(() => {});
        completions.push(completion);
    };
    try {
        while ((ready.length > 0 || runningTotal > 0) && failure == null && !signal.aborted) {
            // The ready nodes of the connections that have room, in node order
            for (let i = 0; i < ready.length && failure == null && !signal.aborted;) {
                const node = graph.nodes[ready[i]];
                if (running[node.connection] >= maxConcurrent[node.connection]) { ++i; continue; }
                launch(ready.splice(i, 1)[0]);
            }
            if (runningTotal === 0) break;
            await wait();
        }
    } catch (error) {
        // E.g. the session changed, the nodes that run already are cancelled
        if (failure == null) failure = error;
    }
    if (failure != null || signal.aborted) {
        // The running nodes are done before the caller releases the files of the run
        if (runningTotal > 0) logger?.info('Cancelling the running statements of the plan', { sessionId, running: runningTotal.toString() }, LOG_CTX);
        args.cancelActive();
        await Promise.allSettled(completions);
        throw failure ?? signal.reason ?? new DOMException('Aborted', 'AbortError');
    }
    if (ready.length > 0) throw new Error('Execution plan has a cycle');
    await Promise.all(completions);
    for (const [scriptIndex, script] of scripts.entries()) {
        const outputQueryId = outputQueryIds[scriptIndex];
        const outputNodeIndex = outputNodeIndexes[scriptIndex];
        const statements = statementIndexes[scriptIndex];
        if (outputQueryId !== null && outputNodeIndex !== statements[statements.length - 1]) {
            await args.modifySessionScripts({ type: REGISTER_QUERY, value: [script.scriptKey, outputQueryId] });
            await args.modifySessionScripts({ type: SET_SCRIPT_EXECUTION_VISUALIZATION,
                value: [script.scriptKey, visualizations.get(outputNodeIndex) ?? null] });
        }
    }
    return outputQueryIds;
}

/// Validate a plan against the live session: the session keeps its scripts, their order and their connections, and
/// the planned scripts keep the text of the plan. The catalog may move on, the plan holds the statements as written and
/// the catalog follows them while they run.
export function sessionPlanValidator(args: {
    graph: core.buffers.execution.ExecutionGraphT;
    session: SessionScripts;
    getSession: () => SessionScripts | null;
    scripts: readonly ScriptData[];
    files: readonly string[];
}): (checkVersions: boolean) => void {
    const { graph, session, scripts, files } = args;
    return (checkVersions: boolean) => {
        const live = args.getSession();
        if (!live || live.sessionId !== session.sessionId || live.instance !== session.instance
            || live.scriptOrder.join('\0') !== files.join('\0') || files.some(file => live.scriptRefs[file] == null)) {
            throw new Error('Session changed during execution');
        }
        scripts.forEach((script, index) => {
            if (live.scriptRefs[files[index]].scriptId !== script.scriptKey
                || live.scripts[script.scriptKey]?.scriptSession !== script.scriptSession) {
                throw new Error(`Session script changed during execution: ${files[index]}`);
            }
        });
        if (graph.scripts.length !== scripts.length) {
            throw new Error('Session changed during execution');
        }
        if (!checkVersions) return;
        scripts.forEach((script, index) => {
            const metadata = graph.scripts[index];
            if (!metadata.planned) return;
            const scriptSession = script.scriptSession;
            if (metadata.scriptId !== scriptSession.getCatalogEntryId()
                || metadata.textVersion !== scriptSession.getTextVersion()
                || metadata.analyzedTextVersion !== metadata.textVersion) {
                throw new Error(`Stale execution plan: ${files[index]}`);
            }
        });
    };
}

/// Analyze every script of a session and publish the declarations into the catalogs of their connections. Returns
/// the editor updates of the analysis at the final catalog revisions.
export async function prepareSessionScripts(
    scripts: readonly ScriptData[],
    cooperate: () => Promise<void>,
): Promise<Array<{ scriptKey: number; editorUpdate: core.buffers.editor.EditorUpdateT }>> {
    const analyze = (script: ScriptData) => {
        const update = script.scriptSession.analyze();
        if (update.status !== core.buffers.editor.EditorUpdateStatus.OK || !update.analysisAvailable) {
            throw new Error(String(update.statusMessage || `Failed to analyze ${script.fileName}`));
        }
        return update;
    };
    for (const [index, script] of scripts.entries()) {
        analyze(script);
        script.scriptSession.loadIntoCatalog();
        if ((index + 1) % PREPARATION_YIELD_INTERVAL === 0) await cooperate();
    }
    // Publishing changed the catalogs, refresh the analysis at the current catalog revisions
    const updates: Array<{ scriptKey: number; editorUpdate: core.buffers.editor.EditorUpdateT }> = [];
    for (const [index, script] of scripts.entries()) {
        updates.push({ scriptKey: script.scriptKey, editorUpdate: analyze(script) });
        if ((index + 1) % PREPARATION_YIELD_INTERVAL === 0) await cooperate();
    }
    return updates;
}

/// A script that can't be planned, e.g. one that references an unknown script
export class ScriptPlanError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ScriptPlanError';
    }
}

/// Run a plan of the scripts of a session: analyze the scripts, plan the targets with what they need, every script
/// without targets, serve the cached results and run the rest.
///
/// A script with a reusable cached result doesn't run if no script runs that it follows in the plan: its result is
/// served from the cache, a script that scans it reads the cached file. A refresh reads no cached results. A script
/// that runs replaces the result of its reusable key. Releases the mounts and the cached files once the run settled.
/// Returns the queries of the outputs of the scripts.
export async function runSessionPlan(args: {
    session: SessionScripts;
    getSession: () => SessionScripts | null;
    /// The scripts of the plan with what they need, every script if absent
    targets?: number[];
    /// Plan the scripts that the change of these inputs affects instead: the scripts that use them and the scripts
    /// downstream of them (docs/design/session_inputs.md)
    inputs?: readonly string[];
    /// The run of the plan, a run of a script needs a statement of its target
    run: PlanRun;
    executeQuery: QueryExecutor;
    modifySessionScripts: ModifySessionScripts;
    signal: AbortSignal;
    queries: RunQueries;
    /// Cancel the running queries, e.g. once a statement failed
    cancelActive: () => void;
    cooperate: () => Promise<void>;
    emit: (update: Partial<SessionExecutionState>, increment?: { statements?: number; scripts?: number }) => void;
    /// The mounts of the materialized script results of the run, null without a compute database
    mounts: ExecutionMounts | null;
    /// Mount the attachments of a session in the embedded Hyper, absent without a compute database
    mountAttachments?: (sessionId: string) => Promise<void>;
    /// The result key of a script on a connection, names the files of the materialized results
    resultKey: (connectionId: string, signature: string) => Promise<string | null>;
    /// Does a connection cache query results? The run reuses and writes the results of the scripts with reusable keys.
    cachesResults: (connectionId: string) => boolean;
    /// The query result cache of the app, null if results aren't cached
    cache: QueryResultCache | null;
    /// Read no cached results: the scripts run, the results with reusable keys become the newest files of their keys
    refresh: boolean;
    maxConcurrentQueries?: (connectionId: string) => number;
    logger?: LoggerLike;
}): Promise<Array<number | null>> {
    const { session, signal, queries, cooperate, emit, mounts, cache, run } = args;
    const { sessionId, instance } = session;
    // The cached files that the run serves or scans, pinned from the lookup on
    const retained: Array<() => Promise<void>> = [];
    try {
        const files = [...session.scriptOrder];
        emit({ totalScripts: files.length });
        // Let React commit the running state and the browser paint its spinner before synchronous
        // analysis and planning work starts.
        await cooperate();
        const scripts = files.map(file => {
            const script = session.scripts[session.scriptRefs[file].scriptId];
            if (!script) throw new Error(`Missing script: ${file}`);
            return script;
        });
        const updates = await prepareSessionScripts(scripts, cooperate);
        await cooperate();
        // A change of inputs runs the scripts that it affects, with what they read
        let targets = args.targets;
        if (args.inputs != null) {
            const dataflow = instance.deriveSessionDataflow(sessionPlanRequest(scripts, files, session)).unpack() as core.buffers.execution.SessionDataflowT;
            targets = affectedScriptIndices(dataflow, args.inputs);
            emit({ totalScripts: targets.length });
            if (targets.length === 0) {
                await args.modifySessionScripts({ type: APPLY_PLANNER_ANALYSIS, value: updates });
                return files.map(() => null);
            }
        }
        const mountPrefix = mounts?.prefix ?? createMountPrefix();
        const planWith = (provided: number[] = [], names: Map<number, string> = new Map()) => {
            // A catalog update may have landed since the preparation, the planner needs the current analysis
            for (const script of scripts) script.scriptSession.analyze();
            const plan = planSessionScripts({
                instance, scripts, files, mountPrefix, targets, materialized: provided, materializationFile: index => names.get(index), session,
            });
            if (!plan.graph.valid) throw new ScriptPlanError(describePlanErrors(plan.graph, files));
            return plan;
        };
        // The plan of the targets checks the session and gives the result keys
        let plan = planWith();
        if (run.kind === 'script' && targets?.every(target => !plan.graph.nodes.some(node => node.script === target))) {
            throw new ScriptPlanError(`${run.target} holds no statement`);
        }
        const keys = await computeScriptResultKeys(plan.graph,
            (index, signature) => args.resultKey(scripts[index].connection.connectionId, signature),
            index => args.cachesResults(scripts[index].connection.connectionId));
        const visualizations = await checkExecutionGraph(plan, cooperate);
        const validate = sessionPlanValidator({ graph: plan.graph, session, getSession: args.getSession, scripts, files });
        validate(true);
        await args.modifySessionScripts({ type: APPLY_PLANNER_ANALYSIS, value: updates });
        signal.throwIfAborted();
        validate(true);
        // The scripts whose cached results are served, with their files
        const cachedFiles = new Map<number, string>();
        if (!args.refresh && cache != null) {
            const statements = describePlannedStatements(plan.graph, files, run);
            // The scripts of the nodes that the nodes of a script follow, edges go from earlier to later scripts
            const follows = scripts.map(() => new Set<number>());
            for (const edge of plan.graph.edges) {
                const from = plan.graph.nodes[edge.from].script, to = plan.graph.nodes[edge.to].script;
                if (from !== to) follows[to].add(from);
            }
            const runs = scripts.map(() => true);
            for (const [index, script] of scripts.entries()) {
                const key = keys[index];
                const resultNodeIndex = plan.graph.nodes.findIndex(node => node.script === index && node.scriptResult);
                if (!key?.reusable || resultNodeIndex < 0 || [...follows[index]].some(earlier => runs[earlier])) continue;
                const file = await cache.retain(key.key).catch(() => null);
                signal.throwIfAborted();
                if (file == null) continue;
                retained.push(file.release);
                const resultNode = plan.graph.nodes[resultNodeIndex];
                const statement = { ...statements[resultNodeIndex], cached: true };
                const visualization = visualizations.get(resultNodeIndex) ?? null;
                const connectionId = script.connection.connectionId;
                const [queryId, execution] = args.executeQuery(connectionId, {
                    query: String(resultNode.sql ?? ''), analyzeResults: true, publishResults: true, throwOnError: true, abortSignal: signal,
                    cacheable: true, cacheOnly: true, cacheSignature: key.signature,
                    metadata: {
                        queryType: QueryType.USER_PROVIDED, userProvided: true, sessionId, resultOwner: scriptResultOwner(sessionId, script.scriptKey),
                        ...plannedStatementMetadata(statement),
                    },
                });
                args.logger?.info('Serving the cached result of a script', {
                    sessionId, query: queryId.toString(), key: key.key, ...plannedStatementLogFields(statement),
                }, LOG_CTX);
                queries.active.set(queryId, { connectionId, execution });
                const served = await execution.then(table => ({ table }), async (error: unknown) => {
                    if (!isQueryCacheMiss(error)) {
                        // The script shows the error of the query
                        await args.modifySessionScripts({ type: REGISTER_QUERY, value: [script.scriptKey, queryId] });
                        throw error;
                    }
                    args.logger?.info('The cached result of a script is gone, running it', { sessionId, query: queryId.toString(), script: files[index], key: key.key }, LOG_CTX);
                    return null;
                }).finally(() => queries.active.delete(queryId));
                if (served == null) continue;
                runs[index] = false;
                cachedFiles.set(index, file.entry.name);
                await args.modifySessionScripts({ type: REGISTER_QUERY, value: [script.scriptKey, queryId] });
                await args.modifySessionScripts({ type: SET_SCRIPT_EXECUTION_VISUALIZATION, value: [script.scriptKey, visualization] });
                if (served.table != null) await args.modifySessionScripts({ type: REGISTER_SCRIPT_RESULT, value: [script.scriptKey, queryId] });
                await cooperate();
            }
        }
        // Scripts without statements are done right away, so are the scripts with cached results
        const counted = targets ?? scripts.map((_script, index) => index);
        // A plan of targets leaves out the targets with cached results
        if (targets != null) targets = targets.filter(target => !cachedFiles.has(target));
        if (targets?.length === 0) {
            emit({}, { scripts: counted.length });
            return files.map(() => null);
        }
        // The plan of the scripts that run, it scans the cached results. A result that the run materializes is a new
        // file of its key if the key is reusable, a transient file otherwise.
        if (cachedFiles.size > 0 || (mounts != null && plan.graph.materializations.length > 0)) {
            const names = new Map(cachedFiles);
            for (const m of mounts != null ? plan.graph.materializations : []) {
                if (!names.has(m.script)) names.set(m.script, mounts!.fileName(keys[m.script]?.reusable ? keys[m.script]!.key : null));
            }
            plan = planWith([...cachedFiles.keys()], names);
        }
        // A materialized result is the file of its key already
        const materialized = new Set(plan.graph.materializations.map(m => m.script));
        const graph = plan.graph;
        const done = counted.filter(index => !graph.nodes.some(node => node.script === index)).length;
        if (done > 0) emit({}, { scripts: done });
        const outputs = await runExecutionGraph({
            plan, scripts, files, sessionId,
            executeQuery: args.executeQuery, modifySessionScripts: args.modifySessionScripts,
            signal, queries, cancelActive: args.cancelActive,
            validate: sessionPlanValidator({ graph, session, getSession: args.getSession, scripts, files }),
            mounts, mountAttachments: args.mountAttachments, cooperate, emit,
            maxConcurrentQueries: args.maxConcurrentQueries,
            run, logger: args.logger,
            // The cached results were read already, a script that runs replaces the result of its key
            resultQueryArgs: index => keys[index]?.reusable && !materialized.has(index)
                ? { cacheable: true, refreshCache: true, cacheSignature: keys[index]!.signature }
                : {},
        });
        return outputs;
    } finally {
        await mounts?.release();
        await Promise.all(retained.map(release => release().catch(() => {})));
    }
}

/// Run every script of a session, or the scripts that a change of inputs affects, and report the state of the run
export async function runSessionExecution(args: {
    session: SessionScripts;
    getSession: () => SessionScripts | null;
    executeQuery: QueryExecutor;
    cancelQuery: CancelQuery;
    modifySessionScripts: ModifySessionScripts;
    signal: AbortSignal;
    onState: (state: SessionExecutionState) => void;
    /// The mounts of the materialized script results of the run, null without a compute database
    mounts?: ExecutionMounts | null;
    /// Mount the attachments of a session in the embedded Hyper, absent without a compute database
    mountAttachments?: (sessionId: string) => Promise<void>;
    /// The result key of a script on a connection, names the files of the materialized results
    resultKey?: (connectionId: string, signature: string) => Promise<string | null>;
    /// Does a connection cache query results? The run reuses and writes the results of the scripts with reusable keys.
    cachesResults?: (connectionId: string) => boolean;
    /// The query result cache of the app, null if results aren't cached
    cache?: QueryResultCache | null;
    /// Read no cached results: every script runs, the results with reusable keys become the newest files of their keys
    refresh?: boolean;
    /// Run only the scripts that the change of these inputs affects
    inputs?: readonly string[];
    /// Allows tests to control cooperative scheduling without relying on timer timing.
    yieldToBrowser?: () => Promise<void>;
    /// Maximum concurrently running backend queries on a connection.
    maxConcurrentQueries?: (connectionId: string) => number;
    /// Logs the plan and its statements
    logger?: LoggerLike;
}): Promise<void> {
    const { session, signal } = args;
    if (!acquireSessionExecution(session, 'session')) return;
    let state: SessionExecutionState = {
        phase: 'planning', totalScripts: 0, completedScripts: 0,
        totalStatements: 0, completedStatements: 0, activeFileName: null,
        activeStatementIndex: null, activeStatementCount: null, error: null,
    };
    const emit = (update: Partial<SessionExecutionState>, increment: { statements?: number; scripts?: number } = {}) => {
        state = {
            ...state, ...update,
            completedStatements: state.completedStatements + (increment.statements ?? 0),
            completedScripts: state.completedScripts + (increment.scripts ?? 0),
        };
        args.onState(state);
    };
    const queries: RunQueries = { active: new Map(), cancellations: new Map() };
    const cooperate = async () => {
        signal.throwIfAborted();
        await (args.yieldToBrowser ?? yieldToBrowser)();
        signal.throwIfAborted();
    };
    const cancelActive = () => {
        for (const [queryId, { connectionId }] of queries.active) {
            if (queries.cancellations.has(queryId)) continue;
            // Catch immediately: cancellation can reject before execution has drained.
            try {
                queries.cancellations.set(queryId, args.cancelQuery(connectionId, queryId).catch(() => {}));
            } catch {
                queries.cancellations.set(queryId, Promise.resolve());
            }
        }
    };
    const stop = () => {
        emit({ phase: 'stopping' });
        cancelActive();
    };
    signal.addEventListener('abort', stop, { once: true });
    try {
        await runSessionPlan({
            session, getSession: args.getSession, inputs: args.inputs, run: { kind: 'session', target: null },
            executeQuery: args.executeQuery, modifySessionScripts: args.modifySessionScripts,
            signal, queries, cancelActive, cooperate, emit,
            mounts: args.mounts ?? null, mountAttachments: args.mountAttachments,
            resultKey: args.resultKey ?? (async () => null), cachesResults: args.cachesResults ?? (() => false),
            cache: args.cache ?? null, refresh: args.refresh ?? false,
            maxConcurrentQueries: args.maxConcurrentQueries, logger: args.logger,
        });
        signal.throwIfAborted();
        signal.removeEventListener('abort', stop);
        emit({ phase: 'succeeded', activeFileName: null,
            activeStatementIndex: null, activeStatementCount: null });
    } catch (error) {
        cancelActive();
        await Promise.allSettled([...queries.active.values()].map(({ execution }) => execution));
        await Promise.allSettled(queries.cancellations.values());
        const cancelled = signal.aborted || (error instanceof Error && error.name === 'AbortError');
        signal.removeEventListener('abort', stop);
        emit({ phase: cancelled ? 'cancelled' : 'failed',
            error: cancelled ? null : error instanceof Error ? error.message : String(error) });
    } finally {
        signal.removeEventListener('abort', stop);
        releaseSessionExecution(session);
    }
}
