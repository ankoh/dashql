import type { QueryExecutor } from '../../connection/query_executor.js';
import type { QueryExecutionArgs } from '../../connection/query_execution_args.js';
import { QueryType } from '../../connection/query_execution_state.js';
import { NotebookState, ScriptData, REGISTER_QUERY, REGISTER_SCRIPT_OUTPUT_SCHEMA, getExecutableQueryText, tryGetExecutableQueryText } from '../../notebook/notebook_state.js';
import { ModifyNotebook } from '../../notebook/notebook_state_registry.js';
import { projectionForVisualizeQuery } from '../../notebook/notebook_types.js';

export function registerNotebookQuery(
    scriptData: ScriptData,
    queryId: number,
    queryText: string,
    execution: Promise<import('apache-arrow').Table | null>,
    modifyNotebook: ModifyNotebook,
    registerOnSuccess = false,
): void {
    if (!registerOnSuccess) {
        modifyNotebook({ type: REGISTER_QUERY, value: [scriptData.scriptKey, queryId] });
    }
    void execution.then(table => {
        if (table == null) return;
        if (registerOnSuccess) {
            modifyNotebook({ type: REGISTER_QUERY, value: [scriptData.scriptKey, queryId] });
        }
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

export function createCachedEntryExecutionArgs(
    notebook: NotebookState,
    scriptData: ScriptData,
): QueryExecutionArgs | null {
    const queryText = tryGetExecutableQueryText(notebook, scriptData);
    if (queryText == null || queryText.trim().length === 0) {
        return null;
    }
    return {
        query: queryText,
        analyzeResults: true,
        cacheOnly: true,
        projection: projectionForVisualizeQuery(scriptData.annotations.visualizeQuery),
        metadata: {
            queryType: QueryType.USER_PROVIDED,
            title: 'Notebook Query',
            description: null,
            issuer: 'Cached Result Auto-load',
            userProvided: true,
        },
    };
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
