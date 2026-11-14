# DashQL SDK

Status: proposed. Nothing here is built.

`packages/dashql-sdk` (`@ankoh/dashql-sdk`) holds the logic of DashQL without React: the workbook model and its
format, the analysis of scripts, the connectors, query execution, the catalog and the computations. The app and a
Node command line tool share it. An agent then works on workbooks with the same code the app runs, through a
`dashql` command, while the user looks at the result in the app.

| Part | State |
|---|---|
| Untangling in place (leaks, `Store` without React) | Planned, step 1 |
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

### Three imports pull UI code into the domain

The transitive closure of the value imports of these modules reaches React, CodeMirror or a `.tsx` file only here:

| Leak | Fix |
|---|---|
| `connections/catalog/catalog_update_state.tsx` has no React and no JSX | Rename to `.ts` |
| `connections/connection_label.ts` imports `isListedConnection` from `connection_registry.tsx`, which mixes pure functions (`registerConnection`, `isListedConnection`, `applyConnectionAction`, …) with providers | Move the pure part into its own `.ts` module |
| `workbook_scripts.ts` imports `DashQLCompletionState`, `DashQLPendingDiff` and `DashQLProcessorUpdateOut` from `workbook/editor/dashql_processor.ts`, which imports `@codemirror/state` | The types hold only core buffers and patches; move them into a module without CodeMirror |

Clean today: the workbook format, the storage writer and the query state (`storage/workbook_tables.ts`,
`storage/storage_writer.ts`, `query/query_execution_state.ts`): 36 files, about 5,500 lines, no `.tsx`. After the
three cuts, `workbook_scripts.ts` (about 67 reachable files) and `connection_state.ts` (about 44) follow.

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
   `react-dom`, `@codemirror/*`, a `.tsx` file or a `?url` asset.
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
