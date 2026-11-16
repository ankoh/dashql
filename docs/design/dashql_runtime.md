# DashQL runtime

The runtime of DashQL is the state of the app and the services that change it: the workbooks with their scripts, the
connections with the histories of their queries, the computations of query results, the query executor, the catalog
loader, the setups of connections, the runs of workbooks, the storage writer, the restore, the migrations and the
imports and exports. It is Rust: the `Runtime` class of the core module (`packages/dashql-core-wasm/src/runtime.rs`)
over the crate `dashql_core_runtime`, see [dashql_core.md](dashql_core.md).

TypeScript holds one facade over it, `Runtime` of `packages/dashql/src/runtime/runtime.ts`. The facade builds the
platform object that the Rust runtime calls for its I/O, owns the handle table of the JavaScript objects that Rust
names by number, keeps the store of the views that the app reads, and has typed commands where a caller needs more than
the module returns. The app, the shell of Hyper, the command line tool and the tests hold the same class.

This document describes the runtime from the outside in: the package, the platform, the seam between TypeScript and
Rust, the app, Node, and the tests.

## The package `@ankoh/dashql`

`packages/dashql` is one source package, `@ankoh/dashql`. Nothing in it is compiled: the app, the command line tool and
the tests bundle and run its TypeScript. It is linked as `//:node_modules/@ankoh/dashql` for Bazel, and mapped in the
root `tsconfig.json` and the Vite config of the app for editors and the dev server. Its three folders of `src/`:

| Folder | Imported as | Holds |
|---|---|---|
| `src/core` | `@ankoh/dashql`, `/buffers`, `/browser-worker` | The bindings of the core module: the API over the Wasm (`api.ts`), the `Runtime` class of the module (`runtime.ts`), the batch worker, `readFlatBuffer` and `FlatBufferCache` (`flatbuffer_view.ts`), the generated FlatBuffers |
| `src/runtime` | `@ankoh/dashql/runtime/<path>` | The facade (`runtime.ts`), the store of the views (`store/`), the view projections, and the adapters that build the platform object of the module from the objects of the platform |
| `src/platform` | `@ankoh/dashql/platform/<path>` | The platforms of the browser, the desktop app and Node; storage backends and the storage root, the query result cache in OPFS, the embedded Hyper (`platform/hyperdb/`), HTTP, the logger, OAuth, the connector clients and channels, the types of the views as the app reads them, UI helpers that more than the app uses, and the SQL and session support of the command line tool |

Only the generated parts are outputs of Bazel, folders in `dependencies/` of `bazel-bin/packages/dashql`, and the
sources import them by name: `@ankoh/dashql-wasm` (`:dep_wasm`, the wasm-bindgen glue and the Wasm of the core and of
the dataflow layout; every glue exports the URL of its Wasm as `wasmUrl`), `@ankoh/dashql-flatbuffers`
(`:dep_flatbuffers`), `@ankoh/dashql-protobuf` and `@ankoh/dashql-jsonschema`. A consumer maps them with paths of
`tsconfig.json` and aliases of Vite or vitest.

### What goes where

- **`src/core`** is the API over the core module and nothing else.
- **`src/runtime`** is what builds and holds a runtime: `runtime.ts`, `store/` (the store, `projection.ts`, the handle
  table, the Arrow tables by handle, `update_scheduler.ts`), the projections of the workbook and script views
  (`workbook/scripts/workbook_projection.ts`) and of the query views (`query/query_projection.ts`), and the adapters
  that turn platform objects into the platform of the core: `query/query_channels.ts` (the channels of the host and the
  query result cache), `query/query_result_stream.ts`, `query/tracked_query_execution.ts` (queries that the host runs
  and the runtime tracks), `compute/compute_platform.ts`, `workbook/scripts/run_mounts.ts`, `storage/runtime_storage.ts`
  (the storage of the platform and the `StorageWriter` commands), `storage/workbook_archives.ts`,
  `platform_requests.ts` (the fetches and OAuth flows that `destroy` aborts) and `node/node_platform.ts`. A module
  belongs here when it names `RuntimePlatform`, the handle table or a platform type of the core.
