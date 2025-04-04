import * as React from 'react';
import Immutable from 'immutable';

import { CONNECTOR_INFOS, ConnectorType } from '../connector_info.js';
import { EXAMPLES } from '../../workbook/example_scripts.js';
import { ScriptData } from '../../workbook/workbook_state.js';
import { ScriptLoadingStatus } from '../../workbook/script_loader.js';
import { useConnectionStateAllocator } from '../connection_registry.js';
import { useDashQLCoreSetup } from '../../core_provider.js';
import { useWorkbookStateAllocator } from '../../workbook/workbook_state_registry.js';
import { createServerlessConnectionState } from '../connection_state.js';

export const DEFAULT_BOARD_WIDTH = 800;
export const DEFAULT_BOARD_HEIGHT = 600;

type WorkbookSetupFn = (abort?: AbortSignal) => Promise<number>;

export function useServerlessWorkbookSetup(): WorkbookSetupFn {
    const setupDashQL = useDashQLCoreSetup();
    const allocateConnection = useConnectionStateAllocator();
    const allocateWorkbookState = useWorkbookStateAllocator();

    return React.useCallback(async (signal?: AbortSignal) => {
        const dql = await setupDashQL("serverless_workbook");
        signal?.throwIfAborted();

        const connectionState = createServerlessConnectionState(dql);
        const connectionId = allocateConnection(connectionState);
        const mainScript = dql.createScript(connectionState.catalog, 1);
        const schemaScript = dql.createScript(connectionState.catalog, 2);

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
            selectedCompletionCandidate: null,
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
            selectedCompletionCandidate: null,
        };

        return allocateWorkbookState({
            instance: dql,
            connectorInfo: CONNECTOR_INFOS[ConnectorType.SERVERLESS],
            connectionId: connectionId,
            connectionCatalog: connectionState.catalog,
            scripts: {
                [mainScriptData.scriptKey]: mainScriptData,
                [schemaScriptData.scriptKey]: schemaScriptData,
            },
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

    }, [setupDashQL, allocateWorkbookState]);
};
