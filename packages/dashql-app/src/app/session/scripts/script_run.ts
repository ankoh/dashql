import type * as arrow from 'apache-arrow';
import type * as core from '@ankoh/dashql-core';

import type { QueryExecutor } from '../../connections/query_executor.js';
import { isQueryCacheMiss, type QueryResultCache } from '../../../query/query_result_cache.js';
import { QueryType } from '../../../query/query_execution_state.js';
import {
    acquireSessionExecution,
    createMountPrefix,
    describePlanErrors,
    planSessionScripts,
    prepareSessionScripts,
    releaseSessionExecution,
    runExecutionGraph,
    sessionPlanValidator,
    computeScriptResultKeys,
    describePlannedStatements,
    materializationFileName,
    plannedStatementLogFields,
    plannedStatementMetadata,
    scriptResultSignature,
    type ExecutionMounts,
} from './session_execution.js';
import { APPLY_PLANNER_ANALYSIS, REGISTER_QUERY, REGISTER_SCRIPT_RESULT, scriptResultOwner, type ScriptData, type SessionScripts } from './session_scripts.js';
import type { QueryExecutionArgs } from '../../connections/query_execution_args.js';
import type { ModifySessionScripts } from './session_scripts_registry.js';
import { yieldToBrowser } from '../../../utils/yield_to_browser.js';
import type { LoggerLike } from '../../../platform/logger/logger.js';

const LOG_CTX = 'session_execution';

const NONE = 0xffffffff;

/// A script that can't be planned, e.g. one that references an unknown script
export class ScriptPlanError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ScriptPlanError';
    }
}

/// The services of the run of a script
export interface ScriptRunServices {
    /// Is a connection the embedded Hyper?
    isLocalConnection: (connectionId: string) => boolean;
    /// The mounts of the materialized results, null without a compute database
    createMounts: () => ExecutionMounts | null;
    /// The result key of a script on a connection, null if the connection has no key
    cacheKey: (connectionId: string, signature: string) => Promise<string | null>;
    /// Does a connection cache query results? Runs reuse the cached results of its scripts only then.
    cachesResults: (connectionId: string) => boolean;
    /// The query result cache of the app, null if results aren't cached
    cache: QueryResultCache | null;
    /// The maximum number of statements a connection runs at once
    maxConcurrentQueries: (connectionId: string) => number;
    /// The live session, a run fails if its scripts, their order or connections change meanwhile. Without it, a run
    /// checks only the text and catalog versions of its scripts.
    liveSession?: (sessionId: string) => SessionScripts | null;
}

/// The services of a run without a session execution provider: no connection is the embedded Hyper, no results of
/// other connections are mounted and no results are cached
const PLAIN_SERVICES: ScriptRunServices = {
    isLocalConnection: () => false,
    createMounts: () => null,
    cacheKey: async () => null,
    cachesResults: () => false,
    cache: null,
    maxConcurrentQueries: () => 1,
};

/// The scripts of a session in session order and the index of a script
function sessionScriptsOf(session: SessionScripts, target: ScriptData) {
    const files = [...session.scriptOrder];
    const scripts = files.map(file => session.scripts[session.scriptRefs[file].scriptId]);
    const targetIndex = scripts.findIndex(script => script.scriptKey === target.scriptKey);
    if (targetIndex < 0) throw new Error(`${target.fileName} is no script of the session`);
    return { files, scripts, targetIndex };
}

/// The options of the run of a script
export interface ScriptRunOptions {
    /// Read no cached results: the script and the scripts it references run, their results with reusable keys become
    /// the newest files of their keys
    refresh?: boolean;
    /// The caller holds the session already (`waitForSessionExecution`), the run releases it
    held?: boolean;
    /// Logs the plan, its statements and the cached results it reads
    logger?: LoggerLike;
}

