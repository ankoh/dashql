import type * as arrow from 'apache-arrow';

import type { QueryExecutor } from '../../connections/query_executor.js';
import { WorkbookScripts, ScriptData, isAnalysisOutdated } from './workbook_scripts.js';
import { ensureWorkbookScriptAnalyzed, ModifyWorkbookScripts } from './workbook_scripts_registry.js';
import { stringifyError, type LoggerLike } from '../../platform/logger/logger.js';
import { isWorkbookExecutionRunning, releaseWorkbookExecution, waitForWorkbookExecution } from './workbook_execution.js';
import { runPlannedScript, scriptRunServices, type ScriptRunOptions } from './script_run.js';

/// Run a script on its connection, resolves when the run ended. A failed statement and a plan that fails, e.g. with an
/// unknown script, show their errors in the script. A refresh reads no cached results, neither of the script nor of
/// the scripts it references.
export async function runWorkbookScript(
    workbookScripts: WorkbookScripts,
    scriptData: ScriptData,
    executeQuery: QueryExecutor,
    modifyWorkbookScripts: ModifyWorkbookScripts,
    logger: LoggerLike,
    options: ScriptRunOptions = {},
): Promise<void> {
    if (isWorkbookExecutionRunning(workbookScripts)) return;
    logger?.info('Workbook script execution requested', {
        connectionId: scriptData.connection.connectionId,
        workbookId: workbookScripts.workbookId,
        scriptKey: scriptData.scriptKey.toString(),
        analysisOutdated: scriptData.analysisOutdated.toString(),
        analysisAvailable: scriptData.editorUpdate?.analysisAvailable.toString(),
        textVersion: scriptData.editorUpdate?.textVersion.toString(),
        nativeTextVersion: scriptData.scriptSession.getTextVersion?.().toString(),
        textLength: scriptData.scriptSession.getText?.().length.toString(),
    }, 'workbook_execution');
    if (isAnalysisOutdated(scriptData)) {
        const analyzed = await ensureWorkbookScriptAnalyzed(workbookScripts, scriptData.scriptKey, modifyWorkbookScripts);
        if (analyzed == null) {
            logger?.warn('Workbook execution stopped because analysis returned no script', {
                workbookId: workbookScripts.workbookId,
                scriptKey: scriptData.scriptKey.toString(),
            }, 'workbook_execution');
            return;
        }
        logger?.info('Outdated workbook script analysis completed', {
            workbookId: workbookScripts.workbookId,
            scriptKey: scriptData.scriptKey.toString(),
            analysisAvailable: analyzed.editorUpdate?.analysisAvailable.toString(),
        }, 'workbook_execution');
        scriptData = analyzed;
    }
    await executeWorkbookScript(scriptData, workbookScripts, executeQuery, modifyWorkbookScripts, logger, false, options);
}

/// Run a script on its connection and wait for its result, e.g. a run of the agent. The run waits for the run of
/// another script of the workbook to end. Fails when the whole workbook runs, the script is gone, can't be planned,
/// holds no statement, or a statement fails or is cancelled. `beforeRun` sees the script as the run gets it, analyzed
/// and after the wait, and refuses the run by throwing.
export async function runWorkbookScriptForResult(
    getWorkbook: () => WorkbookScripts | null,
    scriptKey: number,
    executeQuery: QueryExecutor,
    modifyWorkbookScripts: ModifyWorkbookScripts,
    logger: LoggerLike,
    beforeRun?: (scriptData: ScriptData) => void,
): Promise<arrow.Table | null> {
    const workbookId = getWorkbook()?.workbookId;
    if (workbookId == null) throw new Error('The workbook is gone');
    await waitForWorkbookExecution(workbookId);
    let handedOver = false;
    try {
        // The workbook as the runs before left it, e.g. with analyzed scripts
        const waited = getWorkbook();
        const scriptData = waited?.scripts[scriptKey];
        if (waited == null || scriptData == null) throw new Error('The script is gone');
        const analyzed = isAnalysisOutdated(scriptData)
            ? await ensureWorkbookScriptAnalyzed(waited, scriptKey, modifyWorkbookScripts)
            : scriptData;
        if (analyzed == null) {
            throw new Error('The script could not be analyzed');
        }
        beforeRun?.(analyzed);
        // The run releases the workbook. The caller reports the failure, e.g. to the agent, the script shows it as well.
        handedOver = true;
        return await executeWorkbookScript(analyzed, getWorkbook() ?? waited, executeQuery, modifyWorkbookScripts, logger, true, { held: true });
    } finally {
        if (!handedOver) releaseWorkbookExecution(workbookId);
    }
}

/// Run a script through a plan of the script and the scripts it references (docs/design/script_references.md)
function executeWorkbookScript(
    scriptData: ScriptData,
    workbookScripts: WorkbookScripts,
    executeQuery: QueryExecutor,
    modifyWorkbookScripts: ModifyWorkbookScripts,
    logger: LoggerLike,
    throwOnError: boolean = false,
    options: ScriptRunOptions = {},
): Promise<arrow.Table | null> {
    const services = scriptRunServices(workbookScripts.instance);
    return runPlannedScript(services, workbookScripts, scriptData, executeQuery, modifyWorkbookScripts, { logger, ...options }).catch(error => {
        if (throwOnError) throw error;
        logger?.warn('Workbook script run failed', {
            workbookId: workbookScripts.workbookId,
            scriptKey: scriptData.scriptKey.toString(),
            error: stringifyError(error),
        }, 'workbook_execution');
        return null;
    });
}