- **`src/platform`** is everything else that more than the app uses. It never imports the runtime.
- **The app** keeps what only it uses, at its own paths under `packages/dashql-app/src`: the OPFS and composite
  storage backends, the hooks, the labels of connections, the Hyper links of a tab, the Salesforce mock setup, script
  names and formatting with the app settings, the renames of scripts and attachments, workbook links.

### The boundary test

`//packages/dashql:boundary_test` (`test/boundary_test.mjs`) reads every module of `src/` and fails on each import that
breaks a rule:

- `core/` imports neither `runtime/` nor `platform/`, `platform/` imports `core/`, `runtime/` imports both. Nothing
  imports the app.
- The package imports itself relatively, never as `@ankoh/dashql`, and no relative import leaves `src/`.
- Only `core/` imports `@ankoh/dashql-wasm` and `@ankoh/dashql-flatbuffers`.
- No module imports React, an editor, a UI library, a `.tsx` module or a bundler asset (`?url`, `?raw`, `.css`).
- In `runtime/` and `platform/`, only the modules of Node (`runtime/node`, `platform/node`) import `node:` and other
  modules of Node.
- No module uses a seam that only a browser or a bundler provides (`import.meta.glob`, `navigator.storage`,
  `new Worker`, the Electron bridge) unless it is listed in `KNOWN_SEAMS`: `platform/platform/opfs_root.ts` (the
  origin private file system; Node hands a folder of the host through `setOPFSRootProvider`) and
  `platform/platform/electron_fs.ts` (the file system of the desktop app). The specs of the client functions come
  through `provideClientFunctionSpecs` of `platform/connections/clfn/clfn_specs.ts`: the app passes its
  `import.meta.glob` in `connections/clfn/bundled_clfn_specs.ts`, the tests in Node in `test/setup_node.mjs`.

### Type checks and editors

- `:tsc_typecheck_test` checks the modules against the `WebWorker` lib (`tsconfig.bazel.json`): no `window`, no
  `document`, no types of Node. An API of only one platform fails here.
- `:tsc_typecheck_tests_test` checks the tests of the runtime and the platform with the globals of vitest
  (`tsconfig.bazel.test.json`). The tests of the bindings run but are not type checked.
- `:tsc_typecheck_node_test` checks `src/runtime/node` and `src/platform/node` against the types of Node
  (`tsconfig.bazel.node.json`).
- `:editor_config_test` keeps the `tsconfig.json` of the package extending the root one, and fails on an import that
  is neither a path of the root `tsconfig.json` nor a dependency of the root `package.json`.
- The dev server of the app aliases the sources and watches them: an edit arrives as a hot update, a build of the core
  module replaces the glue and the Wasm and reloads the page.

## Creating a runtime

```ts
const runtime = createRuntime(platform);   // @ankoh/dashql/runtime/runtime
await runtime.restore();
// ...
await runtime.destroy();
```

The platform creates the runtime once its core is there and owns what it passes for the lifetime of the runtime;
nothing is set later. `RuntimePlatform` of `runtime.ts`:

| Member | Required | What |
|---|---|---|
| `logger` | yes | The logger, the Rust runtime logs through it with a target |
| `scheduler` | yes | When the store takes the changes (`UpdateScheduler`: `afterTask`, `beforeFrame`, `cancelFrame`) |
| `core` | yes | The `DashQL` instance whose module creates the runtime |
| `storage` | no | The `StorageBackend` of the workbooks and connections. Without, the runtime keeps nothing |
| `http` | no | The `HttpClient` of fetches, the executor and the setups send through it |
| `oauthFlow` | no | The `OAuthFlow`: opens the authorization page and receives the redirect |
| `channels` | no | A `ChannelConnector` that connects the channels of the host that setups ask for (the embedded Hyper, Hyper over gRPC), and the token of a Hyper link that the page holds. The runtime speaks Trino, Hyper over HTTP and the Hyper of Salesforce itself |
| `computeDatabase` | no | A provider, `() => Promise<EmbeddedComputeDatabase>`: the runtime calls it when a computation, a run or the query result cache first needs the database and waits until the platform set it up |
| `resultCache` | no | The `QueryResultCache` |
| `archives` | no | A factory over the handle table that reads and writes `.dashql` archives (`createRuntimeArchives` of `storage/workbook_archives.ts`: zip.js, Parquet through the embedded Hyper) |
| `catalogLoader` | no | Run the catalog loader, true by default. `dashql run` and most tests turn it off |

