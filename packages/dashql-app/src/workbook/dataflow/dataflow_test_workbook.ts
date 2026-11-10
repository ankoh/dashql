import * as core from '@ankoh/dashql-core';

import { CONNECTOR_INFOS, ConnectorType } from '../../connections/connector_info.js';
import { createEmptyScriptData, replaceScriptSessionText, type WorkbookScripts } from '../scripts/workbook_scripts.js';
import { createEmptyMetadata, createScriptRef } from '../scripts/script_types.js';

/// A workbook of analyzed scripts on one connection, the declarations of every script are in the catalog
export function analyzedTestWorkbook(dql: core.DashQL, entries: Array<[string, string]>): WorkbookScripts {
    const catalog = dql.createCatalog();
    const connection = { connectionId: 'main', connectorInfo: CONNECTOR_INFOS[ConnectorType.HYPER], catalog };
    const scripts: WorkbookScripts['scripts'] = {};
    const scriptRefs: WorkbookScripts['scriptRefs'] = {};
    for (const [fileName, text] of entries) {
        const [scriptKey, script] = createEmptyScriptData(dql, connection, fileName);
        replaceScriptSessionText(script.scriptSession, text);
        scripts[scriptKey] = script;
        scriptRefs[fileName] = createScriptRef(scriptKey, fileName);
    }
    for (const script of Object.values(scripts)) {
        script.scriptSession.analyze();
        script.scriptSession.loadIntoCatalog();
    }
    for (const script of Object.values(scripts)) {
        script.editorUpdate = script.scriptSession.analyze();
    }
    return {
        instance: dql,
        workbookId: crypto.randomUUID(),
        name: 'Dataflow',
        pendingConnection: null,
        workbookMetadata: createEmptyMetadata(),
        scripts,
        scriptRefs,
        scriptOrder: entries.map(([fileName]) => fileName),
        scriptFocus: { fileName: entries[0]?.[0] ?? '' },
        semanticUserFocus: null,
    };
}

/// A workbook with one more script, analyzed with the catalog of the other scripts
export function withTestScript(workbook: WorkbookScripts, fileName: string, text: string): WorkbookScripts {
    const connection = Object.values(workbook.scripts)[0].connection;
    const [scriptKey, script] = createEmptyScriptData(workbook.instance, connection, fileName);
    replaceScriptSessionText(script.scriptSession, text);
    script.editorUpdate = script.scriptSession.analyze();
    return {
        ...workbook,
        scripts: { ...workbook.scripts, [scriptKey]: script },
        scriptRefs: { ...workbook.scriptRefs, [fileName]: createScriptRef(scriptKey, fileName) },
        scriptOrder: [...workbook.scriptOrder, fileName],
    };
}
