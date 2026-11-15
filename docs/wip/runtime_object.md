# One runtime object

Status: proposed, nothing of it is built. Written on `21ea12945` (the workbook views on main), assuming the
connection and query history views of `da18b83f3` (branch `worktree-agent-a2641d627b54c41a5`) have landed. Line
counts are measured on `21ea12945` and count the `.ts` files without their tests; numbers marked as estimates are
estimates.

The state and the services of DashQL are Rust (see [core_runtime.md](core_runtime.md)), but they are eleven classes of
the module, each with its own host, and the TypeScript of `packages/dashql-runtime` carries every value from one to the
next. This document designs the next step of the port: one `Runtime` of the module that owns the workbooks, the
connections with their query histories, the computations and the services, with the services calling each other in
Rust. The registries, the services and the adapters of TypeScript that only pass values between the Rust states go.
It continues "The registries in Rust" of [runtime_projection.md](runtime_projection.md) and replaces its steps 4 and 5
with the slices below.

## Where it stands

Measured on `21ea12945`:

- **Seven hosts.** The bindings implement `host::Host` seven times (the storage writer, the restore, the query
  executor, the catalog loader, the connection setups, the runs of workbooks, the computations) and `http::HttpHost`
  three times, over eight host interfaces of the generated declarations. The TypeScript builds the clock, the timers,
  the log and `fetch` with its aborts in each of their adapters again.
- **TypeScript in every hop.** The executor reports a `QueryEvent` as JSON, `QueryExecutorService.report` turns it into
  an action of the registry of connections, the `UpdateQueue` applies it in its flush, and `NativeConnection` calls the
  Rust connection. A statement of a run goes from the Rust run to `createRunHost`, to `QueryExecutorService.execute`,
  to the Rust executor. A catalog update starts in the Rust loader, crosses as `update_started` into the registry and
  comes back to the Rust connection. The effects of a workbook reach the Rust storage writer through
  `WorkbookScriptsEffects` of TypeScript; the restore hands Rust objects to TypeScript, which adopts them into the
  registries; `CATALOG_DID_UPDATE` fans out to the workbooks of a connection through the TypeScript index; the
  persistence of a connection maps the action to a `ConnectionPersistenceChange` and hands the Rust connection back.
- **The registries hold the index by hand.** `reindexWorkbookScriptConnections` maintains the workbooks of a connection
  on every action, `followRegistries` of the runs and `setRegistry` of the catalog loader scan the registries after
  every store update.
- **Four ways to wait for the core.** The storage writer, the computations, the query history of the shell and the
  executor each queue their calls until the core is instantiated.
- **Whole-registry stores.** `useWorkbookScripts(id)` and `useConnectionById(id)` subscribe to the store of the whole
  registry, so every consumer of any workbook renders again on a keystroke in one script.
- **The holds of runs are global.** `activeWorkbooks` of `workbook_execution.ts` is a map of the module, shared by
  every runtime of a process.

The TypeScript that exists to pass values between the Rust states, measured:

| File | Lines | What it passes |
|---|---|---|
| `workbook/scripts/workbook_scripts_registry_state.ts` | 225 | the index, the queue of workbook actions, the fan-out |
| `workbook/scripts/workbook_scripts_registry_service.ts` | 151 | allocation, creation, deletion, the first writes |
| `connections/connection_registry_state.ts` | 223 | the refusals, the persistence change, the index by type |
| `connections/connection_registry_service.ts` | 74 | the queue of connection actions, the frame batching |
| `connections/connection_persistence_service.ts` | 118 | the save through the module, the save states |
| `connections/query_executor_service.ts` | 746 | query records, events into the registry, the cache, the analysis |
| `connections/catalog/catalog_loader_service.ts` | 312 | the registry to the loader, updates into the registry, queries |
| `workbook/scripts/workbook_execution_service.ts` | 281 | one run per workbook, queued inputs, stopping on a dropped connection |
| `workbook/scripts/workbook_execution.ts` | 426 | the run host, the holds, the mounts of the cache |
| `workbook/scripts/script_run.ts`, `rerun_query.ts` | 265 | the run of a script, its services per core |
| `connections/connection_setup_native.ts` | 232 | the setup host, actions with channels by id |
| `compute/computations.ts` | 106 | the core, the query execution of the tasks |
| `runtime.ts` | 194 | the wiring and the followers |
| `store/store.ts` (`UpdateQueue`) | 123 | the batching of the registries |

## The object

### What it owns

`Runtime` is a struct of the crate (`src/runtime/`), shared as `Rc<RuntimeInner>`; the services hold a `Weak` of it.

