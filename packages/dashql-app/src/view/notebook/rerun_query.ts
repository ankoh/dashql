import { QueryExecutor } from '../../connection/query_executor.js';
import { QueryType } from '../../connection/query_execution_state.js';
import { NotebookState, ScriptData, REGISTER_QUERY, getExecutableQueryText } from '../../notebook/notebook_state.js';
import { ModifyNotebook } from '../../notebook/notebook_state_registry.js';
import { projectionForVisualizeQuery } from '../../notebook/notebook_types.js';

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
    const [queryId] = executeQuery(notebook.sessionId, {
        query: queryText,
        analyzeResults: true,
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
    modifyNotebook({ type: REGISTER_QUERY, value: [scriptData.scriptKey, queryId] });
}