The parts that a platform sets up late are providers or read on call: the compute database is a provider, the
`ChannelConnector` of the app reads its clients when a setup connects, and the archives ask for their database when an
archive first needs it.

### The platform object of the module

`createRuntime` builds the one object that the Rust runtime calls (`RuntimePlatform` of the generated declarations,
declared in `packages/dashql-core-wasm/src/host.rs`) from the members above, in `Runtime.modulePlatform`:

| Group | What the runtime asks for | Built by |
|---|---|---|
| `clock`, `log` | Time, timers, the log | `runtime.ts` |
| `handles` | The handle table: `register`, `get`, `duplicate`, `release`, `close`, `abort` | `store/handles.ts` |
| `tables` | Arrow tables by handle: `open`, `push`, `finish` of a streamed result, `begin`, `append`, `read`, `describe` | `store/runtime_tables.ts` |
| `compute` | The compute database: import a table by handle, create a table from a SELECT, query, drop, cancel a run | `compute/compute_platform.ts` |
| `http` | `fetch` and `abort` by id | `platform_requests.ts` |
| `channels` | `connect` a setup's channel of the host, `hyperLinkToken`, and the queries of host channels: `describe` (keeps a record of the query until `forget`), `open`, `next`, `cancel` (also of a query that `open` still opens), `profileDetail`, `forget` | `query/query_channels.ts` |
| `resultCache` | Lookup, read, write, touch, retain, release, import, list, remove, capacity | `query/query_channels.ts` |
| `mounts` | The files of runs in the compute database and the attachments | `workbook/scripts/run_mounts.ts` |
| `crypto` | `randomUuid`, `sha256` (the core has no randomness and no SHA-256) | `crypto` of the platform |
| `oauth` | PKCE, flow info, loopback and redirect-page authorization, abort | `platform_requests.ts` |
| `extensions` | `loadSpec`, the JSON of a client function spec | `loadClientFunctionSpec` |
| `storage` | The workbook files, scripts, attachments, the app manifest, connection files, native folders | `storage/runtime_storage.ts` |
| `archives` | The ZIP container and the Parquet files of the workbook tables | the factory of the platform |
| `changed` | The state changed, `urgent` or not | the store |

Every call into it catches: a member that throws or is missing fails the call of the service with an error, it never
unwinds through the module.

### The platforms

| | Browser | Desktop app | Node |
|---|---|---|---|
| Created in | `RuntimeProvider` of the app | `RuntimeProvider` of the app | `createNodePlatform` (`runtime/node/node_platform.ts`), the CLI |
| Scheduler | `FRAME_UPDATE_SCHEDULER` (microtask, `requestAnimationFrame`) | the same | `TASK_UPDATE_SCHEDULER` (microtask, `setTimeout`) |
| HTTP | fetch (`WebHttpClient`), limited by CORS | the native proxy (`NativeHttpClient` of the app) | fetch (`WebHttpClient`) |
| Storage | OPFS (composite backend of the app) | OPFS and native workbook folders over the Electron bridge | `NativeStorageBackend` over `NODE_FILE_SYSTEM`, one workbook folder |
| Embedded Hyper | `hyperdb-wasm` in a worker, cross-origin isolated | the same | the `node` build of `hyperdb-wasm` (`platform/node/node_hyperdb.ts`) |
| Core Wasm | URL from the bundler | the same | the file of `@ankoh/dashql/wasm` (`platform/node/node_core.ts`) |
| OAuth | popup and the redirect page `oauth.html` (`AppOAuthFlow`) | the browser of the system, a link back to the app or the loopback server of the desktop app | refused; `dashql auth` is planned |
| Channels | `createChannelConnector` of `connections/hyper/hyper_connection_setup.tsx` | the same, gRPC through the native proxy | the CLI connects its embedded Hyper |
| Archives | `createRuntimeArchives` | the same | none |

`createNodePlatform` is async: it loads the core from its file unless one is passed. The shell of Hyper creates a
runtime without storage (`StandaloneRuntime`, below).

