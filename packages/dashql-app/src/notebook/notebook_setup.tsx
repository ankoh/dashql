import * as pb from '../proto.js';
import * as buf from '@bufbuild/protobuf';

import * as React from 'react';
import * as Immutable from 'immutable';

import { ConnectionState } from '../connection/connection_state.js';
import { ScriptData, NotebookState, createEmptyScriptData } from './notebook_state.js';
import { useNotebookStateAllocator } from './notebook_state_registry.js';

export type NotebookSetup = (conn: ConnectionState, abort?: AbortSignal) => NotebookState;

export function useNotebookSetup(): NotebookSetup {
    const allocateNotebookState = useNotebookStateAllocator();

    return React.useCallback((conn: ConnectionState) => {
        const registry = conn.instance.createScriptRegistry();
        const mainScript = conn.instance.createScript(conn.catalog);
        const mainScriptData: ScriptData = {
            scriptKey: mainScript.getCatalogEntryId(),
            script: mainScript,
            scriptAnalysis: {
                buffers: {
                    scanned: null,
                    parsed: null,
                    analyzed: null,
                    destroy: () => { },
                },
                outdated: true,
            },
            annotations: buf.create(pb.dashql.notebook.NotebookScriptAnnotationsSchema),
            statistics: Immutable.List(),
            cursor: null,
            completion: null,
            latestQueryId: null,
        };

        const [uncommittedKey, uncommittedData] = createEmptyScriptData(conn.instance, conn.catalog);
        const defaultPage = buf.create(pb.dashql.notebook.NotebookPageSchema, {
            scripts: [buf.create(pb.dashql.notebook.NotebookPageScriptSchema, { scriptId: mainScriptData.scriptKey, title: "" })],
            uncommittedScriptId: uncommittedKey,
        });
        return allocateNotebookState({
            notebookMetadata: buf.create(pb.dashql.notebook.NotebookMetadataSchema),
            instance: conn.instance,
            connectorInfo: conn.connectorInfo,
            connectionId: conn.connectionId,
            connectionCatalog: conn.catalog,
            scriptRegistry: registry,
            scripts: {
                [mainScriptData.scriptKey]: mainScriptData,
                [uncommittedKey]: uncommittedData,
            },
            notebookPages: [defaultPage],
            notebookUserFocus: { pageIndex: 0, entryInPage: 0 },
            semanticUserFocus: null,
        });
    }, [allocateNotebookState]);
}
