import * as dashql from '@ankoh/dashql-core';
import * as proto from '@ankoh/dashql-protobuf';
import * as buf from "@bufbuild/protobuf";
import * as Immutable from 'immutable';

import { analyzeNotebookScript, ScriptData, NotebookState } from './notebook_state.js';
import { ConnectionState } from '../connection/connection_state.js';
import { NotebookStateWithoutId } from './notebook_state_registry.js';
import { LoggableException, Logger } from '../platform/logger.js';

const LOG_CTX = "notebook_import";

export function restoreNotebookState(instance: dashql.DashQL, wid: number, wb: proto.dashql.notebook.Notebook, connectionState: ConnectionState): NotebookState {
    // Use notebook_pages from proto; if empty, create one default page with script 1
    const notebookPages = wb.notebookPages?.length
        ? wb.notebookPages
        : [buf.create(proto.dashql.notebook.NotebookPageSchema, { scripts: [buf.create(proto.dashql.notebook.NotebookPageScriptSchema, { scriptId: 1, title: "" })] })];

    const state: NotebookState = {
        instance,
        notebookId: wid,
        notebookMetadata: wb.notebookMetadata ?? buf.create(proto.dashql.notebook.NotebookMetadataSchema),
        connectorInfo: connectionState.connectorInfo,
        connectionId: connectionState.connectionId,
        connectionCatalog: connectionState.catalog,
        scriptRegistry: instance.createScriptRegistry(),
        scripts: {},
        nextScriptKey: 2,
        notebookPages,
        selectedPageIndex: 0,
        selectedEntryInPage: 0,
        userFocus: null
    };
    return state;
}

export function restoreNotebookScript(instance: dashql.DashQL, notebook: NotebookState, scriptId: number, scriptProto: proto.dashql.notebook.NotebookScript): ScriptData {
    const script = instance!.createScript(notebook.connectionCatalog, scriptId);
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
        annotations: scriptProto.annotations ?? buf.create(proto.dashql.notebook.NotebookScriptAnnotationsSchema),
        cursor: null,
        completion: null,
        latestQueryId: null,
    };
    return state;
}

export function analyzeNotebookScriptOnInitialLoad<V extends NotebookStateWithoutId>(notebook: V, logger: Logger): V {
    // Run over all page scripts: first pass for table-definition scripts, then query scripts.
    const allEntries: { scriptId: number }[] = [];
    for (const page of notebook.notebookPages) {
        for (const entry of page.scripts) {
            allEntries.push(entry);
        }
    }

    for (let i = 0; i < allEntries.length; ++i) {
        const entry = allEntries[i];
        const scriptData = notebook.scripts[entry.scriptId];
        if (!scriptData) {
            throw new LoggableException("notebook entry refers to unknown script", {
                connection: notebook.connectionId.toString(),
                script: entry.scriptId.toString(),
                entry: i.toString(),
            }, LOG_CTX);
        }
        const scriptAnnotations = scriptData.annotations;
        if (!scriptData.script || scriptAnnotations.tableDefs.length == 0) {
            continue;
        }
        logger.debug("analyzing notebook script", {
            connection: notebook.connectionId.toString(),
            script: entry.scriptId.toString(),
            entry: i.toString(),
            tableDefs: scriptAnnotations.tableDefs.length.toString()
        }, LOG_CTX);
        notebook.scripts[entry.scriptId] = analyzeNotebookScript(scriptData, notebook.scriptRegistry, notebook.connectionCatalog, logger);
    }

    for (let i = 0; i < allEntries.length; ++i) {
        const entry = allEntries[i];
        const scriptData = notebook.scripts[entry.scriptId];
        const scriptAnnotations = scriptData.annotations;
        if (!scriptData.script || scriptAnnotations.tableDefs.length > 0) {
            continue;
        }
        logger.debug("analyzing notebook script", {
            connection: notebook.connectionId.toString(),
            script: entry.scriptId.toString(),
            entry: i.toString(),
            tableDefs: scriptAnnotations.tableDefs.length.toString()
        }, LOG_CTX);
        notebook.scripts[entry.scriptId] = analyzeNotebookScript(scriptData, notebook.scriptRegistry, notebook.connectionCatalog, logger);
    }
    return notebook;
}
