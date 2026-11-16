# Browser Tests of the Bindings

The harness runs the TypeScript tests of the bindings (`src/core`) in real Chromium and Firefox without the app bundle,
React, or HyperDB. Mocha provides scoped hooks and test execution; `vitest_compat.ts` exposes the existing Jest-style
matchers and spies.

```sh
bazel test //packages/dashql/test/browser:test_chromium
bazel test //packages/dashql/test/browser:test_firefox
bazel test //packages/dashql/test/browser:test_chromium --test_arg=src/core/api.test.ts
bazel test //packages/dashql/test/browser:test_chromium --test_arg=package_consumer.test.ts
```

The parent package exposes these public build targets:

- `:core_srcs`: `src/core/**/*.ts`, including the tests and their fixtures.
- `:dep_wasm`: the wasm-bindgen glue and Wasm under `dependencies/dashql-wasm/`, imported as `@ankoh/dashql-wasm/*`.
- `:dep_flatbuffers`: the generated FlatBuffers under `dependencies/dashql-flatbuffers/`, imported as
  `@ankoh/dashql-flatbuffers/*`.

`:inputs` stages them under `inputs/src/core/` and `inputs/dependencies/`, and `vite.config.mjs` maps the two generated
packages to their folders. Test files are discovered by `import.meta.glob('./inputs/src/core/**/*.test.ts')`; no
hand-maintained test list is needed.

`:packaged` independently stages `//packages/dashql:npm_package`, the package on npm. `package_consumer.test.ts`
imports its public API, Wasm asset, and browser-worker entry through exact aliases derived from the published export
map. These bundled modules have a separate identity from the source modules, so the source runtime override does not
affect them. The two consumer smoke tests verify explicit `wasmBinary` initialization, default emitted Wasm URL loading,
and real worker `processBatch` results.

Each file runs serially with fresh Mocha hooks. The test entry point compiles Wasm once, overrides `DashQL.create` only
in the test page to share one runtime, and resets that runtime between files. The production factory reads no test
globals. `DASHQL_PRECOMPILED` remains available for fixtures not yet migrated to explicit test-only loading. Hook
failures, import failures, empty suites, and browser console errors all fail the Bazel test.

The Playwright driver reads `__DASHQL_BROWSER_TESTS__`, matching the app driver's summary protocol. Browser executables
come from the same Bazel-managed Playwright repositories as the app harness.

The app's separate `src/tests/core_pool.ts` keeps its existing cross-frame sharing in test-only code.
