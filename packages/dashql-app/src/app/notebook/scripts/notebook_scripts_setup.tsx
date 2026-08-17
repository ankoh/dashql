import * as React from 'react';
import * as Immutable from 'immutable';

import { ConnectionState } from '../connections/connection_state.js';
import { ScriptData, NotebookScripts, createEmptyScriptData } from './notebook_scripts.js';
import { useNotebookScriptsAllocator } from './notebook_scripts_registry.js';
import { createEmptyAnnotations, createEmptyMetadata, createScriptRef, generateScriptFileName } from './script_types.js';

export type NotebookScriptsSetup = (conn: ConnectionState, abort?: AbortSignal) => NotebookScripts;

export function useNotebookScriptsSetup(): NotebookScriptsSetup {
    const allocateNotebookScripts = useNotebookScriptsAllocator();

    return React.useCallback((conn: ConnectionState) => {
        const mainScript = conn.instance.createScript(conn.catalog);
        const folderName = 'main';
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
            pendingDiff: null,
            latestQueryId: null,
            latestAgentRunId: null,
            fileName,
            folderName,
        };

        const [uncommittedKey, uncommittedData] = createEmptyScriptData(conn.instance, conn.catalog);
        const defaultPage = {
            folderName,
            scripts: { [fileName]: createScriptRef(mainScriptData.scriptKey, fileName) },
        };
        const [_notebookId, notebookScripts] = allocateNotebookScripts({
            notebookMetadata: createEmptyMetadata(),
            instance: conn.instance,
            connectorInfo: conn.connectorInfo,
            notebookId: conn.notebookId,
            connectionId: conn.connectionId,
            connectionCatalog: conn.catalog,
            scripts: {
                [mainScriptData.scriptKey]: mainScriptData,
                [uncommittedKey]: uncommittedData,
            },
            scriptFolders: { [folderName]: defaultPage },
            uncommittedScriptId: uncommittedKey,
            scriptFocus: { folderName, fileName, interactionCounter: 0 },
            semanticUserFocus: null,
        });
        return notebookScripts;
    }, [allocateNotebookScripts]);
}