## The seam

### Views and slices

The app never reads the Rust state directly. It reads views: plain JS objects with generated types (serde-wasm-bindgen
and tsify), FlatBuffers of the core inside them as `Uint8Array`s, and handles where a value is a JavaScript object. A
view belongs to a slice, a kind and an id (`RuntimeViews` in `runtime.rs`):

| Kind | Id | View |
|---|---|---|
| `computation` | table id | The computation of a result: column groups, tasks, filters, orderings, searches, its tables as handles |
| `connectionList` | `'root'` | The connections in order, whether listed and their ordinals, the ids by connector |
| `connection` | connection id | Connector, params, draft, details with the channel as a handle, health, status, the setup, catalog updates and version, `catalogId`, the queries, the workbooks that use it, the save, token summaries |
| `history` | name | A history without a connection, e.g. the shell's |
| `query` | query id | Status, metadata, metrics, error, the latest progress with the structured progress as FlatBuffers by key, the result table as a handle |
| `workbookList` | `'root'` | The workbooks with their names, the invalid workbooks with their reasons |
| `workbook` | workbook id | Name, metadata, script keys and file names in feed order, attachments, cloud link, connections |
| `script` | script key | The fields of a script, its editor update, staged diff, visualization and statistics as FlatBuffers by key, `cachedResult` |
| `workbookDerived` | workbook id | The checked references, the dataflow and the inputs as FlatBuffers |
| `storage` | `'root'` | Holds, held workbooks, failed writes, questions about external changes |
| `run` | workbook id | `held`, the state of the last run of the whole workbook, the inputs that wait |

A parent lists the ids of its children, not their revisions: a keystroke changes the `script` slice and leaves the
`workbook` slice alone.

### Changes and the flush

1. A service that changes a slice marks it on the platform (`JsPlatform::changed` in Rust), which calls
   `platform.changed(urgent)` once until the store takes the changes. The events of a query between its start and its
   end (progress, batches, the result, the analysis, the cache) are not urgent, nor are the computations; everything
   else is.
2. The store flushes at the end of the task when urgent, before the next frame otherwise (`RuntimeStore.changed` over
   the `UpdateScheduler`). `flush()` flushes at once, e.g. for the command line tool and the tests.
3. `takeChanges()` returns the marked slices, `{ kind, id, revision }` with a null revision for a slice that is gone,
   and the effects on handles (`runtime/changes.rs` of the bindings). A marked slice moves: a script, a query, a
   computation, a run and the storage with the revision of their object, which tells the objects of a mark that
   changed from the others; a connection, a history, a workbook and the lists with a new revision. The derived view of
   a workbook moves when the hash of its buffers changed. Nothing else is compared and nothing is rescanned, so every
   change of state marks its slice; the property test of `runtime_changes.test.ts` checks that every view an action
   changed is named. The queries are marked one by one: the progress of a query moves only that query, its connection
   or history moves when a query starts or finishes.
4. The store aborts and closes at once, then reads the views of each changed kind with one `views(kind, ids, known)`
   call, in the order of the changes. The order of the kinds is the one of `Changes` in `changes.rs`; no projection
   reads another slice.
5. A slice keeps its object while its revision doesn't move. A fresh view is shared with the previous one (`share` of
   `store/projection.ts`), so unchanged parts keep their identity, or built by the projection of its kind.
6. The store forgets the released handles, then notifies the subscribers of the changed slices, then those of their
   kinds.

A view reads as null only for a slice that is gone. A slice that a task holds borrowed is busy: the take leaves it
marked, its view reads as `'busy'` (`BusyView`), and the runtime reports it again with the next changes; the store keeps
the previous view. Every read of the take and of `views` borrows with `try_borrow`, so a platform that calls back into
the runtime while a task holds its state gets busy slices, never a panic. A projection that throws, or a kind whose views
can't be read, keeps the previous views, and the store asks for the slices again (`resync(kind, ids)`), at most three
times in a row; then it drops the slice until it changes. Changes that fail to cross to the host come again with the
next `takeChanges`.

Actions apply at once, views follow with the flush: a read right after a dispatch sees the last flush. The typed
commands of the facade flush the store once they settled (`settled` of `runtime.ts`).

