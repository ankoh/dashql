import * as React from 'react';
import { ConnectionState } from '../connections/connection_state.js';
import { ScriptData, NotebookScripts, createEmptyScriptData, replaceScriptSessionText } from './notebook_scripts.js';
import { useNotebookScriptsAllocator } from './notebook_scripts_registry.js';
import { createEmptyMetadata, createScriptRef, generateScriptFileName } from './script_types.js';

export type NotebookScriptsSetup = (conn: ConnectionState, abort?: AbortSignal) => NotebookScripts;

export function useNotebookScriptsSetup(): NotebookScriptsSetup {
    const allocateNotebookScripts = useNotebookScriptsAllocator();

    return React.useCallback((conn: ConnectionState) => {
        const folderName = 'main';
        const fileName = generateScriptFileName({});
        const [, mainScriptData]: [number, ScriptData] = createEmptyScriptData(conn.instance, conn.catalog, fileName, folderName);
        replaceScriptSessionText(mainScriptData.scriptSession, conn.connectorInfo.helloWorldScript);

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
        }, conn.catalogFunctionScript);
        return notebookScripts;
    }, [allocateNotebookScripts]);
}