/// Run a script: plan it with the scripts it needs and run the plan. Resolves with the last output of the script,
/// rejects if the plan is invalid, a statement fails or another run holds the session. A failed statement cancels the
/// other statements of the run.
///
/// The plan of the script includes the statements before the terminal queries of the scripts it inlines and the
/// scripts it materializes (docs/design/script_references.md). The result of the script is cached if its key is
/// reusable, the key covers the referenced scripts. A cached result of the script is served without running anything
/// else, a materialized script with a reusable cached result is scanned from the cache instead of running. A refresh
/// reads no cached result.
export async function runPlannedScript(
    services: ScriptRunServices,
    session: SessionScripts,
    target: ScriptData,
    executeQuery: QueryExecutor,
    modifySessionScripts: ModifySessionScripts,
    options: ScriptRunOptions = {},
): Promise<arrow.Table | null> {
    const refresh = options.refresh ?? false;
    const logger = options.logger;
    // The app disables the runs of a held session, a run that starts meanwhile fails
    if (!options.held && !acquireSessionExecution(session)) throw new Error('Another script of the session is running');
    const { sessionId, instance } = session;
    // Aborted once a statement failed, cancels the other statements
    const cancellation = new AbortController();
    const signal = cancellation.signal;
    const cooperate = () => yieldToBrowser();
    const queries = { active: new Map<number, { connectionId: string; execution: Promise<unknown> }>(), cancellations: new Map<number, Promise<void>>() };
    let mounts: ExecutionMounts | null = null;
    // The cached files that the plan scans, pinned from the lookup on
    const retained: Array<() => Promise<void>> = [];
    // Did a statement start? An error before shows where the result of the script would be.
    let launched = false;
    try {
        const { files, scripts, targetIndex } = sessionScriptsOf(session, target);
        const updates = await prepareSessionScripts(scripts, cooperate);
        mounts = services.createMounts();
        const mountPrefix = mounts?.prefix ?? createMountPrefix();
        const plan = (materialized: number[] = [], materializationFiles: Map<number, string> = new Map()) => planSessionScripts({
            instance, scripts, files, isLocalConnection: services.isLocalConnection,
            mountPrefix, targets: [targetIndex], materialized,
            materializationFile: index => materializationFiles.get(index),
        });
        let planned = plan();
        if (!planned.graph.valid) throw new ScriptPlanError(describePlanErrors(planned.graph, files));
        if (!planned.graph.nodes.some(node => node.script === targetIndex)) throw new ScriptPlanError(`${files[targetIndex]} holds no statement`);

        // The result keys cover the referenced scripts
        const connectionOf = (index: number) => scripts[index].connection.connectionId;
        const keys = await computeScriptResultKeys(
            planned.graph,
            (index, signature) => services.cacheKey(connectionOf(index), signature),
            index => services.cachesResults(connectionOf(index)),
        );
        const cache = services.cache;
        const targetKey = cache != null && keys[targetIndex]?.reusable ? keys[targetIndex]!.key : null;
        const resultArgs = (): Partial<QueryExecutionArgs> => ({
            // The executor derives the key of the target from its signature
            cacheable: targetKey != null,
            refreshCache: refresh,
            cacheSignature: targetKey != null ? scriptResultSignature(planned.graph, keys, targetIndex) : undefined,
            throwOnError: true,
            metadata: {
                queryType: QueryType.USER_PROVIDED, title: 'Session Query', description: null, issuer: 'Query Rerun',
                userProvided: true, sessionId, resultOwner: scriptResultOwner(sessionId, target.scriptKey),
            },
        });
        // A cached result of the target is served without running anything else. The query of the result node only
        // holds after the statements before it and with the materializations of the plan, it never runs on its own:
        // if the cached result is gone meanwhile, e.g. evicted, the plan runs.
        const run = { kind: 'script' as const, target: files[targetIndex] };
        const resultNodeIndex = planned.graph.nodes.findIndex(node => node.script === targetIndex && node.scriptResult);
        const resultNode = resultNodeIndex >= 0 ? planned.graph.nodes[resultNodeIndex] : undefined;
        if (!refresh && targetKey != null && resultNode != null && await cache!.has(targetKey).catch(() => false)) {
            await modifySessionScripts({ type: APPLY_PLANNER_ANALYSIS, value: updates });
            launched = true;
            const statement = { ...describePlannedStatements(planned.graph, files, run)[resultNodeIndex], cached: true };
            const args = resultArgs();
            const [queryId, execution] = executeQuery(connectionOf(targetIndex), {
                query: String(resultNode.sql ?? ''), analyzeResults: true, publishResults: true, ...args, cacheOnly: true,
                metadata: { ...args.metadata!, ...plannedStatementMetadata(statement) },
            } as QueryExecutionArgs);
            logger?.info('Serving the cached result of a script', {
                sessionId, query: queryId.toString(), key: targetKey, ...plannedStatementLogFields(statement),
            }, LOG_CTX);
            const served = await execution.then(table => ({ table }), async (error: unknown) => {
                if (isQueryCacheMiss(error)) {
                    logger?.info('The cached result of a script is gone, running its plan', { sessionId, query: queryId.toString(), script: files[targetIndex], key: targetKey }, LOG_CTX);
                    return null;
                }
                // The script shows the error of the query
                await modifySessionScripts({ type: REGISTER_QUERY, value: [target.scriptKey, queryId] });
                throw error;
            });
            if (served != null) {
                await modifySessionScripts({ type: REGISTER_QUERY, value: [target.scriptKey, queryId] });
                if (served.table != null) await modifySessionScripts({ type: REGISTER_SCRIPT_RESULT, value: [target.scriptKey, queryId] });
                return served.table;
            }
        }
        // A materialized script whose key is reusable and cached doesn't run, the plan scans the cached file. Every
        // other one runs: a result with a reusable key becomes a new file of its key, any other one a transient file.
        if (mounts != null && planned.graph.materializations.length > 0) {
            const cached: number[] = [];
            const materializationFiles = new Map<number, string>();
            for (const materialization of planned.graph.materializations) {
                const key = keys[materialization.script];
                const file = !refresh && cache != null && key?.reusable ? await cache.retain(key.key).catch(() => null) : null;
                if (file != null) {
                    retained.push(file.release);
                    cached.push(materialization.script);
                    logger?.info('Scanning the cached result of a script instead of running it', {
                        sessionId, script: files[materialization.script], file: file.entry.name, key: key!.key,
                        cachedAt: new Date(file.entry.cachedAtMs).toISOString(),
                    }, LOG_CTX);
                }
                materializationFiles.set(materialization.script, file?.entry.name ?? materializationFileName(mounts, key));
            }
            planned = plan(cached, materializationFiles);
            if (!planned.graph.valid) throw new ScriptPlanError(describePlanErrors(planned.graph, files));
        }
        const liveSession = services.liveSession;
        const getSession = liveSession != null ? () => liveSession(sessionId) : () => session;
        const validate = sessionPlanValidator({ graph: planned.graph, session, getSession, scripts, files });
        // The query of the last output of the target, its result is the result of the run
        const result: { execution: Promise<arrow.Table | null> | null } = { execution: null };
        const executeNode: QueryExecutor = (connectionId, args) => {
            launched = true;
            const [queryId, execution] = executeQuery(connectionId, args);
            if (args.metadata.resultOwner === scriptResultOwner(sessionId, target.scriptKey) && args.analyzeResults) result.execution = execution;
            return [queryId, execution];
        };
        const outputs = await runExecutionGraph({
            plan: planned, scripts, files, sessionId, executeQuery: executeNode, modifySessionScripts, signal, queries,
            cancelActive: () => cancellation.abort(), validate, mounts, cooperate, emit: () => {},
            maxConcurrentQueries: services.maxConcurrentQueries,
            run, logger,
            beforeRun: async () => { await modifySessionScripts({ type: APPLY_PLANNER_ANALYSIS, value: updates }); },
            resultQueryArgs: scriptIndex => scriptIndex !== targetIndex ? {} : resultArgs(),
        });
        if (outputs[targetIndex] != null) {
            await modifySessionScripts({ type: REGISTER_QUERY, value: [target.scriptKey, outputs[targetIndex]!] });
        }
        return await (result.execution ?? Promise.resolve(null));
    } catch (error) {
        // The script shows why it can't be planned or run where it shows the error of a failed statement, e.g. a
        // script of the session that can't be analyzed or a plan that needs the compute database
        if (error instanceof ScriptPlanError || !launched) {
            await recordPlanError(session, target, executeQuery, modifySessionScripts, error instanceof Error ? error : new Error(String(error)));
        }
        throw error;
    } finally {
        await mounts?.release();
        await Promise.all(retained.map(release => release().catch(() => {})));
        releaseSessionExecution(session);
    }
}