### The store and its projections

`RuntimeStore` holds a `RevisionCache` per kind, subscriptions per slice (`subscribe`) and per kind
(`subscribeKind`), `get(kind, id)`, `ids(kind)` and `all(kind)` (a map that keeps its identity until a slice of the kind
changes). Reads never cross into the module.

Four kinds are projected into what the app reads (`ProjectedViews`):

- `workbook` into `WorkbookScripts` (`WORKBOOK_PROJECTION`),
- `script` into `ScriptData` (`ScriptProjection`): the FlatBuffer payloads are read once per key and the update that
  the editor received is held instead of read again,
- `workbookDerived` into `WorkbookDerived` (`WorkbookDerivedProjection`): what it read of a buffer stays while the bytes
  stay the same,
- `query` into `QueryExecutionState` (`createQueryProjection`): the structured progress folded into the
  `ProfileExecutionState` of the progress panels, once per change of the latest update.

A projection may pass the keys of the payloads it holds (`known`), the module leaves their bytes out. The types of the
views as the app reads them are in `src/platform` (`connections/connection_state.ts`,
`query/query_execution_state.ts`, `workbook/scripts/workbook_scripts.ts`, `compute/computation_types.ts`).

### Dispatch

```ts
runtime.dispatch(target, action): DispatchOutcome
```

- **Targets**: `{ workbook: id }`, `{ connection: id }`, `{ computation: tableId }`, `{ history: name }` or `'app'`
  (create and delete workbooks and connections).
- **Actions** are one generated union, `RuntimeAction` of `runtime.rs`, adjacently tagged: `{ kind: 'setScriptText',
  value: { ... } }`. They are synchronous changes of state, e.g. `createScript`, `setScriptText`, `showScript`,
  `setDraft`, `resetConnection`, `orderBy`, `trackQuery`.
- **The outcome** is `{ ok, changed, error, id }`: `id` names what the action created (a workbook, a connection, a
  query). A failed action leaves the state as it was; the facade logs a refused action.
- **Never throws.** A malformed target or action is a failed outcome like a refused action.
- **Handles belong to the runtime from the call on.** An action that carries handles (`trackQuery`,
  `queryReceivedAllBatches`) hands them over; the runtime releases them when it refuses the action. The host never
  releases a handle it handed over.

### Commands

Work that takes time and returns a result is a method each. The facade has typed commands where a caller needs more
than the module returns: the flush of the store after the command, handles for the objects that cross, a projection.

| Facade (`Runtime` of `runtime.ts`) | What |
|---|---|
| `analyzeTable` | Analyze a result as a computation |
| `execute`, `cancel`, `watchProfile` | Run a query on a connection, cancel it, show its profile; a test may replace them |
| `createConnection`, `connection`, `catalog`, `channel`, `saveConnection`, `retrySave` | Connections and their saves |
| `setupConnection`, `authenticateSalesforce` | Setups and the login of the shell |
| `createWorkbook`, `deleteWorkbook`, `applyEditorEvent`, `attachTableParameters` | Workbooks and editors |
| `restore`, `restoreWorkbook`, `deleteInvalidWorkbook` | The restore |
| `attachFiles`, `refreshAttachments` | Attachments |
| `runWorkbook`, `runScript` | Runs |
| `exportArchive`, `exportLink`, `exportTables`, `readImport`, `commitImport` | Imports and exports |
| `storage` | The `StorageWriter` facade: flush, holds, handover, pending keys, statistics |
| `flush`, `destroy` | Take the changes now; stop runs and the catalog loader, write what is pending, free the module, abort fetches and OAuth flows |

Everything else the app and the CLI call on the module directly (`runtime.module`): `stopRun`, `cancelSetup`,
`refreshCatalog`, `runCatalogLoader`, `setUpOpenedWorkbook`, `resultKeys`, `dropImport`, `exportConnection`,
`exportedResults`, `migrateWorkbookFolder`, `checkWorkbookFolders`, `answerExternalChange`, `revealConnectionSecrets`,
`queryProgressRecording`, `followQueryProgress`, and more. `Runtime.migrateStorage(root, log)` of the module is static:
the app migrates its storage before a runtime exists.

### Handles

