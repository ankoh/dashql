import type * as arrow from 'apache-arrow';

import type { QueryExecutor } from '../../connections/query_executor.js';
import { QueryType } from '../../../query/query_execution_state.js';
import { SessionScripts, ScriptData, REGISTER_QUERY, REGISTER_SCRIPT_RESULT, isAnalysisOutdated, scriptResultOwner } from '../scripts/session_scripts.js';
import { compileSessionQuery, createScriptExecution } from '../scripts/script_compilation.js';
import { ensureSessionScriptAnalyzed, ModifySessionScripts } from '../scripts/session_scripts_registry.js';
import type { LoggerLike } from '../../../platform/logger/logger.js';
import { isSessionExecutionRunning } from '../scripts/session_execution.js';

export function registerSessionScriptQuery(
    scriptData: ScriptData,
    queryId: number,
    _queryText: string,
    execution: Promise<import('apache-arrow').Table | null>,
    modifySessionScripts: ModifySessionScripts,
): void {
    modifySessionScripts({ type: REGISTER_QUERY, value: [scriptData.scriptKey, queryId] });
    void execution.then(async table => {
        if (table != null) {
            await modifySessionScripts({ type: REGISTER_SCRIPT_RESULT, value: [scriptData.scriptKey, queryId] });
        }
    }).catch(() => { });
}

/// Run a script on its connection
export function runSessionScript(
    sessionScripts: SessionScripts,
    scriptData: ScriptData,
    executeQuery: QueryExecutor,
    modifySessionScripts: ModifySessionScripts,
    logger: LoggerLike,
): Promise<void> | void {
    if (isSessionExecutionRunning(sessionScripts)) return;
    logger?.info('Session script execution requested', {
        connectionId: scriptData.connection.connectionId,
        sessionId: sessionScripts.sessionId,
        scriptKey: scriptData.scriptKey.toString(),
        analysisOutdated: scriptData.analysisOutdated.toString(),
        analysisAvailable: scriptData.editorUpdate?.analysisAvailable.toString(),
        textVersion: scriptData.editorUpdate?.textVersion.toString(),
        nativeTextVersion: scriptData.scriptSession.getTextVersion?.().toString(),
        textLength: scriptData.scriptSession.getText?.().length.toString(),
    }, 'session_execution');
    if (isAnalysisOutdated(scriptData)) {
        return ensureSessionScriptAnalyzed(sessionScripts, scriptData.scriptKey, modifySessionScripts)
            .then((analyzed) => {
                if (analyzed != null) {
                    logger?.info('Outdated session script analysis completed', {
                        sessionId: sessionScripts.sessionId,
                        scriptKey: scriptData.scriptKey.toString(),
                        analysisAvailable: analyzed.editorUpdate?.analysisAvailable.toString(),
                    }, 'session_execution');
                    executeSessionScript(analyzed, sessionScripts, executeQuery, modifySessionScripts, logger);
                } else {
                    logger?.warn('Session execution stopped because analysis returned no script', {
                        sessionId: sessionScripts.sessionId,
                        scriptKey: scriptData.scriptKey.toString(),
                    }, 'session_execution');
                }
            });
    }
    executeSessionScript(scriptData, sessionScripts, executeQuery, modifySessionScripts, logger);
}

/// Run a script on its connection and wait for its result.
/// Fails when another script of the session runs, the script holds no query, or the query fails or is cancelled.
export async function runSessionScriptForResult(
    sessionScripts: SessionScripts,
    scriptData: ScriptData,
    executeQuery: QueryExecutor,
    modifySessionScripts: ModifySessionScripts,
    logger: LoggerLike,
): Promise<arrow.Table | null> {
    if (isSessionExecutionRunning(sessionScripts)) {
        throw new Error('Another script of the session is running');
    }
    const analyzed = isAnalysisOutdated(scriptData)
        ? await ensureSessionScriptAnalyzed(sessionScripts, scriptData.scriptKey, modifySessionScripts)
        : scriptData;
    if (analyzed == null) {
        throw new Error('The script could not be analyzed');
    }
    // The caller reports the failure, e.g. to the agent, the script shows it as well
    const execution = executeSessionScript(analyzed, sessionScripts, executeQuery, modifySessionScripts, logger, true);
    if (execution == null) {
        throw new Error('The script holds no query');
    }
    return execution;
}

function executeSessionScript(
    scriptData: ScriptData,
    sessionScripts: SessionScripts,
    executeQuery: QueryExecutor,
    modifySessionScripts: ModifySessionScripts,
    logger: LoggerLike,
    throwOnError: boolean = false,
): Promise<arrow.Table | null> | null {
    if (isSessionExecutionRunning(sessionScripts)) return null;
    const { connectionId, connectorInfo } = scriptData.connection;
    const compiled = compileSessionQuery(scriptData, connectorInfo.connectorType, logger);
    const queryText = compiled.sql;
    if (queryText.trim().length === 0) {
        logger?.warn('Session execution stopped because compiled query is empty', {
            scriptKey: scriptData.scriptKey.toString(),
        }, 'session_execution');
        return null;
    }
    const [queryId, execution] = executeQuery(connectionId, {
        query: queryText,
        scriptExecution: createScriptExecution(scriptData, connectorInfo.connectorType),
        analyzeResults: true,
        throwOnError,
        // Sessions opt into reusing cached results, a script decides if its query result can be cached
        cacheable: sessionScripts.settings.cacheQueryResults && compiled.cacheable,
        cacheSignature: compiled.cacheSignature,
        metadata: {
            queryType: QueryType.USER_PROVIDED,
            title: 'Session Query',
            description: null,
            issuer: 'Query Rerun',
            userProvided: true,
            sessionId: sessionScripts.sessionId,
            resultOwner: scriptResultOwner(sessionScripts.sessionId, scriptData.scriptKey),
        },
    });
    logger?.info('Session query allocated', {
        connectionId,
        scriptKey: scriptData.scriptKey.toString(),
        queryId: queryId.toString(),
        queryLength: queryText.length.toString(),
    }, 'session_execution');
    registerSessionScriptQuery(scriptData, queryId, queryText, execution, modifySessionScripts);
    return execution;
}
