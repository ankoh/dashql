import * as React from 'react';
import Immutable from 'immutable';

import { CONNECTOR_INFOS, ConnectorType } from '../../connection/connector_info.js';
import { RESULT_OK } from '../../utils/result.js';
import { ScriptData } from '../../workbook/workbook_state.js';
import { ScriptLoadingStatus } from '../../workbook/script_loader.js';
import { generateBlankScriptMetadata } from '../../workbook/script_metadata.js';
import { useDashQLCoreSetup } from '../../core_provider.js';
import { useWorkbookStateAllocator } from '../../workbook/workbook_state_registry.js';
import { createSalesforceConnectionState } from './salesforce_connection_state.js';
import { useConnectionStateAllocator } from '../../connection/connection_registry.js';

type WorkbookSetupFn = (abort?: AbortSignal) => Promise<number>;

export function useSalesforceWorkbookSetup(): WorkbookSetupFn {
    const setupDashQL = useDashQLCoreSetup();
    const allocateConnection = useConnectionStateAllocator();
    const allocateWorkbookState = useWorkbookStateAllocator();

    return React.useCallback(async (signal?: AbortSignal) => {
        const dql = await setupDashQL("salesforce_workbook");
        signal?.throwIfAborted();

        const connectionState = createSalesforceConnectionState(dql);
        const connectionId = allocateConnection(connectionState);
        const mainScript = dql.createScript(connectionState.catalog, 1);

        const mainScriptData: ScriptData = {
            scriptKey: 1,
            script: mainScript,
            metadata: generateBlankScriptMetadata(),
            loading: {
                status: ScriptLoadingStatus.SUCCEEDED,
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
            connectorInfo: CONNECTOR_INFOS[ConnectorType.SALESFORCE_DATA_CLOUD],
            connectionId: connectionId,
            connectionCatalog: connectionState.catalog,
            scripts: {
                [mainScriptData.scriptKey]: mainScriptData,
            },
            workbookEntries: [{
                scriptKey: mainScriptData.scriptKey,
                queryId: null,
                title: null
            }],
            selectedWorkbookEntry: 0,
            userFocus: null,
        });
    }, [setupDashQL, allocateWorkbookState]);
};
