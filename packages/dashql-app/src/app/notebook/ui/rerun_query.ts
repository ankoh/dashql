import type { QueryExecutor } from '../connections/query_executor.js';
import { QueryType } from '../connections/query_execution_state.js';
import { NotebookScripts, ScriptData, REGISTER_QUERY, compileQuery } from '../scripts/notebook_scripts.js';
import { ensureNotebookScriptAnalyzed, ModifyNotebookScripts } from '../scripts/notebook_scripts_registry.js';
import { projectionForVisualizeQuery } from '../scripts/script_types.js';
import type { LoggerLike } from '../../../platform/logger/logger.js';

export function registerNotebookScriptQuery(
    scriptData: ScriptData,
    queryId: number,
    _queryText: string,
    execution: Promise<import('apache-arrow').Table | null>,
    modifyNotebookScripts: ModifyNotebookScripts,
): void {
    modifyNotebookScripts({ type: REGISTER_QUERY, value: [scriptData.scriptKey, queryId] });
    void execution.catch(() => { });
}

export function runNotebookScript(
    connectionId: string,
    notebookScripts: NotebookScripts,
    scriptData: ScriptData,
    executeQuery: QueryExecutor,
    modifyNotebookScripts: ModifyNotebookScripts,
    logger: LoggerLike,
): Promise<void> | void {
    logger?.info('Notebook script execution requested', {
        connectionId,
        notebookId: notebookScripts.notebookId,
        scriptKey: scriptData.scriptKey.toString(),
        analysisOutdated: scriptData.analysisOutdated.toString(),
        analysisAvailable: scriptData.editorUpdate?.analysisAvailable.toString(),
        documentRevision: scriptData.editorUpdate?.documentRevision.toString(),
        nativeDocumentRevision: scriptData.editorSession.getDocumentRevision?.().toString(),
        textLength: scriptData.editorSession.getText?.().length.toString(),
    }, 'notebook_execution', true);
    if (scriptData.analysisOutdated) {
        return ensureNotebookScriptAnalyzed(notebookScripts, scriptData.scriptKey, modifyNotebookScripts)
            .then((analyzed) => {
                if (analyzed != null) {
                    logger?.info('Outdated notebook script analysis completed', {
                        notebookId: notebookScripts.notebookId,
                        scriptKey: scriptData.scriptKey.toString(),
                        analysisAvailable: analyzed.editorUpdate?.analysisAvailable.toString(),
                    }, 'notebook_execution', true);
                    executeNotebookScript(connectionId, analyzed, executeQuery, modifyNotebookScripts, logger);
                } else {
                    logger?.warn('Notebook execution stopped because analysis returned no script', {
                        notebookId: notebookScripts.notebookId,
                        scriptKey: scriptData.scriptKey.toString(),
                    }, 'notebook_execution', true);
                }
            });
    }
    executeNotebookScript(connectionId, scriptData, executeQuery, modifyNotebookScripts, logger);
}

function executeNotebookScript(
    connectionId: string,
    scriptData: ScriptData,
    executeQuery: QueryExecutor,
    modifyNotebookScripts: ModifyNotebookScripts,
    logger: LoggerLike,
): void {
    const queryText = compileQuery(scriptData, logger);
    if (queryText.trim().length === 0) {
        logger?.warn('Notebook execution stopped because compiled query is empty', {
            scriptKey: scriptData.scriptKey.toString(),
        }, 'notebook_execution', true);
        return;
    }
    const [queryId, execution] = executeQuery(connectionId, {
        query: queryText,
        analyzeResults: true,
        replaceComputationId: scriptData.latestQueryId,
        cacheable: true,
        projection: projectionForVisualizeQuery(scriptData.annotations.visualizeQuery),
        metadata: {
            queryType: QueryType.USER_PROVIDED,
            title: 'Notebook Query',
            description: null,
            issuer: 'Query Rerun',
            userProvided: true,
        },
    });
    logger?.info('Notebook query allocated', {
        connectionId,
        scriptKey: scriptData.scriptKey.toString(),
        queryId: queryId.toString(),
        queryLength: queryText.length.toString(),
    }, 'notebook_execution', true);
    registerNotebookScriptQuery(scriptData, queryId, queryText, execution, modifyNotebookScripts);
}
