import * as pb from '@ankoh/dashql-protobuf';
import * as buf from '@bufbuild/protobuf';

import * as React from 'react';
import * as Immutable from 'immutable';

import { ConnectionState } from '../connection/connection_state.js';
import { ScriptData, NotebookState } from './notebook_state.js';
import { useNotebookStateAllocator } from './notebook_state_registry.js';

export type NotebookSetup = (conn: ConnectionState, abort?: AbortSignal) => NotebookState;

export function useNotebookSetup(): NotebookSetup {
    const allocateNotebookState = useNotebookStateAllocator();

    return React.useCallback((conn: ConnectionState) => {
        const registry = conn.instance.createScriptRegistry();
        const mainScript = conn.instance.createScript(conn.catalog, 1);
        const mainScriptData: ScriptData = {
            scriptKey: 1,
            script: mainScript,
            processed: {
                scanned: null,
                parsed: null,
                analyzed: null,
                destroy: () => { },
            },
            outdatedAnalysis: true,
            annotations: buf.create(pb.dashql.notebook.NotebookScriptAnnotationsSchema),
            statistics: Immutable.List(),
            cursor: null,
            completion: null,
            latestQueryId: null,
        };

        const defaultPage = buf.create(pb.dashql.notebook.NotebookPageSchema, {
            scripts: [buf.create(pb.dashql.notebook.NotebookPageScriptSchema, { scriptId: mainScriptData.scriptKey, title: "" })],
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
            },
            nextScriptKey: 2,
            notebookPages: [defaultPage],
            selectedPageIndex: 0,
            selectedEntryInPage: 0,
            userFocus: null,
        });
    }, [allocateNotebookState]);
}
