import * as flatbuffers from 'flatbuffers';

import * as dashql from './index.js';

import { loadCoreWasm, MemoryStorage, testPlatform } from './test_fixture.js';

let dql: dashql.DashQL | null = null;
beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await loadCoreWasm() });
});
afterEach(() => {
    dql!.resetUnsafe();
});

/// The id of a stored workbook, a UUID
const WB = '11111111-1111-4111-8111-111111111111';
/// The id of a stored connection, a UUID
const CONNECTION = '22222222-2222-4222-8222-222222222222';

/// The keys of a host that holds no payloads, every payload crosses
const NONE: dashql.WorkbookScriptKeys = { editorUpdate: null, pendingDiff: null, visualization: null, statistics: null };

const viewOf = <K extends dashql.ViewKind>(runtime: dashql.Runtime, kind: K, id: dashql.ViewId<K>, known?: dashql.KnownKeys<K>) =>
    runtime.views(kind, [id], known)[0];

/// A runtime with the embedded Hyper and a workbook on it, the storage in memory
function createRuntime(storage?: MemoryStorage, connectionId: string | null = 'main') {
    const platform = testPlatform(storage);
    const runtime = dql!.createRuntime(platform.platform);
    runtime.runCatalogLoader(false);
    if (connectionId != null) {
        const created = runtime.dispatch('app', { kind: 'createConnection', value: { connectionId, connectorType: dashql.ConnectorType.HYPER, setupParams: { protocol: 'WASM', endpoint: '' } } });
        expect(created.ok).toBe(true);
    }
    return { runtime, ...platform };
}

/// The changed slices as `kind:id`
const changesOf = (runtime: dashql.Runtime, kinds?: string[]) =>
    runtime.takeChanges().changes.filter(change => kinds == null || kinds.includes(change.kind)).map(change => `${change.kind}:${change.id}${change.revision == null ? ' gone' : ''}`);

/// Apply a typed character to the shared session of a script and report the update, as the editor does
function type(runtime: dashql.Runtime, workbookId: string, key: number, offset: number, text: string): dashql.buffers.editor.EditorUpdateT {
    const session = dql!.runtimeScriptSession(runtime, key)!;
    const view = viewOf(runtime, 'script', key, [NONE])!;
    const event = new dashql.buffers.editor.EditorEventT(
        session.getTextVersion(),
        [new dashql.buffers.editor.EditorTextChangeT(BigInt(offset), BigInt(offset), text)],
        new dashql.buffers.editor.EditorSelectionT(BigInt(offset + text.length), BigInt(offset + text.length)),
        dashql.buffers.editor.EditorEventOrigin.USER,
        dashql.buffers.editor.EditorEventIntent.EDIT,
        dashql.buffers.editor.EditorEventAction.TYPE,
        true,
    );
    const update = session.apply(event);
    const builder = new flatbuffers.Builder();
    builder.finish(update.pack(builder));
    runtime.reportEditorUpdate(workbookId, key, view.sessionId, builder.asUint8Array(), false);
    session.destroy();
    return update;
}

