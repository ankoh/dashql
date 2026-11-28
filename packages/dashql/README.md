# DashQL

DashQL in TypeScript: portable ESM bindings for DashQL's SQL parser, analyzer, formatter, catalog, batch processing,
and query profiles, the runtime of DashQL over its core module, and the platforms of the runtime. The package includes
the wasm-bindgen glue, the Wasm binaries, the generated FlatBuffer bindings, and TypeScript declarations.

```ts
import { DashQL } from '@akohn/dashql';

const core = await DashQL.create();
const catalog = core.createCatalog();
const script = core.createScript(catalog);
try {
    script.insertTextAt(0, 'select 1');
    script.analyze();
} finally {
    script.destroy();
    catalog.destroy();
}
```

The generated FlatBuffers are also available directly:

```ts
import * as buffers from '@akohn/dashql/buffers';
```

Native objects (catalogs, scripts, sessions, ...) live in Wasm memory and
require explicit `destroy()`. Destroy scripts before their catalogs. Returned
FlatBuffer pointers own their bytes as a JavaScript `Uint8Array`, so readers stay
valid across subsequent operations; `destroy()` only drops the bytes.
`resetUnsafe()` is a test/reset escape hatch that invalidates all outstanding
handles.

`DashQL.create` accepts a `wasmBinary` or a precompiled WebAssembly `module` and
loads the bundled binary otherwise. The module needs nothing but its own JS glue,
no database or other Wasm module. It also holds the shell, `bindings.Shell`,
which runs on a catalog of the module and leaves running queries to its host.

The root export does not export browser workers. In browsers, use:

```ts
import { createBatchWorker } from '@akohn/dashql/browser-worker';

const worker = createBatchWorker();
const result = await worker.processBatch({ scripts: [{ id: 'query', text: 'select 1', outputs: ['analyzed'] }] });
worker.dispose();
```

The browser-worker entry point also exports `DashQLBatchWorker` and the
`BatchWorkerRequest`, `BatchWorkerResponse`, `BatchRequest`, `BatchResult`,
`BatchScriptInput`, `BatchScriptResult`, `BatchDiagnostic`, and `BatchOutput`
types. Importing it is safe in Node; creating a worker requires a browser
module-worker environment. `./batch-worker` is the script of the worker itself.

## The runtime

`@akohn/dashql/runtime` exports `createRuntime(options)`, the runtime of DashQL over the runtime object of the core
module, and `@akohn/dashql/node` exports `createNodePlatform`, its platform in Node:

```ts
import { createRuntime } from '@akohn/dashql/runtime';
import { createNodePlatform } from '@akohn/dashql/node';
import { NativeStorageBackend } from '@akohn/dashql/platform/storage/native_storage_backend';
import { NODE_FILE_SYSTEM } from '@akohn/dashql/platform/node/node_file_system';

const runtime = createRuntime(await createNodePlatform({ logger, storage: new NativeStorageBackend(folder, NODE_FILE_SYSTEM) }));
await runtime.restore();
```

The public modules of the runtime and of its platforms are subpaths at the paths of their sources,
`@akohn/dashql/runtime/<path>` and `@akohn/dashql/platform/<path>`. The `exports` of the package list them, the
other modules stay inside it. The embedded Hyper of the platforms needs `hyperdb-wasm`, an
optional peer dependency, and Node 24 or later.

This package is ESM-only and does not expose other internal `dist/*` paths.

## TypeScript

The declarations of the bindings support `module` and `moduleResolution` set to `NodeNext` with
`strict: true` and `skipLibCheck: false`. TypeScript does not supply WebAssembly
types in its ES libraries alone. For consumers without the DOM library, use
explicit supported worker typings, for example:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022", "WebWorker"],
    "types": [],
    "strict": true,
    "skipLibCheck": false
  }
}
```

`WebWorker` supplies WebAssembly and browser-worker types without `DOM` or
`Document`. Browser applications can instead use their usual `DOM` typings.
No ambient type shim or extra runtime dependency is installed by this package.

Serve the package's `dist` directory intact or use a bundler that preserves
module-worker and `new URL(..., import.meta.url)` assets. The `./wasm` subpath
exports the binary of the core, `./dataflow-wasm` the one of the dataflow layout; `./wasm/glue` exports the
wasm-bindgen glue for custom loading. No application-specific aliases or test globals are required.

## Bazel

`packages/dashql` is a source package in the repository: the app and the tests read its
TypeScript, see `docs/design/dashql_runtime.md`. Only the package on npm is built:

- `bazel build //packages/dashql:bundle` bundles the modules with their declarations into `dist/` (`npm/build.mjs`).
- `bazel build //packages/dashql:npm_package` assembles the npm directory with `npm/package.json`.
- `bazel build //packages/dashql:npm_tarball` creates the publishable archive.
- `bazel test //packages/dashql:node_smoke_test` checks the bindings and a runtime of the assembled package in Node.
- `bazel test //packages/dashql:tarball_consumer_test` validates the actual archive as an external consumer.
- `bazel test //packages/dashql:test_core_node` runs the colocated tests of the bindings in Node.
- `bazel test //packages/dashql/test/browser:all` runs source and packaged-consumer tests in Chromium, Firefox and WebKit.

The real browser-worker integration test requires a browser and is skipped in
Node; worker transport tests run in both environments.

`dist/` keeps the paths of `src/`: the bindings are `dist/core`, the runtime `dist/runtime`, the platforms
`dist/platform`. The generated parts, which the sources import by path from Bazel outputs, are inlined: the Wasm with
its glue in `dist/wasm`, the FlatBuffers, protobuf and JSON schema bindings in `dist/gen`. Tests, test helpers and
fixtures are not shipped in the npm package.

The tarball uses the existing hermetic BSD tar toolchain through Bazel's
`tar` rule, with an ordered mtree manifest, fixed timestamps and ownership,
ustar format, and timestamp-free gzip compression. The consumer test compares
two independent archive actions byte for byte. This guarantees reproducible
packaging for identical inputs/toolchains, not identical Wasm across build
configurations or compiler versions. `npm/package.json` is the only publish-version
source.

The external test extracts `:npm_tarball` into a fresh temporary
`node_modules/@akohn/dashql`, copies only the FlatBuffers runtime
dependency of the bindings from Bazel runfiles, and clears Node's resolution overrides. It uses
no package manager or network. Package-name imports exercise every public JS
entry point of the bindings, binary resolution, default and explicit Wasm initialization,
SQL analysis, and batch processing. TypeScript runs from the Bazel tool input
against the extracted declarations, without repository aliases, DOM typings,
or skipped declaration checks. This does not replace real browser execution.

## License

DashQL is licensed under MPL-2.0, as confirmed by the repository-root `LICENSE`
and `NOTICE`. Both files are copied unchanged into the package; `NOTICE` is
the repository-wide third-party notice.
Source is available at <https://github.com/ankoh/dashql>, including this package
under `packages/dashql`, the Rust core under `packages/dashql-core` and
`packages/dashql-parser`, its wasm-bindgen module under `packages/dashql-core-bindings`,
and generated binding schemas under `proto/fb`. Third-party components retain
their own licenses.
