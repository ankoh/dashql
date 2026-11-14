# DashQL SDK

Status: step 1 is built, the rest is proposed.

`packages/dashql-sdk` (`@ankoh/dashql-sdk`) holds the logic of DashQL without React: the workbook model and its
format, the analysis of scripts, the connectors, query execution, the catalog and the computations. The app and a
Node command line tool share it. An agent then works on workbooks with the same code the app runs, through a
`dashql` command, while the user looks at the result in the app.

| Part | State |
|---|---|
| Untangling in place (leaks, `Store` without React), `//packages/dashql-app:sdk_boundary_test` | Done, step 1 |
| `packages/dashql-sdk` with the clean modules | Planned, step 2 |
| Services in place of providers, one runtime | Planned, step 3 |
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
  `dashql run` and never `node`. `hyperdb-wasm` requires Node 24 or later; the core alone runs on older versions.
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
them, `//packages/dashql-app:sdk_boundary_test` keeps them cut:

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

What the closure still reaches that only a browser or the bundler provides, for steps 2 and 4:

- `connections/catalog/prefetched_hyper_functions.ts` imports the functions of Hyper as SQL text with Vite's `?raw`
  (`static/catalog/hyper/dashql-catalog-functions.sql`). The test lists it as a known asset import.
- `connections/catalog/catalog_batch.ts` imports `@ankoh/dashql-core/browser-worker`.
- `storage/storage_backend.ts` and `workbook/attachments/attachment_mounts.ts` import `platform/opfs_root.ts`
  (`navigator.storage`).

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
3. **Services out of providers.** One at a time: `QueryExecutor` (from `query_executor.tsx`), `CatalogLoader`,
   `WorkbookExecution`, `ConnectionPersistence`, the connector setups, the restore (from `app_state_loader.ts`). Each
   provider turns into a field of the runtime until `RuntimeProvider` is the only one. `createRuntime` states the
   startup order that the nesting implies today (the embedded Hyper needs the core, the Hyper setup needs the
   embedded Hyper).
4. **Node platform.** A storage backend over `node:fs` (`NativeStorageBackend` with the fs functions passed in), a
   fetch client, `EmbeddedDatabase` over `hyperdb-wasm` `node`, Wasm from files, auth. The CLI on top: offline
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

- **Compile time.** The SDK compiles without the DOM and without the types of Node (`lib` ES only, plus the few
  globals both have: `fetch`, `URL`, `TextEncoder`, `queueMicrotask`, `setTimeout`). An API of only one platform fails
  the type check of the SDK. The platforms compile in their own subpaths with their own `lib`.
- **One suite per seam.** The SDK defines a contract suite per interface (`defineStorageBackendContract(create)`, the
  same for `HttpClient`, `EmbeddedDatabase`, `UpdateScheduler`, `WasmSource`), and each implementation runs it: OPFS
  and IndexedDB in the browser tests, `node:fs` in the Node tests, an in-memory fake in both.
- **Scenarios against the runtime, written once.** The tests of the SDK import only the SDK and a
  `createTestRuntime()` of their platform: open a workbook, edit and check scripts, run queries on the embedded Hyper,
  update catalogs, pack and unpack, links. The Node target runs them with the Node platform, the browser targets with
  the browser platform. A test fails when a scenario file isn't part of both targets.
- **Connectors offline.** Recorded HTTP exchanges (the Trino recordings of `snapshots/profiles/trino/recordings/`,
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
- **Bun.** AI Suite ships Bun 1.3.5; run the SDK's tests under Bun as well.
- **A plain-JSON link.** A workbook without results as JSON in the fragment of the link, for agents without the CLI.