describe('The workbooks of the runtime', () => {
    it('create workbooks and scripts and write them', async () => {
        const { runtime, storage } = createRuntime();
        const created = runtime.dispatch('app', { kind: 'createWorkbook', value: { workbookId: 'w', connectionId: 'main', name: 'Sales' } });
        expect(created).toMatchObject({ ok: true, id: 'w' });
        expect(changesOf(runtime, ['workbookList', 'workbook', 'connection'])).toEqual(['connection:main', 'workbookList:root', 'workbook:w']);
        expect(viewOf(runtime, 'workbook', 'w')).toMatchObject({ workbookId: 'w', name: 'Sales', pendingConnectionId: 'main', scriptKeys: [], connectionIds: ['main'] });
        // The connection knows the workbook that uses it, it can't be deleted
        expect(viewOf(runtime, 'connection', 'main')!.workbooks).toEqual(['w']);

        expect(runtime.dispatch({ workbook: 'w' }, { kind: 'createScript', value: { text: 'create table t (x int)', base: 'alpha' } }).changed).toBe(true);
        expect(runtime.dispatch({ workbook: 'w' }, { kind: 'createScript', value: { text: 'select x from t', base: 'beta' } }).changed).toBe(true);
        const workbook = viewOf(runtime, 'workbook', 'w')!;
        expect(workbook.scriptOrder).toEqual(['alpha.sql', 'beta.sql']);
        const [alpha, beta] = workbook.scriptKeys;
        expect(viewOf(runtime, 'script', beta, [NONE])).toMatchObject({ key: beta, workbookId: 'w', fileName: 'beta.sql', connectionId: 'main', analysisOutdated: false });

        // The effects are written through the writer of the runtime
        await runtime.storage({ kind: 'flush' });
        expect(storage.scripts.get('w')).toEqual(new Map([['alpha.sql', 'create table t (x int)'], ['beta.sql', 'select x from t']]));
        expect(storage.workbooks.get('w')).toMatchObject({ name: 'Sales' });

        // A failed action leaves the workbook as it was
        expect(runtime.dispatch({ workbook: 'w' }, { kind: 'setScriptText', value: { scriptKey: 999, text: 'x' } }).changed).toBe(false);
        expect(runtime.dispatch({ workbook: 'gone' }, { kind: 'deleteScript', value: { fileName: 'alpha.sql' } }).ok).toBe(false);

        // The derived view checks the references and derives the dataflow and the inputs
        const derived = viewOf(runtime, 'workbookDerived', 'w')!;
        expect(derived.scriptKeys).toEqual([alpha, beta]);
        const dataflow = dashql.readFlatBuffer(derived.dataflow, bb => dashql.buffers.execution.SessionDataflow.getRootAsSessionDataflow(bb));
        expect(dataflow.scriptsLength()).toBe(2);
        runtime.destroy();
        runtime.free();
    });

    it('take a keystroke as the change of the script only', () => {
        const { runtime } = createRuntime();
        runtime.dispatch('app', { kind: 'createWorkbook', value: { workbookId: 'w', connectionId: 'main' } });
        runtime.dispatch({ workbook: 'w' }, { kind: 'createScript', value: { text: 'select 1', base: 'alpha' } });
        runtime.dispatch({ workbook: 'w' }, { kind: 'createScript', value: { text: 'select 2', base: 'beta' } });
        const [alpha] = viewOf(runtime, 'workbook', 'w')!.scriptKeys;
        runtime.takeChanges();

        type(runtime, 'w', alpha, 8, '0');
        expect(changesOf(runtime)).toEqual([`script:${alpha}`, 'workbookDerived:w']);
        expect(dql!.runtimeScriptSession(runtime, alpha)!.getText()).toBe('select 10');
        // An update of a stale session is dropped
        expect(runtime.reportEditorUpdate('w', alpha, 0, new Uint8Array(), false)).toBe(false);
        runtime.destroy();
        runtime.free();
    });

    it('cross the payloads of a script as FlatBuffers once per key', () => {
        const { runtime } = createRuntime();
        runtime.dispatch('app', { kind: 'createWorkbook', value: { workbookId: 'w', connectionId: 'main' } });
        runtime.dispatch({ workbook: 'w' }, { kind: 'createScript', value: { text: 'select 1 as x', base: 'alpha' } });
        const [key] = viewOf(runtime, 'workbook', 'w')!.scriptKeys;
        const updates = new dashql.FlatBufferCache(bb => dashql.buffers.editor.EditorUpdate.getRootAsEditorUpdate(bb));
        const known = (editorUpdate: string | null): dashql.WorkbookScriptKeys => ({ ...NONE, editorUpdate });

        // The first read carries the update, the accessors read the bytes of the view
        const view = viewOf(runtime, 'script', key, [known(updates.known(key))])!;
        expect(view.editorUpdate).toBeInstanceOf(Uint8Array);
        const update = updates.read(key, view.editorUpdateKey, view.editorUpdate)!;
        expect(update.analysisAvailable()).toBe(true);
        expect(update.bb!.bytes()).toBe(view.editorUpdate);
        // The same key leaves the bytes out and keeps the accessor object
        const again = viewOf(runtime, 'script', key, [known(updates.known(key))])!;
        expect(again.editorUpdate).toBeNull();
        expect(updates.read(key, again.editorUpdateKey, again.editorUpdate)).toBe(update);

        // A cache that hydrates reads the object API once per key, a held payload is the one of its key
        const hydrated = new dashql.FlatBufferCache(bb => dashql.buffers.editor.EditorUpdate.getRootAsEditorUpdate(bb), table => table.unpack());
        const unpacked = hydrated.read(key, view.editorUpdateKey, viewOf(runtime, 'script', key, [NONE])!.editorUpdate)!;
        expect(dashql.editorUpdateKey(unpacked)).toBe(view.editorUpdateKey);
        const holding = new dashql.buffers.editor.EditorUpdateT();
        hydrated.hold(key, view.editorUpdateKey!, holding);
        expect(hydrated.read(key, view.editorUpdateKey, null)).toBe(holding);

        // Every payload of a script, the known keys leave their bytes out
        runtime.dispatch({ workbook: 'w' }, { kind: 'setScriptVisSpec', value: { scriptKey: key, spec: '{"mark":"bar"}' } });
        const staged = viewOf(runtime, 'script', key, [NONE])!;
        expect(staged.pendingDiff?.priorText).toBe('select 1 as x');
        expect(staged.visualization?.visualization).toBeInstanceOf(Uint8Array);
        const newest = staged.statistics[staged.statistics.length - 1].key;
        const held = viewOf(runtime, 'script', key, [{ editorUpdate: staged.editorUpdateKey, pendingDiff: staged.pendingDiff!.key, visualization: staged.visualization!.key, statistics: newest }])!;
        expect(held.editorUpdate).toBeNull();
        expect(held.pendingDiff).toEqual({ ...staged.pendingDiff, diff: null });
        expect(held.visualization).toEqual({ ...staged.visualization, visualization: null });
        expect(dashql.scriptDiffBuffer(dql!, staged.pendingDiff!.diff!).read().opsLength()).toBeGreaterThan(0);
        runtime.dispatch({ workbook: 'w' }, { kind: 'rejectPendingDiff', value: { scriptKey: key } });
        expect(viewOf(runtime, 'script', key, [NONE])!.pendingDiff).toBeNull();
        runtime.destroy();
        runtime.free();
    });

    it('promote the ephemeral workbook with its first script', () => {
        const { runtime } = createRuntime();
        runtime.dispatch('app', { kind: 'createWorkbook', value: { workbookId: 'a', connectionId: 'main', name: 'Untitled' } });
        runtime.dispatch('app', { kind: 'createWorkbook', value: { workbookId: 'e', connectionId: 'main', name: 'New Workbook', ephemeral: true } });
        expect(viewOf(runtime, 'workbookList', 'root')!.workbooks.map(w => [w.workbookId, w.ephemeral])).toEqual([['a', false], ['e', true]]);
        runtime.dispatch({ workbook: 'e' }, { kind: 'createScript', value: { text: 'select 1', base: 'alpha' } });
        expect(viewOf(runtime, 'workbook', 'e')).toMatchObject({ ephemeral: false, name: 'Untitled 2' });
        runtime.destroy();
        runtime.free();
    });

    it('restore the workbooks that the runtime wrote', async () => {
        const first = createRuntime(undefined, CONNECTION);
        first.runtime.dispatch('app', { kind: 'createWorkbook', value: { workbookId: WB, connectionId: CONNECTION, name: 'Sales' } });
        first.runtime.dispatch({ workbook: WB }, { kind: 'createScript', value: { text: 'select 1', base: 'alpha' } });
        await first.runtime.storage({ kind: 'flush' });
        first.runtime.destroy();
        first.runtime.free();

        const second = createRuntime(first.storage, null);
        const progress: dashql.RestoreProgress[] = [];
        const outcome = await second.runtime.restore(update => progress.push(update));
        expect(outcome.workbookIds).toEqual([WB]);
        expect(outcome.connectionIds).toEqual([CONNECTION]);
        expect(outcome.invalidWorkbooks).toEqual([]);
        expect(progress.length).toBeGreaterThan(0);
        const workbook = viewOf(second.runtime, 'workbook', WB)!;
        expect(workbook).toMatchObject({ name: 'Sales', scriptOrder: ['alpha.sql'] });
        expect(dql!.runtimeScriptSession(second.runtime, workbook.scriptKeys[0])!.getText()).toBe('select 1');
        await expect(second.runtime.restoreWorkbook('gone')).rejects.toThrow();
        second.runtime.destroy();
        second.runtime.free();
    });
});
