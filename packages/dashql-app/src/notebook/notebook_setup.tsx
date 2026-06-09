import * as React from 'react';
import * as Immutable from 'immutable';

import { ConnectionState } from '../connection/connection_state.js';
import { ScriptData, NotebookState, createEmptyScriptData } from './notebook_state.js';
import { useNotebookStateAllocator } from './notebook_state_registry.js';
import { createEmptyAnnotations, createEmptyMetadata, createPageScript, generateScriptFileName } from './notebook_types.js';

export type NotebookSetup = (conn: ConnectionState, abort?: AbortSignal) => NotebookState;

export function useNotebookSetup(): NotebookSetup {
    const allocateNotebookState = useNotebookStateAllocator();

    return React.useCallback((conn: ConnectionState) => {
        const registry = conn.instance.createScriptRegistry();
        const mainScript = conn.instance.createScript(conn.catalog);
        const folderName = 'Main';
        const fileName = generateScriptFileName({});
        const mainScriptData: ScriptData = {
            scriptKey: mainScript.getCatalogEntryId(),
            script: mainScript,
            scriptAnalysis: {
                buffers: {
                    parsed: null,
                    analyzed: null,
                    destroy: () => { },
                },
                outdated: true,
            },
            annotations: createEmptyAnnotations(),
            statistics: Immutable.List(),
            cursor: null,
            completion: null,
            latestQueryId: null,
            fileName,
            folderName,
        };

        const [uncommittedKey, uncommittedData] = createEmptyScriptData(conn.instance, conn.catalog);
        const defaultPage = {
            folderName,
            scripts: { [fileName]: createPageScript(mainScriptData.scriptKey, fileName) },
        };
        const [_notebookId, notebook] = allocateNotebookState({
            notebookMetadata: createEmptyMetadata(),
            instance: conn.instance,
            connectorInfo: conn.connectorInfo,
            sessionId: conn.sessionId,
            connectionCatalog: conn.catalog,
            scriptRegistry: registry,
            scripts: {
                [mainScriptData.scriptKey]: mainScriptData,
                [uncommittedKey]: uncommittedData,
            },
            notebookPages: { [folderName]: defaultPage },
            uncommittedScriptId: uncommittedKey,
            notebookUserFocus: { folderName, fileName, interactionCounter: 0 },
            semanticUserFocus: null,
        });
        return notebook;
    }, [allocateNotebookState]);
}
