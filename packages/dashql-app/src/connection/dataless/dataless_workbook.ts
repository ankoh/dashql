import * as pb from '@ankoh/dashql-protobuf';

import * as React from 'react';
import * as Immutable from 'immutable';
import * as buf from '@bufbuild/protobuf';

import { EXAMPLES } from '../../workbook/example_scripts.js';
import { deriveScriptAnnotations, rotateScriptStatistics, ScriptData, WorkbookState } from '../../workbook/workbook_state.js';
import { useWorkbookStateAllocator } from '../../workbook/workbook_state_registry.js';
import { ConnectionState } from '../connection_state.js';
import { analyzeScript } from '../../view/editor/dashql_processor.js';

type WorkbookSetupFn = (conn: ConnectionState, abort?: AbortSignal) => Promise<WorkbookState>;

export function useDatalessWorkbookSetup(): WorkbookSetupFn {
    const allocateWorkbookState = useWorkbookStateAllocator();

    return React.useCallback(async (conn: ConnectionState) => {
        const registry = conn.instance.createScriptRegistry();
        const mainScript = conn.instance.createScript(conn.catalog, 1);
        const schemaScript = conn.instance.createScript(conn.catalog, 2);

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

        // Analyze the schema script
        const schemaProcessed = analyzeScript(schemaScript);
        conn.catalog.loadScript(schemaScript, 1);
        registry.addScript(schemaScript);
        const schemaStats = rotateScriptStatistics(Immutable.List(), schemaScript.getStatistics() ?? null);
        const schemaAnnotations = deriveScriptAnnotations(schemaProcessed);

        // Analyze the main script
        const mainProcessed = analyzeScript(mainScript);
        registry.addScript(mainScript);
        const mainStats = rotateScriptStatistics(Immutable.List(), mainScript.getStatistics() ?? null);
        const mainAnnotations = deriveScriptAnnotations(mainProcessed);


        const mainScriptData: ScriptData = {
            scriptKey: 1,
            script: mainScript,
            processed: mainProcessed,
            outdatedAnalysis: false,
            statistics: mainStats,
            annotations: mainAnnotations,
            cursor: null,
            completion: null,
        };
        const schemaScriptData: ScriptData = {
            scriptKey: 2,
            script: schemaScript,
            processed: schemaProcessed,
            outdatedAnalysis: false,
            statistics: schemaStats,
            annotations: schemaAnnotations,
            cursor: null,
            completion: null,
        };

        return allocateWorkbookState({
            instance: conn.instance,
            workbookMetadata: buf.create(pb.dashql.workbook.WorkbookMetadataSchema, {
                originalFileName: "",
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
            workbookEntries: [{
                scriptKey: mainScriptData.scriptKey,
                queryId: null,
                title: null,
            }, {
                scriptKey: schemaScriptData.scriptKey,
                queryId: null,
                title: null,
            }],
            selectedWorkbookEntry: 0,
            userFocus: null,
        });

    }, [allocateWorkbookState]);
};