The handle table (`store/handles.ts`) holds the JavaScript objects that Rust names by number: channels, the records of
queries that the host runs, the Arrow tables of results and computations, the lifetimes of computations, archives and
files of imports and exports. A handle is never given out twice.

The runtime lets go of a handle with an effect: `release` (forget), `close` (close the object, e.g. a channel, and
forget it) or `abort` (abort the object, it stays until a release). Aborts and closes apply at once, the runtime calls
the handle table in a task of its own; a closed object keeps its handle until the flush. No view of the store names a
handle that is gone: the store forgets the released and closed handles after it read the views of the flush, and keeps
them while a slice holds an older view, busy or asked for again; the runtime keeps the releases while a slice was busy
when the store took the changes. Every effect tells the host. `HandleTable.apply` runs every effect even if one throws.

### Results stay in JavaScript

A query result never lives in the core module. The executor streams it into a table of the platform opened for the
query (`tables.open`, `push`, `finish`): Hyper over HTTP hands its chunks over as they are, Trino and client functions
pass one page at a time as the next part of an Arrow IPC stream, host channels (the embedded Hyper, gRPC, test channels)
keep their record batches. `QueryResultStream` frames the parts and `apache-arrow` builds the table. The history of the
connection names the table by its handle, the app resolves it with `useTable(handle)` or `runtime.table(handle)`.

The computations work the same way: the compute platform imports a result by handle, the module reads only rows and
schema (`tables.describe`) and the small tables it parses (statistics, summaries, counts), and every derived table is a
handle.

### Catalogs and sessions

`runtime.catalog(connectionId)` hands out a read-only `DashQLCatalog` that shares the catalog of the connection, one per
identity (`catalogId` of the connection view); it is destroyed with its connection. The catalog changes only through the
runtime. Editors write through `applyEditorEvent`; a session outside a workbook (the composer, the shell, read-only
views) is a session of its own, and `attachTableParameters` gives it the table parameters of a workbook.

## The app

- **`RuntimeProvider`** (`packages/dashql-app/src/runtime/runtime_provider.tsx`) creates the runtime over the
  providers of the app once the core is there and shows the loading page until then. It flushes the storage writer when
  the page hides and when Electron closes a window, hands over to another tab (`storage.handOver()`), and destroys the
  runtime with the component.
- **`StandaloneRuntime`** (`runtime_hooks.tsx`) gives the shell of Hyper a runtime of its own with the core, the HTTP
  client and the embedded database, without storage.
- **Hooks** (`packages/dashql-app/src/runtime/runtime_hooks.tsx`): `useRuntime`, `useOptionalRuntime`,
  `useView(kind, id)`, `useDispatch(target)` and `useTable(handle)`; one-line aliases `useWorkbook`, `useScript`,
  `useWorkbookDerived`, `useWorkbookList`, `useConnection`, `useConnectionList`, `useQuery`, `useComputation`,
  `useComputationDispatch`; hooks that read all slices of a kind for the views that show all of them (`useWorkbooks`,
  `useWorkbookScriptMap`, `useConnections`, `useConnectionViews`, `useAllQueries`); and hooks over a slice and a
  command (`useQueryProgress`, `useQueryResultTable`, `useQueryProfileDetail`, `useWorkbookExecution`,
  `useScriptRun`). `useView` is `useSyncExternalStore` over one slice; a component renders again only when its slice
  changes. A refused dispatch of `useDispatch` shows as an app error.
- **What the app keeps** is about the user interface: the script selection (`workbook/scripts/script_selection.ts`),
  the drafts of connection forms (`connections/connection_draft.ts`), the state of a save
  (`connections/connection_persistence.tsx`), creating and deleting workbooks with the selection
  (`workbook/workbook_lifecycle.ts`), CodeMirror state, focus and view modes. Its own stores use `Store` of
  `utils/store.ts`.
- **Tests of components** use `TestRuntime` (`packages/dashql-app/src/tests/test_runtime.tsx`): a runtime with the
  catalog loader stopped and replaceable `execute`, `cancel` and `watchProfile`.

## Per keystroke

1. The editor packs the `EditorEvent` with the text version that its document shows and calls
   `runtime.applyEditorEvent(script, event, known)` (`script_editor.tsx`).
