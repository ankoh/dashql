# DashQL runtime

Status: steps 1 to 3 are built. Step 4 has the OAuth flow, the restore, the runtime object with the `RuntimeProvider`
of the app, the Node platform with the embedded Hyper, and the CLI with `lint`, `format`, `run` and `session serve`.
Open: `dashql auth`, `workbook check`/`pack`/`link`, and step 5.

`packages/dashql-runtime` (`@ankoh/dashql-runtime`) holds the logic of DashQL without React: the workbook model and its
format, the analysis of scripts, the connectors, query execution, the catalog and the computations. The app and a
Node command line tool share it. An agent then works on workbooks with the same code the app runs, through a
`dashql` command, while the user looks at the result in the app.

| Part | State |
|---|---|
| Untangling in place (leaks, `Store` without React) | Done, step 1 |
| `packages/dashql-runtime` with the clean modules, `//packages/dashql-runtime:boundary_test` | Done, step 2; their tests run in Node and in the browser tests of the app |
| Services in place of providers | Step 3: the query executor, the catalog loader, the runs of workbooks and saving connections, done |
| The connector setups | Step 4: the setups of Salesforce and Trino take an `OAuthFlow` of the platform, done |
| The restore | Step 4: the restore is a command of the runtime of the module (`CoreRuntime.restore`), the Hyper links of a tab, done |
| One runtime | Step 4: `createRuntime` in `runtime.ts` over the runtime of the module, the `RuntimeProvider` of the app, done |
| Node platform | Step 4: `createNodePlatform` with a workbook folder over `node:fs`, fetch and the core from its file, done; the embedded Hyper over a root folder with the layout of OPFS, done |
| The CLI on top | Step 4: the Node `dashql` with `lint` and `format`, done; `run` on Trino with basic auth and the embedded Hyper, results in the query result cache, done; `session serve` with the journal of a workspace, done; `workbook check`, `pack`, `link`, `auth` follow |
| Editor state out of `ScriptData` | Later, step 5 |

## Why

- **One implementation.** `workbook check`, `pack`, `link` and `run` in the CLI must give the answers of the app. A
  second implementation would drift from `storage/workbook_tables.ts`.
- **Agents iterate over SQL.** The agent writes scripts, checks them against the catalog, runs them where it may
  and fixes them. The commands it runs most work offline on files, so they work in sandboxed harnesses (Codex blocks
  loopback, listening and DNS inside its sandbox). Commands that need the network (`run`, catalog refreshes) are
  separate subcommands that a user can allow once by prefix.
