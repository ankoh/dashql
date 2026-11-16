// The package on npm in Node: the bindings with the Wasm next to them, and a runtime over the platform of Node with a
// workbook folder, the way the command line tool builds one
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DIST = new URL('../../npm_package/dist/', import.meta.url);
const load = path => import(new URL(path, DIST).href);

const core = await load('core/index.js');
const glue = await load('wasm/dashql_core.js');
assert.equal('createBatchWorker' in core, false);
assert.equal('DashQLBatchWorker' in core, false);
const binary = new Uint8Array(await readFile(new URL('wasm/dashql_core.wasm', DIST)));
// The module stands alone: it imports its wasm-bindgen glue and nothing else, a database stays optional
const imports = new Set(WebAssembly.Module.imports(new WebAssembly.Module(binary)).map(entry => entry.module));
assert.deepEqual([...imports], ['wbg']);
const first = await core.DashQL.create();
await glue.default({ module_or_path: binary });
const second = new core.DashQL({ ...glue });
assert.notEqual(first, second);
for (const instance of [first, second]) {
    const catalog = instance.createCatalog();
    const script = instance.createScript(catalog);
    script.insertTextAt(0, 'select 1');
    script.analyze();
    assert.equal(script.toString(), 'select 1');
    const result = instance.processBatch({ scripts: [{ id: 'query', text: 'select 1', outputs: ['analyzed'] }] });
    assert.equal(result.scripts.length, 1);
    assert.ok(result.scripts[0].analyzed.byteLength > 0);
    const shell = new instance.bindings.Shell(catalog.ptr.assertNotNull(), 80, false);
    shell.setPrompt('sel');
    assert.ok(shell.completePrompt(5).some(candidate => candidate.completionText === 'select'));
    shell.free();
    instance.resetUnsafe();
}
const worker = await load('core/browser_worker.js');
assert.equal(typeof worker.createBatchWorker, 'function');

// A runtime over the platform of Node, with the core from @ankoh/dashql/wasm and the workbooks in a folder
const { createRuntime } = await load('runtime/runtime.js');
const { createNodePlatform } = await load('runtime/node/node_platform.js');
const { NativeStorageBackend } = await load('platform/storage/native_storage_backend.js');
const { NODE_FILE_SYSTEM } = await load('platform/node/node_file_system.js');
const { Logger } = await load('platform/platform/logger/logger.js');
const { newDefaultHyperWasmConnection } = await load('platform/connections/connection_params.js');

class SilentLogger extends Logger {
    destroy() { }
    flushPendingRecords() {
        this.pendingRecords = [];
    }
}
const folder = await mkdtemp(join(process.env.TEST_TMPDIR ?? tmpdir(), 'dashql-node-smoke-'));
try {
    const runtime = createRuntime(await createNodePlatform({ logger: new SilentLogger(), storage: new NativeStorageBackend(folder, NODE_FILE_SYSTEM) }));
    try {
        await runtime.restore();
        const connection = runtime.createConnection(newDefaultHyperWasmConnection({ active: true }));
        const workbook = runtime.createWorkbook(connection.connectionId, 'Node', false);
        assert.equal(runtime.store.get('workbook', workbook.workbookId)?.name, 'Node');
    } finally {
        await runtime.destroy();
    }
} finally {
    await rm(folder, { recursive: true, force: true });
}
console.log('DashQL npm package Node smoke test passed');
