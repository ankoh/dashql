import * as core from '@ankoh/dashql-core';
import * as Immutable from 'immutable';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { TestLogger } from '../../testing/test_logger.js';
import { CONNECTOR_INFOS, ConnectorType } from '../../connections/connector_info.js';
import { WorkbookTestBackend } from '../../testing/workbook_test_backend.js';
import { StorageWriter } from '../../storage/storage_writer.js';
import {
    APPLY_PLANNER_ANALYSIS,
    REGISTER_QUERY,
    createWorkbookScripts,
    type WorkbookScripts,
    reduceWorkbookScripts,
    replaceScriptSessionText,
} from './workbook_scripts.js';
import { createEmptyMetadata } from './script_types.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: core.DashQL;
const logger = new TestLogger();

beforeAll(async () => { dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });
afterEach(() => { vi.restoreAllMocks(); dql.resetUnsafe(); });

function fixture() {
    const catalog = dql.createCatalog();
    const connection = { connectionId: crypto.randomUUID(), connectorInfo: CONNECTOR_INFOS[ConnectorType.HYPER], catalog };
    const state: WorkbookScripts = createWorkbookScripts({
        instance: dql, workbookId: crypto.randomUUID(), name: 'Test', pendingConnection: null,
        workbookMetadata: createEmptyMetadata(),
        scripts: [
            ['1_items.sql', 'create table items (id int);'],
            ['2_query.sql', 'select id from items;'],
            ['3_other.sql', 'select 3;'],
        ].map(([name, sql]) => ({ name, sql, connection })),
    });
    const [definition, query, other] = state.scriptOrder.map(name => state.scripts[state.scriptRefs[name].scriptId]);
    // Publish before capturing snapshots, matching the planner's final catalog revision.
    for (const script of [definition, query, other]) {
        script.scriptSession.analyze();
        script.scriptSession.loadIntoCatalog();
    }
    const updates = [definition, query].map(script => ({
        scriptKey: script.scriptKey, editorUpdate: script.scriptSession.analyze(),
    }));
    const writer = new StorageWriter(logger, new WorkbookTestBackend());
    const write = vi.spyOn(writer, 'write');
    const apply = (value = updates, current = state) => reduceWorkbookScripts(current,
        { type: APPLY_PLANNER_ANALYSIS, value }, writer, logger);
    return { state, definition, query, other, updates, write, apply };
}

describe('planner analysis projection', () => {
    it('applies a batch without republishing, invalidating peers, or persisting SQL', () => {
        const f = fixture();
        const workbooks = Object.values(f.state.scripts).map(script => script.scriptSession);
        const revisions = workbooks.map(workbook => workbook.getCatalogRevision());
        const publish = workbooks.map(workbook => vi.spyOn(workbook, 'loadIntoCatalog'));
        const next = f.apply();

        expect(next.scripts[f.definition.scriptKey].annotations.tableDefs).toEqual(['items']);
        for (const { scriptKey, editorUpdate } of f.updates) {
            const script = next.scripts[scriptKey];
            expect(script.editorUpdate).toBe(editorUpdate);
            expect(script.analysisOutdated).toBe(false);
            expect(script.statistics).toEqual(editorUpdate.analysisUpdated && editorUpdate.processingStatistics != null
                ? Immutable.List([editorUpdate.processingStatistics]) : Immutable.List());
            expect(f.state.scripts[scriptKey].analysisOutdated).toBe(true);
        }
        expect(next.scripts[f.other.scriptKey]).toBe(f.other);
        expect(workbooks.map(workbook => workbook.getCatalogRevision())).toEqual(revisions);
        publish.forEach(spy => expect(spy).not.toHaveBeenCalled());
        expect(f.write).not.toHaveBeenCalled();
    });

    it('ignores missing scripts and snapshots with stale live text versions', () => {
        const f = fixture();
        replaceScriptSessionText(f.query.scriptSession, 'select 2;');
        expect(f.query.editorUpdate).toBeNull();
        expect(f.apply([
            f.updates[1],
            { scriptKey: -1, editorUpdate: f.updates[0].editorUpdate },
        ])).toBe(f.state);
        expect(f.write).not.toHaveBeenCalled();
    });

    it('ignores snapshots invalidated by a later catalog publication', () => {
        const f = fixture();
        // Republishing equal declarations keeps the catalog revision, publish a new table
        const workbook = f.other.scriptSession;
        workbook.replaceText(workbook.getTextVersion(), 'create table other (id int);');
        workbook.analyze();
        workbook.loadIntoCatalog();
        expect(f.query.scriptSession.getCatalogRevision()).not.toBe(f.updates[1].editorUpdate.catalogRevision);
        expect(f.apply()).toBe(f.state);
    });

    it('ignores failed or unavailable analysis', () => {
        const f = fixture();
        f.updates[0].editorUpdate.status = core.buffers.editor.EditorUpdateStatus.STALE_TEXT_VERSION;
        f.updates[1].editorUpdate.analysisAvailable = false;
        expect(f.apply()).toBe(f.state);
    });

    it('refreshes a superseded cursor projection', () => {
        const f = fixture();
        const cursorUpdate = f.query.scriptSession.setCursor(f.query.scriptSession.getTextVersion(), 8n);
        expect(cursorUpdate.stateRevision).not.toBe(f.updates[1].editorUpdate.stateRevision);
        const next = f.apply([f.updates[1], f.updates[0]]);
        expect(next.scripts[f.query.scriptKey].editorUpdate?.stateRevision).toBe(cursorUpdate.stateRevision);
        expect(next.scripts[f.query.scriptKey].editorUpdate?.primaryCursorState).toEqual(cursorUpdate.primaryCursorState);
    });

    it('preserves the query history and the staged diff', () => {
        const f = fixture();
        f.query.scriptSession.setCursor(f.query.scriptSession.getTextVersion(), 8n);
        const current = reduceWorkbookScripts(f.state, { type: REGISTER_QUERY, value: [f.query.scriptKey, 42] }, new StorageWriter(logger, new WorkbookTestBackend()), logger);
        const next = f.apply(f.updates, current);
        expect(next.scripts[f.query.scriptKey].pendingDiff).toBeNull();
        expect(next.scripts[f.query.scriptKey].latestQueryId).toBe(42);
    });
});
