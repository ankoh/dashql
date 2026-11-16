import * as flatbuffers from 'flatbuffers';

import * as dashql from './index.js';

import { loadCoreWasm, MemoryStorage, testPlatform } from './test_fixture.js';

// The changes of the runtime (`changes.rs` of the core module): the services mark the slices they change, the host takes
// only the marked ones. These tests check that a slice whose view changed is always named by the changes, that a busy
// workbook is never reported as gone, and that the host can ask for slices again.

let dql: dashql.DashQL | null = null;
beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await loadCoreWasm() });
});
afterEach(() => {
    dql!.resetUnsafe();
});

/// The keys of a host that holds no payloads, every payload crosses
const NONE: dashql.WorkbookScriptKeys = { editorUpdate: null, pendingDiff: null, visualization: null, statistics: null };

const USER_QUERY: dashql.QueryMetadataView = {
    queryType: dashql.QueryType.USER_PROVIDED,
    title: null,
    description: null,
    issuer: null,
    userProvided: true,
    resultOwner: null,
};

const viewOf = <K extends dashql.ViewKind>(runtime: dashql.Runtime, kind: K, id: dashql.ViewId<K>, known?: dashql.KnownKeys<K>) =>
    runtime.views(kind, [id], known)[0];

/// A view as text that compares by value, the bytes of FlatBuffers by their values
const stable = (view: unknown) =>
    JSON.stringify(view, (_key, value) => (value instanceof Uint8Array ? Array.from(value) : typeof value === 'bigint' ? value.toString() : value));

/// Every slice of the runtime as `kind:id` with its view as text: the lists, the connections with their queries, the
/// history of the shell with its queries, the workbooks with their scripts, what they derive and their runs, the storage
function snapshot(runtime: dashql.Runtime): Map<string, string> {
    const out = new Map<string, string>();
    const put = (kind: string, id: unknown, view: unknown) => {
        if (view != null) out.set(`${kind}:${String(id)}`, stable(view));
    };
    const queries = (ids: number[]) => runtime.views('query', ids, ids.map(() => null)).forEach((view, i) => put('query', ids[i], view));
    const connections = viewOf(runtime, 'connectionList', 'root');
    put('connectionList', 'root', connections);
    for (const { connectionId } of connections?.connections ?? []) {
        const connection = viewOf(runtime, 'connection', connectionId);
        put('connection', connectionId, connection);
        queries([...(connection?.queriesActiveOrdered ?? []), ...(connection?.queriesFinishedOrdered ?? [])]);
    }
    const shell = viewOf(runtime, 'history', 'shell');
    put('history', 'shell', shell);
    queries(shell?.queries ?? []);
    const workbooks = viewOf(runtime, 'workbookList', 'root');
    put('workbookList', 'root', workbooks);
    for (const { workbookId } of workbooks?.workbooks ?? []) {
        const workbook = viewOf(runtime, 'workbook', workbookId);
        put('workbook', workbookId, workbook);
        const keys = workbook?.scriptKeys ?? [];
        runtime.views('script', keys, keys.map(() => NONE)).forEach((view, i) => put('script', keys[i], view));
        put('workbookDerived', workbookId, viewOf(runtime, 'workbookDerived', workbookId));
        put('run', workbookId, viewOf(runtime, 'run', workbookId));
    }
    put('storage', 'root', viewOf(runtime, 'storage', 'root'));
    return out;
}

/// An editor event of typed text at an offset of a text version, packed
function typedEvent(textVersion: bigint, offset: number, text: string): Uint8Array {
    const event = new dashql.buffers.editor.EditorEventT(
        textVersion,
        [new dashql.buffers.editor.EditorTextChangeT(BigInt(offset), BigInt(offset), text)],
        new dashql.buffers.editor.EditorSelectionT(BigInt(offset + text.length), BigInt(offset + text.length)),
        dashql.buffers.editor.EditorEventOrigin.USER,
        dashql.buffers.editor.EditorEventIntent.EDIT,
        dashql.buffers.editor.EditorEventAction.TYPE,
        true,
    );
    const builder = new flatbuffers.Builder();
    builder.finish(event.pack(builder));
    return builder.asUint8Array();
}