2. The module applies it to the session of the script in the workbook, publishes the declarations into the catalog of
   the connection when the text or the analysis changed, marks the other scripts on that catalog outdated if the catalog
   changed, hands the write of the text to the storage writer, and returns the update once. An editor that missed a
   change of the text gets `STALE_TEXT_VERSION` and shows the text of the session again; an event of a session that the
   script no longer holds (an older `sessionGeneration`) returns null. The update leaves out the analysis that the
   editor already holds, the facade fills it in.
3. The `script` slice is marked, and the `workbookDerived` slice when the derived buffers changed. The derived buffers
   leave out what typing moves and no consumer reads (text versions, the spans of references without errors), so
   typing within a statement usually leaves the derived slice where it is.
4. The flush is at most three crossings: `takeChanges`, the view of the script (the facade holds the update, its bytes
   don't cross again), and the derived view when it moved. Only the subscribers of that script, and of the derived
   view when it moved, render.

The editors tell the runtime which scripts they show (`showScript`, `hideScript`): an outdated selected script is
analyzed right away, the other shown ones once the changes pause for 150 ms (`visible_scripts.rs`).

## Node and the command line tool

The Node `dashql` (`packages/dashql-cli`, see its [README](../../packages/dashql-cli/README.md)) runs on the same
runtime: `dashql run` creates a runtime over `createNodePlatform` with a `NativeStorageBackend` of the workbook folder,
the embedded Hyper as its compute database and result cache, and the catalog loader off; it restores the folder with
`restoreWorkbook`, sets up its connections with `setupConnection` (the credentials of the environment as
`channelParams`, never written), runs with `runWorkbook` and a listener of script events, and reads the progress from
the `query` views. `lint` and `format` use `platform/sql/` and no runtime.

- **The root of Node.** The CLI brings a folder with the layout of the origin private file system
  ([storage_layout.md](storage_layout.md)): `DASHQL_HOME`, else the `.dashql/` of the workspace, else `~/.dashql`.
  `useNodeRoot` of `platform/node/node_hyperdb.ts` hands the modules that keep files `NodeDirectoryHandle`s over
  `node:fs` (`platform/node/node_directory_handle.ts`) through `setOPFSRootProvider`, and the Node build of
  `hyperdb-wasm` mounts the root at `/mnt/fs` like OPFS. Instance folders are held by a pid file in Node
  (`node_instance_locks.ts`) and by a Web Lock in the browser. Where Node has no Web Locks, `node_locks.ts` stands in
  with locks of the process: a root that two processes use at once is not protected.
- **The embedded Hyper in Node.** `hyperdb-wasm` is a wasm64 build with 64-bit memory, 64-bit tables and Wasm
  exceptions with `exnref`. Node 24.15 and later run it without flags; earlier Node 24 releases need exnref, which
  `checkWasmFeatures` of `@ankoh/hyperdb-edge` enables with `v8.setFlagsFromString` before the engine compiles, since
  Node refuses V8 flags in `NODE_OPTIONS`. Node 22 can't run it (V8 rejects the tables), nor can Bun or Safari
  (JavaScriptCore has no memory64). The CLI loads `hyperdb-wasm` only in commands that need it, so the commands without
  Hyper run on Node 22 (`engines: node >=22`).
- **Agent sessions.** `dashql session serve` and the journal of a session are in
  [agent_session.md](../wip/agent_session.md).

## The package on npm

`//packages/dashql:npm_tarball` (`bazel-bin/packages/dashql/dashql.tgz`) is `@ankoh/dashql` on npm; its metadata is
`npm/package.json`. `:bundle` builds `dist/` with `npm/build.mjs`: Vite builds the modules of `src/` without tests, test
helpers and mocks, every module keeps its path, tsc writes the declarations next to them, and the generated packages and
the library of hyperdb-edge, which are not on npm, are inlined (`dist/wasm`, `dist/gen/<name>`, `dist/hyperdb-edge`).

| Export | Module |
|---|---|
| `.` | `dist/core/index.js`, the bindings |
| `./buffers`, `./browser-worker`, `./batch-worker` | The FlatBuffers, the browser worker and its script |
| `./wasm`, `./dataflow-wasm`, `./wasm/glue` | The Wasm of the core and of the dataflow layout, the glue of the core |
| `./runtime` | `dist/runtime/runtime.js`, `createRuntime` |
| `./node` | `dist/runtime/node/node_platform.js`, `createNodePlatform` |
| `./runtime/*`, `./platform/*` | Every module of `src/runtime` and `src/platform` |

Its dependencies are `flatbuffers`, `apache-arrow`, `@bufbuild/protobuf`, `immutable` and `@zip.js/zip.js`;
`hyperdb-wasm` and `vega-lite` are optional peers. `:tarball_consumer_test` installs the archive like a consumer and
checks its files, the exports of the bindings in Node and their declarations for `NodeNext`; `:node_smoke_test` runs the
bindings and a runtime over the platform of Node from `dist/`; `//packages/dashql/test/browser` runs the bindings of the
archive in Chromium and Firefox. The CLI's package on npm depends on it for the Wasm of the core. More in
[packages/dashql/README.md](../../packages/dashql/README.md).

## Tests

Every feature of the runtime runs, and is tested, in Node and in the browsers.

| Target | Runs |
|---|---|
| `//packages/dashql:test_core_node` | The tests of the bindings (`src/core`) in Node, among them the runtime of the module without the facade (`runtime_workbooks.test.ts`, `runtime_connections.test.ts`, `runtime_imports.test.ts`, `runtime_changes.test.ts`) |
| `//packages/dashql:test_runtime_node`, `:test_platform_node` | The tests of `src/runtime` and `src/platform` in Node (a vitest project per folder of `vitest.config.mjs`) |
| `//packages/dashql/test/browser:all` | The tests of the bindings and of the package on npm in Chromium and Firefox |
| `//packages/dashql-app:test_chromium`, `:test_firefox` | The browser tests of the app, which also run the tests of `src/runtime` and `src/platform` (`:browser_test_files` of the package) |
| `//packages/dashql-cli:test`, `:binary_test` | `dashql run` against a fake Trino and the embedded Hyper, and the bundle |

- **Names.** A test runs in Node and in the browsers. `*.node.test.ts` runs only in Node, e.g.
  `node/node_file_system.node.test.ts`; `*.browser.test.ts` only in the browsers, e.g.
  `platform/hyperdb/hyperdb_wasm.browser.test.ts`.
- **Which folder.** A test that creates a runtime (`createRuntime`, `createTestRuntime`) or imports the facade goes in
  `src/runtime`, also when it tests a module of the platform, e.g.
  `connections/catalog/catalog_updates.integration.test.ts` or `node/storage_root.node.test.ts`. A test of the platform
  imports only the platform, the bindings and `src/platform/testing/`. The logic in Rust is tested in its crates first,
  see [dashql_core.md](dashql_core.md#tests).
- **Helpers.** `createTestRuntime()` (`src/runtime/testing/test_runtime.ts`) is a runtime on an in-memory platform
  with an optional compute database and result cache, its catalog loader stopped unless asked for;
  `testing/connection_fixtures.ts` runs real setups over platforms that answer like the backend.
  `openTestHyperDB(context)` (`src/platform/testing/test_hyperdb.ts`) returns a HyperDB with databases of its own on an
  engine per test file: the browser tests of the app install it over their engine worker, `test/setup_node.mjs` over
  the embedded Hyper of Node. Every test file in Node gets a root of its own with the layout of OPFS.

## The typing benchmark

`packages/dashql/test/npm/bench_typing.mjs` types a script of 40 lines character by character next to two other
scripts, and again next to 19 other scripts, the way the editor does: it packs the event, calls `applyEditorEvent`, lets
the store take the changes and read the view of the typed script, and reads the derived view when it moved. It runs on
the release module in Node and prints the 10th percentile and the median of every step per keystroke in microseconds:

```bash
bazel run --config=release //packages/dashql:bench_typing [-- --passes=3]
```

Run it before and after a change on the per-keystroke path: the editor, the workbook, the derived views, the change
tracking or the store. The derivation of the workbook (the planner) runs for every keystroke that changes the text and
is linear in the scripts of the workbook, so the run next to 19 scripts shows costs per script.
