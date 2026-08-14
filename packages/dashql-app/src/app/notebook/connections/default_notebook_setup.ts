import * as Immutable from 'immutable';
import * as core from '../../../shared/core/index.js';

import { ConnectionState } from './connection_state.js';
import { Logger } from '../../../shared/platform/logger/logger.js';
import { analyzeScriptData, ScriptData, NotebookScripts, createEmptyScriptData } from '../scripts/notebook_scripts.js';
import { NotebookScriptsAllocator, NotebookScriptsInput } from '../scripts/notebook_scripts_registry.js';
import { createEmptyAnnotations, createScriptRef, generateScriptFileName } from '../scripts/script_types.js';

function createScriptData(script: core.DashQLScript, fileName: string, folderName: string): ScriptData {
    return {
        scriptKey: script.getCatalogEntryId(),
        script,
        scriptAnalysis: {
            buffers: {
                parsed: null,
                analyzed: null,
                destroy: () => { },
            },
            outdated: true,
        },
        statistics: Immutable.List(),
        annotations: createEmptyAnnotations(),
        cursor: null,
        completion: null,
        pendingDiff: null,
        latestQueryId: null,
        latestAgentRunId: null,
        fileName,
        folderName,
    };
}

export function createDefaultNotebookScripts(
    conn: ConnectionState,
    allocateNotebookScripts: NotebookScriptsAllocator,
    logger: Logger,
    mainScriptText: string,
): NotebookScripts {
    const mainScript = conn.instance.createScript(conn.catalog);

    mainScript.replaceText(mainScriptText);

    const mainFolderName = 'main';
    const mainFileName = generateScriptFileName({}, 'example_script');

    let mainScriptData = createScriptData(mainScript, mainFileName, mainFolderName);
    // Initial analyze: only the main script exists, so cross-script references can't resolve yet.
    mainScriptData = analyzeScriptData(
        mainScriptData,
        conn.catalog,
        logger,
    );

    const [uncommittedKey, uncommittedData] = createEmptyScriptData(conn.instance, conn.catalog);

    const state: NotebookScriptsInput = {
        instance: conn.instance,
        notebookId: conn.notebookId,
        notebookMetadata: {
            originType: 'LOCAL',
            originalFileName: '',
            originalHttpUrl: '',
        },
        connectorInfo: conn.connectorInfo,
        connectionCatalog: conn.catalog,
        scripts: {
            [mainScriptData.scriptKey]: mainScriptData,
            [uncommittedKey]: uncommittedData,
        },
        scriptFolders: {
            [mainFolderName]: {
                folderName: mainFolderName,
                scripts: {
                    [mainFileName]: createScriptRef(mainScriptData.scriptKey, mainFileName),
                },
            },
        },
        uncommittedScriptId: uncommittedKey,
        scriptFocus: { folderName: mainFolderName, fileName: mainFileName, interactionCounter: 0 },
        semanticUserFocus: null,
    };

    const [_notebookId, notebookScripts] = allocateNotebookScripts(state);
    return notebookScripts;
}
