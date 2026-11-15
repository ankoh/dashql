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

/// The keys that a host holds, here only the one of the editor update
const known = (editorUpdate: string | null): dashql.WorkbookScriptKeys => ({ editorUpdate, pendingDiff: null, visualization: null, statistics: null });

describe('The FlatBuffers of views', () => {
    it('cross as bytes that the accessors read in place, once per key', () => {
        const workbook = dashql.DashQLWorkbook.create(dql!, 'workbook', null);
        const key = workbook.addStoredScript('alpha.sql', 'select 1 as x', MAIN(dql!.createCatalog()));
        workbook.analyzeOutdatedScript(key);
        const updates = new dashql.FlatBufferCache(bb => dashql.buffers.editor.EditorUpdate.getRootAsEditorUpdate(bb));

        // The first read carries the update, typed by its root table
        const view = workbook.scriptView(key, known(updates.known(key)));
        expect(view.key).toBe(key);
        expect(view.editorUpdateKey).not.toBeNull();
        expect(view.editorUpdate).toBeInstanceOf(Uint8Array);
        const update = updates.read(key, view.editorUpdateKey, view.editorUpdate)!;
        expect(update.analysisAvailable()).toBe(true);
        // The accessors read the bytes of the view, nothing is copied
        expect(update.bb!.bytes()).toBe(view.editorUpdate);

        // The same key leaves the bytes out and keeps the accessor object
        const again = workbook.scriptView(key, known(updates.known(key)));
        expect(again.editorUpdateKey).toBe(view.editorUpdateKey);
        expect(again.editorUpdate).toBeNull();
        expect(updates.read(key, again.editorUpdateKey, again.editorUpdate)).toBe(update);

        // A new analysis crosses again
        workbook.setScriptText(key, 'select 2 as y');
        const changed = workbook.scriptView(key, known(updates.known(key)));
        expect(changed.editorUpdateKey).not.toBe(view.editorUpdateKey);
        expect(changed.revision).toBeGreaterThan(view.revision);
        const next = updates.read(key, changed.editorUpdateKey, changed.editorUpdate)!;
        expect(next).not.toBe(update);
        expect(next.textVersion()).toBeGreaterThan(update.textVersion());

        updates.retain([]);
        expect(updates.known(key)).toBeNull();
    });

    it('hold payloads of the host and hydrate the ones they read', () => {
        const workbook = dashql.DashQLWorkbook.create(dql!, 'workbook', null);
        const key = workbook.addStoredScript('alpha.sql', 'select 1 as x', MAIN(dql!.createCatalog()));
        workbook.analyzeOutdatedScript(key);
        const updates = new dashql.FlatBufferCache(bb => dashql.buffers.editor.EditorUpdate.getRootAsEditorUpdate(bb), table => table.unpack());
        const view = workbook.scriptView(key, known(null));
        const update = updates.read(key, view.editorUpdateKey, view.editorUpdate)!;
        expect(update).toBeInstanceOf(dashql.buffers.editor.EditorUpdateT);
        expect(dashql.editorUpdateKey(update)).toBe(view.editorUpdateKey);

        // A held payload is the one of its key
        const held = new dashql.buffers.editor.EditorUpdateT();
        updates.hold(key, view.editorUpdateKey!, held);
        expect(updates.read(key, view.editorUpdateKey, null)).toBe(held);

        // Every payload of a script, the known keys leave their bytes out
        workbook.setScriptVisSpec(key, '{"mark":"bar"}');
        const staged = workbook.scriptView(key, known(null));
        expect(staged.pendingDiff?.priorText).toBe('select 1 as x');
        expect(staged.pendingDiff?.diff).toBeInstanceOf(Uint8Array);
        expect(staged.visualization?.visualization).toBeInstanceOf(Uint8Array);
        expect(staged.statistics.length).toBeGreaterThan(0);
        const newest = staged.statistics[staged.statistics.length - 1].key;
        const again = workbook.scriptView(key, {
            editorUpdate: staged.editorUpdateKey,
            pendingDiff: staged.pendingDiff!.key,
            visualization: staged.visualization!.key,
            statistics: newest,
        });
        expect(again.editorUpdate).toBeNull();
        expect(again.pendingDiff).toEqual({ ...staged.pendingDiff, diff: null });
        expect(again.visualization).toEqual({ ...staged.visualization, visualization: null });
        expect(again.statistics.every(statistics => statistics.statistics == null)).toBe(true);
        const diff = dashql.scriptDiffBuffer(dql!, staged.pendingDiff!.diff!);
        expect(diff.read().opsLength()).toBeGreaterThan(0);
    });
});
