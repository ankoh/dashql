import * as Immutable from 'immutable';
import * as core from '../core/index.js';

import { ConnectionState } from './connection_state.js';
import { Logger } from '../platform/logger/logger.js';
import { analyzeNotebookScript, makeScriptLookup, ScriptData, NotebookState, createEmptyScriptData } from '../notebook/notebook_state.js';
import { NotebookAllocator, NotebookStateWithoutId } from '../notebook/notebook_state_registry.js';
import { createEmptyAnnotations, createPageScript, generateScriptFileName } from '../notebook/notebook_types.js';

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
        latestQueryId: null,
        fileName,
        folderName,
    };
}

export function createDefaultNotebook(
    conn: ConnectionState,
    allocateNotebookState: NotebookAllocator,
    logger: Logger,
    mainScriptText: string,
): NotebookState {
    const registry = conn.instance.createScriptRegistry();
    const mainScript = conn.instance.createScript(conn.catalog);

    mainScript.replaceText(mainScriptText);

    const mainFolderName = 'Main';
    const mainFileName = generateScriptFileName({}, 'example_script');

    let mainScriptData = createScriptData(mainScript, mainFileName, mainFolderName);
    // Initial analyze: only the main script exists, so cross-script references can't resolve yet.
    const initialPages = {
        [mainFolderName]: {
            folderName: mainFolderName,
            scripts: { [mainFileName]: createPageScript(mainScriptData.scriptKey, mainFileName) },
        },
    };
    mainScriptData = analyzeNotebookScript(
        mainScriptData,
        registry,
        conn.catalog,
        makeScriptLookup(initialPages, { [mainScriptData.scriptKey]: mainScriptData }),
        logger,
    );

    const [uncommittedKey, uncommittedData] = createEmptyScriptData(conn.instance, conn.catalog);

    const state: NotebookStateWithoutId = {
        instance: conn.instance,
        sessionId: conn.sessionId,
        notebookMetadata: {
            originType: 'LOCAL',
            originalFileName: '',
            originalHttpUrl: '',
        },
        connectorInfo: conn.connectorInfo,
        connectionCatalog: conn.catalog,
        scriptRegistry: registry,
        scripts: {
            [mainScriptData.scriptKey]: mainScriptData,
            [uncommittedKey]: uncommittedData,
        },
        notebookPages: {
            [mainFolderName]: {
                folderName: mainFolderName,
                scripts: {
                    [mainFileName]: createPageScript(mainScriptData.scriptKey, mainFileName),
                },
            },
        },
        uncommittedScriptId: uncommittedKey,
        notebookUserFocus: { folderName: mainFolderName, fileName: mainFileName, interactionCounter: 0 },
        semanticUserFocus: null,
    };

    const [_notebookId, notebook] = allocateNotebookState(state);
    return notebook;
}