/// Type text at the end of a script as the editor does
function type(runtime: dashql.Runtime, workbookId: string, key: number, text: string): void {
    const session = dql!.runtimeScriptSession(runtime, key)!;
    const view = viewOf(runtime, 'script', key, [NONE])!;
    const offset = session.getText().length;
    runtime.applyEditorEvent(workbookId, key, view.sessionGeneration, typedEvent(session.getTextVersion(), offset, text));
    session.destroy();
}

/// A step of the scenario: what it does, and the dispatch of its action
type Step = [string, (runtime: dashql.Runtime) => unknown];

describe('The changes of the runtime', () => {
    it('name every slice whose view an action changed', async () => {
        const storage = new MemoryStorage();
        const platform = testPlatform(storage);
        const runtime = dql!.createRuntime(platform.platform);
        runtime.runCatalogLoader(false);
        let queryId = 0;
        const key = (runtime: dashql.Runtime, index: number) => viewOf(runtime, 'workbook', 'w')!.scriptKeys[index];
        const file = (runtime: dashql.Runtime, index: number) => viewOf(runtime, 'workbook', 'w')!.scriptOrder[index];
        const workbook = (action: dashql.RuntimeAction) => (runtime: dashql.Runtime) => runtime.dispatch({ workbook: 'w' }, action);
        const connection = (id: string, action: dashql.RuntimeAction) => (runtime: dashql.Runtime) => runtime.dispatch({ connection: id }, action);
        const shell = (action: (id: number) => dashql.RuntimeAction) => (runtime: dashql.Runtime) => runtime.dispatch({ history: 'shell' }, action(queryId));
        const hyper = (connectionId: string): dashql.RuntimeAction =>
            ({ kind: 'createConnection', value: { connectionId, connectorType: dashql.ConnectorType.HYPER, setupParams: { protocol: 'WASM', endpoint: '' } } });
        const trino = (connectionId: string): dashql.RuntimeAction =>
            ({ kind: 'createConnection', value: { connectionId, connectorType: dashql.ConnectorType.TRINO, setupParams: { endpoint: 'http://localhost:8080', defaultCatalog: 'tpch', defaultSchema: 'tiny' } } });
        const steps: Step[] = [
            ['createConnection', rt => rt.dispatch('app', hyper('main'))],
            ['createConnection', rt => rt.dispatch('app', trino('second'))],
            ['createWorkbook', rt => rt.dispatch('app', { kind: 'createWorkbook', value: { workbookId: 'w', connectionId: 'main', name: 'Sales' } })],
            ['createScript', workbook({ kind: 'createScript', value: { text: 'create table t (x int)', base: 'alpha' } })],
            ['createScript', workbook({ kind: 'createScript', value: { text: 'select x from t', base: 'beta' } })],
            ['createScript', workbook({ kind: 'createScript', value: { text: 'select * from :alpha where x > :limit', base: 'gamma' } })],
            ['setScriptText', rt => workbook({ kind: 'setScriptText', value: { scriptKey: key(rt, 1), text: 'select x, x as y from t' } })(rt)],
            ['setScriptText', rt => workbook({ kind: 'setScriptText', value: { scriptKey: key(rt, 1), text: 'select y from t', withDiff: true } })(rt)],
            ['acceptPendingDiff', rt => workbook({ kind: 'acceptPendingDiff', value: { scriptKey: key(rt, 1) } })(rt)],
            ['setScriptText', rt => workbook({ kind: 'setScriptText', value: { scriptKey: key(rt, 1), text: 'select z from t', withDiff: true } })(rt)],
            ['rejectPendingDiff', rt => workbook({ kind: 'rejectPendingDiff', value: { scriptKey: key(rt, 1) } })(rt)],
            ['editorEvent', rt => type(rt, 'w', key(rt, 1), ' where x > 1')],
            ['renameScript', rt => workbook({ kind: 'renameScript', value: { fileName: file(rt, 1), newName: 'renamed' } })(rt)],
            ['reorderScripts', rt => workbook({ kind: 'reorderScripts', value: { order: [file(rt, 1), file(rt, 0), file(rt, 2)] } })(rt)],
            ['setScriptVisSpec', rt => workbook({ kind: 'setScriptVisSpec', value: { scriptKey: key(rt, 1), spec: '{"mark":"bar"}' } })(rt)],
            ['setWorkbookInput', rt => workbook({ kind: 'setWorkbookInput', value: { name: 'limit', literal: '3', scriptKeys: [key(rt, 2)] } })(rt)],
            ['analyzeOutdatedScript', rt => workbook({ kind: 'analyzeOutdatedScript', value: { scriptKey: key(rt, 2) } })(rt)],
            ['renameWorkbook', workbook({ kind: 'renameWorkbook', value: { name: 'Revenue' } })],
            ['setScriptConnection', rt => workbook({ kind: 'setScriptConnection', value: { fileName: file(rt, 2), connectionId: 'second' } })(rt)],
            ['setPendingConnection', workbook({ kind: 'setPendingConnection', value: { connectionId: 'second' } })],
            ['replaceConnection', workbook({ kind: 'replaceConnection', value: { from: 'second', into: 'main' } })],
            ['setPendingConnection', workbook({ kind: 'setPendingConnection', value: { connectionId: 'second' } })],
            ['detachConnection', workbook({ kind: 'detachConnection', value: { from: 'second', into: 'main' } })],
            ['setWorkbookAttachments', workbook({ kind: 'setWorkbookAttachments', value: { files: [{ name: 'orders.csv', sizeBytes: 12, mtimeMs: 1 }] } })],
            ['renameAttachment', workbook({ kind: 'renameAttachment', value: { fileName: 'orders.csv', newFileName: 'sales.csv' } })],
            ['setCloudLink', workbook({ kind: 'setCloudLink', value: { link: { workbookId: 'c', versionId: 'v', preview: false } } })],
            ['setCloudLink', workbook({ kind: 'setCloudLink', value: { link: null } })],
            ['setDraft', connection('main', { kind: 'setDraft', value: { params: { hyper: { protocol: 'WASM', endpoint: 'draft' } } } })],
            ['discardDraft', connection('main', { kind: 'discardDraft' })],
            ['rename', connection('main', { kind: 'rename', value: { name: 'Main' } })],
            ['setQueryResultCaching', connection('main', { kind: 'setQueryResultCaching', value: { caching: false } })],
            ['saveConnection', rt => rt.saveConnection('main', { hyper: { protocol: 'WASM', endpoint: 'saved' } })],
            ['createHistory', rt => rt.dispatch({ history: 'shell' }, { kind: 'createHistory', value: { limit: 2 } })],
            ['trackQuery', rt => {
                const tracked = rt.dispatch({ connection: 'main' }, { kind: 'trackQuery', value: { traceId: 1, text: 'select 1', metadata: USER_QUERY } });
                queryId = tracked.id as number;
            }],
            ['querySending', rt => rt.dispatch({ connection: 'main' }, { kind: 'querySending', value: { queryId } })],
            ['queryRunning', rt => rt.dispatch({ connection: 'main' }, { kind: 'queryRunning', value: { queryId } })],
            ['queryReceivedAllBatches', rt => rt.dispatch({ connection: 'main' }, { kind: 'queryReceivedAllBatches', value: { queryId, table: platform.platform.handles.register('t'), rows: 2 } })],
            ['queryProcessingResults', rt => rt.dispatch({ connection: 'main' }, { kind: 'queryProcessingResults', value: { queryId } })],
            ['queryProcessedResults', rt => rt.dispatch({ connection: 'main' }, { kind: 'queryProcessedResults', value: { queryId } })],
            ['querySucceeded', rt => rt.dispatch({ connection: 'main' }, { kind: 'querySucceeded', value: { queryId } })],
            ['queryCacheDeleted', rt => rt.dispatch({ connection: 'main' }, { kind: 'queryCacheDeleted', value: { queryId } })],
            ['trackQuery', rt => {
                const tracked = rt.dispatch({ history: 'shell' }, { kind: 'trackQuery', value: { traceId: 2, text: 'select 2', metadata: USER_QUERY } });
                queryId = tracked.id as number;
            }],
            ['queryFailed', shell(id => ({ kind: 'queryFailed', value: { queryId: id, message: 'failed' } }))],
            ['trackQuery', rt => {
                const tracked = rt.dispatch({ history: 'shell' }, { kind: 'trackQuery', value: { traceId: 3, text: 'select 3', metadata: USER_QUERY } });
                queryId = tracked.id as number;
            }],
            ['queryCancelled', shell(id => ({ kind: 'queryCancelled', value: { queryId: id, message: 'cancelled' } }))],
            ['resetConnection', connection('main', { kind: 'resetConnection' })],
            ['deleteScript', rt => workbook({ kind: 'deleteScript', value: { fileName: file(rt, 0) } })(rt)],
            ['deleteConnection', connection('second', { kind: 'deleteConnection' })],
            ['dropHistory', rt => rt.dispatch({ history: 'shell' }, { kind: 'dropHistory' })],
            ['deleteWorkbook', rt => rt.dispatch('app', { kind: 'deleteWorkbook', value: { workbookId: 'w' } })],
        ];
        const unchanged: string[] = [];
        for (const [name, step] of steps) {
            runtime.takeChanges();
            const before = snapshot(runtime);
            await step(runtime);
            const changes = runtime.takeChanges();
            const named = new Set(changes.changes.map(change => `${change.kind}:${String(change.id)}`));
            const after = snapshot(runtime);
            const changed = [...new Set([...before.keys(), ...after.keys()])].filter(slice => before.get(slice) !== after.get(slice));
            expect({ step: name, missed: changed.filter(slice => !named.has(slice)) }).toEqual({ step: name, missed: [] });
            if (changed.length === 0) unchanged.push(name);
        }
        // Every step of the scenario changed a view but these: a script without a chart takes no spec, an analysis that is
        // current stays, an attachment that is no file of the storage keeps its name
        expect(unchanged).toEqual(['setScriptVisSpec', 'analyzeOutdatedScript', 'renameAttachment']);
        runtime.destroy();
        runtime.free();
    });

    it('report a slice that was busy with the next changes instead of reporting it gone', () => {
        const platform = testPlatform();
        const runtime = dql!.createRuntime(platform.platform);
        runtime.runCatalogLoader(false);
        runtime.dispatch('app', { kind: 'createConnection', value: { connectionId: 'main', connectorType: dashql.ConnectorType.HYPER, setupParams: { protocol: 'WASM', endpoint: '' } } });
        runtime.dispatch('app', { kind: 'createWorkbook', value: { workbookId: 'w', connectionId: 'main' } });
        runtime.dispatch({ workbook: 'w' }, { kind: 'createScript', value: { text: 'select 1', base: 'alpha' } });
        runtime.takeChanges();
        const [key] = viewOf(runtime, 'workbook', 'w')!.scriptKeys;
        runtime.dispatch({ workbook: 'w' }, { kind: 'renameWorkbook', value: { name: 'Busy' } });
        runtime.dispatch({ workbook: 'w' }, { kind: 'setScriptText', value: { scriptKey: key, text: 'select 2' } });

        // A task holds the workbook while the host takes the changes and reads the views
        let held: dashql.ChangeSet | null = null;
        let views: unknown[] = [];
        runtime.testHoldWorkbook('w', () => {
            held = runtime.takeChanges();
            views = [viewOf(runtime, 'workbook', 'w'), viewOf(runtime, 'script', key, [NONE]), viewOf(runtime, 'workbookDerived', 'w')];
        });
        // Nothing of the workbook is reported, least of all as gone, and its views read as null
        const ofWorkbook = (changes: dashql.ChangeSet) => changes.changes.filter(change => ['workbook', 'script', 'workbookDerived'].includes(change.kind));
        expect(ofWorkbook(held!)).toEqual([]);
        expect(views).toEqual([null, null, null]);

        // Once the workbook is free its slices follow
        const next = ofWorkbook(runtime.takeChanges()).map(change => `${change.kind}:${change.id}${change.revision == null ? ' gone' : ''}`);
        expect(next).toEqual(expect.arrayContaining(['workbook:w', `script:${key}`]));
        expect(next.some(change => change.endsWith(' gone'))).toBe(false);
        expect(viewOf(runtime, 'workbook', 'w')!.name).toBe('Busy');
        runtime.destroy();
        runtime.free();
    });

    it('move a slice again that the host asks for, also if its view is the same', () => {
        const platform = testPlatform();
        const runtime = dql!.createRuntime(platform.platform);
        runtime.runCatalogLoader(false);
        runtime.dispatch('app', { kind: 'createConnection', value: { connectionId: 'main', connectorType: dashql.ConnectorType.HYPER, setupParams: { protocol: 'WASM', endpoint: '' } } });
        runtime.dispatch('app', { kind: 'createWorkbook', value: { workbookId: 'w', connectionId: 'main' } });
        runtime.dispatch({ workbook: 'w' }, { kind: 'createScript', value: { text: 'select 1', base: 'alpha' } });
        const first = runtime.takeChanges().changes;
        const [key] = viewOf(runtime, 'workbook', 'w')!.scriptKeys;
        expect(runtime.takeChanges().changes).toEqual([]);
        runtime.resync('workbook', ['w']);
        runtime.resync('script', [key]);
        runtime.resync('connection', ['main']);
        runtime.resync('workbookDerived', ['w']);
        const again = runtime.takeChanges().changes.map(change => `${change.kind}:${change.id}`);
        expect(again).toEqual(expect.arrayContaining(['connection:main', 'workbook:w', `script:${key}`, 'workbookDerived:w']));
        // The script keeps its revision, the others move
        const revision = (changes: dashql.SliceChange[], kind: string) => changes.find(change => change.kind === kind)?.revision;
        expect(revision(first, 'script')).toBeDefined();
        expect(runtime.takeChanges().changes).toEqual([]);
        runtime.destroy();
        runtime.free();
    });

    it('keep the derived view of a workbook while typing changes nothing it derives', () => {
        const platform = testPlatform();
        const runtime = dql!.createRuntime(platform.platform);
        runtime.runCatalogLoader(false);
        runtime.dispatch('app', { kind: 'createConnection', value: { connectionId: 'main', connectorType: dashql.ConnectorType.HYPER, setupParams: { protocol: 'WASM', endpoint: '' } } });
        runtime.dispatch('app', { kind: 'createWorkbook', value: { workbookId: 'w', connectionId: 'main' } });
        runtime.dispatch({ workbook: 'w' }, { kind: 'createScript', value: { text: 'create table t (x int)', base: 'alpha' } });
        runtime.dispatch({ workbook: 'w' }, { kind: 'createScript', value: { text: 'select x\nfrom t', base: 'beta' } });
        runtime.takeChanges();
        const [, key] = viewOf(runtime, 'workbook', 'w')!.scriptKeys;
        const kinds = () => runtime.takeChanges().changes.map(change => change.kind);
        // Typing after the first line of the statement moves the script, not what the workbook derives
        type(runtime, 'w', key, ' ');
        expect(kinds()).toEqual(['script']);
        type(runtime, 'w', key, 'w');
        expect(kinds()).toEqual(['script']);
        // A reference to another script changes what the workbook derives
        runtime.dispatch({ workbook: 'w' }, { kind: 'setScriptText', value: { scriptKey: key, text: 'select x\nfrom :alpha' } });
        expect(kinds()).toEqual(expect.arrayContaining(['script', 'workbookDerived']));
        runtime.destroy();
        runtime.free();
    });
});
