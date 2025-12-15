import * as pb from '@ankoh/dashql-protobuf';
import * as buf from '@bufbuild/protobuf';

import * as React from 'react';
import * as Immutable from 'immutable';

import { ConnectionState } from '../connection/connection_state.js';
import { ScriptData, WorkbookState } from './workbook_state.js';
import { useWorkbookStateAllocator } from './workbook_state_registry.js';

export type WorkbookSetup = (conn: ConnectionState, abort?: AbortSignal) => WorkbookState;

export function useWorkbookSetup(): WorkbookSetup {
    const allocateWorkbookState = useWorkbookStateAllocator();

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
            annotations: buf.create(pb.dashql.workbook.WorkbookScriptAnnotationsSchema),
            statistics: Immutable.List(),
            cursor: null,
            completion: null,
            latestQueryId: null,
        };

        return allocateWorkbookState({
            workbookMetadata: buf.create(pb.dashql.workbook.WorkbookMetadataSchema),
            instance: conn.instance,
            connectorInfo: conn.connectorInfo,
            connectionId: conn.connectionId,
            connectionCatalog: conn.catalog,
            scriptRegistry: registry,
            scripts: {
                [mainScriptData.scriptKey]: mainScriptData,
            },
            nextScriptKey: 2,
            workbookEntries: [
                buf.create(pb.dashql.workbook.WorkbookEntrySchema, {
                    scriptId: mainScriptData.scriptKey,
                }),
            ],
            selectedWorkbookEntry: 0,
            userFocus: null,
        });
    }, [allocateWorkbookState]);
}