```rust
pub struct RuntimeInner<H: RuntimeHost> {
    host: Rc<H>,
    state: RefCell<RuntimeState>,     // the registries, borrowed only between awaits
    writer: StorageWriter<H>,         // storage/writer.rs, the one the platform passed
    executor: QueryExecutor<H>,       // executor/
    catalog_loader: CatalogLoaderService<H>,
    computations: ComputeService<H>,  // compute/service.rs
    runs: RunService,                 // workbook_run/service.rs, new
    changes: RefCell<ChangeSet>,
}

pub struct RuntimeState {
    workbooks: BTreeMap<WorkbookId, Rc<RefCell<Workbook>>>,
    invalid_workbooks: BTreeMap<WorkbookId, InvalidWorkbook>,
    connections: BTreeMap<ConnectionId, ConnectionEntry>,  // the state, the history, the persisted fields
    connections_by_type: Vec<Vec<ConnectionId>>,
    next_query_id: QueryId,
    saves: BTreeMap<ConnectionId, ConnectionSaveState>,
}
```

- **Workbooks.** The `Workbook`s of today, by id, with the invalid workbooks. The workbooks of a connection are derived
  from the scripts and the pending connection of every workbook, kept per workbook with the revision of its connection
  list, so a keystroke doesn't touch it.
- **Connections with their histories.** The `ConnectionState` and the `QueryExecutionHistory` of a connection are one
  entry; the executor, the catalog loader, the setups and the runs reach them through the runtime instead of through
  `Rc`s that a binding hands out. One sequence of query ids for all connections (`allocateQueryId` of TypeScript goes).
- **Computations.** The `ComputeService` of the runtime; the shell keeps a `Computations` of its own, it has no
  runtime.
- **The services.** The storage writer, the executor, the catalog loader, the setups and health checks, the run
  service. Each keeps its own state behind its own `RefCell` as today.

### How services reach each other

A service calls another as a method of the runtime. The rule of the crate stays: no borrow across an await, what the
host is told is collected while a state is borrowed and passed on after.

- A workbook action returns `WorkbookEffect`s; the runtime hands them to its writer in the same call.
- A connection action runs the decisions of `connection_persistence.rs` with the workbooks that reference it, the
  refusals (deleting a referenced connection or the embedded Hyper, switching the type of a shared one), and fans out
  to the workbooks: `CatalogDidUpdate` analyzes the scripts of the connection again.
- The executor applies its `QueryEvent`s to the history of the connection directly. A result that asks for an
  analysis starts it on the computations of the runtime; the queries of the tasks enter the history of the connection
  of the computation as `INTERNAL_SQLFRAME` queries.
- The catalog loader reads the connections of the runtime instead of following weak references under the ids of a
  registry (`follow`, `observe`, `setRegistry` go), applies the start and the end of an update to the connection, and
  runs its metadata queries on the executor.
- A setup applies its actions to the connection of the runtime (`SetupHost::dispatch` goes) and runs the health probe
  on the executor.
