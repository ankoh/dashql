import * as dashql from './index.js';

import { loadCoreWasm } from './test_fixture.js';

let dql: dashql.DashQL | null = null;
beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await loadCoreWasm() });
});
afterEach(() => {
    dql!.resetUnsafe();
});

function connection(catalog: dashql.DashQLCatalog, connectionId = 'main'): dashql.WorkbookConnection {
    return {
        connectionId,
        catalog,
        dialect: dashql.buffers.formatting.FormattingDialect.HYPER,
        local: false,
        params: '{"hyper":{}}',
        defaultDatabase: '',
        defaultSchema: '',
    };
}

/// The keys of a host that holds no payloads, every payload crosses
const NONE: dashql.WorkbookScriptKeys = { editorUpdate: null, pendingDiff: null, visualization: null, statistics: null };

describe('DashQL workbooks', () => {
    it('apply actions and return the files to write', () => {
        const main = connection(dql!.createCatalog());
        const workbook = dashql.DashQLWorkbook.create(dql!, 'workbook', 'Sales');
        const alpha = workbook.addStoredScript('alpha.sql', 'create table t (x int)', main);
        const outcome = workbook.createScript(null, 'select x from t', 'beta');
        expect(outcome.changed).toBe(true);
        expect(outcome.effects[0]).toEqual({ type: 'writeScript', fileName: 'beta.sql', text: 'select x from t' });
        expect(outcome.effects[1]).toEqual({
            type: 'writeScriptList',
            list: {
                scripts: [{ name: 'alpha.sql', connectionId: 'main' }, { name: 'beta.sql', connectionId: 'main' }],
                connections: [{ connectionId: 'main', params: '{"hyper":{}}' }],
            },
        });
        const keys = workbook.view().scripts.map(([key]) => key);
        expect(keys[0]).toBe(alpha);
        const beta = workbook.scriptView(keys[1], NONE);
        expect(beta).toMatchObject({ key: keys[1], fileName: 'beta.sql', connectionId: 'main', analysisOutdated: false, pendingDiff: null });
        const update = dashql.readFlatBuffer(beta.editorUpdate!, bb => dashql.buffers.editor.EditorUpdate.getRootAsEditorUpdate(bb));
        expect(update.analysisAvailable()).toBe(true);
        expect(workbook.view()).toMatchObject({ name: 'Sales', ephemeral: false, pendingConnectionId: null, attachments: null });
        // An action that fails throws and leaves the workbook as it was
        const revision = workbook.revision();
        expect(() => workbook.applyEditorEvent(999, new dashql.buffers.editor.EditorEventT())).toThrow();
        expect(workbook.revision()).toBe(revision);
    });

    it('share the sessions of the scripts', () => {
        const main = connection(dql!.createCatalog());
        const workbook = dashql.DashQLWorkbook.create(dql!, 'workbook', null);
        const key = workbook.addStoredScript('alpha.sql', 'select 1', main);
        const session = workbook.scriptSession(key);
        expect(session.getText()).toBe('select 1');
        expect(session.getCatalogEntryId()).toBe(key);
        // An editor that applies an event to the shared session reports its update
        const revision = workbook.scriptView(key, NONE).revision;
        const update = session.replaceText(session.getTextVersion(), 'select 42');
        const outcome = workbook.reportEditorUpdate(key, update, true);
        expect(outcome.effects).toEqual([{ type: 'writeScript', fileName: 'alpha.sql', text: 'select 42' }]);
        expect(workbook.view().scripts).toEqual([[key, workbook.scriptView(key, NONE).revision]]);
        expect(workbook.scriptView(key, NONE).revision).toBeGreaterThan(revision);
        // The workbook changes the text of the same session
        workbook.setScriptText(key, 'select 7');
        expect(session.getText()).toBe('select 7');
        // A script that moves to another connection gets a new session under its key
        const sessionId = workbook.scriptView(key, NONE).sessionId;
        workbook.setScriptConnection('alpha.sql', connection(dql!.createCatalog(), 'other'));
        expect(workbook.scriptView(key, NONE)).toMatchObject({ connectionId: 'other', key });
        expect(workbook.scriptView(key, NONE).sessionId).not.toBe(sessionId);
    });

    it('apply the events of an editor and stage rewrites', () => {
        const main = connection(dql!.createCatalog());
        const workbook = dashql.DashQLWorkbook.create(dql!, 'workbook', null);
        const key = workbook.addStoredScript('alpha.sql', 'select 2 as x', main);
        const event = new dashql.buffers.editor.EditorEventT();
        event.expectedTextVersion = workbook.scriptSession(key).getTextVersion();
        event.changes = [new dashql.buffers.editor.EditorTextChangeT(13n, 13n, ', 3 as y')];
        event.analyze = true;
        const outcome = workbook.applyEditorEvent(key, event);
        expect(dashql.readFlatBuffer(outcome.editorUpdate!, bb => dashql.buffers.editor.EditorUpdate.getRootAsEditorUpdate(bb)).analysisAvailable()).toBe(true);
        expect(outcome.effects).toEqual([{ type: 'writeScript', fileName: 'alpha.sql', text: 'select 2 as x, 3 as y' }]);

        workbook.setScriptVisSpec(key, '{"mark":"bar"}');
        const staged = workbook.scriptView(key, NONE);
        expect(staged.pendingDiff?.priorText).toBe('select 2 as x, 3 as y');
        expect(dashql.scriptDiffBuffer(dql!, staged.pendingDiff!.diff!).read().opsLength()).toBeGreaterThan(0);
        const visualization = dashql.readFlatBuffer(staged.visualization!.visualization!, bb => dashql.buffers.execution.CompiledVisualization.getRootAsCompiledVisualization(bb));
        expect(visualization.renderer()).toBe('vegalite');
        workbook.rejectPendingDiff(key);
        expect(workbook.scriptSession(key).getText()).toBe('select 2 as x, 3 as y');
        expect(workbook.scriptView(key, NONE).pendingDiff).toBeNull();
    });

    it('replace their scripts with the ones of storage', () => {
        const main = connection(dql!.createCatalog());
        const workbook = dashql.DashQLWorkbook.create(dql!, 'workbook', null);
        workbook.addStoredScript('alpha.sql', 'select 1', main);
        const stored = [{ name: 'beta.sql', sql: 'select 2', connection: main }, { name: 'alpha.sql', sql: 'select 1', connection: main }];
        expect(workbook.matchesStoredScripts(stored)).toBe(false);
        expect(workbook.replaceFromStorage(stored)).toBe(true);
        expect(workbook.view().scriptList.scripts.map(script => script.name)).toEqual(['beta.sql', 'alpha.sql']);
        expect(workbook.matchesStoredScripts(stored)).toBe(true);
        workbook.setStoredAttachments([{ name: 'sales.parquet', sizeBytes: 3, mtimeMs: 4 }]);
        expect(workbook.view().attachments).toEqual([{ fileName: 'sales.parquet', name: 'sales', sizeBytes: 3, mtimeMs: 4, columns: null }]);
    });
});
