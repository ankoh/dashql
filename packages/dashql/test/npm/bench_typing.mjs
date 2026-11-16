// The typing benchmark of the runtime (docs/design/dashql_runtime.md, "The typing benchmark").
//
// A script of 40 lines is typed character by character next to two other scripts, and again next to 19 other scripts
// (tables, queries over them and scripts that read other scripts as table parameters) so that costs per script show.
// Every keystroke goes the way of the editor: the editor packs the event, the runtime applies it to the session of the
// script and returns the update (`applyEditorEvent`), the store of the host takes the changes and reads the view of the
// typed script with the newest processing statistics. The typing pauses at the end of every line: the runtime derives
// the workbook again, the store takes the changes and reads the derived view of the workbook when it moved. Prints the
// 10th percentile and the median of every step in microseconds.
//
//   bazel run --config=release //packages/dashql:bench_typing [-- --passes=3]
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import * as flatbuffers from 'flatbuffers';
import * as core from '../../npm_package/dist/core/index.js';

const passes = Number(process.argv.find(arg => arg.startsWith('--passes='))?.slice('--passes='.length) ?? 3);
const buffers = core.buffers;
/// The pause of the typing at the end of a line, longer than the one after which the runtime derives the workbook
const TYPING_PAUSE_MS = 200;

/// The two scripts next to the typed one
const FEW_SCRIPTS = [
    ['lineitem', 'create table if not exists lineitem (l_orderkey integer, l_partkey integer, l_suppkey integer, l_quantity decimal(15,2), l_extendedprice decimal(15,2), l_discount decimal(15,2), l_tax decimal(15,2), l_returnflag text, l_linestatus text, l_shipdate date)'],
    ['orders', 'create table if not exists orders (o_orderkey integer, o_custkey integer, o_orderstatus text, o_totalprice decimal(15,2), o_orderdate date, o_orderpriority text)'],
];

/// 19 scripts next to the typed one: the two above, tables, queries over them and scripts that read other scripts
function manyScripts() {
    const scripts = [...FEW_SCRIPTS];
    for (let i = 0; i < 6; ++i) {
        scripts.push([`t${i}`, `create table if not exists t${i} (k integer, v${i} decimal(15,2), name text, d date)`]);
    }
    for (let i = 0; i < 6; ++i) {
        scripts.push([`q${i}`, `select k, sum(v${i}) as total, count(*) as n\nfrom t${i}\nwhere d >= date '1994-01-01'\ngroup by k\norder by k`]);
    }
    for (let i = 0; scripts.length < 19; ++i) {
        scripts.push([`r${i}`, `select a.k, a.total, b.n\nfrom :q${i} a join :q${i + 1} b on a.k = b.k\nwhere a.total > ${i * 10}`]);
    }
    return scripts;
}

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

