import type { QueryExecutor } from '../../connection/query_executor.js';
import { QueryType } from '../../connection/query_execution_state.js';
import { NotebookState, ScriptData, REGISTER_QUERY, REGISTER_SCRIPT_OUTPUT_SCHEMA, getExecutableQueryText } from '../../notebook/notebook_state.js';
import { ModifyNotebook } from '../../notebook/notebook_state_registry.js';
import { projectionForVisualizeQuery } from '../../notebook/notebook_types.js';

export function registerNotebookQuery(
    scriptData: ScriptData,
    queryId: number,
    queryText: string,
    execution: Promise<import('apache-arrow').Table | null>,
    modifyNotebook: ModifyNotebook,
): void {
    modifyNotebook({ type: REGISTER_QUERY, value: [scriptData.scriptKey, queryId] });
    void execution.then(table => {
        if (table == null) return;
        modifyNotebook({
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
    notebook: NotebookState,
    scriptData: ScriptData,
    executeQuery: QueryExecutor,
    modifyNotebook: ModifyNotebook,
): void {
    const queryText = getExecutableQueryText(notebook, scriptData);
    if (queryText.trim().length === 0) {
        return;
    }
    const [queryId, execution] = executeQuery(notebook.sessionId, {
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
    registerNotebookQuery(scriptData, queryId, queryText, execution, modifyNotebook);
}
