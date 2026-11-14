// The precompiled core of the tests, the browser test frame of the app sets the same global
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import { provideClientFunctionSpecs } from '../src/connections/clfn/clfn_specs.ts';

const require = createRequire(import.meta.url);
globalThis.DASHQL_PRECOMPILED = readFile(require.resolve('@ankoh/dashql-core/wasm')).then(bytes => new Uint8Array(bytes));
// The client function specs of the extensions, vitest resolves the glob like the bundler of the app
provideClientFunctionSpecs(import.meta.glob('@dashql/extensions/*/clfn/spec/spec.json', { import: 'default' }));
