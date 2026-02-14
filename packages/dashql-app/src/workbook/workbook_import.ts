import * as dashql from '@ankoh/dashql-core';
import * as proto from '@ankoh/dashql-protobuf';
import * as buf from "@bufbuild/protobuf";
import * as Immutable from 'immutable';

import { analyzeWorkbookScript, ScriptData, WorkbookState } from './workbook_state.js';
import { ConnectionState } from '../connection/connection_state.js';
import { WorkbookStateWithoutId } from './workbook_state_registry.js';
import { LoggableException, Logger } from '../platform/logger.js';

const LOG_CTX = "workbook_import";

export function restoreWorkbookState(instance: dashql.DashQL, wid: number, wb: proto.dashql.workbook.Workbook, connectionState: ConnectionState): WorkbookState {
    // Use workbook_pages from proto; if empty, create one default page with script 1
    const workbookPages = wb.workbookPages?.length
        ? wb.workbookPages
        : [buf.create(proto.dashql.workbook.WorkbookPageSchema, { scripts: [buf.create(proto.dashql.workbook.WorkbookPageScriptSchema, { scriptId: 1, title: "" })] })];

    const state: WorkbookState = {
        instance,
        workbookId: wid,
        workbookMetadata: wb.workbookMetadata ?? buf.create(proto.dashql.workbook.WorkbookMetadataSchema),
        connectorInfo: connectionState.connectorInfo,
        connectionId: connectionState.connectionId,
        connectionCatalog: connectionState.catalog,
        scriptRegistry: instance.createScriptRegistry(),
        scripts: {},
        nextScriptKey: 2,
        workbookPages,
        selectedPageIndex: 0,
        selectedEntryInPage: 0,
        userFocus: null
    };
    return state;
}

export function restoreWorkbookScript(instance: dashql.DashQL, workbook: WorkbookState, scriptId: number, scriptProto: proto.dashql.workbook.WorkbookScript): ScriptData {
    const script = instance!.createScript(workbook.connectionCatalog, scriptId);
    script.replaceText(scriptProto.scriptText);
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
        annotations: scriptProto.annotations ?? buf.create(proto.dashql.workbook.WorkbookScriptAnnotationsSchema),
        cursor: null,
        completion: null,
        latestQueryId: null,
    };
    return state;
}

export function analyzeWorkbookScriptOnInitialLoad<V extends WorkbookStateWithoutId>(workbook: V, logger: Logger): V {
    // Run over all page scripts: first pass for table-definition scripts, then query scripts.
    const allEntries: { scriptId: number }[] = [];
    for (const page of workbook.workbookPages) {
        for (const entry of page.scripts) {
            allEntries.push(entry);
        }
    }

    for (let i = 0; i < allEntries.length; ++i) {
        const entry = allEntries[i];
        const scriptData = workbook.scripts[entry.scriptId];
        if (!scriptData) {
            throw new LoggableException("workbook entry refers to unknown script", {
                connection: workbook.connectionId.toString(),
                script: entry.scriptId.toString(),
                entry: i.toString(),
            }, LOG_CTX);
        }
        const scriptAnnotations = scriptData.annotations;
        if (!scriptData.script || scriptAnnotations.tableDefs.length == 0) {
            continue;
        }
        logger.debug("analyzing workbook script", {
            connection: workbook.connectionId.toString(),
            script: entry.scriptId.toString(),
            entry: i.toString(),
            tableDefs: scriptAnnotations.tableDefs.length.toString()
        }, LOG_CTX);
        workbook.scripts[entry.scriptId] = analyzeWorkbookScript(scriptData, workbook.scriptRegistry, workbook.connectionCatalog, logger);
    }

    for (let i = 0; i < allEntries.length; ++i) {
        const entry = allEntries[i];
        const scriptData = workbook.scripts[entry.scriptId];
        const scriptAnnotations = scriptData.annotations;
        if (!scriptData.script || scriptAnnotations.tableDefs.length > 0) {
            continue;
        }
        logger.debug("analyzing workbook script", {
            connection: workbook.connectionId.toString(),
            script: entry.scriptId.toString(),
            entry: i.toString(),
            tableDefs: scriptAnnotations.tableDefs.length.toString()
        }, LOG_CTX);
        workbook.scripts[entry.scriptId] = analyzeWorkbookScript(scriptData, workbook.scriptRegistry, workbook.connectionCatalog, logger);
    }
    return workbook;
}
