import * as dashql from '@ankoh/dashql-core';
import * as proto from '@ankoh/dashql-protobuf';
import * as buf from "@bufbuild/protobuf";
import * as Immutable from 'immutable';

import { rotateScriptStatistics, ScriptData, WorkbookState } from './workbook_state.js';
import { ConnectionState } from '../connection/connection_state.js';
import { analyzeScript } from '../view/editor/dashql_processor.js';

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
        latestQueryId: null,
    };
    return state;
}

export function analyzeWorkbookScriptOnInitialLoad(workbook: WorkbookState) {
    // Iterate over all workbooks and analyze the scripts.
    // First analyze scripts where we already know that they have only table definitions, ordered by the workbook entry id.
    // Then analyze queries, ordered by the workbook entry id.
    // Effectively just running over the workbook entries two times.
    for (const entry of workbook.workbookEntries) {
        const scriptData = workbook.scripts[entry.scriptId];
        const scriptAnnotations = scriptData.annotations;

        // In the first pass skip over everything that has no table definitions
        if (!scriptData.script || scriptAnnotations.tableDefs.length == 0) {
            continue;
        }
        const prev = scriptData.processed;
        scriptData.processed = analyzeScript(scriptData.script);
        scriptData.statistics = rotateScriptStatistics(scriptData.statistics, scriptData.script.getStatistics());
        prev.destroy(prev);
    }

}
