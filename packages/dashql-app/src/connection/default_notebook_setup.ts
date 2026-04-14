import * as Immutable from 'immutable';
import * as core from '../core/index.js';

import { ConnectionState } from './connection_state.js';
import { Logger } from '../platform/logger/logger.js';
import { analyzeNotebookScript, ScriptData, NotebookState, createEmptyScriptData } from '../notebook/notebook_state.js';
import { NotebookAllocator, NotebookStateWithoutId } from '../notebook/notebook_state_registry.js';
import { createEmptyAnnotations, createPageScript } from '../notebook/notebook_types.js';

function createScriptData(script: core.DashQLScript): ScriptData {
    return {
        scriptKey: script.getCatalogEntryId(),
        script,
        scriptAnalysis: {
            buffers: {
                scanned: null,
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
    };
}

export function createDefaultNotebookWithSchemaPage(
    conn: ConnectionState,
    allocateNotebookState: NotebookAllocator,
    logger: Logger,
    mainScriptText: string,
    schemaScriptText: string,
): NotebookState {
    const registry = conn.instance.createScriptRegistry();
    const mainScript = conn.instance.createScript(conn.catalog);
    const schemaScript = conn.instance.createScript(conn.catalog);

    mainScript.replaceText(mainScriptText);
    schemaScript.replaceText(schemaScriptText);

    let mainScriptData = createScriptData(mainScript);
    let schemaScriptData = createScriptData(schemaScript);
    schemaScriptData = analyzeNotebookScript(schemaScriptData, registry, conn.catalog, logger);
    mainScriptData = analyzeNotebookScript(mainScriptData, registry, conn.catalog, logger);

    const [uncommittedKey, uncommittedData] = createEmptyScriptData(conn.instance, conn.catalog);

    const state: NotebookStateWithoutId = {
        instance: conn.instance,
        sessionId: conn.sessionId,
        sessionPath: conn.sessionId,
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
            [schemaScriptData.scriptKey]: schemaScriptData,
            [uncommittedKey]: uncommittedData,
        },
        notebookPages: [
            {
                scripts: [
                    createPageScript(mainScriptData.scriptKey, 'Main'),
                ],
            },
            {
                scripts: [
                    createPageScript(schemaScriptData.scriptKey, 'Schema'),
                ],
            },
        ],
        uncommittedScriptId: uncommittedKey,
        notebookUserFocus: { pageIndex: 0, entryInPage: 0 },
        semanticUserFocus: null,
    };

    const [_notebookId, notebook] = allocateNotebookState(state);
    return notebook;
}
