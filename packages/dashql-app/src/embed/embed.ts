// The embed that other applications frame, e.g. the side panel of a Slack Work Object, see docs/wip/embeds.md.
//
// The first version is a probe: it reports what the frame got (isolation, origin, storage), starts the core in its
// batch worker and the embedded Hyper in its worker, and runs one query in each. Every value is rendered as text. The
// result is also left in a global for the page tests.
//
// Both workers start from blob: URLs and keep nothing in OPFS. In a sandbox without allow-same-origin, Slack's
// default, the page has an opaque origin: a worker from a URL throws, OPFS is denied, and every request to the app is
// cross-origin, so the scripts are fetched or imported with CORS.

import { DashQLBatchWorker } from '@akohn/dashql/browser-worker';
import { stringifyError } from '@akohn/dashql/platform/logger/logger';

import { HyperDB as HyperDBEngine } from 'hyperdb-wasm';
import { HYPERDB_WASM_VERSION } from '../globals.js';

// eslint-disable-next-line import/no-unresolved -- resolved by Vite
import batchWorkerUrl from '@akohn/dashql/batch-worker?worker&url';
// eslint-disable-next-line import/no-unresolved -- package asset resolved by Vite
import hyperEngineUrl from '@dashql/hyperdb-wasm-js?url';
// eslint-disable-next-line import/no-unresolved -- package asset resolved by Vite
import hyperWorkerUrl from '@dashql/hyperdb-wasm-worker?url';
// eslint-disable-next-line import/no-unresolved -- package asset resolved by Bazel/Vite alias
import hyperWasmUrl from '@dashql/hyperdb-wasm?url';

import '@akohn/dashql-react/fonts/fonts.css';
import '@akohn/dashql-react/styles/colors.css';
import '@akohn/dashql-react/styles/tokens.css';
import './embed.css';

const QUERY = 'select count(*) as n, sum(v) as total from generate_series(1, 5000000) as s(v)';

export interface EmbedStep {
    name: string;
    ok: boolean;
    durationMs: number;
    detail: string;
}

export interface EmbedProbe {
    done: boolean;
    environment: Record<string, string>;
    steps: EmbedStep[];
}

declare global {
    var __DASHQL_EMBED__: EmbedProbe | undefined;
}

async function canOpenOPFS(): Promise<string> {
    try {
        await navigator.storage.getDirectory();
        return 'yes';
    } catch (error) {
        return `no (${stringifyError(error)})`;
    }
}

function isFramed(): string {
    try {
        return window.top !== window ? 'yes' : 'no';
    } catch {
        return 'yes, cross-origin';
    }
}

async function readEnvironment(): Promise<Record<string, string>> {
    return {
        origin: self.origin,
        framed: isFramed(),
        crossOriginIsolated: String(globalThis.crossOriginIsolated === true),
        sharedArrayBuffer: String(typeof SharedArrayBuffer !== 'undefined'),
        secureContext: String(globalThis.isSecureContext === true),
        opfs: await canOpenOPFS(),
        userAgent: navigator.userAgent,
    };
}

async function runStep(name: string, step: () => Promise<string>): Promise<EmbedStep> {
    const start = performance.now();
    try {
        const detail = await step();
        return { name, ok: true, durationMs: Math.round(performance.now() - start), detail };
    } catch (error) {
        return { name, ok: false, durationMs: Math.round(performance.now() - start), detail: stringifyError(error) };
    }
}

/// Start a worker from a blob: URL that imports an ES module worker script. A worker from a URL needs an origin, and in
/// an opaque origin a module worker from a blob: URL fails to start too, so the blob is a classic worker that imports
/// the module. Messages that arrive before the module set its handler wait in a queue.
function startBlobWorker(scriptUrl: string): { worker: Worker; revoke: () => void } {
    const url = new URL(scriptUrl, import.meta.url).href;
    const source = `
const queued = [];
const queue = event => queued.push(event);
self.addEventListener('message', queue);
import(${JSON.stringify(url)}).then(() => {
    self.removeEventListener('message', queue);
    for (const event of queued) self.onmessage(event);
}, error => setTimeout(() => { throw error; }));
`;
    const blobUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    try {
        return { worker: new Worker(blobUrl), revoke: () => URL.revokeObjectURL(blobUrl) };
    } catch (error) {
        URL.revokeObjectURL(blobUrl);
        throw error;
    }
}

/// Parse the query with the core in its batch worker
async function runCore(): Promise<string> {
    const { worker, revoke } = startBlobWorker(batchWorkerUrl);
    const batch = new DashQLBatchWorker(worker);
    try {
        const result = await batch.processBatch({ scripts: [{ id: 'probe', text: QUERY, outputs: ['parsed'] }] });
        const script = result.scripts[0];
        if (script.failure != null) throw new Error(script.failure);
        const errors = script.diagnostics.filter(d => d.severity === 'error');
        if (errors.length > 0) throw new Error(errors.map(d => `${d.stage}: ${d.message}`).join('; '));
        return `parsed ${script.parsed?.byteLength ?? 0} bytes, ${script.diagnostics.length} diagnostics`;
    } finally {
        batch.dispose();
        revoke();
    }
}

/// Start the embedded Hyper in a blob: worker with its storage in memory and run the query
async function runHyper(): Promise<string> {
    const engine = await HyperDBEngine.create({
        worker: 'blob',
        storage: 'memory',
        workerUrl: new URL(hyperWorkerUrl, import.meta.url),
        engineUrl: new URL(hyperEngineUrl, import.meta.url),
        wasmUrl: new URL(hyperWasmUrl, import.meta.url),
    });
    try {
        const connection = await engine.connect();
        try {
            const table = await connection.query(QUERY);
            const row = table.get(0) as { n?: unknown; total?: unknown } | null;
            return `hyperdb-wasm ${HYPERDB_WASM_VERSION}: n=${String(row?.n)}, total=${String(row?.total)}`;
        } finally {
            await connection.close();
        }
    } finally {
        await engine.terminate();
    }
}

function render(root: HTMLElement, probe: EmbedProbe) {
    const rows: [string, string, string][] = [
        ...Object.entries(probe.environment).map(([key, value]): [string, string, string] => [key, value, '']),
        ...probe.steps.map((step): [string, string, string] => [
            step.name,
            `${step.ok ? 'ok' : 'failed'}, ${step.durationMs} ms: ${step.detail}`,
            step.ok ? 'ok' : 'failed',
        ]),
    ];
    if (!probe.done) rows.push(['', 'running…', '']);

    const title = document.createElement('h1');
    title.textContent = 'DashQL Embed';
    const query = document.createElement('code');
    query.textContent = QUERY;
    const table = document.createElement('table');
    for (const [key, value, state] of rows) {
        const tr = table.insertRow();
        const th = document.createElement('th');
        th.textContent = key;
        tr.append(th);
        const td = tr.insertCell();
        td.textContent = value;
        if (state) td.dataset.state = state;
    }
    root.replaceChildren(title, query, table);
}

async function main() {
    const root = document.getElementById('root')!;
    const probe: EmbedProbe = { done: false, environment: await readEnvironment(), steps: [] };
    render(root, probe);
    for (const [name, step] of [['core worker', runCore], ['hyper worker', runHyper]] as const) {
        probe.steps.push(await runStep(name, step));
        render(root, probe);
    }
    probe.done = true;
    render(root, probe);
    globalThis.__DASHQL_EMBED__ = probe;
}

void main();
