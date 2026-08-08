import type { QueryExecutor } from '../../connection/query_executor.js';
import { QueryType } from '../../connection/query_execution_state.js';
import { NotebookScripts, ScriptData, REGISTER_QUERY, REGISTER_SCRIPT_OUTPUT_SCHEMA, getExecutableQueryText } from '../../scripts/notebook_scripts.js';
import { ModifyNotebookScripts } from '../../scripts/notebook_scripts_registry.js';
import { projectionForVisualizeQuery } from '../../scripts/script_types.js';

export function registerNotebookScriptQuery(
    scriptData: ScriptData,
    queryId: number,
    queryText: string,
    execution: Promise<import('apache-arrow').Table | null>,
    modifyNotebookScripts: ModifyNotebookScripts,
): void {
    modifyNotebookScripts({ type: REGISTER_QUERY, value: [scriptData.scriptKey, queryId] });
    void execution.then(table => {
        if (table == null) return;
        modifyNotebookScripts({
            type: REGISTER_SCRIPT_OUTPUT_SCHEMA,
            value: {
                scriptKey: scriptData.scriptKey,
                queryId,
                queryText,
                columnNames: table.schema.fields.map(field => field.name),
            },
        });
    }).catch(() => {});
}

export function rerunEntry(
    notebookScripts: NotebookScripts,
    scriptData: ScriptData,
    executeQuery: QueryExecutor,
    modifyNotebookScripts: ModifyNotebookScripts,
): void {
    const queryText = getExecutableQueryText(notebookScripts, scriptData);
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
