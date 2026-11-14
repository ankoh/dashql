# DashQL SDK

Status: steps 1 and 2 are built, step 3 is built for four services, the rest is proposed.

`packages/dashql-sdk` (`@ankoh/dashql-sdk`) holds the logic of DashQL without React: the workbook model and its
format, the analysis of scripts, the connectors, query execution, the catalog and the computations. The app and a
Node command line tool share it. An agent then works on workbooks with the same code the app runs, through a
`dashql` command, while the user looks at the result in the app.

| Part | State |
|---|---|
| Untangling in place (leaks, `Store` without React) | Done, step 1 |
| `packages/dashql-sdk` with the clean modules, `//packages/dashql-sdk:boundary_test` | Done, step 2; their tests still run in the browser tests of the app |
| Services in place of providers | Step 3: the query executor, the catalog loader, the runs of workbooks and saving connections are done |
| The connector setups, the restore, one runtime | Step 4, with the seams of the platforms |
| Node platform and the CLI on top | Planned, step 4 |
| Editor state out of `ScriptData` | Later, step 5 |

## Why

- **One implementation.** `workbook check`, `pack`, `link` and `run` in the CLI must give the answers of the app. A
  second implementation (the Rust CLI writing workbook tables) would drift from `storage/workbook_tables.ts`.
- **Agents iterate over SQL.** The agent writes scripts, checks them against the catalog, runs them where it may
  and fixes them. The commands it runs most work offline on files, so they work in sandboxed harnesses (Codex blocks
  loopback, listening and DNS inside its sandbox). Commands that need the network (`run`, catalog refreshes) are
  separate subcommands that a user can allow once by prefix.
