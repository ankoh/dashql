import * as dashql from '@ankoh/dashql-core';
import * as proto from '@ankoh/dashql-protobuf';
import * as buf from "@bufbuild/protobuf";
import * as Immutable from 'immutable';

import { ScriptData, WorkbookState } from './workbook_state.js';
import { ConnectionState } from '../connection/connection_state.js';

export function restoreWorkbookState(instance: dashql.DashQL, wid: number, wb: proto.dashql.workbook.Workbook, connectionState: ConnectionState): WorkbookState {
    const state: WorkbookState = {
        instance,
        workbookId: wid,
        workbookMetadata: wb.workbookMetadata ?? buf.create(proto.dashql.workbook.WorkbookMetadataSchema),
        connectorInfo: connectionState.connectorInfo,
        connectionId: connectionState.connectionId,
        connectionCatalog: instance.createCatalog(),
        scriptRegistry: instance.createScriptRegistry(),
        scripts: {},
        nextScriptKey: 2,
        workbookEntries: [],
        selectedWorkbookEntry: 0,
        userFocus: null
    };
    return state;
}

export function restoreWorkbookScript(instance: dashql.DashQL, workbook: WorkbookState, scriptId: number, scriptText: string): ScriptData {
    const script = instance!.createScript(workbook.connectionCatalog, scriptId);
    script.replaceText(scriptText);
    const state: ScriptData = {
        scriptKey: scriptId,
        script,
        processed: {
            scanned: null,
            parsed: null,
            analyzed: null,
            destroy: () => { },
        },
        outdatedAnalysis: true,
        statistics: Immutable.List(),
        annotations: buf.create(proto.dashql.workbook.WorkbookScriptAnnotationsSchema),
        cursor: null,
        completion: null,
    };
    return state;
}
