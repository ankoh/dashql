import type * as arrow from 'apache-arrow';
import type * as core from '@ankoh/dashql-core';

import type { QueryExecutor } from '../../connections/query_execution_args.js';
import type { QueryResultCache } from '../../query/query_result_cache.js';
import { QueryType } from '../../query/query_execution_state.js';
import {
    ScriptPlanError,
    acquireWorkbookExecution,
    releaseWorkbookExecution,
    runWorkbookPlan,
    workbookRunError,
    type ExecutionMounts,
    type WorkbookRuns,
} from './workbook_execution.js';
import { scriptResultOwner, type ModifyWorkbookScripts, type ScriptData, type WorkbookScripts } from './workbook_scripts.js';
import { yieldToBrowser } from '../../utils/yield_to_browser.js';
import type { LoggerLike } from '../../platform/logger/logger.js';

/// The services of the run of a script
export interface ScriptRunServices {
    /// The runs of the runtime that holds the workbooks
    runs: WorkbookRuns;
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
}

/// The files of the scripts of a workbook in workbook order and the index of a script
function workbookScriptsOf(workbook: WorkbookScripts, target: ScriptData) {
    const files = [...workbook.scriptOrder];
    const targetIndex = files.findIndex(file => workbook.scriptRefs[file]?.scriptId === target.scriptKey);
    if (targetIndex < 0) throw new Error(`${target.fileName} is no script of the workbook`);
    return { files, targetIndex };
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

/// Run a script: plan it with the scripts it needs and run the plan on the Rust runtime (`runWorkbookPlan`). Resolves
/// with the last output of the script, rejects if the plan is invalid, a statement fails or another run holds the
/// workbook. A failed statement cancels the other statements of the run.
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
    // Did a statement start? An error before shows where the result of the script would be.
    let launched = false;
    // The query of the last output of the target, its result is the result of the run
    let result: Promise<arrow.Table | null> | null = null;
    const executeNode: QueryExecutor = (connectionId, args) => {
        const [queryId, execution] = executeQuery(connectionId, args);
        if (args.metadata.resultOwner === scriptResultOwner(workbookId, target.scriptKey) && args.analyzeResults) result = execution;
        return [queryId, execution];
    };
    try {
        const { files, targetIndex } = workbookScriptsOf(workbook, target);
        const outcome = await runWorkbookPlan({
            workbook, runs: services.runs, executeQuery: executeNode,
            mounts: services.createMounts(), mountAttachments: services.mountAttachments,
            resultKey: services.cacheKey, cachesResults: services.cachesResults, cache: services.cache,
            maxConcurrentQueries: services.maxConcurrentQueries, cooperate: () => yieldToBrowser(), logger: options.logger,
            plan: { run: 'script', target: files[targetIndex], targets: [targetIndex], refresh: options.refresh ?? false, reportsState: false },
        });
        launched = outcome.launched;
        if (outcome.failure != null) throw workbookRunError(outcome);
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
    const [queryId, execution] = executeQuery(target.connectionId, {
        query: target.scriptSession.getText(),
        failure: error,
        metadata: {
            queryType: QueryType.USER_PROVIDED, title: 'Workbook Query', description: null, issuer: 'Query Rerun',
            userProvided: true, workbookId: workbook.workbookId, resultOwner: scriptResultOwner(workbook.workbookId, target.scriptKey),
        },
    });
    modifyWorkbookScripts({ kind: 'registerQuery', value: { scriptKey: target.scriptKey, queryId } });
    await execution.catch(() => null);
}

/// The result keys of the scripts of a workbook of the Rust runtime, planned without analyzing
function workbookResultKeys(services: ScriptRunServices, workbook: WorkbookScripts, targets: number[] | null): Promise<Array<core.WorkbookResultKey | null>> {
    return services.runs.resultKeys(workbook.workbookId, targets, {
        resultKey: (connectionId, signature) => services.cacheKey(connectionId, signature),
        cachesResults: connectionId => services.cachesResults(connectionId),
    });
}

/// The cache key of the result of a script, the key that a run of the script reads and writes. Null if the result
/// is not reusable or the current analysis of the scripts it needs can't be planned. Plans without analyzing.
export async function computeScriptResultCacheKey(
    services: ScriptRunServices,
    workbook: WorkbookScripts,
    target: ScriptData,
): Promise<string | null> {
    const { targetIndex } = workbookScriptsOf(workbook, target);
    const keys = await workbookResultKeys(services, workbook, [targetIndex]);
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
    const keys = await workbookResultKeys(services, workbook, null);
    return keys.map(key => key?.reusable ? key.key : null);
}
