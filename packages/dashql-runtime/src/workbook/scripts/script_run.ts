import type * as arrow from 'apache-arrow';
import type * as core from '@ankoh/dashql-core';

import type { QueryExecutor } from '../../connections/query_execution_args.js';
import type { QueryResultCache } from '../../query/query_result_cache.js';
import { QueryType } from '../../query/query_execution_state.js';
import {
    ScriptPlanError,
    acquireWorkbookExecution,
    computeScriptResultKeys,
    createMountPrefix,
    planWorkbookScripts,
    releaseWorkbookExecution,
    runWorkbookPlan,
    type ExecutionMounts,
    type RunQueries,
} from './workbook_execution.js';
import { REGISTER_QUERY, scriptResultOwner, type ScriptData, type WorkbookScripts } from './workbook_scripts.js';
import type { ModifyWorkbookScripts } from './workbook_scripts_registry_state.js';
import { yieldToBrowser } from '../../utils/yield_to_browser.js';
import type { LoggerLike } from '../../platform/logger/logger.js';

/// The services of the run of a script
export interface ScriptRunServices {
    /// The mounts of the materialized results, null without a compute database
    createMounts: () => ExecutionMounts | null;
    /// Mount the attachments of a workbook in the embedded Hyper, absent without a compute database
    mountAttachments?: (workbookId: string) => Promise<void>;
    /// The result key of a script on a connection, null if the connection has no key
    cacheKey: (connectionId: string, signature: string) => Promise<string | null>;
    /// Does a connection cache query results? Runs reuse the cached results of its scripts only then.
    cachesResults: (connectionId: string) => boolean;
    /// The query result cache of the app, null if results aren't cached
    cache: QueryResultCache | null;
    /// The maximum number of statements a connection runs at once
    maxConcurrentQueries: (connectionId: string) => number;
    /// The live workbook, a run fails if its scripts, their order or connections change meanwhile. Without it, a run
    /// checks only the text and catalog versions of its scripts.
    liveWorkbook?: (workbookId: string) => WorkbookScripts | null;
}

/// The services of a run without a runtime: no results of other connections are mounted and no
/// results are cached
const PLAIN_SERVICES: ScriptRunServices = {
    createMounts: () => null,
    cacheKey: async () => null,
    cachesResults: () => false,
    cache: null,
    maxConcurrentQueries: () => 1,
};

/// The scripts of a workbook in workbook order and the index of a script
function workbookScriptsOf(workbook: WorkbookScripts, target: ScriptData) {
    const files = [...workbook.scriptOrder];
    const scripts = files.map(file => workbook.scripts[workbook.scriptRefs[file].scriptId]);
    const targetIndex = scripts.findIndex(script => script.scriptKey === target.scriptKey);
    if (targetIndex < 0) throw new Error(`${target.fileName} is no script of the workbook`);
    return { files, scripts, targetIndex };
}

/// The options of the run of a script
export interface ScriptRunOptions {
    /// Read no cached results: the script and the scripts it references run, their results with reusable keys become
    /// the newest files of their keys
    refresh?: boolean;
    /// The caller holds the workbook already (`waitForWorkbookExecution`), the run releases it
    held?: boolean;
    /// Logs the plan, its statements and the cached results it reads
    logger?: LoggerLike;
}

/// Run a script: plan it with the scripts it needs and run the plan (`runWorkbookPlan`). Resolves with the last output
/// of the script, rejects if the plan is invalid, a statement fails or another run holds the workbook. A failed
/// statement cancels the other statements of the run.
///
/// The plan of the script includes the statements before the terminal queries of the scripts it inlines and the
/// scripts it materializes (docs/design/script_references.md). The result of the script is cached if its key is
/// reusable, the key covers the referenced scripts. Like in a run of the workbook, a script with a reusable cached
/// result doesn't run if nothing that it follows runs.
export async function runPlannedScript(
    services: ScriptRunServices,
    workbook: WorkbookScripts,
    target: ScriptData,
    executeQuery: QueryExecutor,
    modifyWorkbookScripts: ModifyWorkbookScripts,
    options: ScriptRunOptions = {},
): Promise<arrow.Table | null> {
    // The app disables the runs of a held workbook, a run that starts meanwhile fails
    if (!options.held && !acquireWorkbookExecution(workbook)) throw new Error('Another script of the workbook is running');
    const { workbookId } = workbook;
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
        if (args.metadata.resultOwner === scriptResultOwner(workbookId, target.scriptKey) && args.analyzeResults) result = execution;
        return [queryId, execution];
    };
    try {
        const { files, targetIndex } = workbookScriptsOf(workbook, target);
        const liveWorkbook = services.liveWorkbook;
        const outputs = await runWorkbookPlan({
            workbook, getWorkbook: liveWorkbook != null ? () => liveWorkbook(workbookId) : () => workbook,
            targets: [targetIndex], run: { kind: 'script', target: files[targetIndex] },
            executeQuery: executeNode, modifyWorkbookScripts, signal: cancellation.signal, queries,
            cancelActive: () => cancellation.abort(), cooperate: () => yieldToBrowser(), emit: () => {},
            mounts: services.createMounts(), mountAttachments: services.mountAttachments,
            resultKey: services.cacheKey, cachesResults: services.cachesResults,
            cache: services.cache, refresh: options.refresh ?? false,
            maxConcurrentQueries: services.maxConcurrentQueries, logger: options.logger,
        });
        if (outputs[targetIndex] != null) {
            await modifyWorkbookScripts({ type: REGISTER_QUERY, value: [target.scriptKey, outputs[targetIndex]!] });
        }
        return await (result ?? Promise.resolve(null));
    } catch (error) {
        // The script shows why it can't be planned or run where it shows the error of a failed statement, e.g. a
        // script of the workbook that can't be analyzed or a plan that needs the compute database
        if (error instanceof ScriptPlanError || !launched) {
            await recordPlanError(workbook, target, executeQuery, modifyWorkbookScripts, error instanceof Error ? error : new Error(String(error)));
        }
        throw error;
    } finally {
        releaseWorkbookExecution(workbook);
    }
}

