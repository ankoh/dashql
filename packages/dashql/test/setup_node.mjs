// The precompiled core of the tests, the browser test frame of the app sets the same global
import { mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';

import { startNodeHyperEngine, useNodeRoot } from '../src/platform/node/node_hyperdb.ts';
import { PROCESS_LOCKS } from '../src/platform/node/node_locks.ts';

// The Wasm of the source package (the export ./wasm in the workspace)
globalThis.DASHQL_PRECOMPILED = readFile(new URL('../dependencies/dashql-wasm/dashql_core.wasm', import.meta.url)).then(bytes => new Uint8Array(bytes));

// Every test file gets a root of its own with the layout of the origin private file system (platform/node/node_directory_handle.ts),
// like the browser tests get an OPFS folder. Node before 24.5 has no Web Locks, the locks of the process stand in.
const root = mkdtempSync(path.join(process.env.TEST_TMPDIR ?? tmpdir(), 'dashql-test-root-'));
await useNodeRoot(root);
if (globalThis.navigator?.locks == null) Object.defineProperty(globalThis.navigator, 'locks', { value: PROCESS_LOCKS, configurable: true });

// The HyperDBs of the tests (platform/testing/test_hyperdb.ts): one engine of the embedded Hyper of Node per test file,
// started in the root by the first test that needs it, every HyperDB gets databases of its own on it
let engine = null;
let next = 0;
globalThis.__DASHQL_TEST_HYPERDB__ = async context => {
    engine ??= startNodeHyperEngine(root);
    const lease = `${context.replace(/[^\w-]/g, '_')}-${++next}`;
    return await (await engine).createDatabase({
        compute: `${lease}-compute.hyper`,
        default: `${lease}-default.hyper`,
        snippets: `${lease}-snippets.hyper`,
    });
};
afterAll(async () => {
    if (engine != null) await (await engine).close();
    engine = null;
});
