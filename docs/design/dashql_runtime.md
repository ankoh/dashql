# DashQL runtime

The runtime of DashQL is the state of the app and the services that change it: the workbooks with their scripts, the
connections with the histories of their queries, the computations of query results, the query executor, the catalog
loader, the setups of connections, the runs of workbooks, the storage writer, the restore, the migrations and the
imports and exports. It is Rust: the `Runtime` class of the core module (`packages/dashql-core-bindings/src/runtime.rs`)
over the crate `dashql_core_runtime`, see [dashql_core.md](dashql_core.md).

TypeScript holds one facade over it, `Runtime` of `packages/dashql/src/runtime/runtime.ts`. The facade builds the
platform object that the Rust runtime calls for its I/O, owns the handle table of the JavaScript objects that Rust
names by number, keeps the store of the views that the app reads, and has typed commands where a caller needs more than
the module returns. The app, the shell of Hyper and the tests hold the same class.

This document describes the runtime from the outside in: the package, the platform, the seam between TypeScript and
Rust, the app, Node, and the tests.

## The package `@akohn/dashql`

`packages/dashql` is one source package, `@akohn/dashql`. Nothing in it is compiled: the app and the tests bundle and run
its TypeScript. It is linked as `//:node_modules/@akohn/dashql` for Bazel, and mapped in the
root `tsconfig.json` and the Vite config of the app for editors and the dev server. Its three folders of `src/`:

| Folder | Imported as | Holds |
|---|---|---|
| `src/core` | `@akohn/dashql`, `/buffers`, `/browser-worker`, `/batch-worker`; the Wasm and its glue as `/wasm`, `/dataflow-wasm`, `/wasm/glue` | The bindings of the core module: the API over the Wasm (`api.ts`), the `Runtime` class of the module (`runtime.ts`), the batch worker, `readFlatBuffer` and `FlatBufferCache` (`flatbuffer_view.ts`), the generated FlatBuffers |
| `src/runtime` | `@akohn/dashql/runtime/<path>` | The facade (`runtime.ts`), the store of the views (`store/`), the view projections, and the adapters that build the platform object of the module from the objects of the platform |
| `src/platform` | `@akohn/dashql/platform/<path>` | The platforms of the browser, the desktop app and Node; the storage backends (OPFS, the composite of OPFS and native workbook folders, native folders) and the storage root, the stored results of the workbooks (`platform/workbook/`), the embedded Hyper (`platform/hyperdb/`), HTTP, the logger, OAuth, the connector clients and channels, the types of the views as the app reads them, UI helpers that more than the app uses, and the conversation of the agent on a workbook (`platform/session/`) |

Only the generated parts are outputs of Bazel, folders in `dependencies/` of `bazel-bin/packages/dashql`, and the
sources import them by name: `@akohn/dashql-wasm` (`:dep_wasm`, the wasm-bindgen glue and the Wasm of the core and of
the dataflow layout; every glue exports the URL of its Wasm as `wasmUrl`), `@akohn/dashql-flatbuffers`
(`:dep_flatbuffers`), `@akohn/dashql-protobuf` (`:dep_protobuf`) and `@akohn/dashql-jsonschema` (`:dep_jsonschema`).
They come with the source package, in `node_modules/@akohn/dashql/dependencies/`, and a consumer maps them there with
paths of `tsconfig.json` and aliases of Vite or vitest.

### What goes where

Logic that fits semantically into the core is Rust in the module, not a module of this package; this package binds
the module, supplies its I/O and holds the views, see [core_first.md](../agents/core_first.md).

- **`src/core`** is the API over the core module and nothing else.
- **`src/runtime`** is what builds and holds a runtime: `runtime.ts`, `store/` (the store, `projection.ts`, the handle
  table, the Arrow tables by handle, `update_scheduler.ts`), the projections of the workbook and script views
  (`workbook_projection.ts`) and of the query views (`query/query_projection.ts`), and the adapters
  that turn platform objects into the platform of the core: `query/query_channels.ts` (the channels of the host and the
  stored results), `query/query_result_stream.ts`, `compute_platform.ts`, `compute_database.ts`
  (the compute database of the platform and whether it is ready), `run_mounts.ts`,
  `query/cache_pins.ts` (the releases of the pins of the result files that the runtime keeps, by id),
  `runtime_storage.ts` (the storage of the platform and `StorageCommands`, the commands of the storage writer),
  `workbook_archives.ts`, `platform_requests.ts` (the fetches and OAuth flows that `destroy` aborts),
  `embedded_session.ts` (the session of the shell on a connection to the embedded Hyper) and
  `node/node_platform.ts`. A module belongs here when it names `RuntimeOptions`, the handle table or a platform type of
  the core.
- **`src/platform`** is everything else that more than the app uses. It never imports the runtime.
- **The app** keeps what only it uses, at its own paths under `packages/dashql-app/src`: the hooks, the Hyper links of
  a tab, the Salesforce mock setup, script names and formatting with the app settings, the renames of scripts and
  attachments, workbook links.

The folders stay flat: a module of the runtime sits in `src/runtime`, one of the platform in `src/platform` or in the
folder of its area (`connections/`, `workbook/`, `storage/`, ...). A subfolder is for a rule (`node/`, `testing/`) or a
larger part with a name of its own (`store/`, `query/`, `hyperdb/`, a connector with several modules), not for two or
three files.

### The boundary test

`//packages/dashql:boundary_test` (`test/boundary_test.mjs`) reads every module of `src/` and fails on each import that
breaks a rule:

- `core/` imports neither `runtime/` nor `platform/`, `platform/` imports `core/`, `runtime/` imports both. Nothing
  imports the app.
- The package imports itself relatively, never as `@akohn/dashql`, and no relative import leaves `src/`.
- Only `core/` imports `@akohn/dashql-wasm` and `@akohn/dashql-flatbuffers`.
- No module imports React, an editor, a UI library or a `.tsx` module.
- In `runtime/` and `platform/`, only the modules of Node (`runtime/node`, `platform/node`) import `node:` and other
  modules of Node.