/// Record an error of a run before its statements as a failed query of the script
async function recordPlanError(
    workbook: WorkbookScripts,
    target: ScriptData,
    executeQuery: QueryExecutor,
    modifyWorkbookScripts: ModifyWorkbookScripts,
    error: Error,
): Promise<void> {
    const [queryId, execution] = executeQuery(target.connection.connectionId, {
        query: target.scriptSession.getText(),
        failure: error,
        metadata: {
            queryType: QueryType.USER_PROVIDED, title: 'Workbook Query', description: null, issuer: 'Query Rerun',
            userProvided: true, workbookId: workbook.workbookId, resultOwner: scriptResultOwner(workbook.workbookId, target.scriptKey),
        },
    });
    await modifyWorkbookScripts({ type: REGISTER_QUERY, value: [target.scriptKey, queryId] });
    await execution.catch(() => null);
}

/// The cache key of the result of a script, the key that a run of the script reads and writes. Null if the result
/// is not reusable or the current analysis of the scripts it needs can't be planned. Plans without analyzing.
export async function computeScriptResultCacheKey(
    services: ScriptRunServices,
    workbook: WorkbookScripts,
    target: ScriptData,
): Promise<string | null> {
    const { files, scripts, targetIndex } = workbookScriptsOf(workbook, target);
    const { graph } = planWorkbookScripts({
        instance: workbook.instance, scripts, files,
        mountPrefix: createMountPrefix(), targets: [targetIndex], workbook,
    });
    if (!graph.valid) return null;
    const connectionOf = (index: number) => scripts[index].connection.connectionId;
    const keys = await computeScriptResultKeys(graph, (index, signature) => services.cacheKey(connectionOf(index), signature), index => services.cachesResults(connectionOf(index)));
    const key = keys[targetIndex];
    return key?.reusable ? key.key : null;
}

/// The cache keys of the results of the scripts of a workbook in workbook order, the keys that a run of the workbook
/// reads. Null for a script whose result is not reusable, all null if the current analysis can't be planned. Plans
/// without analyzing, like the cache indicators of the cards.
export async function computeWorkbookResultCacheKeys(
    services: ScriptRunServices,
    workbook: WorkbookScripts,
): Promise<Array<string | null>> {
    const files = [...workbook.scriptOrder];
    const scripts = files.map(file => workbook.scripts[workbook.scriptRefs[file].scriptId]);
    const { graph } = planWorkbookScripts({
        instance: workbook.instance, scripts, files, mountPrefix: createMountPrefix(), workbook,
    });
    if (!graph.valid) return scripts.map(() => null);
    const connectionOf = (index: number) => scripts[index].connection.connectionId;
    const keys = await computeScriptResultKeys(graph, (index, signature) => services.cacheKey(connectionOf(index), signature), index => services.cachesResults(connectionOf(index)));
    return keys.map(key => key?.reusable ? key.key : null);
}

/// The services of script runs, one per core instance, registered by the runtime (runtime.ts) for every workbook
const runners = new WeakMap<core.DashQL, ScriptRunServices>();

/// Register the services of the script runs of a core instance
export function registerScriptRunServices(instance: core.DashQL, services: ScriptRunServices | null): void {
    if (services == null) runners.delete(instance);
    else runners.set(instance, services);
}

/// The services of the script runs of a core instance. Without a runtime, runs neither mount the
/// results of other connections nor cache results.
export function scriptRunServices(instance: core.DashQL): ScriptRunServices {
    return runners.get(instance) ?? PLAIN_SERVICES;
}
