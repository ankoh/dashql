// The typing benchmark of the runtime (docs/wip/core_runtime.md, "Typing").
//
// A script of 40 lines is typed character by character next to two other scripts, the way the editor does it: the
// editor applies the event to the shared session of the script and reports the update to the runtime
// (`reportEditorUpdate`), the store of the host takes the changes and reads the view of the typed script with the newest
// processing statistics, and reads the derived view of the workbook when it moved. Prints the 10th percentile and the
// median of every step per keystroke in microseconds.
//
//   bazel run --config=release //packages/dashql-core-js:bench_typing [-- --passes=3]
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import * as flatbuffers from 'flatbuffers';
import * as core from '../npm_package/dist/index.js';

const passes = Number(process.argv.find(arg => arg.startsWith('--passes='))?.slice('--passes='.length) ?? 3);
const buffers = core.buffers;

/// The two scripts next to the typed one
const OTHER_SCRIPTS = [
    ['lineitem', 'create table if not exists lineitem (l_orderkey integer, l_partkey integer, l_suppkey integer, l_quantity decimal(15,2), l_extendedprice decimal(15,2), l_discount decimal(15,2), l_tax decimal(15,2), l_returnflag text, l_linestatus text, l_shipdate date)'],
    ['orders', 'create table if not exists orders (o_orderkey integer, o_custkey integer, o_orderstatus text, o_totalprice decimal(15,2), o_orderdate date, o_orderpriority text)'],
];

/// The typed script, 40 lines
function typedScript() {
    const lines = ['select', '    l_returnflag,', '    l_linestatus,'];
    for (let i = 0; lines.length < 32; ++i) {
        lines.push(`    sum(l_extendedprice * (1 - l_discount) * (1 + l_tax)) filter (where l_quantity > ${i * 3}) as revenue_with_tax_above_${i},`);
    }
    lines.push('    count(*) as count_order');
    lines.push('from lineitem, orders');
    lines.push('where l_orderkey = o_orderkey');
    lines.push("    and l_shipdate <= date '1998-12-01' - interval '90' day");
    lines.push("    and o_orderdate >= date '1994-01-01' and o_orderpriority <> '5-LOW'");
    lines.push('group by l_returnflag, l_linestatus');
    lines.push('order by l_returnflag, l_linestatus');
    lines.push('limit 100');
    return lines.join('\n');
}

/// A storage that keeps nothing
const storage = {
    loadWorkbook: async () => { throw new Error('no workbook'); },
    saveWorkbook: async () => { }, saveScript: async () => { }, deleteScript: async () => { }, renameScript: async () => { },
    listAttachments: async () => [], updateConnections: async () => { }, saveConnectionFile: async () => { },
    deleteConnectionFiles: async () => { }, deleteWorkbook: async () => { }, ownsConnections: () => false,
    listWorkbooks: async () => [], loadManifestConnections: async () => null, loadScripts: async () => [],
    listDataFiles: async () => [], loadConnectionFile: async () => null,
};

/// The platform of the benchmark: the handle table, timers and the storage, no other I/O
function platform() {
    const objects = new Map();
    let next = 1;
    let uuid = 0;
    const none = () => { throw new Error('none'); };
    return {
        clock: { now: () => Date.now(), sleep: ms => new Promise(resolve => setTimeout(resolve, ms)) },
        log: () => { },
        handles: {
            register: object => { objects.set(next, object); return next++; },
            release: handle => { objects.delete(handle); },
            get: handle => objects.get(handle),
            duplicate: handle => { objects.set(next, objects.get(handle)); return next++; },
        },
        tables: { begin: none, append: none, finish: none, read: none, open: none, push: none },
        compute: null,
        http: { fetch: none, abort: () => { } },
        channels: { connect: none, hyperLinkToken: () => null, open: none, next: none, cancel: async () => { }, profileDetail: () => { } },
        queries: { describe: none, forget: () => { } },
        resultCache: null,
        crypto: { randomUuid: () => `00000000-0000-4000-8000-${(++uuid).toString().padStart(12, '0')}` },
        oauth: { pkce: none, flowInfo: none, authorizeWithLoopback: none, authorizeWithRedirectPage: none, abort: () => { } },
        extensions: { loadSpec: none },
        salesforce: null,
        storage,
        changed: () => { },
    };
}