- **Node is where agents run.** The CLI is an npm package with a real `dashql` command, so an approval rule can name
  `dashql run` and never `node`. The embedded Hyper needs Node 24.15 or later (see
  [Runtimes for the embedded Hyper](#runtimes-for-the-embedded-hyper)); the core alone runs on older versions.
- **Tests without a browser.** The SDK's tests run in Node.

## Findings

### The state already lives outside React

`utils/store.ts` has `Store<T>` (`current`, `subscribe`, `update`) and `UpdateQueue<T>`. The registries free Wasm
objects and schedule storage writes while they reduce, so an update must run exactly once, which React's state hooks
don't promise. Components read the stores through `useSyncExternalStore`. React appears only in:

- the type `React.SetStateAction`,
- `requestAnimationFrame` in `UpdateQueue` (updates that may wait for the next frame),
- `useStore`, `useStoreState` and `useUpdateQueue`.

### The reducers take their dependencies as arguments

- `reduceWorkbookScripts(state, action, storage, logger)` (`workbook/scripts/workbook_scripts.ts`, 29 actions)
- `reduceConnectionState(prev, action, logger)` (`connections/connection_state.ts`) and the connector reducers
  (`salesforce/`, `trino/`, `hyper/`)
- `query/query_execution_state.ts`, `compute/computation_state.ts`

### Imports that pulled UI code into the domain

The transitive closure of the imports of these modules reached React, CodeMirror or a `.tsx` file here. Step 1 cut
them, `//packages/dashql-sdk:boundary_test` keeps them cut:

| Leak | Fix |
|---|---|
| `connections/catalog/catalog_update_state.tsx` has no React and no JSX | Rename to `.ts` |
| `connections/connection_label.ts` imports `isListedConnection` from `connection_registry.tsx`, which mixes pure functions (`registerConnection`, `isListedConnection`, `applyConnectionAction`, …) with providers | Move the pure part into its own `.ts` module |
| `workbook_scripts.ts` imports `DashQLCompletionState`, `DashQLPendingDiff` and `DashQLProcessorUpdateOut` from `workbook/editor/dashql_processor.ts`, which imports `@codemirror/state` | The types hold only core buffers and patches; they moved to `workbook/scripts/script_editor_state.ts` |
| `workbook/scripts/script_format.ts` imports `EditorView` (for `measureScriptFormatWidth` and `formatScriptEditor`) and `AppSettings` from `config/app_config.tsx` | The two editor functions moved to `workbook/editor/script_format_editor.ts`, `AppSettings` to `config/app_settings.ts` |
| `connections/trino/trino_catalogs.ts` and `connections/catalog/catalog_query_information_schema.ts` import `QueryExecutor` from `query_executor.tsx` and `DynamicConnectionDispatch` from `connection_registry.tsx` | `QueryExecutor` and `CancelQuery` moved to `query_execution_args.ts`, the dispatch types to `connection_registry_state.ts` |

The pure parts of the registries are `connections/connection_registry_state.ts` (with `applyConnectionAction` and
`connectionOrdinals`) and `workbook/scripts/workbook_scripts_registry_state.ts` (with `dispatchWorkbookScriptsAction`
and `applyConnectionWorkbookScriptsAction`). `connection_registry.tsx` and `workbook_scripts_registry.tsx` bind them to
React and re-export them, so their importers didn't change; step 2 points the importers at the package. The React
hooks of the store are in `utils/store_hooks.ts`, `UpdateQueue` takes an `UpdateScheduler` (frames in the browser,
`TASK_UPDATE_SCHEDULER` without frames).

After step 1 the roots of the test (the store, the workbook scripts and their registry state, the connection state and
its registry state, the query state, the workbook tables, the storage writer) reach about 95 modules and 20,700 lines,
none of them `.tsx`, React or CodeMirror.

### The effects live in hooks, their logic doesn't need React

- `setupSalesforceConnection(modifyState, logger, connector, params, config, platformType, apiClient, httpClient,
  appEvents, forceReLogin, abortSignal)` is a plain async function.
- `CatalogLoaderDependencies` (`connections/catalog/catalog_loader.tsx`) is already an interface.
- `connections/query_executor.tsx` uses hooks only to reach the store, dispatch, the result cache, the logger, HTTP
  and the core. So do `WorkbookExecutionProvider` (Execute All), `ConnectionPersistenceProvider` and
  `ComputationScheduler`. `workbook/persistence/app_state_loader.ts` (the restore at startup) is a plain module.
- `app/app.tsx` nests about 35 components that construct these services from context: the service container of the
  app, in React form.

### Editor state sits in the domain state

`ScriptData` carries `completion`, `pendingDiff`, `editorUpdate` and `statistics` next to `scriptSession`,
`fileName` and `connection`. `WorkbookScripts` carries `scriptFocus` and `semanticUserFocus`. About 90 lines of the
reducer touch them (`UPDATE_FROM_PROCESSOR`, `ACCEPT_PENDING_DIFF`, `REJECT_PENDING_DIFF`, `SELECT_*`). They depend
on core buffers only, not on an editor library, so they can move with the reducer and leave it later.

### The rest is portable already

- `hyperdb-wasm` exports a `node` build (`dist/node.js`, `engines: node >=24`).
- The connector clients go through `platform/http/http_client.ts`.
- `NativeStorageBackend` implements `StorageBackend`; it calls `platform/electron_fs.js` directly.
- `@ankoh/dashql-core` loads its Wasm with `fetch(new URL('./wasm/…', import.meta.url))`. Node's `fetch` doesn't read
  `file:` URLs, and the batch worker uses `new Worker`.

### The package

Step 2 moved the 94 modules into `packages/dashql-sdk/src` with the folders they had in the app (`connections/`,
`workbook/`, `storage/`, `query/`, `platform/`, …), so their relative imports stayed, and the app imports them as
`@ankoh/dashql-sdk/<path>`. A source package like `@ankoh/dashql-ui`: linked as `//:node_modules/@ankoh/dashql-sdk`,
mapped in the root `tsconfig.json` and the Vite config. The SDK type-checks against the `WebWorker` lib of TypeScript
(no `window`, no `document`, no elements) with its own copies of the generated `@ankoh/dashql-protobuf` and
`@ankoh/dashql-jsonschema`. `platform/electron_fs.ts` owns the type of the file system of the Electron bridge, the
global declaration of the app (`types/electron.d.ts`) refers to it.

`//packages/dashql-sdk:boundary_test` reads every module: none leaves the package, reaches React, an editor or a
`.tsx` module, and the seams that only a browser or a bundler provides are known by name. Step 4 removes them:

- A bundler asset: `connections/catalog/prefetched_hyper_functions.ts` imports the functions of Hyper as SQL text with
  Vite's `?raw` (`connections/catalog/dashql-catalog-functions.sql`, moved from `static/catalog/hyper/` of the app).
- `import.meta.glob`: `connections/clfn/clfn_specs.ts` loads the specs of the extensions.
- The origin private file system: `platform/opfs_root.ts`, `platform/database/embedded_database.ts`,
  `platform/hyperdb/hyperdb_parquet_export.ts`, `storage/migration/migration_folder.ts`, `storage/workbook_tree.ts`,
  `workbook/attachments/attachment_mounts.ts`.
- The Electron bridge: `platform/electron_fs.ts`, `platform/native_globals.ts`.
- `connections/catalog/catalog_batch.ts` imports `@ankoh/dashql-core/browser-worker`.

### Runtimes for the embedded Hyper

`hyperdb-wasm` is a wasm64 build: 64-bit memory, 64-bit tables (table64) and Wasm exceptions with `exnref`. A runtime
must support all three.

| Runtime | Embedded Hyper |
|---|---|
| Node 22 | No. V8 12.4 rejects the tables (`invalid table elements limits flags`), and no flag helps |
| Node 24.0 to 24.14 | Only as `node --experimental-wasm-exnref …`, otherwise `invalid value type 'exn'` |
| Node 24.15 and later | Yes, without flags. 24.15.0 cherry-picks V8's "Enable exnref" (nodejs/node#62567) |
| Electron 45 (`ELECTRON_RUN_AS_NODE`) | Should, its V8 is the one of Chromium, which has all three; not tried |
| Bun | No. JavaScriptCore has no memory64 yet (WebKit bug 300538 is open), and no Safari has it either |

On Node 24.22.0 the `node` build of `hyperdb-wasm` creates a database and runs a query without flags, and fails with
`--no-experimental-wasm-exnref`. Node 22.23 and 24.4.1 were tested on the side of Hyper. The same gap in
JavaScriptCore means that the embedded Hyper of the app doesn't load in Safari.

For agents this means:

- **No flag.** Node refuses V8 flags in `NODE_OPTIONS` (`--experimental-wasm-exnref is not allowed in NODE_OPTIONS`),
  and a flag on the command line breaks approval by prefix and launches through `npx`. The CLI declares
  `engines: node >=24.15` and runs without flags. `hyperdb-wasm` should declare the same instead of `>=24`. Where
  an older Node 24 must work, the package can call `v8.setFlagsFromString('--experimental-wasm-exnref')` before it
  compiles the engine; that works on a Node started without exnref.
- **The `node` of a harness may not be the one of the shell.** MCP servers and hooks start without the login shell,
  and other tools put their own older Node on `PATH`. The CLI validates a tiny module per feature at startup
  (`WebAssembly.validate`) and names `process.execPath` and the missing feature, instead of failing in V8.
- **Hyper only where it's needed.** The CLI loads `hyperdb-wasm` lazily, in commands that query the embedded Hyper.
  `check`, `pack`, `unpack`, `link`, `lint` and `format` need only the core, so they run on older Node too.

## Layout

```
packages/dashql-sdk                 @ankoh/dashql-sdk: TypeScript and Wasm, no React, no CodeMirror, no Vite ?url imports
  src/platform/                     interfaces: HttpClient, StorageBackend (+ fs), EmbeddedDatabase, AuthFlow, Scheduler,
                                    LogSink, WasmSource
  src/store/                        Store, UpdateQueue
  src/workbook/                     workbook_scripts reducer, script analysis, attachments, inputs
  src/connections/                  connection_state, connector states and setups, catalog updates, clients
  src/query/                        query execution state, QueryExecutor, result cache
  src/compute/                      computation state and scheduler
  src/storage/                      workbook tables, link encoding, storage writer, import and export
  src/runtime.ts                    createRuntime(platform) → Runtime
  src/node/                         @ankoh/dashql-sdk/node: fs storage, fetch HTTP, hyperdb-wasm node, Wasm from files,
                                    loopback OAuth
packages/dashql-app                 createBrowserRuntime(): OPFS, native proxy, hyperdb web worker, oauth.html
                                    <RuntimeProvider>, UI-only state: CodeMirror, focus, view modes, overlays, ownership
the dashql CLI                      createRuntime(nodePlatform): workbook check/pack/unpack/link, run, catalog refresh,
                                    session serve
```

```ts
interface Runtime {
    core: DashQL;
    logger: Logger;
    storage: { reader: StorageReader; writer: StorageWriter };
    hyper: EmbeddedDatabase;
    connections: RegistryStore<ConnectionRegistry, ConnectionAction>;
    workbooks: RegistryStore<WorkbookScriptsRegistry, WorkbookScriptsAction>;
    computations: Store<ComputationRegistry>;
    executor: QueryExecutor;
    catalogLoader: CatalogLoader;
    execution: WorkbookExecution;
    connectors: { salesforce: SalesforceConnector; trino: TrinoConnector; hyper: HyperConnector };
    restore(): Promise<RestoredAppState>;
}
```

### Platform seams

| Seam | Browser | Desktop | Node |
|---|---|---|---|
| HTTP | fetch, limited by CORS | native proxy | fetch |
| Storage | OPFS | files over IPC | files (`node:fs`) |
| Embedded Hyper | `hyperdb-wasm` in a worker, cross-origin isolated | the same | `hyperdb-wasm` `node` |
| Core Wasm | URL from the bundler | the same | file next to the package |
| Auth | redirect through `oauth.html` | loopback (`oauth_loopback.ts`) | loopback with PKCE, or the token of a logged-in `sf` |
| Scheduler | microtask, `requestAnimationFrame` | the same | microtask, `setImmediate` |

## React after the move

- **Stores.** They move into the SDK unchanged. `Store` loses the React type, `UpdateQueue` takes a `Scheduler`.
  `createRuntime` creates them once, not a provider.
- **Hooks keep their names.** Only their bodies change:

  ```ts
  export function useWorkbookScripts(id: string | null): [WorkbookScripts | null, ModifyWorkbookScripts] {
      const rt = useRuntime();
      const scripts = useStoreSelector(rt.workbooks, reg => (id == null ? null : reg.workbookMap.get(id) ?? null));
      return [scripts, action => rt.workbooks.dispatch(id!, action)];
  }
  ```

  Call sites that keep working: `useConnectionRegistry` (39), `useWorkbookScriptsRegistry` (23), `useQueryExecutor`
  (16), `useConnectionById` (12), `useLogger` (100).
- **Dispatch.** `applyConnectionAction` (the reducer plus the storage writes, now in `connection_registry.tsx`)
  becomes `rt.connections.dispatch(id, action)` with the same queue. The storage writer and the logger come from the
  runtime instead of context. The same holds for the workbook scripts.
- **Providers.** The services become fields of the runtime, and one `<RuntimeProvider runtime={rt}>` replaces most
  of the nesting in `app/app.tsx`. Router, theme, flavor, toasts, the file dropzone and the version check stay.
- **Wasm lifetimes** stay in the reducers inside the stores.
- **Editor state** stays in `ScriptData` with types free of CodeMirror. Step 5 moves `completion`, `pendingDiff` and
  the focus into an editor store of the app keyed by workbook and script.

## Steps

Each step ships on its own and keeps the behavior.

1. **Untangle in place.** Rename `catalog_update_state.tsx`, split the pure part of `connection_registry.tsx` and
   `workbook_scripts_registry.tsx` into `.ts` modules, move the editor data types out of `dashql_processor.ts`, make
   `Store` free of React with a `Scheduler`. Add a test that fails when a module of the SDK set imports `react`,
   `react-dom`, `@codemirror/*`, a `.tsx` file or a `?url` asset. Done.
2. **Draw the package line.** Move the clean set into `packages/dashql-sdk`, a Bazel `ts_project` with tests in
   Node. The app imports from `@ankoh/dashql-sdk`.
3. **Services out of providers.** Done for four services of the SDK, each a class with its dependencies passed in,
   its state as a `Store`, and a provider that binds it to React:
   - `QueryExecutorService` (`connections/query_executor_service.ts`), with the computations, the result cache, the
     tracked execution and the profile layout of the query progress (`query/profile/`);
   - `CatalogLoaderService` (`connections/catalog/catalog_loader_service.ts`), with the update of Hyper catalogs. The
     provider passes each new registry, the loader reconsiders its queue in a microtask;
   - `WorkbookExecutionService` (`workbook/scripts/workbook_execution_service.ts`), with the engine of the runs and the
     runs of single scripts;
   - `ConnectionPersistenceService` (`connections/connection_persistence_service.ts`).

   The rest waits for the seams of step 4. The setups of Salesforce and Trino authenticate in a popup window or
   through the OAuth loopback of the Electron bridge, and the restore (`app_state_loader.ts`) reads the tokens of
   Hyper links from the storage of the tab (`connections/hyper/hyper_link.ts`, `embedded_connection.ts` also binds
   React). They move once the platform passes an auth flow and the tab state in. The runtime object that replaces the
   nesting of providers comes with them: `createRuntime` states the startup order that the nesting implies today
   (the embedded Hyper needs the core, the Hyper setup needs the embedded Hyper).
4. **Platform seams and Node.** An auth flow (popup and redirect in the browser, loopback in Electron and Node) and the
   tab state passed in, so the connector setups and the restore move; `createRuntime`. Then the Node platform: a
   storage backend over `node:fs` (`NativeStorageBackend` with the fs functions passed in), a fetch client,
   `EmbeddedDatabase` over `hyperdb-wasm` `node`, Wasm from files. The CLI on top: offline
   `workbook check`, `pack`, `unpack` and `link` first, then `run` and `catalog refresh`.
5. **Editor state.** Out of `ScriptData` into the app.

## The CLI on the SDK

- **Offline by default.** `check`, `pack`, `unpack` and `link` read and write files in the workspace, nothing else.
- **Network in separate subcommands.** `run` and `catalog refresh` reach connections; a harness approves them by
  prefix (`dashql run`), never through `node` or `npx`.
- **Results stay in files.** Harness telemetry records tool output, so `run` prints the error with its position, the
  schema, the row count and a few rows, and writes the result as Parquet into the workbook.

## Testing both platforms

The browser and Node must offer the same: every feature of the SDK runs, and is tested, on both.

- **Compile time.** The SDK compiles against the `WebWorker` lib, without the DOM and without the types of Node; the
  APIs it uses there, like `fetch`, `URL`, `TextEncoder`, `crypto` and `Blob`, Node has as well. The browser-only ones
  that remain are the named seams of the boundary test. Once step 4 removed them, the lib can shrink to ES plus a few
  declared globals. The platforms compile in their own subpaths with their own `lib`.
- **One suite per seam.** The SDK defines a contract suite per interface (`defineStorageBackendContract(create)`, the
  same for `HttpClient`, `EmbeddedDatabase`, `UpdateScheduler`, `WasmSource`), and each implementation runs it: OPFS
  and IndexedDB in the browser tests, `node:fs` in the Node tests, an in-memory fake in both.
- **Scenarios against the runtime, written once.** The tests of the SDK import only the SDK and a
  `createTestRuntime()` of their platform: open a workbook, edit and check scripts, run queries on the embedded Hyper,
  update catalogs, pack and unpack, links. The Node target runs them with the Node platform, the browser targets with
  the browser platform. A test fails when a scenario file isn't part of both targets.
- **Connectors offline.** Recorded HTTP exchanges (the Trino recordings of `tests/snapshots/profiles/trino/recordings/`,
  the Salesforce mocks) answer through the `HttpClient` seam on both platforms.
- **Artifacts across platforms.** `pack` writes byte for byte the same `.dashql` on both (fixed ZIP times, the same
  Parquet settings), a checked-in file reads back the same rows on both, and a file packed in Node imports in the
  browser.
- **Capabilities.** The runtime lists what it can do. A test compares the lists of both platforms and allows only the
  differences that this document names (owning OPFS, the limits of CORS).

## Costs and risks

- **Step 3 is the real work.** It touches the startup, and many `.test.tsx` files build provider trees. They get
  simpler (one runtime, often without React), but there are many.
- **Assets.** `runtime/core_provider.tsx` and `platform/hyperdb/hyperdb_provider_web.ts` import Wasm with Vite's
  `?url`. The SDK can't; the app passes URLs through `WasmSource`.
- **Bazel.** A new package with Wasm assets and Node tests.
- **Ownership.** The app owns OPFS (`platform/crosstab/app_ownership.ts`); the CLI works on folders on disk. On the
  desktop both may touch the same native workbook; native file sync picks up changes from outside
  (`docs/design/native_file_sync.md`).

## Open

- **The Rust CLI.** `lint` and `format` are core functions and move into the SDK; the agent server could move to
  Node. DashQL.app can run the Node CLI with Electron's Node (`ELECTRON_RUN_AS_NODE`). Replace the Rust `dashql` once
  step 4 works, or keep it for native-only parts.
- **Bun.** AI Suite ships Bun 1.3.5. It can't load the embedded Hyper until JavaScriptCore has memory64. The core and
  the commands without Hyper may run; that is untested. Run the SDK's tests without Hyper under Bun as well, and the
  rest once JavaScriptCore has memory64.
- **A plain-JSON link.** A workbook without results as JSON in the fragment of the link, for agents without the CLI.