- A run hands its statements to the executor, see [The run service](#the-run-service).
- The restore inserts the connections and workbooks it creates into the state; `RestoredAppState`, `adopt` and the
  wrapping in `NativeConnection` go.

### The host

One trait set, implemented once by the module over one JavaScript object (`RuntimeHost` in the declarations):

```rust
pub trait RuntimeHost: Host + HttpHost + RestoreHost + OAuthHost + ChannelHost + ComputeDatabaseHost + ResultCacheHost {
    fn sha256(&self, input: &[u8]) -> impl Future<Output = Result<Vec<u8>, HostError>> + 'static;
    fn random_uuid(&self) -> String;
    /// A change set is ready, the host schedules `take_changes`
    fn changed(&self, urgent: bool);
}
```

- `Host` (clock, timers, spawn, log), `HttpHost` (fetch, abort by request id), `RestoreHost` over `StorageHost` (the
  backend of the platform) and `OAuthHost` stay as they are.
- `ChannelHost` is the half of `ExecutorHost` and `SetupHost` that speaks the channels of the host: open, next message,
  cancel, profile detail, close, by the handle of the channel. The embedded Hyper, gRPC through the native proxy of the
  desktop app and the channels of tests live there.
- `ComputeDatabaseHost` is the I/O half of `ComputeHost` (import a result table by its handle, create a table from a
  SELECT, query, drop, cancel the calls of a run) plus reading the columns of a Parquet attachment and mounting the
  attachments.
- `ResultCacheHost` is the query result cache: lookup, read a file into a result table of the host and write one by
  its handle (the compute database reads and writes the Parquet), touch, retain and release, new file names, the mount prefix, remove. It replaces the cache
  calls of `ExecutorHost` and `RunHost` and the `ExecutionMounts` of TypeScript.
- What the hosts are told today about the registries goes: `report`, `update_started`, `update_finished`,
  `workbook_changed`, `state`, `changed` of the computations, `dispatch` of the setups. They are changes of the
  runtime now.

The tests of the crate implement the trait set once as a fake (the fakes of `tests/*_service_test.rs` merge into
`tests/support/fake_host.rs`).

### createRuntime

```ts
export function createRuntime(platform: RuntimePlatform): Runtime {
    const handles = new HandleTable();
    const host = createRuntimeHost(platform, handles);       // runtime_host.ts, the platform as one object
    const native = new LazyRuntime(platform.setupCore, host); // the core comes with the first call
    const store = new RuntimeStore(native, handles, platform.scheduler);
    return { platform, logger: platform.logger, handles, store, ...runtimeMethods(native, store) };
}
```

- `createRuntime` stays synchronous. The calls before the core is there wait in one queue and run in order, the four
  copies of that queue go. `restore()` instantiates the core.
- The storage writer is the one of the platform: the app creates it in its storage provider before the runtime and
  flushes it when the page hides. `DashQL.createRuntime(host, writer)` shares the `Rc` of the writer of the binding.
- The compute database and the API of Salesforce come later in the app (`setComputeDatabase`, `setSalesforce`); the
  host object reads them when it is called, as the adapters do today.
- `destroy()` stops the runs and the loader, flushes the cache writes and the writer, frees the runtime and checks that
  the handle table is empty in tests.

## Dispatch and reading

### Dispatch

- **One dispatch.** `runtime.dispatch(action)` takes the generated union of actions (`{ kind: 'renameScript', ... }`,
  tsify, as decided in runtime_projection.md) for workbooks, connections and computations, and returns its outcome
  synchronously: the action is applied in Rust at once. A failed action returns its error and leaves the state.
- **Typed methods on the hot path and for services.** `reportEditorUpdate(workbookId, scriptKey, packed)` with the
  packed buffer of the editor, `executeQuery`, `cancelQuery`, `runWorkbook`, `stopRun`, `runScript`, `saveConnection`,
  `setupConnection`, `refreshCatalog`. They return promises where the work is async.
- **Allocation.** Creating a workbook or a connection is an action with its id from `random_uuid` of the host; the
  random base names of new scripts stay in TypeScript and come with the action (kept on purpose in core_runtime.md).

### Effects that still go to the host

Every change of the runtime is in Rust; the host gets I/O calls of the trait set and, with the change set, the effects
on its handles: `release`, `close`, `abort` (see [The handle table](#the-handle-table)). There are no named effects
for the registries anymore: `invalidateCatalogBatch` went with the batch worker, `cancelSetup` is a cancellation token
of the setup in Rust.

### The change set

- The runtime records what changed while it applies an action or a service applies an event: the roots (the workbook
  list, the connection list, the run states, the save states) and the slices by kind and id with their revisions, plus
  the effects on handles. Below a root, a parent lists its children as `[id, revision]` (built for the workbook and the
  connection).
- After the first change it calls `changed(urgent)` once. A change set is urgent unless it holds only the progress and
  the batches of queries. The host schedules a flush: at the end of the task when urgent, before the next frame
  otherwise, and an urgent change flushes a pending frame flush at once. This is the scheduling of `UpdateQueue`,
  applied to notifications instead of to actions.
- The flush calls `takeChanges()`, runs the effects on handles, reads the views of the changed slices in one crossing
  per kind (`views(kind, ids)`), shares them with the previous views, and notifies the subscribers of each changed
  slice.

### The store as a cache

`RuntimeStore` (`store/runtime_store.ts`) holds one `RevisionCache` per kind and the roots, built on
`store/projection.ts`:

- `getSnapshot` of a slice reads the cache only, never the module. A slice keeps its object while its revision doesn't
  move, so `useSyncExternalStore` sees the same object between flushes and a changed one after.
- A read right after a dispatch sees the state of the last flush, as the registries do today. `runtime.flush()` flushes
  at once for the callers that need the latest state, e.g. the command line tool and tests; the promise of a typed
  method resolves after the flush that holds its change.
- Until the consumers read views (step 6 of runtime_projection.md), the hydrators of the cache build the objects of
  today from the views: `WorkbookScripts` and `ScriptData` (`workbook_native.ts`), `ConnectionState` and
  `QueryExecutionState` (`connection_native.ts`), the computation state (`computation_native.ts`).

### React

- **Hooks per slice.** `useWorkbook(id)`, `useScript(workbookId, key)`, `useWorkbookList()`, `useInvalidWorkbooks()`,
  `useConnection(id)`, `useConnectionList()` (the ids by type, the listed ones and their ordinals, derived in Rust),
  `useQuery(connectionId, queryId)`, `useComputation(tableId)`, `useWorkbookRun(id)`, `useConnectionSave(id)`. The
  names of today (`useWorkbookScripts`, `useConnectionById`, `useWorkbookConnections`) stay as wrappers over them.
- **Selectors go.** `useConnectionRegistrySelector`, `useConnectionReferencesSelector` and the identity guard of
  `useWorkbookConnections` exist because the stores are whole registries; a slice keeps its identity by revision.
- `utils/store_hooks.ts` keeps `useStore` and `useStoreState` for the stores of the app (focus, view modes); the
  registry stores and `storeWithoutRuntime` for them go.

### Typing

The bar is the measurement of "Typing" in core_runtime.md on the release module: median per keystroke 128 µs for the
reduction and 25 µs for its projection (measured on `1e96729fa`), with the two crossings of the workbook view and the
script view. Each slice runs that benchmark and must not exceed it.

- A keystroke is `reportEditorUpdate`: the workbook applies the update as today, the runtime marks the workbook and the
  script changed (two map inserts) and hands the effects to its writer without the crossing of
  `WorkbookScriptsEffects.commit`. The index of connections is not touched, the text doesn't change the connections.
- The flush reads the same two views. With hooks per slice, the subscribers of that workbook and that script render;
  today every subscriber of the workbook registry does.
- The action applies inside the update listener of the editor instead of in a microtask after it. The cost moves, it
  doesn't grow.

## The handle table

Step 2 of runtime_projection.md and the first slice. One `HandleTable` per runtime (`store/handles.ts`):
`register(object) -> id`, `get(id)`, `release(id)`, `size`. Rust holds a `HostHandle`: an `Rc` around the id whose
`Drop` records a `release` in the change set. Rust owns the lifetime of every handle it holds; the host never releases
a handle that it gave to Rust.

What stays a host object by id:

| Object | Held by | Released |
|---|---|---|
| A channel of the host: the embedded Hyper session, gRPC through the native proxy, a channel of a test | the connection | `close` on reset, delete or a new setup |
| The stream of a query on a host channel | the running query | with the query |
| A result table (results never live in the core module), a table that an action of the host hands over | the history, the computation | with the query, the computation or the history limit |
| A host operation that Rust can abort: a fetch, the calls of a compute run, a channel stream, an OAuth flow | the task | `abort`, then `release` when the task ends |
| The original error of a failed query, setup or update (a `LoggableException` with its stack) | the query, the update | with the query or the update |
| An OAuth window or the loopback listener of a flow | the setup | when the flow ends or is cancelled |
| A retained file of the query result cache, the pins of a run | the run, the query | when the run or the cache write ends |

- **Abort controllers go from the state.** A cancellation is a `CancellationToken` in Rust. The host keeps an
  `AbortController` only for an operation that Rust started and may abort, under the handle of the operation. An
  abort signal of a caller (`QueryExecutionArgs.abortSignal`, the signal of a setup) is mapped by the facade to the
  cancel method of the runtime.
- **The three effects** replace `releaseResultTable`, `releaseChannel`, `releaseDataFrame`, `closeChannel`,
  `abortCatalogUpdates`, `stopQueries`, `abortComputation`, `abortDataSearch` and the forgetting of query records.
- **Data frames stay ids of the compute database**, allocated by the runtime; they are tables, not JavaScript objects.
- **Leaks are visible.** `size` is checked after `destroy()` in `createTestRuntime`; a test resets and deletes a
  connection with a channel, a running query and a running update and expects the table empty.

## The run service

`WorkbookExecutionService`, the holds of `workbook_execution.ts` and the services of `script_run.ts` become
`workbook_run/service.rs` on the run engine of today (`workbook_run/engine.rs`).

- **One run per workbook.** `RunService` keeps the runs by workbook: the kind (workbook or script), the cancellation
  token, the connections that were online at the start, and the state of the run (`RunState`, a slice of the change
  set). The holds of the runs are the keys of that map: `useWorkbookRun(id)` reads `{ state, held, kind }`, and the
  global `activeWorkbooks` with `subscribeWorkbookExecutions` goes. A second runtime in a process has its own holds.
- **The blockers are reads of the state.** A run starts when the compute database is set up, no run holds the workbook
  or one of its connections, no connection is connecting and no connection runs a query that isn't `INTERNAL_SQLFRAME`.
  The service reads the connection entries directly.
- **Input changes wait for an event, not a poll.** A change of inputs while the workbook is busy merges into the
  pending inputs of the workbook and cancels the run that holds it. The runtime checks the pending inputs whenever a
  run ends or a connection of the workbook changes its health or its active queries, and starts the run once nothing
  blocks. A timer of the host drops the change after 5 s, the limit of the 50 polls of 100 ms today, with the same
  warning.
- **Stopping on a dropped connection.** Applying a connection action that moves the health of a connection away from
  online cancels the runs that hold it in their online set; deleting a workbook cancels its run. `followRegistries`
  goes, nothing scans the registries after an update.
- **Statements go to the executor in Rust.** `RunHost::execute` becomes a call of the executor with the planned
  statement; the readiness of a result and its end are futures of the executor. `workbook_live` compares the workbook
  of the runtime, `workbook_changed` is a change of the workbook slice, `state` and `script_event` are a change of the
  run slice and an event of the run.
- **The holds of the cache.** The run retains the cached files it reads and pins the files it writes through
  `ResultCacheHost`, and releases them when it settles (today's `createExecutionMounts`). The transient files are
  removed then.
- **Attachments.** The columns of a Parquet attachment are read once per file and stamp through the host and set with
  `SetAttachmentColumns`, triggered when the runtime applies attachments without columns; the scan in
  `followRegistries` goes.
- **The run of a script.** `runtime.runScript(workbookId, scriptKey, { refresh })` analyzes an outdated script first
  (`ensureWorkbookScriptAnalyzed` goes), refuses a cloud preview and a held workbook, records a plan error as a failed
  query of the script in the history (no executor round trip), and resolves with the result table of the last output.
- **Events for the command line tool.** `runWorkbook` takes an optional listener of `ScriptRunEvent`s, the events of
  today, so `run_events.ts`, the reporters and the journal markers of `dashql run` keep their input. The CLI keeps its
  own `prepareConnection` (the credentials of the environment) as a host call that a run makes before its first
  statement, when the host says it prepares connections.

## Result tables

- **Results never live in the core module.** A result passes through the module at most one page at a time, where a
  protocol needs a conversion (Trino, client functions), and lives in JavaScript and in hyperdb-wasm (through the data
  frames), held by handle. Hyper over HTTP hands its chunks over as they are, a channel of the host keeps its batches.
  The query executor works like this already, see "The query executor" in core_runtime.md. The core module is wasm32:
  its linear memory has a limit of 4 GiB and never shrinks, so a result held in Rust would keep its peak for the life
  of the page. There is no memory budget in Rust and no result as a Rust value.
- **Host tables by handle.** A query result is a table of the host (`ResultTable::Host`), the history and the
  computations hold its handle. The host builds it from the parts of the stream (`finish_result`) or reads it from the
  query result cache, imports it into the compute database for the analysis and writes the cache from it; Rust
  decides when, and learns the rows, columns and batches.
- **To the UI.** The table is a JavaScript value already: `runtime.resultTable(tableId)` returns it from the handle
  table, nothing crosses. The table cache of the store keeps it while a query, a run result or a computation names it,
  and drops it with the `release` of the change set. `executeQuery` keeps its signature for its callers: its promise
  resolves with the table.
- **The cache as a host.** `ResultCacheHost` keeps OPFS, the Parquet files and the pins; the keys, the decisions to
  read, write and evict are Rust. The key keeps its bytes: the signature of the params and the script are built in Rust
  in the canonical form of `query_result_cache_key.ts`, the host hashes them with SHA-256.
- **What goes.** The `table` and `cacheEntry` of the query records move to the handle table, `registerArrowTable` for
  results, `analyze_table.ts`, `result_computations.ts` (the crate has its port), the `analyze_result` and `cache_*`
  calls of `ExecutorHost` become calls of the runtime host on the handle.

## Slices

Each slice keeps the app and the tests green and is one agent's work; the slices touch overlapping files and run one
after another in this order. Line numbers are estimates of the TypeScript of `packages/dashql-runtime` and the app,
counted without tests.

### 1. One host and the handle table

- **Rust.** `dashql-core-wasm/src/host.rs` with `JsRuntimeHost` over one JavaScript object: `Host`, `HttpHost`,
  `StorageHost`, `RestoreHost`, `OAuthHost`. The seven bindings take it and keep only their service callbacks
  (`report`, `update_started`, the run host) on the objects of today. `HostHandle` with the release on `Drop`; the
  outcome of an action carries `release`, `close` and `abort`.
- **TypeScript.** `runtime_host.ts` builds the host from the platform once; `store/handles.ts`. The channels,
  result tables, errors and aborts of `connection_native.ts`, `connection_setup_native.ts`, `computation_native.ts`,
  `query_executor_service.ts` and `catalog_loader_service.ts` become handles; their id maps and effect switches go, and
  so do the five copies of clock, timers, log and fetch.
- **Lines.** TypeScript −450, +180 (net −270). Rust bindings −300, +250.
- **Risks.** A handle that the host releases while Rust holds it; the rule is that only Rust releases what it holds.
  A connection reset during a setup must close the channel exactly once.
- **Tests.** `connection_state.test.ts` and `connection_registry_service.test.ts` (channels closed on reset and delete,
  result tables released), `query_executor_service.test.ts` (cancelling), `catalog_loader_service.test.ts` (aborts),
  the setup tests of the app; new: `handles.test.ts` (each verb, the table empty after `destroy`).

### 2. The registries in Rust

- **Rust.** `src/runtime/` with `RuntimeState`: the workbooks, the invalid workbooks, the connections with their
  histories, the derived index, the promotion of the ephemeral workbook, the fan-out to the workbooks of a connection,
  the refusals, the persistence decisions and the writer; the restore inserts into it, also for a single workbook
  against the live connections (`connection_restore.ts` goes). The binding `Runtime` (`runtime.rs`) with typed methods
  for the actions of today, `takeChanges()` and `views(kind, ids)`.
- **TypeScript.** `WorkbookScriptsRegistryService` and `ConnectionRegistryService` become facades with their API
  (`dispatch`, `dispatchConnection`, `allocate`, `create`, `delete`, `deleteInvalid`), mapping the symbol actions to
  the typed methods in one switch each. Their stores are rebuilt in the flush from the changed slices with the
  hydrators, so the hooks and the 89 files that read `ConnectionState` or `WorkbookScripts` (measured, 55 of them in
  the app) don't change. The flush
  replaces the `UpdateQueue`: the actions apply at once in Rust, the projection is batched.
- **Deleted.** `workbook_scripts_registry_state.ts`, most of `workbook_scripts_registry_service.ts`,
  `connection_registry_service.ts`, the reducing parts of `connection_registry_state.ts` (the label helpers stay until
  slice 3), `WorkbookScriptsEffects` and the promotion in `workbook_scripts.ts`, the mapping of
  `connection_persistence_service.ts`, the adoption in `app_state_loader.ts`, the followers in `runtime.ts`.
- **Lines.** TypeScript −1,000, +250 (net −750). Rust +1,300 (crate 800, bindings 500), tests +600.
- **Risks.** The order of deleting a workbook before its connection (the catalog is shared; in Rust the `Rc` keeps it,
  the rule of `WorkbookScriptsRegistryService.delete` turns into a test). Consumers that compare registry objects by
  identity. Older snapshots of a workbook keep reading as they were (kept on purpose).
- **Tests.** `workbook_scripts.test.ts`, `workbook_scripts_registry_service.test.ts`,
  `connection_registry_service.test.ts`, `runtime.test.ts` (write with one runtime, restore with a second),
  `restore_test.rs`; new: `tests/runtime_test.rs` on the fake host (index, fan-out of `CatalogDidUpdate`, promotion,
  refusals, the writes of a connection change and a save), the typing benchmark.

### 3. One dispatch and reading by slice

- **Rust.** The generated action union with tsify for workbooks, connections, setups and computations; `dispatch`.
- **TypeScript.** `RuntimeStore` with a cache per kind and subscriptions per slice, the hooks per slice, the table
  cache. The call sites of the actions move to the union: 358 action literals in 53 files of the app, measured.
- **Deleted.** The action symbols, unions and switches of `workbook_scripts.ts`, `connection_state.ts` and
  `query_execution_state.ts`, `reduceSetupStep` of `connection_setup_native.ts`, the switch of
  `NativeComputations.call`, `UpdateQueue`, the registry facades and stores of slice 2, the selectors and references of
  `connection_registry.tsx` and `workbook_scripts_registry.tsx` in the app.
- **Lines.** TypeScript −1,050, +450 (net −600).
- **Risks.** A wide mechanical diff in the app; the number of renders changes (fewer), tests that count renders or
  rely on a component rendering with another workbook need care. Re-entrancy: a subscriber that dispatches inside the
  flush.
- **Tests.** The tests of the app that edit scripts and connections; new: typing in one script renders only its card
  and its workbook (render counts in a test of the app), progress notifies once per frame, a dispatch from a
  subscriber, the typing benchmark.
- This slice may go after 4 and 5: they change the runtime, it changes the app.

### 4. Queries on the runtime

- **Rust.** The executor reports into the history of the runtime, query ids from the runtime, results as host tables
  by handle (`ResultTable::Host`, no memory budget in Rust), the analysis on the computations of the runtime, the cache
  through `ResultCacheHost`, the queries of the compute tasks in the history.
- **TypeScript.** `executeQuery` and `cancelQuery` of the runtime; `QueryExecutorService` keeps its signature as a
  facade and the channels of the host (`produce`, `nextMessage`, the Trino token of a host channel) in
  `runtime_host.ts`.
- **Deleted.** Most of `query_executor_service.ts` (the records, `report`, the cache host, `analyzeResult`),
  `compute/computations.ts` but the shell's, `analyze_table.ts`, `result_computations.ts`, the query id allocation of
  `tracked_query_execution.ts`, the tables and query records of `connection_native.ts`, the import path of
  `computation_native.ts`.
- **Lines.** TypeScript −900, +150 (net −750). Rust bindings −300 (the executor binding and its JSON events).
- **Risks.** The progress of a stream, which must stay batched per frame. The bytes of the cache key.
- **Tests.** `query_executor_service.test.ts`, `compute/computations.test.ts`, `workbook_execution_integration.test.ts`
  (cached results), `executor_test.rs`, `compute_service_test.rs`; new: a result table is the same object for every
  reader of its handle, the keys of a fixed workbook match the keys of today (a snapshot). The memory of the module
  while a large result streams is measured already (`query_executor.test.ts` of `dashql-core-js`).

### 5. The services on the executor

- **Rust.** The run service; the catalog loader on the connections of the runtime; the setups and health checks on the
  connections and the executor; `runWorkbook`, `stopRun`, `runScript`, `setupConnection`, `refreshCatalog`.
- **TypeScript.** `createRuntime` builds the host, the store and the facades; the CLI runs `dashql run` on
  `runWorkbook` with its listener of script events.
- **Deleted.** `workbook_execution_service.ts`, the run host and the holds of `workbook_execution.ts` (the type of the
  script events stays), `script_run.ts`, `rerun_query.ts`, most of `catalog_loader_service.ts` and
  `connection_setup_native.ts`, `connection_setup_cancellation.ts`, most of `runtime.ts`.
- **Lines.** TypeScript −1,350, +150 (net −1,200). Rust: the run service +600, the hosts of `workbook_run.rs`,
  `catalog_loader.rs` and `connection_setup.rs` −700.
- **Risks.** The timing of queued input changes (event instead of poll), the holds that the UI reads, the CLI with its
  credentials of the environment, a setup cancelled while its channel opens.
- **Tests.** `workbook_execution_service.test.ts`, `workbook_execution.test.ts`, `script_run.test.ts`,
  `workbook_execution_integration.test.ts`, `use_workbook_execution.test.tsx`, `catalog_loader_service.test.ts`,
  `workbook_run_test.rs`, `catalog_loader_service_test.rs`, `connection_setup_test.rs`, `//packages/dashql-cli:test`
  (the fake Trino); new: `tests/run_service_test.rs` (one run per workbook, inputs queued and merged, a run stopped by a
  dropped connection and by a deleted workbook, two runtimes with separate holds, the 5 s limit on the fake clock).

### In total

Slices 1 to 5 remove about 3,600 lines of TypeScript net (estimate) and add about 3,000 lines of Rust with tests.

### Pieces that run in parallel

These touch few files of the slices and can run next to them, by another agent, where noted:

- **The progress model in Rust.** `query/progress.rs` is ported; the executor applies the engine payloads itself and the
  query view carries the profile progress as a FlatBuffer by revision. `query_progress_model.ts` (289) and
  `profile_execution_state.ts` (65) go, about −330 lines. It touches `query_executor_service.ts`: before slice 4, not
  during it.
- **The workbook inputs in the view.** `deriveWorkbookInputs` and its module-global cache become a part of the
  workbook view by revision, from the planner of the crate; `workbook_inputs.ts` keeps the controls and the literals,
  about −120 lines. It touches the workbook view: not during slice 2.
- **The storage writer and the restore on views.** Step 1 of runtime_projection.md for `storage_writer.rs` and
  `restore.rs` (their `json!`), and the adapter of `storage/storage_writer.ts`, about −150 lines. Before slice 2,
  which moves the restore into the runtime.
- **The journal of agent sessions.** `session/` reads log records and the markers of `dashql run`, which come from the
  script events; it depends on the event contract only, which slice 5 keeps. It can change at any time.
- **The editor sends its events to the workbook** (`ApplyEditorEvent`, 0.09 ms per keystroke, core_runtime.md). Any time
  after slice 2.
- **The connection setups on views.** The JSON of `connection_setup.rs` and its actions as views, before slice 5.

## What stays TypeScript

- **The platform.** The embedded Hyper (`platform/hyperdb/`, `node/node_hyperdb.ts`) and its channels, the storage
  backends (OPFS, the native folders, `node:fs`), the OPFS root and the instance folders, the logger and its buffer,
  the HTTP client and fetch, the OAuth flows (windows, the redirect page, the loopback), the locks, the Node platform
  and `src/node/`.
- **Hosts.** `runtime_host.ts` over the platform, the query result cache over OPFS and Parquet, the compute database.
- **What the UI formats and edits.** `arrow_formatter.ts`, the workbook tree (read before the core and edited by the
  sidebar synchronously), ZIP archives with zip.js and the compilation of chart specs with vega-lite (host calls until
  a reason to move them).
- **The store and its hydrators** until the consumers read views (step 6 of runtime_projection.md): `RuntimeStore`,
  `projection.ts`, `handles.ts`, the hydrators in `workbook_native.ts`, `connection_native.ts`,
  `computation_native.ts`, and the types the consumers read (`connection_state.ts`, `query_execution_state.ts`,
  `computation_types.ts`).
- **Connectors where TypeScript is the client.** The Salesforce API client of the settings pages and its mock, the
  gRPC client of Hyper in the desktop app, the client of Hyper over HTTP that the settings and the tests use.
- **The shell of Hyper.** It keeps its own `QueryHistory` and `Computations` classes; it has no runtime.
- **The command line tool's support**: lint, format and the reports of SQL files, the session journal and its state,
  the test helpers.

`packages/dashql-runtime` has 23,939 lines of TypeScript without tests (measured). After the five slices and the
parallel pieces about 19,700 remain (estimate): about 7,000 of platform, storage and Node (`platform/`, `storage/`,
`node/`, `workbook/persistence/`), 3,500 of connectors and their clients, 3,500 of the computations and the query
types that the consumers read, 1,800 of the store, the hydrators and the workbook types, 1,000 of the host, and the
rest in tests' helpers, the session and utilities. Step 6 of runtime_projection.md, the consumers on views, would remove
about another 2,500 of hydrators and types.

## Risks

- **Re-entrancy.** One `Runtime` object means every host call happens inside a method of it. The bindings take `&self`
  with the state in `RefCell`s, a host call never runs inside a borrow, and the host is told only after the borrow
  ended; a host that calls back synchronously gets the wasm-bindgen error "recursive use", not a panic. A test per host
  callback that calls back into the runtime.
- **Semantics of the flush.** Actions apply at once and the projection lags until the flush. A caller that dispatches
  and reads the store in the same task reads the previous state, as today; one that awaited the promise of a dispatch
  reads the new one. Tests that relied on the queue applying in order with other queued updates move to `flush()`.
- **The wide diff of slice 3.** The action call sites of 53 files change at once. The union is generated, the
  typecheck finds every miss.
- **The cache key.** A key that changes by one byte makes every cached result a miss. A snapshot of the keys of a
  fixed workbook pins it.
- **Wasm size.** The runtime adds the registries and the run service, the bindings lose six hosts and the JSON of the
  events. Measured per slice like the views.
- **Panics.** A panic traps the module and now every workbook and connection with it. The rules of the crate hold:
  `Result` on input, no indexing and no unwraps.

## Decided against

- **A runtime per workbook.** The connections, their catalogs and their histories are shared by workbooks; a runtime
  per workbook would keep the TypeScript between them.
- **Keeping the `UpdateQueue` for actions.** Applying actions in a flush was there to run each update once in
  TypeScript; in Rust an action runs once by construction, only the notification needs batching.
- **Notifying per action.** A result stream applies hundreds of batches per second; the frame batching of the queue
  stays as the batching of notifications.
- **Results as Rust values.** The linear memory of the wasm32 core module is capped at 4 GiB and never returns what
  it grew by: a page that showed one large result would keep the peak, and a result above a few hundred MB would fail
  to allocate where the heap of JavaScript holds it. A budget with handles above it would keep two paths. Results stay
  host tables by handle; the cost is that the analysis and the cache go through the host.
- **Reading the module in `getSnapshot`.** A revision costs a crossing (0.14 µs, measured in runtime_projection.md)
  per read and React reads often; the cache holds the revisions of the last flush.

## Open

- Whether a large result streams to the UI in parts, and whether the parts go to the compute database as they arrive.
- Whether the shell becomes a runtime without workbooks, so its history and computations are those of the runtime.
- Whether `ConnectionSaveState` and the run states need revisions of their own or ride on their connection and
  workbook.
- The connections of a native workbook that changed on disk are restored by the runtime in slice 2; whether the native
  file sync moves with them.
