import * as dashql from './index.js';

import { loadCoreWasm } from './test_fixture.js';

let dql: dashql.DashQL | null = null;
beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await loadCoreWasm() });
});
afterEach(() => {
    dql!.resetUnsafe();
});

const MAIN = (catalog: dashql.DashQLCatalog): dashql.WorkbookConnection => ({
    connectionId: 'main',
    catalog,
    dialect: dashql.buffers.formatting.FormattingDialect.HYPER,
    local: false,
    params: '{"hyper":{}}',
    defaultDatabase: '',
    defaultSchema: '',
});

describe('The FlatBuffers of views', () => {
    it('cross as bytes that the accessors read in place, once per key', () => {
        const workbook = dashql.DashQLWorkbook.create(dql!, 'workbook', null);
        const key = workbook.addStoredScript('alpha.sql', 'select 1 as x', MAIN(dql!.createCatalog()));
        workbook.analyzeOutdatedScript(key);
        const updates = new dashql.FlatBufferCache(bb => dashql.buffers.editor.EditorUpdate.getRootAsEditorUpdate(bb));

        // The first read carries the update, typed by its root table
        const view = workbook.scriptView(key, updates.known(key));
        expect(view.key).toBe(key);
        expect(view.editorUpdateKey).not.toBeNull();
        expect(view.editorUpdate).toBeInstanceOf(Uint8Array);
        const update = updates.read(key, view.editorUpdateKey, view.editorUpdate)!;
        expect(update.analysisAvailable()).toBe(true);
        // The accessors read the bytes of the view, nothing is copied
        expect(update.bb!.bytes()).toBe(view.editorUpdate);

        // The same key leaves the bytes out and keeps the accessor object
        const again = workbook.scriptView(key, updates.known(key));
        expect(again.editorUpdateKey).toBe(view.editorUpdateKey);
        expect(again.editorUpdate).toBeNull();
        expect(updates.read(key, again.editorUpdateKey, again.editorUpdate)).toBe(update);

        // A new analysis crosses again
        workbook.setScriptText(key, 'select 2 as y');
        const changed = workbook.scriptView(key, updates.known(key));
        expect(changed.editorUpdateKey).not.toBe(view.editorUpdateKey);
        expect(changed.revision).toBeGreaterThan(view.revision);
        const next = updates.read(key, changed.editorUpdateKey, changed.editorUpdate)!;
        expect(next).not.toBe(update);
        expect(next.textVersion()).toBeGreaterThan(update.textVersion());

        updates.retain([]);
        expect(updates.known(key)).toBeNull();
    });
});
