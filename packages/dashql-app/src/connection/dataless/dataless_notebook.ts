import * as pb from '../../proto.js';

import * as React from 'react';
import * as Immutable from 'immutable';
import * as buf from '@bufbuild/protobuf';

import { EXAMPLES } from '../../notebook/example_scripts.js';
import { analyzeNotebookScript, ScriptData, NotebookState, createEmptyScriptData } from '../../notebook/notebook_state.js';
import { useNotebookStateAllocator, NotebookStateWithoutId } from '../../notebook/notebook_state_registry.js';
import { ConnectionState } from '../connection_state.js';
import { useLogger } from '../../platform/logger_provider.js';

export type NotebookSetupFn = (conn: ConnectionState, abort?: AbortSignal) => Promise<NotebookState>;

export function useDatalessNotebookSetup(): NotebookSetupFn {
    const allocateNotebookState = useNotebookStateAllocator();
    const logger = useLogger();

    return React.useCallback(async (conn: ConnectionState) => {
        const registry = conn.instance.createScriptRegistry();
        const mainScript = conn.instance.createScript(conn.catalog);
        const schemaScript = conn.instance.createScript(conn.catalog);

        // Fetch the scripts
        const fetchMainScript = fetch(EXAMPLES.TPCH.queries[0].source);
        const fetchSchemaScript = fetch(EXAMPLES.TPCH.schema.source);
        const [mainScriptResponse, schemaScriptResponse] = await Promise.all([
            fetchMainScript,
            fetchSchemaScript
        ]);

        // Store the script texts
        const mainScriptText = await mainScriptResponse.text();
        const schemaScriptText = await schemaScriptResponse.text();
        mainScript.replaceText(mainScriptText);
        schemaScript.replaceText(schemaScriptText);

        let mainScriptData: ScriptData = {
            scriptKey: mainScript.getCatalogEntryId(),
            script: mainScript,
            processed: {
                scanned: null,
                parsed: null,
                analyzed: null,
                destroy: () => { },
            },
            outdatedAnalysis: true,
            statistics: Immutable.List(),
            annotations: buf.create(pb.dashql.notebook.NotebookScriptAnnotationsSchema),
            cursor: null,
            completion: null,
            latestQueryId: null,
        };
        let schemaScriptData: ScriptData = {
            scriptKey: schemaScript.getCatalogEntryId(),
            script: schemaScript,
            processed: {
                scanned: null,
                parsed: null,
                analyzed: null,
                destroy: () => { },
            },
            outdatedAnalysis: true,
            statistics: Immutable.List(),
            annotations: buf.create(pb.dashql.notebook.NotebookScriptAnnotationsSchema),
            cursor: null,
            completion: null,
            latestQueryId: null,
        };
        schemaScriptData = analyzeNotebookScript(schemaScriptData, registry, conn.catalog, logger);
        mainScriptData = analyzeNotebookScript(mainScriptData, registry, conn.catalog, logger);

        const [uncommittedKey, uncommittedData] = createEmptyScriptData(conn.instance, conn.catalog);
        let state: NotebookStateWithoutId = {
            instance: conn.instance,
            notebookMetadata: buf.create(pb.dashql.notebook.NotebookMetadataSchema, {
                originalFileName: "",
            }),
            connectorInfo: conn.connectorInfo,
            connectionId: conn.connectionId,
            connectionCatalog: conn.catalog,
            scriptRegistry: registry,
            scripts: {
                [mainScriptData.scriptKey]: mainScriptData,
                [schemaScriptData.scriptKey]: schemaScriptData,
                [uncommittedKey]: uncommittedData,
            },
            notebookPages: [
                buf.create(pb.dashql.notebook.NotebookPageSchema, {
                    scripts: [
                        buf.create(pb.dashql.notebook.NotebookPageScriptSchema, { scriptId: mainScriptData.scriptKey, title: "" }),
                        buf.create(pb.dashql.notebook.NotebookPageScriptSchema, { scriptId: schemaScriptData.scriptKey, title: "" }),
                    ],
                    uncommittedScriptId: uncommittedKey,
                }),
            ],
            notebookUserFocus: { pageIndex: 0, entryInPage: 0 },
            semanticUserFocus: null,
        };
        return allocateNotebookState(state);

    }, [allocateNotebookState]);
};
