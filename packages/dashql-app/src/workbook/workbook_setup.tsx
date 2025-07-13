import * as React from 'react';
import * as Immutable from 'immutable';

import { ConnectionState } from '../connection/connection_state.js';
import { ScriptData, WorkbookState } from './workbook_state.js';
import { ScriptLoadingStatus } from './script_loader.js';
import { generateBlankScriptMetadata } from './script_metadata.js';
import { useWorkbookStateAllocator } from './workbook_state_registry.js';

type WorkbookSetupFn = (conn: ConnectionState, abort?: AbortSignal) => WorkbookState;

export function useWorkbookSetup(): WorkbookSetupFn {
    const allocateWorkbookState = useWorkbookStateAllocator();

    return React.useCallback((conn: ConnectionState) => {
        const registry = conn.instance.createScriptRegistry();
        const mainScript = conn.instance.createScript(conn.catalog, 1);
        const mainScriptData: ScriptData = {
            scriptKey: 1,
            script: mainScript,
            metadata: generateBlankScriptMetadata(),
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
            workbookMetadata: {
                fileName: "",
            },
            instance: conn.instance,
            connectorInfo: conn.connectorInfo,
            connectionId: conn.connectionId,
            connectionCatalog: conn.catalog,
            scriptRegistry: registry,
            scripts: {
                [mainScriptData.scriptKey]: mainScriptData,
            },
            nextScriptKey: 2,
            workbookEntries: [{
                scriptKey: mainScriptData.scriptKey,
                queryId: null,
                title: null,
            }],
            selectedWorkbookEntry: 0,
            userFocus: null,
        });
    }, [allocateWorkbookState]);
}
