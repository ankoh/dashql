import type * as arrow from 'apache-arrow';
import type * as core from '@ankoh/dashql-core';

import type { QueryExecutor } from '../../connections/query_executor.js';
import type { QueryResultCache } from '../../query/query_result_cache.js';
import { QueryType } from '../../query/query_execution_state.js';
import {
    ScriptPlanError,
    acquireSessionExecution,
    computeScriptResultKeys,
    createMountPrefix,
    planSessionScripts,
    releaseSessionExecution,
    runSessionPlan,
    type ExecutionMounts,
    type RunQueries,
} from './session_execution.js';
import { REGISTER_QUERY, scriptResultOwner, type ScriptData, type SessionScripts } from './session_scripts.js';
import type { ModifySessionScripts } from './session_scripts_registry.js';
import { yieldToBrowser } from '../../utils/yield_to_browser.js';
import type { LoggerLike } from '../../platform/logger/logger.js';

/// The services of the run of a script
export interface ScriptRunServices {
    /// The mounts of the materialized results, null without a compute database
    createMounts: () => ExecutionMounts | null;
    /// Mount the attachments of a session in the embedded Hyper, absent without a compute database
    mountAttachments?: (sessionId: string) => Promise<void>;
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

/// The services of a run without a session execution provider: no results of other connections are mounted and no
/// results are cached
const PLAIN_SERVICES: ScriptRunServices = {
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

/// Run a script: plan it with the scripts it needs and run the plan (`runSessionPlan`). Resolves with the last output
/// of the script, rejects if the plan is invalid, a statement fails or another run holds the session. A failed
/// statement cancels the other statements of the run.
///
/// The plan of the script includes the statements before the terminal queries of the scripts it inlines and the
/// scripts it materializes (docs/design/script_references.md). The result of the script is cached if its key is
/// reusable, the key covers the referenced scripts. Like in a run of the session, a script with a reusable cached
/// result doesn't run if nothing that it follows runs.
export async function runPlannedScript(
    services: ScriptRunServices,
    session: SessionScripts,
    target: ScriptData,
    executeQuery: QueryExecutor,
    modifySessionScripts: ModifySessionScripts,
    options: ScriptRunOptions = {},
): Promise<arrow.Table | null> {
    // The app disables the runs of a held session, a run that starts meanwhile fails
    if (!options.held && !acquireSessionExecution(session)) throw new Error('Another script of the session is running');
    const { sessionId } = session;
    // Aborted once a statement failed, cancels the other statements
    const cancellation = new AbortController();
    const queries: RunQueries = { active: new Map(), cancellations: new Map() };
    // Did a statement start? An error before shows where the result of the script would be.
    let launched = false;
    // The query of the last output of the target, its result is the result of the run
    let result: Promise<arrow.Table | null> | null = null;
    const executeNode: QueryExecutor = (connectionId, args) => {
        launched = true;
        const [queryId, execution] = executeQuery(connectionId, args);
        if (args.metadata.resultOwner === scriptResultOwner(sessionId, target.scriptKey) && args.analyzeResults) result = execution;
        return [queryId, execution];
    };
    try {
        const { files, targetIndex } = sessionScriptsOf(session, target);
        const liveSession = services.liveSession;
        const outputs = await runSessionPlan({
            session, getSession: liveSession != null ? () => liveSession(sessionId) : () => session,
            targets: [targetIndex], run: { kind: 'script', target: files[targetIndex] },
            executeQuery: executeNode, modifySessionScripts, signal: cancellation.signal, queries,
            cancelActive: () => cancellation.abort(), cooperate: () => yieldToBrowser(), emit: () => {},
            mounts: services.createMounts(), mountAttachments: services.mountAttachments,
            resultKey: services.cacheKey, cachesResults: services.cachesResults,
            cache: services.cache, refresh: options.refresh ?? false,
            maxConcurrentQueries: services.maxConcurrentQueries, logger: options.logger,
        });
        if (outputs[targetIndex] != null) {
            await modifySessionScripts({ type: REGISTER_QUERY, value: [target.scriptKey, outputs[targetIndex]!] });
        }
        return await (result ?? Promise.resolve(null));
    } catch (error) {
        // The script shows why it can't be planned or run where it shows the error of a failed statement, e.g. a
        // script of the session that can't be analyzed or a plan that needs the compute database
        if (error instanceof ScriptPlanError || !launched) {
            await recordPlanError(session, target, executeQuery, modifySessionScripts, error instanceof Error ? error : new Error(String(error)));
        }
        throw error;
    } finally {
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
        instance: session.instance, scripts, files,
        mountPrefix: createMountPrefix(), targets: [targetIndex], session,
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