- In `runtime/` and `platform/`, no module uses a seam that only a browser or a bundler provides (a bundler asset
  `?url`, `?raw` or `.css`, `import.meta.glob`, `navigator.storage`, `new Worker`, the Electron bridge) unless it is
  listed in `KNOWN_SEAMS`: `platform/opfs_root.ts` (the origin private file system; Node hands a folder of
  the host through `setOPFSRootProvider`) and `platform/electron_fs.ts` (the file system of the desktop app).
  The specs of the client functions come through `provideClientFunctionSpecs` of
  `platform/connections/clfn_specs.ts`: the app passes its `import.meta.glob` in
  `connections/bundled_clfn_specs.ts`, the tests in Node in `test/setup_node.mjs`.
- The checks of the assets and the seams skip all of `core/` and every `*.test.ts`. The bindings load their Wasm in
  Node and in the browsers on their own, e.g. `core/batch_worker_client.ts` uses `new Worker(`, and a test may stand
  in for a platform.

### Type checks and editors

The modules type check against the `WebWorker` lib (`tsconfig.bazel.json`): no `window`, no `document`, no types of
Node, so an API of only one platform fails. The tests of the runtime and the platform check with the globals of
vitest, the modules of Node with the types of Node; the tests of the bindings run but are not type checked.
`:editor_config_test` keeps the `tsconfig.json` of the package extending the root one. The targets are in
[build_bazel_targets.md](../agents/build_bazel_targets.md).

The dev server of the app aliases the sources and watches them: an edit arrives as a hot update, a build of the core
module replaces the glue and the Wasm and reloads the page.

## Creating a runtime

```ts
const runtime = createRuntime(options);   // RuntimeOptions, @akohn/dashql/runtime/runtime
await runtime.restore();
// ...
await runtime.destroy();
```

The platform creates the runtime once its core is there and owns what it passes for the lifetime of the runtime;
nothing is set later. `RuntimeOptions` of `runtime.ts` (not to be confused with `RuntimePlatform`, the platform object
of the module that the runtime builds from it):