/// The p10 and the median of samples in microseconds
function percentiles(samples) {
    const sorted = [...samples].sort((a, b) => a - b);
    const at = p => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] * 1000;
    return { p10: at(0.1), p50: at(0.5), n: sorted.length };
}

const wasm = new Uint8Array(await readFile(new URL('../npm_package/dist/wasm/dashql_core.wasm', import.meta.url)));
const dql = await core.DashQL.create({ wasmBinary: wasm });
const text = typedScript();
const apply = [], report = [], flush = [], derive = [];
for (let pass = 0; pass < passes; ++pass) {
    const runtime = dql.createRuntime(platform());
    runtime.runCatalogLoader(false);
    runtime.dispatch('app', { kind: 'createConnection', value: { connectionId: 'main', connectorType: core.ConnectorType.HYPER, setupParams: { protocol: 'WASM', endpoint: '' } } });
    const workbookId = runtime.dispatch('app', { kind: 'createWorkbook', value: { connectionId: 'main' } }).id;
    for (const [base, sql] of OTHER_SCRIPTS) runtime.dispatch({ workbook: workbookId }, { kind: 'createScript', value: { text: sql, base } });
    runtime.dispatch({ workbook: workbookId }, { kind: 'createScript', value: { text: '', base: 'typed' } });
    const key = runtime.views('workbook', [workbookId])[0].scriptKeys[2];
    runtime.takeChanges();
    const session = dql.runtimeScriptSession(runtime, key);
    let view = runtime.views('script', [key], [null])[0];
    for (let i = 0; i < text.length; ++i) {
        const event = new buffers.editor.EditorEventT(
            session.getTextVersion(),
            [new buffers.editor.EditorTextChangeT(BigInt(i), BigInt(i), text[i])],
            new buffers.editor.EditorSelectionT(BigInt(i + 1), BigInt(i + 1)),
            buffers.editor.EditorEventOrigin.USER, buffers.editor.EditorEventIntent.EDIT, buffers.editor.EditorEventAction.TYPE, true,
        );
        const t0 = performance.now();
        const update = session.apply(event);
        const t1 = performance.now();
        // The editor reports its update, packed
        const builder = new flatbuffers.Builder();
        builder.finish(update.pack(builder));
        runtime.reportEditorUpdate(workbookId, key, view.sessionId, builder.asUint8Array(), false);
        const t2 = performance.now();
        // The store takes the changes and reads the view of the script, the editor update is the one it reported
        const changes = runtime.takeChanges().changes;
        const statistics = view.statistics;
        const known = {
            editorUpdate: core.editorUpdateKey(update),
            pendingDiff: null,
            visualization: null,
            statistics: statistics.length > 0 ? statistics[statistics.length - 1].key : null,
        };
        view = runtime.views('script', [key], [known])[0];
        for (const entry of view.statistics) {
            if (entry.statistics != null) core.readFlatBuffer(entry.statistics, bb => buffers.editor.EditorProcessingStatistics.getRootAsEditorProcessingStatistics(bb)).unpack();
        }
        const t3 = performance.now();
        // The derived view of the workbook when it moved, its buffers read
        if (changes.some(change => change.kind === 'workbookDerived')) {
            const derived = runtime.views('workbookDerived', [workbookId])[0];
            core.readFlatBuffer(derived.references, bb => buffers.execution.ScriptReferenceCheck.getRootAsScriptReferenceCheck(bb)).unpack();
            core.readFlatBuffer(derived.dataflow, bb => buffers.execution.SessionDataflow.getRootAsSessionDataflow(bb)).unpack();
            core.readFlatBuffer(derived.inputs, bb => buffers.execution.SessionInputs.getRootAsSessionInputs(bb)).unpack();
            derive.push(performance.now() - t3);
        }
        apply.push(t1 - t0); report.push(t2 - t1); flush.push(t3 - t2);
    }
    session.destroy();
    await runtime.storage({ kind: 'flush' });
    runtime.destroy();
    runtime.free();
}
const rows = [
    ['The editor applies the event to the session', apply],
    ['The runtime takes the reported update', report],
    ['The flush: the changes and the view of the script', flush],
    ['The update and the flush', report.map((r, i) => r + flush[i])],
    ['The derived view of the workbook when it moved', derive],
];
for (const [label, samples] of rows) {
    const { p10, p50, n } = percentiles(samples);
    console.log(`${label.padEnd(52)} p10 ${p10.toFixed(1).padStart(7)} us  p50 ${p50.toFixed(1).padStart(7)} us  (${n})`);
}
