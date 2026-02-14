import * as buf from '@bufbuild/protobuf';
import * as pb from '@ankoh/dashql-protobuf';

import * as React from 'react';
import * as Immutable from 'immutable';

import { analyzeNotebookScript, ScriptData, NotebookState } from '../../notebook/notebook_state.js';
import { useNotebookStateAllocator, NotebookStateWithoutId } from '../../notebook/notebook_state_registry.js';
import { ConnectionState } from '../../connection/connection_state.js';
import { useLogger } from '../../platform/logger_provider.js';

const demo_q1_url = new URL('../../../static/examples/demo/q1.sql', import.meta.url);
const schema_script_url = new URL('../../../static/examples/demo/schema.sql', import.meta.url);

export type NotebookSetupFn = (conn: ConnectionState, abort?: AbortSignal) => Promise<NotebookState>;

export function useDemoNotebookSetup(): NotebookSetupFn {
    const allocateNotebookState = useNotebookStateAllocator();
    const logger = useLogger();

    return React.useCallback(async (conn: ConnectionState) => {
        const registry = conn.instance.createScriptRegistry();
        const mainScript = conn.instance.createScript(conn.catalog, 1);
        const schemaScript = conn.instance.createScript(conn.catalog, 2);

        // Fetch the scripts
        const fetchMainScript = fetch(demo_q1_url);
        const fetchSchemaScript = fetch(schema_script_url);
        const [mainScriptResponse, schemaScriptResponse] = await Promise.all([
            fetchMainScript,
            fetchSchemaScript
        ]);

        // Store the script texts
        const mainScriptText = await mainScriptResponse.text();
        const schemaScriptText = await schemaScriptResponse.text();
        mainScript.replaceText(mainScriptText);
        schemaScript.replaceText(schemaScriptText);

        // Create the script data
        let mainScriptData: ScriptData = {
            scriptKey: 1,
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
            scriptKey: 2,
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

        let state: NotebookStateWithoutId = {
            instance: conn.instance,
            notebookMetadata: buf.create(pb.dashql.notebook.NotebookMetadataSchema, {
                originalFileName: ""
            }),
            connectorInfo: conn.connectorInfo,
            connectionId: conn.connectionId,
            connectionCatalog: conn.catalog,
            scriptRegistry: registry,
            scripts: {
                [mainScriptData.scriptKey]: mainScriptData,
                [schemaScriptData.scriptKey]: schemaScriptData,
            },
            nextScriptKey: 3,
            notebookPages: [
                buf.create(pb.dashql.notebook.NotebookPageSchema, {
                    scripts: [
                        buf.create(pb.dashql.notebook.NotebookPageScriptSchema, { scriptId: mainScriptData.scriptKey, title: "" }),
                        buf.create(pb.dashql.notebook.NotebookPageScriptSchema, { scriptId: schemaScriptData.scriptKey, title: "" }),
                    ],
                }),
            ],
            selectedPageIndex: 0,
            selectedEntryInPage: 0,
            userFocus: null,
        };
        return allocateNotebookState(state);

    }, [allocateNotebookState]);
}