| Member | Required | What |
|---|---|---|
| `logger` | yes | The logger, the Rust runtime logs through it with a target |
| `scheduler` | yes | When the store takes the changes (`UpdateScheduler`: `afterTask`, `beforeFrame`, `cancelFrame`) |
| `core` | yes | The `DashQL` instance whose module creates the runtime |
| `storage` | no | The `StorageBackend` of the workbooks and connections. Without, the runtime keeps nothing: the changes of the workbooks are dropped, the storage commands resolve at once, a workbook enters by `readImport` and `commitImport` into memory with the files of its attachments, and what needs a storage is refused (attaching new files, exports, the restore), see [The storage](dashql_core.md#storage) |
| `http` | no | The `HttpClient` of fetches, the executor and the setups send through it |
| `oauthFlow` | no | The `OAuthFlow`: opens the authorization page and receives the redirect |
| `channels` | no | A `ChannelConnector` that connects the channels of the host that setups ask for (the embedded Hyper, Hyper over gRPC), and the token of a Hyper link that the page holds. The runtime speaks Trino, Hyper over HTTP and the Hyper of Salesforce itself |
| `computeDatabase` | no | A provider, `() => Promise<EmbeddedComputeDatabase>`: the runtime calls it when a computation, a run or the stored results first need the database and waits until the platform set it up. `runtime.computeDatabase` (`compute_database.ts`) wraps it: it is `ready` once the provider resolved, until a call fails, and the app reads that (`useComputeReady`) |
| `results` | no | The `WorkbookResultFiles` of the stored results of the scripts (`createWorkbookResultFiles`, `platform/workbook/workbook_result_files.ts`), the runtime adapts it to `RuntimeResults` |
| `archives` | no | A factory over the handle table that reads and writes `.dashql` archives (`createRuntimeArchives` of `workbook_archives.ts`: zip.js, Parquet through the embedded Hyper) |
| `catalogLoader` | no | Run the catalog loader, true by default. Most tests turn it off |
| `queryCommands` | no | Stand in for `execute`, `cancel` and `watchProfile` of the facade, e.g. in the tests of components. The services of the runtime keep the executor of the module |
| `settings` | no | The timings and limits that a host may choose (`RuntimeSettings`): the pause before the background analyses, the heartbeat and the query timeout of the catalog loader, the internal queries a history keeps. The defaults are those of DashQL, read once when the runtime is created |

The parts that a platform sets up late are providers or read on call: the compute database is a provider, the
`ChannelConnector` of the app reads its clients when a setup connects, and the archives ask for their database when an
archive first needs it.

### The platform object of the module

`createRuntime` builds the one object that the Rust runtime calls (`RuntimePlatform` of the generated declarations,
declared in `packages/dashql-core-bindings/src/host.rs`) from the members above, in `Runtime.modulePlatform`:

| Group | What the runtime asks for | Built by |
|---|---|---|
| `clock`, `log` | Time, timers, the log | `runtime.ts` |
| `handles` | The handle table: `register`, `get`, `duplicate`, `release`, `close`, `abort` | `store/handles.ts` |
| `tables` | Arrow tables by handle: `open`, `push`, `finish` of a streamed result, `begin`, `append`, `read`, `describe` | `store/runtime_tables.ts` |
| `compute` | The compute database: import a table by handle, create a table from a SELECT, query into Arrow IPC or into a table, drop, cancel a run | `compute_platform.ts` |
| `http` | `fetch` and `abort` by id | `platform_requests.ts` |
| `channels` | `connect` a setup's channel of the host, `hyperLinkToken`, and the queries of host channels: `describe` (keeps a record of the query until `forget`), `open`, `next`, `cancel` (also of a query that `open` still opens), `forget` | `query/query_channels.ts` |
| `results` | `mount`, `unmount`, `files`, `pin`, `release`, `read`, `write`, `file`, `import`, `move`, `remove`: the Parquet files of `workbooks/<id>/results/` ([workbook_results.md](workbook_results.md)) | `query/query_channels.ts`, the pins in `query/cache_pins.ts` |
| `mounts` | The attachments of the workbooks in the compute database, unmounted when their workbook is deleted | `run_mounts.ts` |
| `crypto` | `randomUuid`, `sha256` (the core has no randomness and no SHA-256) | `crypto` of the platform |
| `oauth` | PKCE, flow info, loopback and redirect-page authorization, abort | `platform_requests.ts` |
| `extensions` | `loadSpec`, the JSON of a client function spec | `loadClientFunctionSpec` |
| `storage` | The workbook files, scripts, attachments, the app manifest, connection files, native folders | `runtime_storage.ts` |
| `archives` | The ZIP container and the Parquet files of the workbook tables | the factory of the platform |
| `changed` | The state changed, `urgent` or not | the store |
| `settings` | The settings of the runtime, read once | `RuntimeOptions.settings` |

Every call into it catches: a member that throws or is missing fails the call of the service with a `HostError`, it
never unwinds through the module (see [Errors](#errors)). Once the module shut down (`shutdown`, below), it calls the
platform object no more: a call fails, a timer never fires, and the effects on handles wait for the last changes.

### The platforms

| | Browser | Desktop app | Node |
|---|---|---|---|
| Created in | `RuntimeProvider` of the app | `RuntimeProvider` of the app | `createNodePlatform` (`runtime/node/node_platform.ts`), the CLI |
| Scheduler | `FRAME_UPDATE_SCHEDULER` of the app (`utils/store_hooks.ts`: microtask, `requestAnimationFrame`) | the same | `TASK_UPDATE_SCHEDULER` (`store/update_scheduler.ts`: microtask, `setTimeout`) |
| HTTP | fetch (`WebHttpClient`), limited by CORS | the native proxy (`NativeHttpClient` of the app) | fetch (`WebHttpClient`) |
| Storage | OPFS (composite backend of the app) | OPFS and native workbook folders over the Electron bridge | `NativeStorageBackend` over `NODE_FILE_SYSTEM`, one workbook folder |
| Embedded Hyper | `hyperdb-wasm` in a worker, cross-origin isolated (`platform/hyperdb/`) | the same | the `node` build of `hyperdb-wasm` (`platform/node/node_hyperdb.ts`) |
| Core Wasm | URL from the bundler | the same | the file of `@akohn/dashql/wasm` (`platform/node/node_core.ts`) |
| OAuth | popup and the redirect page `oauth.html` (`AppOAuthFlow`) | the browser of the system, a link back to the app or the loopback server of the desktop app | refused |
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
| `connectionList` | `'root'` | The connections in order, whether listed, their ordinals and their labels with the ordinals, the ids by connector |
| `connection` | connection id | Connector, params, draft, details with the channel as a handle, health, status, the setup, catalog updates and version, `catalogId`, the queries, the workbooks that use it, the save, token summaries, its label, whether it is the embedded Hyper, a local cloud or can be a cloud, the databases of the clouds folder it attaches |
| `query` | query id | Status, metadata, metrics, error, the latest progress with the structured progress as FlatBuffers by key, the result table as a handle |
| `workbookList` | `'root'` | The workbooks with their names, the invalid workbooks with their reasons |
| `workbook` | workbook id | Name, metadata, script keys and file names in feed order, attachments, cloud link, connections |
| `script` | script key | The fields of a script, its editor update, staged diff, visualization and statistics as FlatBuffers by key, `storedResult` |
| `workbookDerived` | workbook id | The checked references, the dataflow and the inputs as FlatBuffers, with the hash of each |
| `storage` | `'root'` | Holds, held workbooks, failed writes, questions about external changes |
| `run` | workbook id | `held`, the state of the last run of the whole workbook, the inputs that wait |

A parent lists the ids of its children, not their revisions: a keystroke changes the `script` slice and leaves the
`workbook` slice alone.

### Changes and the flush

1. A service that changes a slice marks it on the platform (`JsPlatform::changed` or `mark` and `signal` in Rust),
   which calls `platform.changed(urgent)` once until the store takes the changes, and again when a change turns
   urgent. Not urgent are the events of a query other than its registration, `Sending` and its end (succeeded,
   failed, cancelled), so its progress, its batches and its result wait for the frame; the steps of the tasks of a
   computation; the progress of a run and its steps but the analysis and the planning, which the run lets the host
   paint before it works without a break; a refreshed token of a connection; the releases of handles; and the slices
   that were busy or that the host asked for again. Everything else is urgent: actions, setups, workbooks, the runs (a
   new phase, e.g. the start and the end of a run, their holds and waiting inputs), the storage.
2. The store flushes at the end of the task when urgent, before the next frame otherwise (`RuntimeStore.changed` over
   the `UpdateScheduler`). `flush()` flushes at once, e.g. for the commands of an agent and the tests.
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

Actions apply at once, views follow with the flush: a read right after a dispatch sees the last flush, a read after its
`settled` sees the action. The commands of the facade that wait for the state of the module flush the store once they
settled (`settled` of `runtime.ts`): `analyzeTable`, `saveConnection`, `retrySave`, `replaceConnections`,
`setupConnection`, `settleCatalog`, `restore`, `restoreWorkbook`, `deleteInvalidWorkbook`, `removeWorkbook`,
`attachFiles`, `renameAttachment`, `detachFile`, `refreshAttachments`, `runWorkbook`, `runScript` and `commitImport`.
`createConnection`, `createWorkbook` and `deleteWorkbook` flush right after their action. The others, e.g. `execute`,
`cancel`, `authenticateSalesforce`, the exports and `readImport`, leave the views to the next flush.

### The store and its projections

`RuntimeStore` holds a `RevisionCache` per kind, subscriptions per slice (`subscribe`) and per kind
(`subscribeKind`), `get(kind, id)`, `ids(kind)` and `all(kind)` (a map that keeps its identity until a slice of the kind
changes). Reads never cross into the module.

Four kinds are projected into what the app reads (`ProjectedViews`):

- `workbook` into `WorkbookScripts` (`WORKBOOK_PROJECTION`),
- `script` into `ScriptData` (`ScriptProjection`): the FlatBuffer payloads are read once per key and the update that
  the editor received is held instead of read again; the session handle of a script stays one per session generation,
  a replaced handle is not destroyed, an editor may still read it, the module frees it once it is collected,
- `workbookDerived` into `WorkbookDerived` (`WorkbookDerivedProjection`): what it read of a buffer stays while the hash
  of the buffer stays the same,
- `query` into `QueryExecutionState` (`createQueryProjection`): the structured progress folded into the
  `ProfileExecutionState` of the progress panels, once per change of the latest update.

A projection may pass the keys of the payloads it holds (`known`), the module leaves their bytes out. The types of the
views as the app reads them are in `src/platform` (`connections/connection_state.ts`,
`query/query_execution_state.ts`, `workbook/workbook_scripts.ts`, `compute/computation_types.ts`).

A new view kind:

1. The view, a Rust struct with `Serialize` and `Tsify` next to the bindings of its domain.
2. The kind in `runtime.rs`: a constant, an entry of `RuntimeViews` in the TypeScript section (id, view, known keys)
   and an arm of `read_views` that reads with `try_borrow` and returns `Read::Busy` for a borrowed state.
3. The marks in `runtime/changes.rs`: a `Slice` variant with its field in `Dirty` (`mark`, `merge`, `is_empty`), a
   field of `Changes` at its place in the order of the kinds (`of`, `into_vec`), what the host took in `Taken`, a take
   that compares the revisions of the objects or moves the slice with a new revision, and an arm of
   `resync_slices`. Every change of the state marks the slice.
4. Optionally a `ViewProjection` (`store/runtime_store.ts`: `project`, `known`, `release`) passed to `store.attach`
   in `runtime.ts`, with its type in `ProjectedViews`. Without one the store shares the view with the previous one.
5. A hook in `packages/dashql-react/src/hooks.ts`, a one-line alias of `useView(kind, id)`.
6. The tests: the marks in the unit tests of the wasm crate, the views in `runtime_changes.test.ts`.

### Dispatch

```ts
runtime.dispatch<T extends Target>(target: T, action: ActionOf<T>): Settled
```

- **Targets**: `{ workbook: id }`, `{ connection: id }`, `{ computation: tableId }` or `'app'`
  (create and delete workbooks and connections).
- **Actions** are one generated union per target in `runtime/actions.rs` of the bindings, adjacently tagged:
  `{ kind: 'setScriptText', value: { ... } }`. `WorkbookAction`, `ConnectionAction`, `ComputationAction` and
  `AppAction`; `ActionOf<T>` picks the union of a target and `RuntimeAction` is all of them. The module reads an action
  with the union of its target, so an action of another target is a type error in TypeScript and a malformed action in
  the module. They are synchronous changes of state, e.g. `createScript`, `setScriptText`, `showScript`, `setDraft`,
  `resetConnection`, `orderBy`. The queries run with `execute`, never by actions.
- **The outcome** is `{ ok, changed, error, id, settled }` (`Settled` of `runtime.ts`, over `DispatchOutcome`): `id`
  names what the action created (a workbook, a connection, the key of a script). A failed action leaves the state as it
  was; the runtime logs every refused action as a warning. `settled` resolves once the store took the changes of the
  action (`RuntimeStore.afterFlush`), so a read after it sees them unless a task held the slice; it resolves at once
  when the action changed nothing, and for a destroyed runtime.
- **Never throws.** A malformed target or action and a refused action are a failed outcome, and so is a dispatch after
  `destroy`.

A new action:

1. A variant of the union of its target in `runtime/actions.rs`, with doc comments, they become the declarations.
2. An arm in the dispatch of its target in `runtime.rs`: `dispatch_computation`, `dispatch_connection` (or
   `dispatch_query` for the queries of its history), `dispatch_workbook`, which maps it to a `WorkbookAction` of
   `workbook.rs` that `Workbooks::apply` settles, or `dispatch_app`. The matches are exhaustive.
3. Its outcome: `DispatchOutcome::changed(changed)`, `created(id)` or `failed(error)`. The service marks what it
   changed, a workbook action through `Workbooks::settle`.
4. A test in the crate (`tests/workbook_test.rs` for a workbook) and a step in the property test of
   `runtime_changes.test.ts`, which checks that every view the action changed is named.

### Commands

Work that takes time and returns a result is a method each. The facade has typed commands where a caller needs more
than the module returns: the flush of the store after the command, handles for the objects that cross, a projection.

The facade and the adapters of the platform decide nothing: the order of a handover, which files a run keeps and when
it lets go of them, how ids of workbooks compare, the NFC of names, the defaults of options and the log of refused
actions are the module's. What stays in TypeScript is the JavaScript side of a call: an object by the id that Rust
names it with (the pins of the result files, the fetches, the OAuth flows, the records of the queries of host channels, the
abort controllers of compute runs), the errors of JavaScript that a failure becomes, and the identity of the objects
that React holds (a catalog per `catalogId`, the arrays of an analysis that an editor update left out). Each command
is a typed method with its contract rather than a generated table, the app reads its types and docs.

| Facade (`Runtime` of `runtime.ts`) | What |
|---|---|
| `analyzeTable` | Analyze a result as a computation |
| `previewResult` | The first rows of an analyzed result as Arrow IPC, read from its data frame, e.g. for the table of the shell; waits for the system columns of an analysis that runs |
| `execute`, `cancel`, `watchProfile` | Run a query on a connection, cancel it, show its profile; `queryCommands` of the options stand in for them |
| `createConnection`, `connection`, `catalog`, `channel`, `saveConnection`, `retrySave`, `replaceConnections`, `connectionUsage` | Connections and their saves; `replaceConnections` moves the workbooks of connections to another one, writes their files and names the replaced connections that are dead (`ConnectionReplacement` of the registry), the app deletes those; `connectionUsage` counts the workbooks that use a connection and those that keep it, and says whether the user may delete it (`ConnectionRegistry::usage`): ephemeral workbooks and previews don't count, every workbook keeps the embedded Hyper |
| `setupConnection`, `cancelSetup`, `authenticateSalesforce`, `refreshCatalog` | Setups, the login of the shell and refreshes of catalogs |
| `openSession`, `closeSession`, `settleCatalog` | The session of the shell on a connection, see [Catalogs and sessions](#catalogs-and-sessions) |
| `createWorkbook`, `deleteWorkbook`, `removeWorkbook`, `applyEditorEvent`, `attachTableParameters` | Workbooks and editors; `deleteWorkbook` drops a workbook with its run and the computations of the results of its queries, `removeWorkbook` deletes its files first and keeps it when that fails |
| `restore`, `restoreWorkbook`, `deleteInvalidWorkbook` | The restore |
| `attachFiles`, `renameAttachment`, `detachFile`, `refreshAttachments` | Attachments |
| `runWorkbook`, `runScript`, `stopRun`, `cancelScript`, `setUpOpenedWorkbook` | Runs; `cancelScript` stops the run of the workbook while one is busy, else cancels the latest query of the script; the setups of the connections of an opened workbook |
| `exportArchive`, `exportLink`, `exportTables`, `readImport`, `commitImport` | Imports and exports |
| `allocateId`, `catalogRelationsFile`, `bindHyperLink`, `revealConnectionSecrets`, `exportConnection`, `exportedResults`, `withStoredResult`, `dropImport`, `checkWorkbookFolders`, `answerExternalChange` | Commands of the module that the app needs, passed on and refused once the runtime is destroyed |
| `storage` | `StorageCommands`, the commands of the storage writer: flush (`closing` while the window closes), flush of a workbook, holds, handover, discarding failed writes, statistics |
| `computeDatabase` | The compute database of the platform and whether it is ready |
| `flush`, `destroy` | Take the changes now; shut the runtime down, see below |

The app calls the module only through the facade, which also passes on the commands that need nothing of it:
`allocateId`, `catalogRelationsFile`, `bindHyperLink`, `revealConnectionSecrets`, `exportConnection`,
`exportedResults`, `withStoredResult`, `dropImport`, `checkWorkbookFolders` and `answerExternalChange`;
`//packages/dashql-app:component_boundary_test` fails on a `runtime.module` in a module of the app. The tests reach the
module (`runtime.module`) for the rest, e.g. `runCatalogLoader`, `resultKeys`,
`migrateWorkbookFolder`, `queryProgressRecording` and `followQueryProgress`.

**Reported runs.** `runWorkbookReported` (`src/runtime/workbook_run_report.ts`) runs the scripts of a workbook and
reports what happens as `RunEvent`s (`src/platform/workbook/run_events.ts`): the page prints them for the `dashql run`
and `dashql vis` of an agent (`docs/design/agent_integration.md`).
The core decides the report (`workbook_run/report.rs` of the core runtime): which scripts a run that names them reports
(`runScripts`), what a connection is called in the events (`runConnectionLabel`), and how the run ended for its scripts
(`finishRunReport`); the facade keeps the events in order and the timings.
`Runtime.migrateStorage(root, log)` of the module is static: the app migrates its storage before a runtime exists.

**Destroy.** From the call of `destroy` on the commands of the facade refuse: a command that returns a promise rejects
with `the runtime was destroyed`, `execute` returns a rejected promise, `dispatch` fails, a command without a result
does nothing, and the storage commands do nothing. A wait for a compute database that never came up ends. `shutdown()` of the module owns the order: the
runs stop, the catalog loader stops, the writes of the stored results and the pending writes of the storage
finish, then the imports are dropped, the setups and queries cancelled and the computations deleted, and the platform is
fenced. The store then takes the last changes, the projection of the scripts destroys its session handles, the module is
freed, the fetches and OAuth flows are aborted, and the pins of the result files that are left are released
(`CachePins.close`); a pin that arrives later is released at once.

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

### Errors

- **`dispatch` never throws.** A malformed target or action, a refused action and a dispatch after `destroy` are a
  failed `DispatchOutcome` with its `error`.
- **The synchronous methods of the module** throw a `JsError` on bad arguments, e.g. an id that is no integer or an
  option that doesn't deserialize, and on a state that a task holds (`the state is busy`). The facade catches
  `applyEditorEvent`, logs it and returns null.
- **The commands** report failure in their result. `analyzeTable`, `restore`, `restoreWorkbook`, `attachFiles`,
  `renameAttachment`, `detachFile`, the imports and exports and the storage commands reject with the error of the task or with what
  the platform failed with. `setupConnection` and `authenticateSalesforce` resolve with their `SetupOutcome`, a
  failure is in the view of the connection and the log. `runWorkbook` and `runScript` resolve with `{ outcome, error }`.
  `executeQuery` resolves with a `QueryRunOutcome`: `rejected` carries a `QueryRunFailure` (`error`, `cancelled`,
  `cacheMiss` or `processing`, with `hostValue`) and the value; `execute` of the facade rejects with that value when
  `hostValue` is set, else with the reason of the abort signal or a `LoggableException`.
- **A host call that fails** is a `HostError` in Rust (`host/mod.rs` of the core runtime): its message and the value
  that JavaScript failed with, which goes back unchanged (`host_value` of `host.rs`). A cancelled call is
  `HostError::cancelled()` (`is_cancelled()`), a call whose target is gone is `HostError::unavailable` (a
  `WorkbookFolderMissingError` of the storage, the storage writer stops retrying it), a write onto a file that changed
  outside the app is an external script change (an `ExternalScriptChangeError`).
- **A panic** aborts the module, see [dashql_core.md](dashql_core.md#the-core-module). The runtime crates deny
  panicking code.

### Results stay in JavaScript

A query result never lives in the core module. The executor streams it into a table of the platform opened for the
query (`tables.open`, `push`, `finish`): Hyper over HTTP hands its chunks over as they are, Trino and client functions
pass one page at a time as the next part of an Arrow IPC stream, host channels (the embedded Hyper, gRPC, test channels)
keep their record batches. The stream of a host channel is an async iterator of its batches and its progress (`read`
of `QueryExecutionResponseStream`): the runtime pulls the next message with `channels.next`, and `query_channels.ts`
pulls the next item of the stream for it, so the stream is read no faster than the runtime takes it. `QueryResultStream` frames the parts and `apache-arrow` builds the table. The history of the
connection names the table by its handle, the app resolves it with `useTable(handle)` or `runtime.table(handle)`.

The computations work the same way: the compute platform imports a result by handle, the module reads only rows and
schema (`tables.describe`) and the small tables it parses (statistics, summaries, counts), and every derived table is a
handle.

### Catalogs and sessions

`runtime.catalog(connectionId)` hands out a read-only `DashQLCatalog` that shares the catalog of the connection, one per
identity (`catalogId` of the connection view, which the module reads without the view). The facade never destroys it:
a component may hold it after its connection went, the finalizer of the module frees it once it is unreachable. A
component reads it with `useCatalog(connectionId)`, which follows the connection slice. The catalog changes only through
the runtime. The session of a script of a workbook is a `DashQLWorkbookScriptSession` (`ScriptData.scriptSession`): it
reads the text, completes, compiles, formats and computes the texts of rewrites, it has no mutators. Editors write
through `applyEditorEvent`; a session outside a workbook (the composer, the shell, read-only views) is a
`DashQLScriptSession` of its own, and `attachTableParameters` gives it the table parameters of a workbook. Both share
`DashQLScriptSessionReader`, which the editor and the views take.

The shell runs its statements with `runtime.execute` on its connection to the embedded Hyper
(`connectEmbeddedSession` of `embedded_session.ts`): the executor analyzes the results after their queries and tells
the catalog loader about the relations that a statement touched, `previewResult` waits for the analysis of the result
that it shows, and `settleCatalog` waits for the catalog before the prompt returns. The session leases the connection (`openSession`, `closeSession` of the module): a later session takes
it over, and only the latest lease resets the connection when it closes.

## The app

- **`RuntimeProvider`** (`packages/dashql-app/src/host/runtime_provider.tsx`) creates the runtime over the
  providers of the app once the core is there and shows the loading page until then. It flushes the storage writer when
  the page hides and when Electron closes a window (a page that goes away flushes with `closing`), hands over to another
  tab (`storage.handOver()`: the pending writes are written, then the tab writes nothing any more), asks for the
  compute database right away, and destroys the runtime with the component. `useOwnedRuntime` creates the runtime with
  the first render, keeps it in a ref and destroys it in a task after the cleanup of its effect unless the effect runs
  again: StrictMode and Fast Refresh keep the same runtime.
- **`StandaloneRuntime`** (`host/standalone_runtime.tsx`) gives the shell of Hyper a runtime of its own with the core, the HTTP
  client and the embedded database, without storage.
- **Hooks** (`@akohn/dashql-react/hooks`, `packages/dashql-react/src/hooks.ts`, a source package shared with other hosts
  of the runtime: it imports React, apache-arrow, `@akohn/dashql` and the libraries of its components only,
  `//packages/dashql-react:boundary_test`):
  `RuntimeContextProvider`, `useOwnedRuntime`, `useRuntime`, `useOptionalRuntime`,
  `useView(kind, id)`, `useDispatch(target)` (typed by the target, see [Dispatch](#dispatch)), `useTable(handle)`, `useCatalog(connectionId)`, `useComputeReady()` and `useComputeDatabase()` (the compute database once it is ready, e.g. for
  the Parquet export of a result);
  one-line aliases `useWorkbook`, `useScript`,
  `useWorkbookDerived`, `useWorkbookList`, `useConnection`, `useConnectionList`, `useQuery`, `useComputation`,
  `useComputationDispatch`; hooks that read all slices of a kind for the views that show all of them (`useWorkbooks`,
  `useWorkbookScriptMap`, `useConnections`, `useConnectionViews`, `useAllQueries`); and hooks over a slice and a
  command (`useQueryResultTable`, `useQueryProfileDetail`, `useWorkbookExecution`,
  `useScriptRun`). `useView` is `useSyncExternalStore` over one slice; a component renders again only when its slice
  changes. `useDispatch` dispatches through the facade, see [Dispatch](#dispatch).
- **Selectors** read a part of the views, a component renders again only when its part changes:
  `useViewSelector(kind, id, select, isEqual?)` selects from the view of one slice, `useScriptReferences(workbookId,
  scriptKey)` is the report of one script in the derived view and `useWorkbookInputs(workbookId)` its inputs. The
  selected value is the previous one while it is equal (`isEqual`, by identity by default), so a selector returns a
  primitive or a part of the view that keeps its identity (`share` of the projections, the reports of
  `readScriptReferenceReports`); a new `select` with every render is fine. `useViewReader()` reads the views when it
  is called, e.g. in a handler, without subscribing. A list passes its rows no view that each of them reads a part
  of, each row selects its part: the rows and the editors of the feed read their script, whether it is selected (`useIsScriptSelected` of
  `workbook/scripts/script_selection.ts`) and its references, and the feed reads its scripts in its handlers only.
- **Models** (`@akohn/dashql-react/models/...`): a model is what a component shows of the runtime with its operations,
  `useScriptModel`, `useQueryModel` and `useComputationModel`; components take models as props and import nothing of
  the runtime, see
  [writing_components.md](../agents/writing_components.md). Fakes for tests are in `@akohn/dashql-react/testing/...`.
- **Components** (`@akohn/dashql-react/components/...`, helpers in `@akohn/dashql-react/dom/...`): the building blocks
  that the app and other hosts share, with their CSS modules. They reach neither the hooks nor the runtime. The same
  package holds the tokens, fonts and brand code (`styles/`, `fonts/`, `src/theme`, `src/brand`) shared with the
  website.
- **What the app keeps** is about the user interface: the script selection (`workbook/scripts/script_selection.ts`),
  the drafts of connection forms (`connections/connection_draft.ts`), the state of a save
  (`connections/connection_persistence.tsx`), creating and deleting workbooks with the selection
  (`workbook/workbook_lifecycle.ts`), CodeMirror state, focus and view modes. Its own stores use `Store` of
  `utils/store.ts`.
- **Tests of components** of the app use `TestRuntime` (`packages/dashql-app/src/tests/test_runtime.tsx`): the
  runtime of the app over its providers with the catalog loader stopped and `execute`, `cancel` and `watchProfile` of
  the test (`queryCommands`). The tests of the hooks and models of `@akohn/dashql-react` hand a runtime of
  `createTestRuntime` to `RuntimeContextProvider`.

## Per keystroke

1. The editor packs the `EditorEvent` with the text version that its document shows and calls
   `runtime.applyEditorEvent(script, event, known)` (`script_editor.tsx`); the facade names `known`, the update that the
   editor holds, by its key (`editorUpdateKey`, the projection knows the keys of the updates it handed out).
2. The module applies it to the session of the script in the workbook, publishes the declarations into the catalog of
   the connection when the text or the analysis changed, marks the other scripts on that catalog outdated if the catalog
   changed, also those of the other workbooks on the connection, hands the write of the text to the storage writer, and
   returns the update once with its key. An editor that missed a change of the text gets `STALE_TEXT_VERSION` and shows
   the text of the session again; an event of a session that the script no longer holds (an older `sessionGeneration`)
   returns null. The update leaves out the analysis if the editor holds the analysis of the script, the facade fills it
   in from `known`.
3. The `script` slice is marked. The derived view runs the planner over every script of the workbook, so a keystroke
   leaves it to the pause: once the typing paused for 150 ms (`BACKGROUND_ANALYSIS_DELAY_MS`, every keystroke restarts
   it) the `workbookDerived` slice is marked, and it moves when the derived buffers changed. A change of the workbook or
   of an analysis outside the editor marks it at once. The derived buffers leave out what typing moves and no consumer
   reads (text versions, the spans of references without errors), so typing within a statement usually leaves the
   derived slice where it is. Until it moved, the editor hides the errors of references of a script whose text changed.
4. The flush of a keystroke is two crossings, `takeChanges` and the view of the script (the facade holds the update, its
   bytes don't cross again), and costs the same with any number of scripts. Only the subscribers of that script render;
   those of the derived view once it moved after the pause, and of those the selectors whose part changed. In the
   feed that is the card of the script without its result (`ScriptCardResult` is memoized on the query of the
   script, and the operations of a script model keep their identity), and after the pause the cards whose
   references changed. Two views read all scripts and are components of their own, so the page around them doesn't
   render: the errors in the bar (`WorkbookErrors`) and the status of the prompt (`WorkbookStatusSources`, it shows
   nothing and tells the bar of Wobble the latest queries).
5. The stored results of the workbook are looked up once the typing paused, a move of the cursor looks up none
   (`runs/stored_results.rs`).

The editors tell the runtime which scripts they show (`showScript`, `hideScript`): an outdated selected script is
analyzed right away, the other shown ones once the changes pause, see
[dashql_core.md](dashql_core.md#workbooks-and-scripts).

## Node

The runtime runs in Node over `createNodePlatform` (`runtime/node/node_platform.ts`), e.g. in the tests of the
runtime: a `NativeStorageBackend` of a workbook folder, the embedded Hyper as its compute database and its stored
results, and the catalog loader off.

- **The root of Node.** A host in Node brings a folder with the layout of the origin private file system
  ([storage_layout.md](storage_layout.md)).
  `useNodeRoot` of `platform/node/node_hyperdb.ts` hands the modules that keep files `NodeDirectoryHandle`s over
  `node:fs` (`platform/node/node_directory_handle.ts`) through `setOPFSRootProvider`, and the Node build of
  `hyperdb-wasm` mounts the root at `/mnt/fs` like OPFS. Instance folders are held by a pid file in Node
  (`node_instance_locks.ts`) and by a Web Lock in the browser. Where Node has no Web Locks, `node_locks.ts` stands in
  with locks of the process: a root that two processes use at once is not protected.
- **The embedded Hyper in Node.** `hyperdb-wasm` is a wasm64 build with 64-bit memory, 64-bit tables and Wasm
  exceptions with `exnref`. Node 24.15 and later run it without flags; earlier Node 24 releases need exnref, which
  `checkWasmFeatures` of `@akohn/hyperdb-edge` enables with `v8.setFlagsFromString` before the engine compiles: a flag
  on the command line would break approving the command by its prefix, and the worker of the engine gets the flag
  too. Node 22 can't run it (V8 rejects the tables), nor can Bun or Safari
  (JavaScriptCore has no memory64).

## The package on npm

`//packages/dashql:npm_tarball` (`bazel-bin/packages/dashql/dashql.tgz`) is `@akohn/dashql` on npm; its metadata is
`npm/package.json`. `:bundle` builds `dist/` with `npm/build.mjs`: Vite builds the modules of `src/` without tests, test
helpers and mocks, every module keeps its path, tsc writes the declarations next to them, and the generated packages and
the library of hyperdb-edge, which are not on npm, are inlined (`dist/wasm`, `dist/gen/<name>`, `dist/hyperdb-edge`).
The exports mirror those of the source package and are listed in
[packages/dashql/README.md](../../packages/dashql/README.md).

Its dependencies are `flatbuffers`, `apache-arrow`, `@bufbuild/protobuf`, `immutable` and `@zip.js/zip.js`;
`hyperdb-wasm` and `vega-lite` are optional peers. `:tarball_consumer_test` installs the archive like a consumer and
checks its files, the exports of the bindings in Node and their declarations for `NodeNext`; `:node_smoke_test` runs the
bindings and a runtime over the platform of Node from `dist/`; `//packages/dashql/test/browser` runs the bindings of the
archive in Chromium and Firefox. The CLI's package on npm depends on it for the Wasm of the core.

## Tests

Every feature of the runtime runs, and is tested, in Node and in the browsers. In Node, `:test_core_node`,
`:test_runtime_node` and `:test_platform_node` of `//packages/dashql` run the tests of the three folders (a vitest
project per folder of `vitest.config.mjs`); the tests of the bindings include the runtime of the module without the
facade (`runtime_*.test.ts` of `src/core`). In the browsers, `//packages/dashql/test/browser:all` runs the bindings
and the package on npm, and the browser tests of the app run the tests of `src/runtime` and `src/platform` as well
(`:browser_test_files` of the package). The targets are in [build_bazel_targets.md](../agents/build_bazel_targets.md).

- **Names.** A test runs in Node and in the browsers. `*.node.test.ts` runs only in Node, e.g.
  `node/node_file_system.node.test.ts`; `*.browser.test.ts` only in the browsers, e.g.
  `platform/hyperdb/hyperdb_wasm.browser.test.ts`.
- **Which folder.** A test that creates a runtime (`createRuntime`, `createTestRuntime`) or imports the facade goes in
  `src/runtime`, also when it tests a module of the platform, e.g.
  `catalog_updates.integration.test.ts` or `node/storage_root.node.test.ts`. A test of the platform
  imports only the platform, the bindings and `src/platform/testing/`. The logic in Rust is tested in its crates first,
  see [dashql_core.md](dashql_core.md#tests).
- **Helpers.** `createTestRuntime()` (`src/runtime/testing/test_runtime.ts`) is a runtime on an in-memory platform
  with an optional compute database and stored results, its catalog loader stopped unless asked for;
  `testing/connection_fixtures.ts` runs real setups over platforms that answer like the backend.
  `openTestHyperDB(context)` (`src/platform/testing/test_hyperdb.ts`) returns a HyperDB with databases of its own on an
  engine per test file: the browser tests of the app install it over their engine worker, `test/setup_node.mjs` over
  the embedded Hyper of Node. Every test file in Node gets a root of its own with the layout of OPFS.

## The typing benchmark

`packages/dashql/test/npm/bench_typing.mjs` types a script of 40 lines character by character next to two other
scripts, and again next to 19 other scripts, the way the editor does: it packs the event, calls `applyEditorEvent` and
lets the store take the changes and read the view of the typed script. At the end of every line the typing pauses, and
the store takes the changes and reads the derived view when it moved. It runs on the release module in Node and prints
the 10th percentile and the median of every step in microseconds:

```bash
bazel run --config=release //packages/dashql:bench_typing [-- --passes=3]
```

Run it before and after a change on the per-keystroke path: the editor, the workbook, the derived views, the change
tracking or the store. A keystroke costs the same next to 2 and next to 19 scripts. The derivation of the workbook (the
planner) runs after a pause and is linear in the scripts of the workbook, the run next to 19 scripts shows its cost per
script.

## Perf marks

Perf marks are named time spans at the seams of DashQL on the timeline of the browser, to see where the time of a
workbook goes: in the planner, the store, the queries, the stored results, the computations or the charts. Each is a
`performance.measure` named `dashql:<track>:<step>` (`perfMarks` of `@akohn/dashql`, `src/core/perf_marks.ts`). They are
off by default, a span then costs the check of a flag; `?perf` in the URL of the app turns them on from the start
(`http://localhost:9002/?perf`), and `perfMarks.setEnabled` at any time.

To read them:

- **The performance panel of Chrome.** A recording shows every span on its track in the DashQL group, next to the
  calls of the main thread and the tracks of React, with its detail in the tooltip, e.g. the workbook of a derive or
  the text of a query.
- **A script.** `performance.getEntriesByType('measure')` lists the spans with their `detail.text`, e.g. from a
  Playwright page that loads a workbook and changes an input. Sum them by name to compare a change with its base.

| Span | Where | What |
|---|---|---|
| `store:flush` | `RuntimeStore` | A flush of the store: the take, the views of every changed kind, the notification of the subscribers |
| `store:takeChanges` | `RuntimeStore` | The changes of the runtime, with the derive of the workbooks that changed |
| `store:views` | `RuntimeStore` | The views of one kind with their projections, the kind and the number of slices as detail |
| `store:notify` | `RuntimeStore` | The subscribers of the changed slices, the renders of React follow |
| `runtime:dispatch` | `Runtime.dispatch` | An action in the module, its kind as detail |
| `runtime:editorEvent` | `Runtime.applyEditorEvent` | A keystroke or a move of the cursor in the module |
| `planner:derive` | `derive` of the bindings (`runtime/changes.rs`) | The derived view of a workbook: the reference check, the dataflow and the inputs, packed and hashed |
| `planner:plan` | `planner::plan` | One plan of the statements of a workbook, also the ones of a run and of the dataflow |
| `planner:references`, `planner:dataflow`, `planner:inputs` | `planner/` | The passes of the derived view |
| `core:analyze` | `Workbook::analyze_at` | The analysis of one script, its file as detail |
| `run:workbook` | `Run::run_plan` (`workbook_run/engine.rs`) | A run of a workbook from its analysis to the release of its files |
| `run:settleResults` | `Run::plan_and_run` | The keys of the scripts of a run and the stored results that they reuse |
| `query:open`, `query:run` | `QueryChannels` | A query of a channel of the host until its first answer, and until its last batch |
| `results:mount`, `results:read`, `results:write`, `results:import` | `QueryChannels` | The stored results of the scripts |
| `compute:importTable`, `compute:createTable`, `compute:query` | `createComputePlatform` | The computations of the results in the compute database |
| `render:visRows`, `render:visEmbed` | `VegaLiteView` | The rows of a chart, and its compilation and first run in Vega |
| `render:deferredWait`, `render:deferredShow` | `Deferred` | The wait of a heavy part for a calm frame, and the render that shows it |
| `dataflow:layout` | `DashQLDataflow` | The layout of the dataflow canvas with ELK |

A new span goes on a seam that is called a few times per user action, never into a loop over rows or tokens. In
TypeScript, `perfMarks.measure(name, fn, detail)` measures a function, also one that returns a promise, and
`perfMarks.start()` with `perfMarks.end(name, started, detail)` a span across calls. In Rust,
`perf_marks::measure`/`measure_with` and `begin`/`end` of `dashql_core_runtime::perf_marks` record through the
recorder that the bindings install while the marks are on (`setPerfRecorder`). A detail that costs something to build
is a function, it is only built while the marks are on. Add the span to the table.
