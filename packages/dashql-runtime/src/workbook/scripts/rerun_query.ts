import type * as arrow from 'apache-arrow';

import type { QueryExecutor } from '../../connections/query_execution_args.js';
import { WorkbookScripts, ScriptData, isAnalysisOutdated, isCloudPreview } from './workbook_scripts.js';
import { ensureWorkbookScriptAnalyzed, ModifyWorkbookScripts } from './workbook_scripts_registry_state.js';
import { stringifyError, type LoggerLike } from '../../platform/logger/logger.js';
import { isWorkbookExecutionRunning } from './workbook_execution.js';
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
    // A preview of a published workbook runs nothing until it is imported
    if (isCloudPreview(workbookScripts)) {
        logger?.warn('A preview of a published workbook does not run', { workbookId: workbookScripts.workbookId });
        return;
    }
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