- **Node is where agents run.** The CLI is an npm package with a real `dashql` command, so an approval rule can name
  `dashql run` and never `node`. The embedded Hyper needs Node 24 or later (see
  [Runtimes for the embedded Hyper](#runtimes-for-the-embedded-hyper)); the core alone runs on older versions.
- **Tests without a browser.** The runtime's tests run in Node.

## Findings

What the app looked like before step 1, with the paths of then.

### The state already lives outside React

`utils/store.ts` (now `store/store.ts` of the runtime) has `Store<T>` (`current`, `subscribe`, `update`) and `UpdateQueue<T>`. The registries free Wasm
objects and schedule storage writes while they reduce, so an update must run exactly once, which React's state hooks
don't promise. Components read the stores through `useSyncExternalStore`. React appears only in:

- the type `React.SetStateAction`,
- `requestAnimationFrame` in `UpdateQueue` (updates that may wait for the next frame),
- `useStore`, `useStoreState` and `useUpdateQueue`.

### The reducers take their dependencies as arguments

- `reduceWorkbookScripts(state, action, storage, logger)` (`workbook/scripts/workbook_scripts.ts`, 29 actions)
- the computations, the connections with their queries and the query history of the shell are views of the runtime of
  the module (`core_runtime.ts`, see [core_runtime.md](core_runtime.md) and [runtime_api.md](runtime_api.md))

### Imports that pulled UI code into the domain

The transitive closure of the imports of these modules reached React, CodeMirror or a `.tsx` file here. Step 1 cut
them, `//packages/dashql-runtime:boundary_test` keeps them cut:

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

Step 2 moved the 94 modules into `packages/dashql-runtime/src` with the folders they had in the app (`connections/`,
`workbook/`, `storage/`, `query/`, `platform/`, …), so their relative imports stayed, and the app imports them as
`@ankoh/dashql-runtime/<path>`. A source package like `@ankoh/dashql-ui`: linked as `//:node_modules/@ankoh/dashql-runtime`,
mapped in the root `tsconfig.json` and the Vite config. Bazel type-checks the runtime against the `WebWorker` lib of
TypeScript (no `window`, no `document`, no elements) with its own copies of the generated `@ankoh/dashql-protobuf` and
`@ankoh/dashql-jsonschema` (`tsconfig.bazel.json`, `tsconfig.bazel.test.json` for the tests). `platform/electron_fs.ts`
owns the type of the file system of the Electron bridge, the global declaration of the app (`types/electron.d.ts`)
refers to it.

Two properties of the source package hold:

- **Editors resolve everything.** An editor checks a module of the runtime with the `tsconfig.json` of the package, which
  extends the root `tsconfig.json` and its paths into `bazel-bin` (the core, the generated packages), with the lib of
  the runtime and the globals of vitest. `//packages/dashql-runtime:editor_config_test` fails when the config stops extending
  the root, or when a module imports a package that is neither a path of the root `tsconfig.json` nor a dependency of
  the root `package.json`.
- **The dev server picks up edits.** The Vite alias points at the sources and `server.fs.allow` includes them, so the
  dev server serves and watches them like the sources of the app. An edit of a module of the runtime arrives as hot
  updates; since the modules of the runtime export no components, the update climbs to the app and often ends in a
  full reload, as it did before the move. An edit of a component of `dashql-ui` updates in place.

`//packages/dashql-runtime:boundary_test` reads every module: none leaves the package, reaches React, an editor or a
`.tsx` module, and the seams that only a browser or a bundler provides are known by name. The runtime uses no feature
of a bundler: the functions of Hyper are SQL text in the core module (`catalog_loader/prefetched_hyper_functions_sql.rs`)
and the platform provides the specs of the extensions (`provideClientFunctionSpecs` of `connections/clfn/clfn_specs.ts`;
the app passes its `import.meta.glob` in `connections/clfn/bundled_clfn_specs.ts`, which its pages and the test frame
import, the tests in Node in `test/setup_node.mjs`). The seams that remain are listed in `KNOWN_SEAMS` of the test:

- The origin private file system: only `platform/opfs_root.ts` reads `navigator.storage`. The other modules that keep
  files ask it for the root (`getOPFSRoot()`), and Node hands them a folder of the host (`setOPFSRootProvider`).
- The Electron bridge: `platform/electron_fs.ts`, the file system of the desktop app. Which host the app runs in
  (`native_globals.ts`) and which connectors it offers there are questions of the app and live in it.

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
  and a flag on the command line breaks approval by prefix and launches through `npx`. Before it compiles the engine,
  `node/node_hyperdb.ts` runs the check of hyperdb-edge (`checkWasmFeatures` of
  `packages/hyperdb-edge/src/node/runtime_check.ts`, linked as `@ankoh/hyperdb-edge`), which calls
  `v8.setFlagsFromString('--experimental-wasm-exnref')` when exnref is missing, so every Node 24 runs it without flags. The CLI declares `engines: node >=22`, for the commands without Hyper.
- **The `node` of a harness may not be the one of the shell.** MCP servers and hooks start without the login shell,
  and other tools put their own older Node on `PATH`. Before the engine starts, the runtime validates a tiny module per
  feature (`WebAssembly.validate`) and names `process.execPath` and the missing feature, instead of failing in V8.
- **Hyper only where it's needed.** The CLI loads `hyperdb-wasm` lazily, in commands that query the embedded Hyper.
  `check`, `pack`, `unpack`, `link`, `lint` and `format` need only the core, so they run on older Node too.

## Layout

```
packages/dashql-runtime             @ankoh/dashql-runtime, a source package: `@ankoh/dashql-runtime/<path>` is src/<path>.ts
  src/platform/                     the seams: HttpClient, StorageBackend, FileSystem, EmbeddedDatabase, the OPFS root,
                                    the logger, HyperDB over hyperdb-wasm, the instance folders
  src/store/                        Store, UpdateScheduler, the store of the runtime with its projections
  src/workbook/                     the views of the workbooks and their projections, script runs, execution,
                                    attachments, inputs, persistence
  src/connections/                  connection state and registry service, connector setups and clients, the catalog
                                    loader, the query executor service, the specs of client functions
  src/query/, src/compute/          query execution state and profiles, computations and data frames
  src/storage/                      workbook tables, the storage of the platform and the commands of the writer of the
                                    runtime, the query result cache, migrations
  src/session/                      the journal of an agent session and its state
  src/oauth/, src/sql/              the OAuth flow; lint, format and reports of SQL files
  src/runtime.ts                    createRuntime(platform) → Runtime
  src/node/                         the only modules that import node:, e.g. @ankoh/dashql-runtime/node/node_platform:
                                    the platform of Node, node:fs handles of the OPFS root, the embedded Hyper of Node,
                                    the core from its file, the locks of the process
  src/testing/                      helpers of the tests on both platforms
packages/dashql-app                 the RuntimeProvider creates the runtime (see React after the move), UI-only state:
                                    CodeMirror, focus, view modes, overlays, ownership
packages/dashql-cli                 the dashql command: lint, format, run, session
```

```ts
interface Runtime {
    platform: RuntimePlatform;
    core: core.DashQL;
    logger: Logger;
    /// The runtime of the module: the connections with their queries, the executor, the setups, the catalog loader,
    /// the saves, the computations, the workbooks, the storage writer (`coreRuntime.storage`) and the restore
    coreRuntime: CoreRuntime;
    execution: WorkbookExecutionService;
    restore(progress?: (progress: core.RestoreProgress) => void): Promise<core.RestoreOutcome>;
    destroy(): Promise<void>;
}
```

### Platform seams

| Seam | Browser | Desktop | Node |
|---|---|---|---|
| HTTP | fetch, limited by CORS | native proxy | fetch |
| Storage | OPFS | files over IPC | files (`node:fs`) |
| Embedded Hyper | `hyperdb-wasm` in a worker, cross-origin isolated | the same | `hyperdb-wasm` `node` |
| Core Wasm | URL from the bundler | the same | file next to the package |
| Auth | redirect through `oauth.html` | loopback (`oauth_loopback.ts`) | refused for now; planned: loopback with PKCE (`dashql auth`) |
| Scheduler | microtask, `requestAnimationFrame` | the same | microtask, `setImmediate` |

## React after the move

Built. One `RuntimeProvider` (`packages/dashql-app/src/runtime/runtime_provider.tsx`) creates the runtime with
`createRuntime` over the platform of the app and replaces the providers that each created a service. The app and the
CLI wire the services in one place, and the tests of `runtime.ts` cover the wiring of the app.

- **The platform of the app.** The provider sits below the providers of the storage, the http client, the core, the
  embedded database, the query result cache and Salesforce, and passes them to `createRuntime`; the storage writer is
  the one of the runtime: the app flushes it when the page hides and stops it when another tab takes over.
  The compute database starts after the settings loaded and the config may choose the mock of Salesforce, so the
  runtime takes them later (`setComputeDatabase`, `setSalesforce`). `createRuntime` is synchronous, the core is
  instantiated when the runtime needs it.
- **The followers.** The runs follow the workbooks and the connections of the store, before React renders. The
  runtime of the module analyzes the scripts of a connection again when its catalog changed, also in the CLI.
- **Hooks read slices.** `useWorkbookScripts`, `useScript`, `useWorkbookDerived`, `useConnectionById`,
  `useQueryExecutor` and the others read the slices of the store and the services of the runtime. Outside of the provider, e.g. in
  a test of a component, the state hooks return no state and the functions throw when they are called, like the
  contexts without a provider before.
- **Computations.** They are the first domain of the `Runtime` class of the module (see [runtime_api.md](runtime_api.md)).
  `CoreRuntime` (`core_runtime.ts`) holds it with its platform object and its store, the runtime creates one as its
  `coreRuntime` and the shell of Hyper, which has no runtime, one of its own (`StandaloneCoreRuntime`). Components
  read the views with `useView` and its aliases and dispatch with `useDispatch` (`runtime/runtime_hooks.tsx`); the
  first command takes the core of the platform.
- **Tests.** `TestRuntime` (`packages/dashql-app/src/tests/test_runtime.tsx`) is the provider in the tests of
  components: the catalog loader stopped like in `createTestRuntime`, and the functions of the query executor that a
  test replaces.
- **Wasm lifetimes** stay in the reducers inside the stores.
- **Editor state** stays in `ScriptData` with types free of CodeMirror. Step 5 moves `completion`, `pendingDiff` and
  the focus into an editor store of the app keyed by workbook and script.

## Steps

Each step ships on its own and keeps the behavior.

1. **Untangle in place.** Rename `catalog_update_state.tsx`, split the pure part of `connection_registry.tsx` and
   `workbook_scripts_registry.tsx` into `.ts` modules, move the editor data types out of `dashql_processor.ts`, make
   `Store` free of React with a `Scheduler`. Add a test that fails when a module of the runtime set imports `react`,
   `react-dom`, `@codemirror/*`, a `.tsx` file or a `?url` asset. Done.
2. **Draw the package line.** Move the clean set into `packages/dashql-runtime`, a source package with tests in
   Node. The app imports from `@ankoh/dashql-runtime`. Done.
3. **Services out of providers.** Done for four services of the runtime, each a class with its dependencies passed in
   and its state as a `Store`:
   - `QueryExecutorService`, with the computations, the result cache, the tracked execution and the profile layout of
     the query progress (`query/profile/`), since step 2 of [runtime_api.md](runtime_api.md) the executor of the
     runtime of the module with `query/query_platform.ts` as its host half;
   - the catalog loader, since step 3 of [runtime_api.md](runtime_api.md) a service of the runtime of the module that
     follows its connections (`refreshCatalog`);
   - `WorkbookExecutionService` (`workbook/scripts/workbook_execution_service.ts`), with the runs of single scripts;
     the engine of the runs is Rust (`docs/wip/core_runtime.md`, The runs of workbooks);
   - `ConnectionPersistenceService`, since step 2 of [runtime_api.md](runtime_api.md) the saves of the runtime of the
     module.

   The rest waited for the seams of step 4, with the runtime object that replaced the nesting of providers.
4. **Platform seams and Node.** An OAuth flow, done: `oauth/oauth_flow.ts` of the runtime opens the authorization page
   and receives the redirect, through the redirect page (`oauth.html`, to the opener in a browser or as a link of the
   desktop app) or a loopback server (Trino). A connector builds the URL and exchanges the code. The app implements it
   in `oauth/app_oauth_flow.ts` (a popup that a dialog reserved during the click, the Electron bridge); the setups of
   Salesforce and Trino, their mocks and `connector_configs.ts` moved into the runtime. The restore, done:
   `workbook/persistence/app_state_loader.ts` moved with `connection_restore.ts`, `embedded_connection.ts` and the
   Hyper links (`connections/hyper/hyper_link.ts`). A `HyperLinkTabStore` keeps the links of a tab in a
   `KeyValueStorage` (`platform/key_value_storage.ts`) that the platform passes in; the app holds the one of its tab
   over `sessionStorage` in `connections/hyper/hyper_link_tab.ts`, with the hooks. The test helpers `TestLogger` and
   `WorkbookTestBackend` moved to `src/testing/`, so the restore is tested in Node. The runtime object, done: the
   workbooks and the connections are domains of the runtime of the module (steps 2 and 4 of
   [runtime_api.md](runtime_api.md));
   `createRuntime(platform)` in `runtime.ts` wires it with the runs of workbooks,
   `restore()` loads the stored state into it and `destroy()` writes what is pending. `runtime.test.ts`
   writes a workbook with one runtime and restores it with a second one in Node. The app creates it in its
   `RuntimeProvider` (see React after the move). The Node platform, done: `NativeStorageBackend` (one workbook in a folder) moved into the runtime and
   takes a `FileSystem` (`platform/file_system.ts`); the app passes `ELECTRON_FILE_SYSTEM`, Node passes
   `NODE_FILE_SYSTEM` (`node/node_file_system.ts`). The modules of Node live in `src/node`, the only place that
   imports `node:` (the boundary test checks it), with a type check of their own against the types of Node
   (`tsconfig.bazel.node.json`, `src/node/tsconfig.json` for editors). `createNodePlatform` (`node/node_platform.ts`)
   passes a storage backend, `fetch` (`WebHttpClient`, moved from the app) and the core from the Wasm file of its
   package (`node/node_core.ts`) to `createRuntime`; its OAuth flow refuses until `dashql auth` brings one. The
   embedded Hyper of Node runs over a root folder with the layout of OPFS (see The CLI on the runtime). The CLI on
   top: `run` and `session serve` are built, the offline `workbook check`, `pack`, `unpack` and `link` and
   `catalog refresh` follow.
5. **Editor state.** Out of `ScriptData` into the app.

## The CLI on the runtime

Everything the CLI does goes through the runtime. `packages/dashql-cli` is a Node package on `@ankoh/dashql-runtime` with the
`dashql` command, bundled with Vite's server build into one module (`dist/dashql.js`); the core stays a package next
to it, its Wasm file is read from there. `lint` and `format` run on `sql/sql_lint.ts`, `sql/sql_format.ts` and
`sql/sql_report.ts` of the runtime; the Rust `dashql` is gone. The agent bridge and its server are gone too, an agent in
the terminal reaches the page through `dashql session serve` (`docs/wip/agent_session.md`). Planned: DashQL.app ships
the CLI and runs it with Electron's Node (`ELECTRON_RUN_AS_NODE`).

- **Offline by default.** `check`, `pack`, `unpack` and `link` read and write files in the workspace, nothing else.
- **`dashql auth`.** The Node platform passes an `OAuthFlow` with a loopback server on `127.0.0.1` and the browser of
  the system. Trino redirects to the loopback directly. The connected app of Salesforce redirects to the fixed
  `oauth.html`, which gets a third way back: to a loopback URL that the state names, only to `127.0.0.1` or
  `localhost`. PKCE keeps the code useless without the verifier of the CLI. `dashql auth login` keeps the tokens for
  `run` and `catalog refresh`; it listens and reaches the network, so the user runs it or approves it by prefix.
- **Network in separate subcommands.** `run` and `catalog refresh` reach connections; a harness approves them by
  prefix (`dashql run`), never through `node` or `npx`.
- **Results stay in files.** Harness telemetry records tool output, so `run` prints the error with its position, the
  schema, the row count and a few rows, and writes the result as Parquet into the workbook.
- **`dashql run`, built.** `dashql run [--plain] [--workspace <dir>] <workbook-dir> [<script>...]`
  (`packages/dashql-cli/src/run_command.ts`) loads the folder with `restoreWorkbook` of the runtime over a
  `NativeStorageBackend` and runs it like the Run of the workbook in the app: `runWorkbookExecution` with the services
  of the runtime, all scripts or the named ones as `targets` with what they need. Scripts of different connections run
  at the same time; the first failed statement stops the run. The first interrupt cancels the running queries, the
  second ends the process. What is built:
  - Events of the scripts. `runWorkbookPlan` reports what happens to every script through `onScript`
    (`ScriptRunEvent`: planned with the scripts it follows, cached, skipped with a reason, started, done with its key
    and the query of its output, failed, cancelled). The command turns them and the progress of the running queries
    into `RunEvent`s (`run_events.ts`) that reporters show: the live view on a terminal (`run_live.ts`, settled lines
    in the scrollback and a region drawn again in place below them), plain lines for agents and pipes
    (`run_output.ts`, nothing while scripts run, a summary at the end), and the markers of the journal of a session
    (`run_journal.ts`). `term.ts` decides between the two views: a live view only when stdout is a terminal.
  - Trino with basic auth. `DASHQL_TRINO_USER` and `DASHQL_TRINO_PASSWORD` override the user and the password of
    the workbook; the connection keeps the params of the workbook, so the credentials of the environment are never
    written (a successful setup otherwise saves the params it was set up with into every workbook of the connection).
  - The embedded Hyper, see below. Its connection is a session of the `hyper` database of the instance in an
    `EmbeddedHyperDatabaseChannel` (`connections/embedded/`, moved from the app) like in the app.
  - The setups are commands of the runtime (`setupConnection` with the credentials of the environment as the params of
    the channel; the embedded Hyper of the run connects with `connectEmbeddedHyper`), the outcome says why a setup
    failed, e.g. a rejected login. The run of a plan sets up the
    connections of the scripts it will run, all at once (`prepareConnection` of `runWorkbookPlan`), so a result that
    the cache serves needs none. The scripts of a connection that can't be set up are skipped like those of a
    connection that can't run, the others still run.
  - It prints the schema, the row count and the first rows (`--rows`), the file of the result in the query result
    cache, and the message of Trino on a failure with the line of the statement it points at. A cached result is
    served like in the app, `--refresh` runs again.
  - The results are not analyzed (the summaries of the app), the catalog loader is stopped; `catalog refresh` follows.
  - Tested against a fake Trino in `//packages/dashql-cli:test`, the bundle in `:binary_test`, by hand against
    `bazel run //:trino`.
- **The root of Node.** The CLI brings its own root, a folder with the layout of the origin private file system
  (`DASHQL_HOME`, else the `.dashql/` of the workspace that `session serve` created, else `~/.dashql`;
  `docs/design/storage_layout.md`), so the modules of the runtime that keep files in the
  root run unchanged: `setOPFSRootProvider` (`platform/opfs_root.ts`) hands them `NodeDirectoryHandle`s
  (`node/node_directory_handle.ts`), the handles of the File System Access API over `node:fs` that the modules use, with
  the path of the host. `openNodeComputeDatabase` (`node/node_hyperdb.ts`) starts the build of `hyperdb-wasm` for Node
  lazily with the root as its storage, which the engine sees at `/mnt/fs` like OPFS, opens an instance folder like a
  window of the app and creates the query result cache of the root (`storage/opfs_query_result_cache.ts`, moved from
  the app). The `HyperDB` of the app (`platform/hyperdb/hyperdb_wasm.ts`, with `hyperdb_arrow_insert.ts` and
  `hyperdb_settings.ts`) moved into the runtime and imports only the types of `hyperdb-wasm`: it mounts the path of a
  handle of the host, and a `mountFile` option writes the files that statements mount (the Arrow IPC of an insert) into
  the instance folder first, the build of Node mounts only files of the host. `mirrorWorkbookAttachments`
  (`workbook/attachments/attachment_mirror.ts`) copies the attachments of a workbook folder into the root.
  The instance folders are one module for both (`platform/hyperdb/hyperdb_opfs_instance.ts`): a window of the app
  holds a Web Lock per instance, a process of Node a pid file (`node/node_instance_locks.ts`), and the folders of
  instances whose holder is gone are removed at the start.
- **What differs in Node.** The root is not the one of the app: a viewer mirrors what it needs into its OPFS, e.g. the
  connection of a live view. The Web Locks of the cache are those of the process (`node/node_locks.ts`), a root that
  two processes use at once is not protected.

## Testing both platforms

The browser and Node must offer the same: every feature of the runtime runs, and is tested, on both.

- **Where they run.** `//packages/dashql-runtime:test_node` runs the tests of the runtime in Node with vitest
  (`vitest.config.mjs`, `test/setup_node.mjs` sets the precompiled core like the browser test frame of the app). The
  tests live next to the modules, their helpers in `src/testing/`, and a type check of their own
  (`tsconfig.bazel.test.json`) gives them the globals of vitest while the modules stay checked without them. The
  browser tests of the app run the tests of the runtime as well (`runtime/src/<path>` in their list), so each one runs
  in Node and in the browsers. A test of Node is named `*.node.test.ts` and runs only in Node, like
  `node/node_file_system.node.test.ts`. A test that needs a browser is named `*.browser.test.ts` and runs only in the
  browsers: `hyperdb_wasm.browser.test.ts` (the HyperDB adapter over the browser build of hyperdb-wasm with a fake
  worker client).
- **What they cover.** 92 test files, about 900 tests in Node: the workbook scripts, script runs and workbook
  execution, the storage writer, native storage, bundles and the query result cache, the connection state, the
  Salesforce and Hyper HTTP clients, the catalog queries and updates, the computations and data
  frames, the services, the embedded Hyper of Node and the journal of a session. Tests of the app that need parts of
  the app stay in the app until those parts move.
- **The embedded Hyper in tests.** `openTestHyperDB(context)` (`src/testing/test_hyperdb.ts`) returns a HyperDB with
  databases of its own on the engine that the tests of a platform share. The browser tests of the app install it over
  their engine worker (`tests/hyperdb_pool.ts`), `test/setup_node.mjs` over the embedded Hyper of Node: one engine per
  test file, started by the first test that needs it, about 1.5 s. Every test file in Node also gets a root of its own
  with the layout of OPFS (`useNodeRoot`), so `getOPFSRoot()` works, and the locks of the process where Node has no Web
  Locks.
- **The services in Node.** The tests of the providers of the app became tests of the services of the runtime:
  `WorkbookExecutionService` (starting and stopping runs, the connections a run needs, previews, changes of inputs);
  the workbooks, the connections, their setups, the catalog loader, the queries and their saves are tested on the
  runtime of the module (`runtime_workbooks.test.ts` and `runtime_connections.test.ts` of `dashql-core-js`) and
  through `CoreRuntime` (the handles, the workbooks, the tracked queries). `createTestRuntime()` (`src/testing/test_runtime.ts`)
  is a `createRuntime` on an in-memory platform with an optional compute database and result cache, its catalog loader
  stopped unless a test asks for it, so it schedules no updates. The app keeps the
  tests of what React adds: hooks, rendering order, remounting and unmounting.
- **Export and import in Node.** Writing and reading `.dashql` files (`workbook/persistence/workbook_export.ts`,
  `workbook_import.ts`, `workbook_zip.ts`, `storage/workbook_tables_parquet.ts`) moved into the runtime with their
  tests and `workbook_execution_integration.test.ts`; a link takes the URL of the app that opens it, the app passes its
  own, `workbook_link.ts` has the one of the desktop app.
- **The compute tasks.** The tasks of the computations (aggregation, filtering, ordering, search, system columns) run in
  the runtime of the core (`packages/dashql-core-runtime/src/compute`); the app keeps `compute/computation_scheduler.tsx`,
  which tracks their queries in React.
- **What remains in the app** (the inventory of the test files): the OPFS and composite storage backends; the
  connector setups, which need a fake `OAuthFlow`; the snippets and the local cloud.
- **Compile time.** The runtime compiles against the `WebWorker` lib, without the DOM and without the types of Node; the
  APIs it uses there, like `fetch`, `URL`, `TextEncoder`, `crypto` and `Blob`, Node has as well. The browser-only ones
  that remain are the named seams of the boundary test. Once they are gone, the lib can shrink to ES plus a few
  declared globals. `src/node` compiles with the types of Node.

Planned:

- **One suite per seam.** The runtime would define a contract suite per interface (`defineStorageBackendContract(create)`, the
  same for `HttpClient`, `EmbeddedDatabase`, `UpdateScheduler`, `WasmSource`), and each implementation runs it: OPFS
  and IndexedDB in the browser tests, `node:fs` in the Node tests, an in-memory fake in both.
- **Scenarios against the runtime, written once.** The tests of the runtime import only the runtime and a
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
  `?url`. The runtime can't; the app passes URLs through `WasmSource`.
- **Bazel.** A new package with Wasm assets and Node tests.
- **Ownership.** The app owns OPFS (`platform/crosstab/app_ownership.ts`); the CLI works on folders on disk. On the
  desktop both may touch the same native workbook; native file sync picks up changes from outside
  (`docs/design/native_file_sync.md`).

## Open

- **Bun.** AI Suite ships Bun 1.3.5. It can't load the embedded Hyper until JavaScriptCore has memory64. The core and
  the commands without Hyper may run; that is untested. Run the runtime's tests without Hyper under Bun as well, and the
  rest once JavaScriptCore has memory64.
- **A plain-JSON link.** A workbook without results as JSON in the fragment of the link, for agents without the CLI.
- **The locks of the process.** The Node of Bazel, 24.22.1, has Web Locks (`navigator.locks`), the first releases of
  Node 24 don't. `node/node_locks.ts` can go once the embedded Hyper requires a Node with them.
