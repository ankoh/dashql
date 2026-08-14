import type { QueryExecutor } from '../connections/query_executor.js';
import { QueryType } from '../connections/query_execution_state.js';
import { NotebookScripts, ScriptData, REGISTER_QUERY, compileQuery } from '../scripts/notebook_scripts.js';
import { ModifyNotebookScripts } from '../scripts/notebook_scripts_registry.js';
import { projectionForVisualizeQuery } from '../scripts/script_types.js';
import type { LoggerLike } from '../../../shared/platform/logger/logger.js';

export function registerNotebookScriptQuery(
    scriptData: ScriptData,
    queryId: number,
    queryText: string,
    execution: Promise<import('apache-arrow').Table | null>,
    modifyNotebookScripts: ModifyNotebookScripts,
): void {
    modifyNotebookScripts({ type: REGISTER_QUERY, value: [scriptData.scriptKey, queryId] });
    void execution.catch(() => {});
}

export function rerunEntry(
    notebookScripts: NotebookScripts,
    scriptData: ScriptData,
    executeQuery: QueryExecutor,
    modifyNotebookScripts: ModifyNotebookScripts,
    logger: LoggerLike,
): void {
    const queryText = compileQuery(notebookScripts, scriptData, logger);
    if (queryText.trim().length === 0) {
        return;
    }
    const [queryId, execution] = executeQuery(notebookScripts.notebookId, {
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
    registerNotebookScriptQuery(scriptData, queryId, queryText, execution, modifyNotebookScripts);
}
