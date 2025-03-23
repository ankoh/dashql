import * as React from 'react';
import Immutable from 'immutable';

import { CONNECTOR_INFOS, ConnectorType } from '../connector_info.js';
import { createExampleMetadata } from '../../workbook/example_scripts.js';
import { RESULT_OK } from '../../utils/result.js';
import { ScriptData } from '../../workbook/workbook_state.js';
import { ScriptLoadingStatus } from '../../workbook/script_loader.js';
import { useConnectionStateAllocator } from '../connection_registry.js';
import { useDashQLCoreSetup } from '../../core_provider.js';
import { useWorkbookStateAllocator } from '../../workbook/workbook_state_registry.js';
import { createDemoConnectionState } from './demo_connection_state.js';
import { ScriptType } from '../../workbook/script_metadata.js';

const demo_q1 = new URL('../../../static/examples/demo/demo1.sql', import.meta.url);

export const DEFAULT_BOARD_WIDTH = 800;
export const DEFAULT_BOARD_HEIGHT = 600;

type WorkbookSetupFn = (abort?: AbortSignal) => Promise<number>;

export function useDemoWorkbookSetup(): WorkbookSetupFn {
    const setupDashQL = useDashQLCoreSetup();
    const allocateConnection = useConnectionStateAllocator();
    const allocateWorkbookState = useWorkbookStateAllocator();

    return React.useCallback(async (signal?: AbortSignal) => {
        const dql = await setupDashQL("demo_workbook");
        signal?.throwIfAborted();

        const connectionState = createDemoConnectionState(dql);
        const connectionId = allocateConnection(connectionState);
        const mainScript = dql.createScript(connectionState.catalog, 1);

        const mainScriptData: ScriptData = {
            scriptKey: 1,
            script: mainScript,
            metadata: createExampleMetadata(ScriptType.QUERY, "Demo", demo_q1, null),
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
            connectorInfo: CONNECTOR_INFOS[ConnectorType.DEMO],
            connectionId: connectionId,
            connectionCatalog: connectionState.catalog,
            scripts: {
                [mainScriptData.scriptKey]: mainScriptData,
            },
            workbookEntries: [{
                scriptKey: mainScriptData.scriptKey,
                queryId: null,
                title: null,
            }],
            selectedWorkbookEntry: 0,
            userFocus: null,
        });
    }, [setupDashQL, allocateWorkbookState]);
}
