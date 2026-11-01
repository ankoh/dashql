import * as core from '@ankoh/dashql-core';

import { CONNECTOR_INFOS, ConnectorType } from '../../connections/connector_info.js';
import { createEmptyScriptData, replaceScriptSessionText, type SessionScripts } from '../scripts/session_scripts.js';
import { createEmptyMetadata, createScriptRef } from '../scripts/script_types.js';

/// A session of analyzed scripts on one connection, the declarations of every script are in the catalog
export function analyzedTestSession(dql: core.DashQL, entries: Array<[string, string]>): SessionScripts {
    const catalog = dql.createCatalog();
    const connection = { connectionId: 'main', connectorInfo: CONNECTOR_INFOS[ConnectorType.HYPER], catalog };
    const scripts: SessionScripts['scripts'] = {};
    const scriptRefs: SessionScripts['scriptRefs'] = {};
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
        sessionId: crypto.randomUUID(),
        name: 'Dataflow',
        pendingConnection: null,
        sessionMetadata: createEmptyMetadata(),
        scripts,
        scriptRefs,
        scriptOrder: entries.map(([fileName]) => fileName),
        scriptFocus: { fileName: entries[0]?.[0] ?? '' },
        semanticUserFocus: null,
    };
}