/// Record an error of a run before its statements as a failed query of the script
async function recordPlanError(
    session: SessionScripts,
    target: ScriptData,
    executeQuery: QueryExecutor,
    modifySessionScripts: ModifySessionScripts,
    error: Error,
): Promise<void> {
    const [queryId, execution] = executeQuery(target.connection.connectionId, {
        query: target.scriptSession.getText(),
        failure: error,
        metadata: {
            queryType: QueryType.USER_PROVIDED, title: 'Session Query', description: null, issuer: 'Query Rerun',
            userProvided: true, sessionId: session.sessionId, resultOwner: scriptResultOwner(session.sessionId, target.scriptKey),
        },
    });
    await modifySessionScripts({ type: REGISTER_QUERY, value: [target.scriptKey, queryId] });
    await execution.catch(() => null);
}

/// The cache key of the result of a script, the key that a run of the script reads and writes. Null if the result
/// is not reusable or the current analysis of the scripts it needs can't be planned. Plans without analyzing.
export async function computeScriptResultCacheKey(
    services: ScriptRunServices,
    session: SessionScripts,
    target: ScriptData,
): Promise<string | null> {
    const { files, scripts, targetIndex } = sessionScriptsOf(session, target);
    const { graph } = planSessionScripts({
        instance: session.instance, scripts, files, isLocalConnection: services.isLocalConnection,
        mountPrefix: createMountPrefix(), targets: [targetIndex],
    });
    if (!graph.valid) return null;
    const connectionOf = (index: number) => scripts[index].connection.connectionId;
    const keys = await computeScriptResultKeys(graph, (index, signature) => services.cacheKey(connectionOf(index), signature), index => services.cachesResults(connectionOf(index)));
    const key = keys[targetIndex];
    return key?.reusable ? key.key : null;
}

/// The services of script runs, one per core instance, registered by the session execution provider
const runners = new WeakMap<core.DashQL, ScriptRunServices>();

/// Register the services of the script runs of a core instance
export function registerScriptRunServices(instance: core.DashQL, services: ScriptRunServices | null): void {
    if (services == null) runners.delete(instance);
    else runners.set(instance, services);
}

/// The services of the script runs of a core instance. Without a session execution provider, runs neither mount the
/// results of other connections nor cache results.
export function scriptRunServices(instance: core.DashQL): ScriptRunServices {
    return runners.get(instance) ?? PLAIN_SERVICES;
}
