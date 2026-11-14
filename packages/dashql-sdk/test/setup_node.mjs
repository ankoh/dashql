// The precompiled core of the tests, the browser test frame of the app sets the same global
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.DASHQL_PRECOMPILED = readFile(require.resolve('@ankoh/dashql-core/wasm')).then(bytes => new Uint8Array(bytes));