const wasm = new Uint8Array(await readFile(new URL('../../npm_package/dist/wasm/dashql_core.wasm', import.meta.url)));
const dql = await core.DashQL.create({ wasmBinary: wasm });
const text = typedScript();
for (const [title, others] of [['3 scripts', FEW_SCRIPTS], ['20 scripts', manyScripts()]]) {
    const event = [], flush = [], derive = [], total = [];
    for (let pass = 0; pass < passes; ++pass) {
        const runtime = dql.createRuntime(platform());
        runtime.runCatalogLoader(false);
        runtime.dispatch('app', { kind: 'createConnection', value: { connectionId: 'main', connectorType: core.ConnectorType.HYPER, setupParams: { protocol: 'WASM', endpoint: '' } } });
        const workbookId = runtime.dispatch('app', { kind: 'createWorkbook', value: { connectionId: 'main' } }).id;
        for (const [base, sql] of others) runtime.dispatch({ workbook: workbookId }, { kind: 'createScript', value: { text: sql, base } });
        runtime.dispatch({ workbook: workbookId }, { kind: 'createScript', value: { text: '', base: 'typed' } });
        const key = runtime.views('workbook', [workbookId])[0].scriptKeys[others.length];
        runtime.takeChanges();
        let view = runtime.views('script', [key], [null])[0];
        // The editor shows the text of the session and holds no analysis of the empty script
        const session = dql.runtimeScriptSession(runtime, key);
        let shown = session.getTextVersion();
        session.destroy();
        let held = null;
        let heldKey = null;
        for (let i = 0; i < text.length; ++i) {
            const t0 = performance.now();
            // The editor packs the event with the text version it shows, it names the update it holds by its key
            const typed = new buffers.editor.EditorEventT(
                shown,
                [new buffers.editor.EditorTextChangeT(BigInt(i), BigInt(i), text[i])],
                new buffers.editor.EditorSelectionT(BigInt(i + 1), BigInt(i + 1)),
                buffers.editor.EditorEventOrigin.USER, buffers.editor.EditorEventIntent.EDIT, buffers.editor.EditorEventAction.TYPE, true,
            );
            const builder = new flatbuffers.Builder();
            builder.finish(typed.pack(builder));
            const outcome = runtime.applyEditorEvent(workbookId, key, view.sessionGeneration, builder.asUint8Array(), heldKey);
            const update = core.readFlatBuffer(outcome.update, bb => buffers.editor.EditorUpdate.getRootAsEditorUpdate(bb)).unpack();
            if (update.status !== buffers.editor.EditorUpdateStatus.OK) throw new Error(`the keystroke failed: ${update.statusMessage}`);
            if (update.analysisOmitted && held != null) {
                update.diagnostics = held.diagnostics; update.syntaxSpans = held.syntaxSpans; update.semanticSpans = held.semanticSpans;
                update.scriptAnnotations = held.scriptAnnotations; update.processingStatistics = held.processingStatistics;
            }
            held = update;
            heldKey = outcome.key;
            shown = update.textVersion;
            const t1 = performance.now();
            // The store takes the changes and reads the view of the script, the editor update is the one it holds
            const changes = runtime.takeChanges().changes;
            const statistics = view.statistics;
            const known = {
                editorUpdate: heldKey,
                pendingDiff: null,
                visualization: null,
                statistics: statistics.length > 0 ? statistics[statistics.length - 1].key : null,
            };
            view = runtime.views('script', [key], [known])[0];
            for (const entry of view.statistics) {
                if (entry.statistics != null) core.readFlatBuffer(entry.statistics, bb => buffers.editor.EditorProcessingStatistics.getRootAsEditorProcessingStatistics(bb)).unpack();
            }
            const t2 = performance.now();
            event.push(t1 - t0); flush.push(t2 - t1); total.push(t2 - t0);
            // The typing pauses at the end of a line, the runtime derives the workbook again: the store takes the
            // changes and reads the derived view when it moved, its buffers read
            if (text[i] === '\n') {
                await new Promise(resolve => setTimeout(resolve, TYPING_PAUSE_MS));
                const t3 = performance.now();
                const paused = runtime.takeChanges().changes;
                if (paused.some(change => change.kind === 'workbookDerived')) {
                    const derived = runtime.views('workbookDerived', [workbookId])[0];
                    core.readFlatBuffer(derived.references, bb => buffers.execution.ScriptReferenceCheck.getRootAsScriptReferenceCheck(bb)).unpack();
                    core.readFlatBuffer(derived.dataflow, bb => buffers.execution.SessionDataflow.getRootAsSessionDataflow(bb)).unpack();
                    core.readFlatBuffer(derived.inputs, bb => buffers.execution.SessionInputs.getRootAsSessionInputs(bb)).unpack();
                }
                derive.push(performance.now() - t3);
            }
        }
        await runtime.storage({ kind: 'flush' });
        runtime.free();
    }
    const rows = [
        ['The runtime applies the event of the editor', event],
        ['The flush: the changes and the view of the script', flush],
        ['The flush after a pause: what the workbook derives', derive],
        ['The keystroke in total', total],
    ];
    console.log(title);
    for (const [label, samples] of rows) {
        const { p10, p50, n } = percentiles(samples);
        console.log(`${label.padEnd(52)} p10 ${p10.toFixed(1).padStart(7)} us  p50 ${p50.toFixed(1).padStart(7)} us  (${n})`);
    }
}
