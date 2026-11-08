import type * as arrow from 'apache-arrow';

import type { QueryExecutor } from '../../connections/query_executor.js';
import { SessionScripts, ScriptData, isAnalysisOutdated } from './session_scripts.js';
import { ensureSessionScriptAnalyzed, ModifySessionScripts } from './session_scripts_registry.js';
import { stringifyError, type LoggerLike } from '../../platform/logger/logger.js';
import { isSessionExecutionRunning, releaseSessionExecution, waitForSessionExecution } from './session_execution.js';
import { runPlannedScript, scriptRunServices, type ScriptRunOptions } from './script_run.js';

/// How a script runs on its connection
export interface SessionScriptRunOptions extends ScriptRunOptions {
    /// Leave a script out that calls a client function that writes, for a run that nobody asked for. Only the analysis
    /// before the run can tell, its annotations are out of date before that.
    skipWrites?: boolean;
}

/// Run a script on its connection, resolves when the run ended. A failed statement and a plan that fails, e.g. with an
/// unknown script, show their errors in the script. A refresh reads no cached results, neither of the script nor of
/// the scripts it references.
export async function runSessionScript(
    sessionScripts: SessionScripts,
    scriptData: ScriptData,
    executeQuery: QueryExecutor,
    modifySessionScripts: ModifySessionScripts,
    logger: LoggerLike,
    options: SessionScriptRunOptions = {},
): Promise<void> {
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
        const analyzed = await ensureSessionScriptAnalyzed(sessionScripts, scriptData.scriptKey, modifySessionScripts);
        if (analyzed == null) {
            logger?.warn('Session execution stopped because analysis returned no script', {
                sessionId: sessionScripts.sessionId,
                scriptKey: scriptData.scriptKey.toString(),
            }, 'session_execution');
            return;
        }
        logger?.info('Outdated session script analysis completed', {
            sessionId: sessionScripts.sessionId,
            scriptKey: scriptData.scriptKey.toString(),
            analysisAvailable: analyzed.editorUpdate?.analysisAvailable.toString(),
        }, 'session_execution');
        scriptData = analyzed;
    }
    if (options.skipWrites && scriptData.annotations.writes) return;
    await executeSessionScript(scriptData, sessionScripts, executeQuery, modifySessionScripts, logger, false, options);
}

/// Run a script on its connection and wait for its result, e.g. a run of the agent. The run waits for the run of
/// another script of the session to end. Fails when the whole session runs, the script is gone, can't be planned,
/// holds no statement, or a statement fails or is cancelled. `beforeRun` sees the script as the run gets it, analyzed
/// and after the wait, and refuses the run by throwing.
export async function runSessionScriptForResult(
    getSession: () => SessionScripts | null,
    scriptKey: number,
    executeQuery: QueryExecutor,
    modifySessionScripts: ModifySessionScripts,
    logger: LoggerLike,
    beforeRun?: (scriptData: ScriptData) => void,
): Promise<arrow.Table | null> {
    const sessionId = getSession()?.sessionId;
    if (sessionId == null) throw new Error('The session is gone');
    await waitForSessionExecution(sessionId);
    let handedOver = false;
    try {
        // The session as the runs before left it, e.g. with analyzed scripts
        const waited = getSession();
        const scriptData = waited?.scripts[scriptKey];
        if (waited == null || scriptData == null) throw new Error('The script is gone');
        const analyzed = isAnalysisOutdated(scriptData)
            ? await ensureSessionScriptAnalyzed(waited, scriptKey, modifySessionScripts)
            : scriptData;
        if (analyzed == null) {
            throw new Error('The script could not be analyzed');
        }
        beforeRun?.(analyzed);
        // The run releases the session. The caller reports the failure, e.g. to the agent, the script shows it as well.
        handedOver = true;
        return await executeSessionScript(analyzed, getSession() ?? waited, executeQuery, modifySessionScripts, logger, true, { held: true });
    } finally {
        if (!handedOver) releaseSessionExecution(sessionId);
    }
}

/// Run a script through a plan of the script and the scripts it references (docs/design/script_references.md)
function executeSessionScript(
    scriptData: ScriptData,
    sessionScripts: SessionScripts,
    executeQuery: QueryExecutor,
    modifySessionScripts: ModifySessionScripts,
    logger: LoggerLike,
    throwOnError: boolean = false,
    options: ScriptRunOptions = {},
): Promise<arrow.Table | null> {
    const services = scriptRunServices(sessionScripts.instance);
    return runPlannedScript(services, sessionScripts, scriptData, executeQuery, modifySessionScripts, { logger, ...options }).catch(error => {
        if (throwOnError) throw error;
        logger?.warn('Session script run failed', {
            sessionId: sessionScripts.sessionId,
            scriptKey: scriptData.scriptKey.toString(),
            error: stringifyError(error),
        }, 'session_execution');
        return null;
    });
}
