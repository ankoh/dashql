import * as React from 'react';
import { AttachedDatabaseState } from '../connections/attached_database_state.js';
import { ScriptData, NotebookScripts, createEmptyScriptData, replaceScriptSessionText } from './notebook_scripts.js';
import { useNotebookScriptsAllocator } from './notebook_scripts_registry.js';
import { createEmptyMetadata, createScriptRef, generateScriptFileName } from './script_types.js';

export type NotebookScriptsSetup = (notebookId: string, database: AttachedDatabaseState, name?: string) => NotebookScripts;

export function useNotebookScriptsSetup(): NotebookScriptsSetup {
    const allocateNotebookScripts = useNotebookScriptsAllocator();

    return React.useCallback((notebookId: string, database: AttachedDatabaseState, name?: string) => {
        const fileName = generateScriptFileName({});
        const [, mainScriptData]: [number, ScriptData] = createEmptyScriptData(database.instance, database.catalog, fileName);
        replaceScriptSessionText(mainScriptData.scriptSession, database.connectorInfo.helloWorldScript);

        const [_notebookId, notebookScripts] = allocateNotebookScripts({
            notebookMetadata: createEmptyMetadata(),
            instance: database.instance,
            connectorInfo: database.connectorInfo,
            notebookId,
            name: name ?? null,
            databaseId: database.databaseId,
            connectionCatalog: database.catalog,
            scripts: {
                [mainScriptData.scriptKey]: mainScriptData,
            },
            scriptRefs: { [fileName]: createScriptRef(mainScriptData.scriptKey, fileName) },
            scriptFocus: { fileName, interactionCounter: 0 },
            semanticUserFocus: null,
        }, database.catalogFunctionScript);
        return notebookScripts;
    }, [allocateNotebookScripts]);
}
