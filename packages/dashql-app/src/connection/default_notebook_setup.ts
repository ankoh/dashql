import * as buf from '@bufbuild/protobuf';
import * as pb from '../proto.js';

import * as Immutable from 'immutable';
import * as core from '../core/index.js';

import { ConnectionState } from './connection_state.js';
import { Logger } from '../platform/logger.js';
import { analyzeNotebookScript, ScriptData, NotebookState, createEmptyScriptData } from '../notebook/notebook_state.js';
import { NotebookAllocator, NotebookStateWithoutId } from '../notebook/notebook_state_registry.js';

function createScriptData(script: core.DashQLScript): ScriptData {
    return {
        scriptKey: script.getCatalogEntryId(),
        script,
        scriptAnalysis: {
            buffers: {
                scanned: null,
                parsed: null,
                analyzed: null,
                destroy: () => { },
            },
            outdated: true,
        },
        statistics: Immutable.List(),
        annotations: buf.create(pb.dashql.notebook.NotebookScriptAnnotationsSchema) as pb.dashql.notebook.NotebookScriptAnnotations,
        cursor: null,
        completion: null,
        latestQueryId: null,
    };
}

export function createDefaultNotebookWithSchemaPage(
    conn: ConnectionState,
    allocateNotebookState: NotebookAllocator,
    logger: Logger,
    mainScriptText: string,
    schemaScriptText: string,
): NotebookState {
    const registry = conn.instance.createScriptRegistry();
    const mainScript = conn.instance.createScript(conn.catalog);
    const schemaScript = conn.instance.createScript(conn.catalog);

    mainScript.replaceText(mainScriptText);
    schemaScript.replaceText(schemaScriptText);

    let mainScriptData = createScriptData(mainScript);
    let schemaScriptData = createScriptData(schemaScript);
    schemaScriptData = analyzeNotebookScript(schemaScriptData, registry, conn.catalog, logger);
    mainScriptData = analyzeNotebookScript(mainScriptData, registry, conn.catalog, logger);

    const [uncommittedKey, uncommittedData] = createEmptyScriptData(conn.instance, conn.catalog);

    const state: NotebookStateWithoutId = {
        instance: conn.instance,
        notebookMetadata: buf.create(pb.dashql.notebook.NotebookMetadataSchema, {
            originalFileName: '',
        }) as pb.dashql.notebook.NotebookMetadata,
        connectorInfo: conn.connectorInfo,
        connectionId: conn.connectionId,
        connectionCatalog: conn.catalog,
        scriptRegistry: registry,
        scripts: {
            [mainScriptData.scriptKey]: mainScriptData,
            [schemaScriptData.scriptKey]: schemaScriptData,
            [uncommittedKey]: uncommittedData,
        },
        notebookPages: [
            buf.create(pb.dashql.notebook.NotebookPageSchema, {
                scripts: [
                    buf.create(pb.dashql.notebook.NotebookPageScriptSchema, { scriptId: mainScriptData.scriptKey, title: 'Main' }),
                ],
            }) as pb.dashql.notebook.NotebookPage,
            buf.create(pb.dashql.notebook.NotebookPageSchema, {
                scripts: [
                    buf.create(pb.dashql.notebook.NotebookPageScriptSchema, { scriptId: schemaScriptData.scriptKey, title: 'Schema' }),
                ],
            }) as pb.dashql.notebook.NotebookPage,
        ],
        uncommittedScriptId: uncommittedKey,
        notebookUserFocus: { pageIndex: 0, entryInPage: 0 },
        semanticUserFocus: null,
    };

    return allocateNotebookState(state);
}
