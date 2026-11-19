// This module is imported only after Mocha and the Vitest compatibility globals are installed.
// Eager imports let Vite combine the full suite instead of creating a serial request waterfall.
// Register the only engine-restart coverage first, before other tests retain Wasm runtimes.
import '../host/hyperdb/hyperdb_wasm.integration.test.js';
import '../host/hyperdb/integration/iceberg.test.js';
import.meta.glob([
    '../**/*.test.{ts,tsx}',
    // Core tests now belong to the independent package, including stale Bazel outputs.
    '!../core/**',
    '!../host/hyperdb/hyperdb_wasm.integration.test.ts',
    '!../host/hyperdb/integration/iceberg.test.ts',
], { eager: true });
// The tests of the runtime and of the platform of @akohn/dashql, see test_modules.ts
import.meta.glob([
    '../../../dashql/src/runtime/**/*.test.ts',
    '../../../dashql/src/platform/**/*.test.ts',
    // The tests of Node
    '!../../../dashql/src/**/*.node.test.ts',
], { eager: true });
// The tests of the components of @akohn/dashql-react, see test_modules.ts
import.meta.glob([
    '../../../dashql-react/src/**/*.test.{ts,tsx}',
], { eager: true });
