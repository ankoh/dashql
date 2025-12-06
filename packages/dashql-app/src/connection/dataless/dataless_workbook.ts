import * as React from 'react';
import * as Immutable from 'immutable';

import { EXAMPLES } from '../../workbook/example_scripts.js';
import { ScriptData, WorkbookState } from '../../workbook/workbook_state.js';
import { ScriptLoadingStatus } from '../../workbook/script_loader.js';
import { useWorkbookStateAllocator } from '../../workbook/workbook_state_registry.js';
import { ConnectionState } from '../connection_state.js';

type WorkbookSetupFn = (conn: ConnectionState, abort?: AbortSignal) => WorkbookState;

export function useDatalessWorkbookSetup(): WorkbookSetupFn {
    const allocateWorkbookState = useWorkbookStateAllocator();

    return React.useCallback((conn: ConnectionState) => {
        const registry = conn.instance.createScriptRegistry();
        const mainScript = conn.instance.createScript(conn.catalog, 1);
        const schemaScript = conn.instance.createScript(conn.catalog, 2);

        const mainScriptData: ScriptData = {
            scriptKey: 1,
            script: mainScript,
            // metadata: STRESS_TESTS[0].queries[0],
            metadata: EXAMPLES.TPCH.queries[1],
            loading: {
                status: ScriptLoadingStatus.PENDING,
                error: null,
                startedAt: null,
                finishedAt: null,
            },
            processed: {
                scanned: null,
                parsed: null,
                analyzed: null,
                destroy: () => { },
            },
            outdatedAnalysis: true,
            statistics: Immutable.List(),
            cursor: null,
            completion: null,
        };
        const schemaScriptData: ScriptData = {
            scriptKey: 2,
            script: schemaScript,
            // metadata: STRESS_TESTS[0].schema,
            metadata: EXAMPLES.TPCH.schema,
            loading: {
                status: ScriptLoadingStatus.PENDING,
                error: null,
                startedAt: null,
                finishedAt: null,
            },
            processed: {
                scanned: null,
                parsed: null,
                analyzed: null,
                destroy: () => { },
            },
            outdatedAnalysis: true,
            statistics: Immutable.List(),
            cursor: null,
            completion: null,
        };

        return allocateWorkbookState({
            instance: conn.instance,
            workbookMetadata: {
                fileName: "",
            },
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
