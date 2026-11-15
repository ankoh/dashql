# The core runtime

Status: the workbook scripts, the connections, the computations, the storage writes, the queries, the restore of the
stored state, the persistence of connections and the storage format of workbooks of the app run on Rust.
`packages/dashql-core-runtime` (crate `dashql_core_runtime`) holds the scripts of a workbook, the state of a
connection with the history of its queries, the query history of the shell and the computations, linked into the core
module. `reduceWorkbookScripts`
of the TypeScript runtime is an adapter over the workbook (`workbook/scripts/workbook_native.ts`),
`reduceConnectionState` one over the connection (`connections/connection_native.ts`), `reduceComputationState` one
over the computations (`compute/computation_native.ts`). The storage writer is the first service on a host
(`storage/storage_writer.ts` over `src/storage/`), the restore the second (`workbook/persistence/app_state_loader.ts`
over `src/restore/`), the tasks of the computations the third (`compute/service.rs` on the compute database of the
platform), the query executor the fourth (`QueryExecutorService` over `src/executor/`): Trino, Hyper over HTTP,
Salesforce Data Cloud and the client functions run their protocols in Rust over the HTTP client of the host, the
catalog loader the fifth (`CatalogLoaderService` over `catalog_loader/service.rs`): it schedules the updates of the
catalogs, runs their metadata queries through the query executor, fetches the metadata of Salesforce and registers the
client functions of the connections, the runs of workbooks the sixth (`src/workbook_run/`): a run analyzes, plans and
runs the scripts of a workbook, the setups of the connectors and the health checks the seventh (`connection_setup/`):
Trino, Salesforce and Hyper set up their connections over an OAuth host. The storage format of workbooks is called by
the storage, the imports and the exports of the TypeScript runtime (`src/workbook_format/`, see
[The format of workbooks](#the-format-of-workbooks)).

The runtime is linked into the core module, but it isn't part of the contract of the core. Integrations that use the
core on its own get the classes of the core (`DashQL`, `Catalog`, `ScriptSession`, the shell) and the FlatBuffer
schemas of `proto/fb`. The classes of the runtime (`Workbook`, `Connection`, `QueryHistory`, `Computations`,
`StorageWriter`, `AppRestore`, `ConnectionPersistence`, `QueryExecutor`, `CatalogLoader`, `WorkbookRun`,
`ConnectionSetupRun`) belong to DashQL and change with it, their snapshots cross as JSON.

The crates follow the same line. `packages/dashql-core-script` (crate `dashql_core_script`) holds the script sessions,
the compiler, batch processing, the relations that statements touch and the visualizations. It depends on the core,
the parser and the buffers only, and its sessions are part of the contract of the core. The planner, the script
references, the dataflow and the inputs work across the scripts of a workbook and are part of the runtime
(`src/planner/`).

## Why

The reducers of the TypeScript runtime are hard to follow. `reduceWorkbookScripts` copied JavaScript objects as if the
state were immutable while it changed the script sessions of the core in place, freed core objects of the previous
state after the reduction and scheduled storage writes on the way. Most of what it did was calling the core:
analyzing, publishing into catalogs, compiling, rewriting tags, checking references.

[rust_logic.md](rust_logic.md) kept the reducers in TypeScript because they hold Wasm handles, rely on object identity
and would need a crossing per state read. That holds for a reducer in TypeScript that calls into the core. It doesn't
hold for state that lives next to the core: a runtime crate linked into the same Wasm module owns the script sessions
and catalogs as plain Rust values, `Drop` frees them, and the calls into the core are function calls without packed
buffers in between. The boundary moves to what the UI reads.

## Architecture

- **One Wasm module.** The runtime crate is linked into the core module (`//packages/dashql-core-wasm:core_wasm`).
  A module of its own would duplicate the core and split the catalogs. The optimized module grew from 4.27 MB to
  4.56 MB with the workbook (gzip 1.28 MB to 1.36 MB).
- **The workbook owns its scripts.** `Workbook` holds every script with its session, its connection (with the
  shared catalog), its latest analysis, its staged rewrite and its query ids, the attachments and the table
  parameters. An action changes the workbook in place and returns `WorkbookEffect`s: the files to write, delete or
  rename, the script list and the properties of the workbook file. The host passes them to the storage writer, which
  debounces them. A dropped script leaves the catalog of its connection.
- **Sessions are shared.** The workbook shares the session of a script with a `ScriptSession` handle of the module, the
  editors of the app still apply their events to it and report the update (`ReportEditorUpdate`, the action
  `UPDATE_FROM_PROCESSOR`). The editor that sends its events to `ApplyEditorEvent` of the workbook is the end state.
- **The UI reads projections.** Every script and the workbook have a revision from one counter of the module, it
  changes with every change. `NativeWorkbook.project` builds the `WorkbookScripts` objects of the app from the
  workbook: a script keeps its `ScriptData` while its revision doesn't move, its editor update while the analysis is
  the same, its session handle while it keeps its session. Plain fields cross as JSON, editor updates, staged diffs and
  visualizations as packed FlatBuffers.
- **Actions are method calls.** The class `Workbook` of the module (`packages/dashql-core-wasm/src/workbook.rs`) takes
  typed arguments, `DashQLWorkbook` of `@ankoh/dashql-core` wraps it. The class `Connection`
  (`packages/dashql-core-wasm/src/connection.rs`) holds the state of a connection and the history of its queries,
  `DashQLConnection` wraps it. Params, errors and metrics cross as JSON.
- **A connection owns its catalog.** The connection holds its catalog with the entry ids of all catalogs of the module.
  `DashQLConnection.catalog` is one `Catalog` handle per connection that shares it, the app hands it to the scripts of
  workbooks, so the scripts publish into the catalog of the connection. The script with the functions of the
  connection stays in Rust, the catalog loader replaces its text through the connection.
- **Channels, tables and cancellations stay in JavaScript.** `NativeConnection` keeps the channels and the result
  tables by id, the abort controllers and the errors of catalog updates and queries, and the structured progress of
  a query. The effects map to what the reducer in TypeScript did: cancel the setup, invalidate the catalog batches,
  abort catalog updates and the queries of a stopped connection, close or release a channel, release a result table.
  A reset or a delete stops the queries: the binding drops the history (`QueryExecutionHistory::clear`) and names the
  active queries in the effect.
- **No panics.** A panic traps the whole module, a thrown error of a reducer in TypeScript only drops the action.
  Actions return `Result`, a failed action leaves the workbook unchanged, and the crate avoids indexing and unwraps
  on input.
- **I/O stays with the host**: fetch, OPFS, Web Locks, the embedded Hyper. A service of the crate asks for it through
  a trait of the host, see [The host and the executor](#the-host-and-the-executor).

## Stages

1. **Scripts and the core actions.** Done, `tests/workbook_test.rs`.
2. **The rest of the reducer.** Done: staged rewrites, chart specs, inputs, moving scripts between connections,
   picking, replacing and detaching connections, attachments, table parameters, rewriting references on renames, the
   compiled visualization of a script and the one of a run, processing statistics, the analyses of the planner, cloud
   previews and links, the promotion of the ephemeral workbook, the replacement from storage.
3. **Bindings and the switch.** Done: the class of the module, the adapter, the restore of the loader, the registry
   service. The reducer tests of the runtime run against the Rust workbook.
4. **The other state.** The connection state (`src/connections/`, with the Hyper, Trino and Salesforce connectors and
   the catalog updates), the query execution state (`src/query/`, with the progress model and the profile state) and
   the computation state (`src/compute/`, with the cross filters) are ported with their tests. The connections keep
   their result tables in JavaScript as opaque ids. The computations hold their Arrow tables as Rust values and their
   data frames as ids of the compute database, and run their tasks in Rust. The connections with their query
   histories and the computations are switched: the bindings, the adapters and the tests of the runtime and the app
   run on Rust, see [The computations](#the-computations).
5. **The editor and the services.** The editor sends its events to the workbook, the planner runs in the workbook,
   then the services move with async calls of the host, see [The whole runtime in Wasm](#the-whole-runtime-in-wasm).
   The host trait, the executor and the storage writer are done, see [The storage writer](#the-storage-writer), and
   so are the restore and the persistence of connections, see [The restore](#the-restore), the query executor with
   one HTTP layer, see [The query executor](#the-query-executor), the catalog loader, see
   [The catalog loader](#the-catalog-loader), the runs of workbooks, see [The runs of workbooks](#the-runs-of-workbooks),
   and the setups of the connectors, see [The setups of the connectors](#the-setups-of-the-connectors).

## The whole runtime in Wasm

The goal: `createRuntime(platform)` builds a runtime of the module, and the TypeScript of `packages/dashql-runtime`
shrinks to the platforms and the adapters of the app.

**What stays in the host.** `RuntimePlatform` (`runtime.ts`) already draws the line: the storage backend (OPFS, the
folders of the desktop app, `node:fs`), `HttpClient` (fetch and the proxy of the desktop app), the scheduler and timers,
`OAuthFlow` (windows and links), the embedded Hyper (`hyperdb-wasm`, a module of its own), the gRPC channel of Hyper
in the desktop app (through its native proxy), the cache of query results and the sink of the logger. The crate sees them as a trait `Host` with async methods that don't need `Send`. The
module implements it over a JavaScript object whose methods return promises (`wasm-bindgen-futures`), the tests of the
crate over a fake with an executor of a single thread.

**What moves.** The storage writer (debouncing, groups, pausing), the format of workbooks (files, tree, validation,
tables, bundles), the protocols of the connectors over `Host::fetch` (Trino, the REST and query APIs of Salesforce,
the HTTP API of Hyper, the client functions), the catalog loader with its SQL, the query executor, the runs
of workbooks, the restore and the persistence of connections, the registries.

**Arrow in Rust.** Most of these read or build Arrow: the catalog loader reads result columns, Trino turns JSON pages
into batches, the client functions build tables, the computations read results. The crate uses `arrow-rs` (arrays,
schema, IPC), a result crosses to the UI as IPC bytes once, and `apache-arrow` decodes it there as today. Hyper
hands its results to the host as IPC bytes already.

**Tasks.** A service is an async function on the runtime: it reads a state, awaits the host without holding a borrow,
then applies an action. `spawn_local` runs it in the browser, cancellation is a token that the action checks. A host
call that fails is an error of the task, never a panic.

**Order.** The host trait and the executor with the storage writer as the first service (done), the format of
workbooks (done); the catalog loader and the
query executor once the connection and query states are switched; the connectors one by one behind the existing
`QueryChannel`; the runs of workbooks (done); the restore (done) and `createRuntime` last. ZIP archives (`zip.js` with
`CompressionStream`) and the compilation of chart specs (`vega-lite`) stay host calls until a reason to move them.

## The computations

`reduceComputationState` of the TypeScript runtime is an adapter over the computations of the crate
(`compute/computation_native.ts`), bound as the class `Computations` of the module
(`packages/dashql-core-wasm/src/computations.rs`, `DashQLComputations` of `@ankoh/dashql-core`, created with
`DashQL.createComputations`). The class holds the `ComputeService` of the crate with the state and runs the tasks.
Ids, versions and names cross as typed arguments, tasks, results and cross filters as JSON, a computation is read as a
JSON snapshot once its revision moved.

- **An analysis runs in Rust.** `analyzeTable` of the TypeScript runtime keeps its signature and dispatches
  `ANALYZE_TABLE` with the result and the compute database. The adapter hands the result over as Arrow IPC once
  (`analyzeTable` of the module), the service imports it, computes the statistics, the system columns and the
  summaries, and the promise settles with the analysis. A task that the views schedule on such a computation (filter,
  ordering, filtered summary, data search) runs in Rust as well (`runTask`), its result settles with the projected
  object. The abort controller of a data search cancels its run (`cancelTask`).
- **The adapter is the compute host.** `NativeComputations` implements the `ComputeHost` of the module over the
  compute database (`EmbeddedComputeDatabase`): it imports Arrow IPC with `insertArrowTable`, creates tables with
  `createTableAs`, reads them back as Arrow IPC, drops them through the `DataFrameRegistry` and aborts the calls of a
  cancelled run. A task tells it that the state changed (`changed`), the computations of the runtime project the state
  into their store then.
- **Arrow tables are Rust values.** The state holds `Arc<ResultTable>` with an id, a table goes with its last clone.
  The UI reads a table of the state as Arrow IPC once (`arrowTableIpc`, decoded by `apache-arrow`) and wraps it like
  the results of the tasks of the host: the filter, ordering and search tables, the statistics with their formatter,
  the summaries with their analysis. The counts and shares of an analysis come from Rust, the host formats the
  minimum, the maximum, the lower bounds of the bins and the frequent values (`arrow_formatter.ts`). A table of an
  action of the host crosses as Arrow IPC with the action (`registerArrowTable`), the action names it by its id.
- **Data frames are ids of the compute database.** The service and the adapter allocate them from one counter of the
  thread (`allocateId`), a data frame of the runtime is the table `__df_<id>`. Computations that share a compute
  database, e.g. of the shell and of tests, don't share table names. The state holds a data frame once, the host
  holds one while it reads it (`acquire`, `release`, e.g. the search of the columns). The host releases the data
  frames of the effects of its own actions, the service drops the ones that the actions of its tasks release.
- **The queries of the tasks are tracked where they were.** `ComputationScheduler` of the app gives the computations
  the query execution of its provider (`setQueryExecution`), the host runs the SELECT of a task through it, e.g. into
  the query history of the connection of the computation.
- **Computations of the host.** A computation that an action of the host starts (`COMPUTATION_FROM_QUERY_RESULT`)
  runs its tasks on the scheduler of the app (`processTask`) with the TypeScript tasks, the reducer tests use it.
- **The projection keeps identity.** A computation keeps its object while its revision doesn't move; in a changed one
  the version, the searches, the arrays of summaries and the tracked tasks keep theirs while they are the same. A
  tracked task of the app names its scheduler task, a task of an analysis has its table, its version and its progress.
- **The core comes with the first action.** The runtime and the shell create the computations before the core is set
  up. The first action asks the platform for it and the actions wait until it is there, the runtime hands its core
  over on `restore`. A platform without a core instantiates the default one.
- **Changed on purpose.** The progress of a task that the scheduler doesn't know is dropped, the TypeScript reducer
  registered such a task as a new one. A failed action is logged and leaves the state as it is. An analysis whose
  computation is gone ends without an error, the TypeScript analysis waited for its task forever. The tasks of an
  analysis log through the logger of the computations, not the one that `analyzeTable` gets.

## The host and the executor

`dashql_core_runtime::host` holds what every service asks of the platform: the trait `Host` with the clock (`now`),
timers (`sleep`, a future that clears its timer when it is dropped), tasks (`spawn`, a task starts after the caller
returned) and the log. A service adds a trait for its I/O on top, the storage writer `storage::StorageHost` with the
operations of the storage backend that it uses. Their async methods don't need `Send`: the futures of the module hold
JavaScript values and run on one thread. A failed host call returns a `HostError`, the error of the task: it keeps
what the host failed with and hands it back unchanged, and the host classifies the failures that the runtime decides
on, e.g. a script that changed outside the app.

- **No borrow across an await.** A service keeps its state behind a `RefCell`. A task reads it, awaits the host, then
  applies the result. What the host is told (resolved writes, statistics, notifications, the log) is collected while
  the state is borrowed and passed on after, so the host may call the service again from any of them.
- **The module.** `JsHost` of `packages/dashql-core-wasm/src/storage_writer.rs` implements the traits over a JavaScript
  object whose methods return promises (`StorageWriterHost` in the generated declarations): `JsFuture` awaits them,
  `spawn_local` of `wasm-bindgen-futures` runs the tasks on the event loop, `future_to_promise` gives the results of a
  service to JavaScript. Imported methods catch, a host that throws fails the call instead of unwinding through the
  module.
- **The tests.** `tests/storage_writer_test.rs` runs the writer on a fake host: an executor of a single thread, a clock
  that only the test advances and a storage in memory. Debouncing is tested to the millisecond.
- **Signals.** `host::signal` has a value that is sent once and a future that can be cancelled, the writer needs no
  crate for them.

## The storage writer

`StorageWriter` of the TypeScript runtime is an adapter over the writer of the crate (`storage/writer.rs`), bound as
the class `StorageWriter` of the module (`DashQLStorageWriter` of `@ankoh/dashql-core`, created with
`DashQL.createStorageWriter`). Its API stayed, its callers didn't change.

- **Decisions in Rust.** The keys and their chains, debouncing and coalescing (a newer task keeps the timer of the first
  one), pausing the writer and workbooks, flushing, the statistics and the generations of keys, deleted workbooks,
  holding a write that would overwrite a script that changed outside the app, retrying the failed writes of a flushed
  workbook. The tasks that patch the workbook file read it, patch it as a JSON value and skip a write that changes
  nothing (`storage/workbook_file.rs`); a patched file keeps the order of its keys.
- **I/O in the host.** Loading and saving workbook files, scripts and connection files, the exclusive update of the
  connection entries of the app manifest (the host calls back into the writer with the entries), deleting. The natural
  order of the attachment list follows the collator of the host. A task carries a text or a function that reads the
  latest text when the write runs, e.g. the scripts of a workbook that is written as a whole.
- **Before the core.** The app creates the writer in its storage provider, above the provider of the core. The writer
  takes the core it is given or the one that the package instantiated already (`DashQL.instantiated`), else it asks
  for one with the first write and the calls before it wait and run in order. The runtime gives the writer the setup
  of the platform and the core it restores with. Until the core is there the queries of the writer see none of the
  waiting calls: a test that queries a writer before any core was instantiated gives the writer the core when it
  creates it. `DashQL.create` instantiates the module once, two instantiations at the same time replaced the memory of
  the module under each other.
- **Changed on purpose.** A task starts in a task of the host, the TypeScript writer called the backend within
  `writeDurable`. Written bytes count UTF-8 bytes. A durable write of a deleted workbook resolves as cancelled, the
  TypeScript writer threw. Resuming re-arms a timer once, the TypeScript writer could keep the timer of a task that was
  scheduled while paused next to the new one. `getPendingKeys` lists every pending key, a test read the pending tasks
  of the TypeScript writer.

## The restore

`restoreAppState` and `restoreSingleWorkbook` of the TypeScript runtime are adapters over the restore of the crate
(`src/restore/`), bound as the class `AppRestore` of the module (`DashQLAppRestore` of `@ankoh/dashql-core`, created
with `DashQL.createRestore`). The runtime restores through it on `restore()`, the command line tool loads the workbook
of a folder through it. Their callers didn't change.

- **A host on top of the writer.** `restore::RestoreHost` extends `storage::StorageHost` with the reads of the restore:
  the workbooks of the tree, the connection entries of the app manifest, the scripts and the data files of a workbook,
  the files of a connection, the progress, and whether the storage owns connections. A storage of a single workbook
  folder doesn't, it restores no catalogs and writes no connections. The adapter builds it over the `StorageBackend` of
  the platform from the host of the storage writer, the tests of the crate over a storage in memory
  (`tests/restore_test.rs`).
- **The steps.** The restore reads the connection entries of the app manifest and creates their connections with the
  catalogs of their files, then restores the workbooks of the tree in order: it checks the id, loads and validates the
  workbook file, resolves its connections with the `RestorePlanner`, creates the connections that only the workbook
  knows with their catalogs, reads the scripts and the data files and creates the workbook. A workbook that fails its
  validation is skipped, one whose connections or scripts fail is invalid, the workbench shows both. The progress
  counts the connections, the catalogs and the scripts of every workbook like the loader of the TypeScript runtime.
- **Catalogs from their files.** `restore::catalog` parses the relations and the functions of a connection in one batch
  (`publish_catalog_batch_sync`) and publishes them into the catalog of the connection, restores the relations to ask
  about and those that are gone (`CatalogStateFile`), moves the relations of the changes file of older versions into
  the pending ones and clears the files of a connection whose database doesn't outlive the app.
- **The writes after the restore go through the storage writer.** The connections that workbooks registered and the
  cleared catalog files are durable writes of the app manifest and the files of the connections. Once they are
  written, the stale copies of the workbooks follow, then the script lists that changed and the promotion of an
  ephemeral workbook that holds scripts. A failed write is logged, the next restore attempts it again.
- **Rust objects reach the registries as they are.** The result holds the connections and the workbooks of the module.
  The adapter wraps a connection in a `NativeConnection` and projects its `ConnectionState`, and adopts a workbook with
  the connections of its scripts (`NativeWorkbook.adopt`). The registries get the same `RestoredAppState` as before.
- **Connections that the app holds.** A restore of a single workbook, e.g. an import or the folder of `dashql run`,
  resolves against the live connections, which the adapter passes with their catalogs, and returns the connections that
  the workbook registered.
- **Migrations stay before the restore.** The storage setup of the app migrates the root and the reachable workbook
  folders before the backend exists, the native backend a folder when it opens it. The restore validates the format
  version and shows an older workbook as invalid.

The persistence of connections is a module of the crate as well (`src/connection_persistence.rs`, bound as
`ConnectionPersistence`). The registry of connections still applies the actions in TypeScript, and the module decides
what storage keeps of a change from the persisted fields of the connection before it and the Rust connection after
it: saved params go to the app manifest and to every workbook that references the connection, drafts, names and the
caching choice to the app manifest with a longer debounce, and an active connection writes its catalog files after
an update and its catalog state after statements and updates. A deleted active connection leaves the app manifest and
its pending file writes are discarded. `ConnectionPersistenceService` saves through the module: the entry of the app
manifest first, then the commit of the params, then the copies of the workbooks, all of them durable writes of the
writer. A connection that the app created holds no id in Rust, the id comes with every call.

- **Changed on purpose.** The restore parses the catalog files in the module and not in the batch worker, a file that
  doesn't parse publishes neither relations nor functions. A draft that can't be read is dropped with a warning
  instead of failing the connection. The writes after the restore are writes of the storage writer, a promotion writes
  the properties of the workbook file. The relations file of a connection is rendered by the module when the write
  runs.

## The tasks of the computations

The tasks that summarize, filter, order and search a result run in `src/compute/service.rs` on a compute host
(`src/compute/host.rs`). A task is planned sans-IO in `src/compute/tasks/`: its plan holds a `TaskQuery`, the SELECT
that creates the table of a new data frame and the read of that table in the order the task needs, and its `finish`
returns the values of the action of the state. The analysis of a result is a sequence of steps: the column groups and
the import of the result with row numbers from 1, the statistics, the system columns, then the summary of every
ordinal and string column.

- **The compute host.** `ComputeHost` sits on top of `host::Host`: import a table from Arrow IPC, create the table of a
  data frame from a SELECT, run a query and return Arrow IPC, drop a table, cancel the calls of a run, and learn that a
  task changed the state. Every call carries the computation, the title of its task, the connection and the client
  context of the computation and the run.
- **A run of a task.** The service reads the task from the state, reports it running, allocates the data frame of its
  output, creates the table, reads it back, finishes the plan and applies the action of the result, then unregisters
  the task. A failure drops the data frame of the output, fails a data search, reports the error as the progress of
  the task and unregisters it. A result that is no longer current is dropped by the state, and its data frame with it.
- **Cancellation.** A run is a future that can be cancelled. `AbortComputation` cancels the runs of the computation,
  `AbortDataSearch` the run of the search, `cancel_task` the run of a task; the host aborts the queries of the run.
- **No borrow across an await.** The state sits behind a `RefCell` that a task borrows only between its awaits. The
  host learns of a change after the borrow ended, so it may read the state from `changed`.
- **The tests.** `tests/compute_service_test.rs` runs the service on a fake host: an executor of a single thread and a
  compute database in memory that answers the SELECT of a task by its title. `compute/computations.test.ts` of the
  TypeScript runtime runs an analysis, a filter, an ordering and a data search on the embedded Hyper.
- **Formatting stays with the host.** The analysis of a histogram keeps the minimum and the maximum as Arrow values in
  the type of the column and the lower bounds of the bins as numbers or epoch milliseconds. The host formats them as it
  formats the cells of the grid.
- **The SQL is the one of the TypeScript.** `SqlFrame` builds the same text, numbers print as in JavaScript. The tests
  compare the text; the tests that run the SQL on Hyper stay in TypeScript.
- **Changed on purpose.** The tables of data frames are named by id. The column types come from the schema of the
  result. The data frame of any failed task is dropped, the TypeScript dropped only the one of a data search.

## The catalog loader

`CatalogLoaderService` of the TypeScript runtime is an adapter over the loader of the crate
(`src/catalog_loader/service.rs`), bound as the class `CatalogLoader` of the module (`DashQLCatalogLoader` of
`@ankoh/dashql-core`, created with `DashQL.createCatalogLoader` on the core of the first connection). Its API stayed,
the runtime hands it every registry and requests refreshes as before.

- **The loader follows the Rust connections.** The binding of a connection holds its state and its query history
  behind shared references, the loader keeps weak ones under the id of the registry (`follow`). The adapter tells it
  when the registry changed (`observe`), the loader reads health, params, details, catalog updates and the number of
  running queries of every connection then, and describes the connections that came online.
- **The scheduler and the updates run in Rust.** `CatalogLoader` decides what to start and to abort, the service runs
  an update as a task: it drives `CatalogUpdate`, parses its batches in the module (`CatalogBatch::process`, like the
  restore) and publishes into the catalog of the connection. A publication needs the connection to still run the
  update, a reset or a delete aborts it. The text of the function script is replaced in Rust once its descriptor is
  published. A failed lookup is tried again after a wait, the wake-up is a timer of the host.
- **The queries go through the query executor.** The host runs a metadata query (`run_query`) with the executor of the
  runtime as a query of the app with the issuer `Catalog Update`, registers it with the update and hands the result
  back as Arrow IPC, the loader reads it with `arrow-rs`.
- **The host keeps the registry and the cancellation.** The start and the end of an update are actions of the registry
  (`update_started`, `update_finished`), so the connection, its persistence and the scripts that use it see them as
  before. The host keeps an abort controller per update, an abort of the loader, of a reset or of a caller cancels the
  task (`cancel`) and the queries of the update.
- **Salesforce over fetch.** The metadata of a data space comes from the instance over `HttpHost::fetch`
  (`SalesforceMetadataLoad`, three requests at once). An API of Salesforce that the platform passes, e.g. the mock of
  the app, answers it instead (`salesforce_metadata`).
- **Client functions.** The loader registers the client functions of a connector on the catalog of every connection
  it follows (`ClientFunctionRegistrations`), the host loads the specs (`load_spec`) and analyzes the scripts again
  once they changed (`catalog_changed`).
- **The tests.** `tests/catalog_loader_test.rs` drives the updates without I/O, `tests/catalog_loader_service_test.rs`
  runs the loader on a fake host: the queue, forced refreshes, the relations of statements with their retries, the
  embedded database, Salesforce and client functions. `catalog_loader_service.test.ts` runs the adapter on the module
  with a fake executor, `catalog_updates.integration.test.ts` runs lookups on the embedded Hyper.
- **Changed on purpose.** The requested refreshes are considered before the lookups, so a request that a refresh
  answered and the lookup behind it settle in one pass. The retry wakes at the earliest attempt. Skipped functions and
  duplicate columns come back as warnings of the outcome. A forced refresh doesn't wait for the cancelled update to
  settle at its backend, the update ends as soon as its token is cancelled. The batches parse on the main thread in the
  module, the app has no batch worker anymore. A Hyper update that partly failed logs `Partially updated the catalog`.
  An update logs on the targets of the log of the loader, not on a trace of its own.

## The setups of the connectors

The setup functions of the TypeScript runtime are adapters over the setups of the crate (`src/connection_setup/`):
`setupTrinoConnection`, `setupSalesforceConnection`, `authenticateSalesforce` and `performHealthCheck` of the runtime
and `setupHyperConnection` of the app. They are bound as free functions of the module (`connectionSetupTrino`,
`connectionSetupSalesforce`, `connectionSetupAuthenticateSalesforce`, `connectionSetupHyper`,
`connectionSetupHealthCheck`, `DashQL.connectionSetup` of `@ankoh/dashql-core`) that start a `ConnectionSetupRun`.
Their APIs stayed, the settings pages, the startup, the cloud login and the login of the shell call them as before.

- **An OAuth host.** `connection_setup::OAuthHost` adds the OAuth flows to `HttpHost`: the PKCE challenge and a random
  id come from the crypto of the platform, the core has no SHA-256 and no randomness. `authorize_with_loopback` opens
  the authorization URL and waits for the loopback redirect (Trino), `authorize_with_redirect_page` waits for the
  callback of the redirect page whose state has the flow id (Salesforce), in the browser as a window and in the desktop
  app as a link. The flow reports the window and the external browser as events while it waits, a cancelled token
  stops it. The adapter implements the host over the `OAuthFlow` of the platform, the tests over a fake.
- **A setup is an async function.** It drives the state machine of its connector (`TrinoSetup`, `SalesforceSetup`, the
  steps of a Hyper channel in `connection_setup/hyper.rs`) over the host: it applies every action of the connection
  through `SetupHost::dispatch`, awaits the host for the flow, the requests and the channel, and returns the id of the
  channel. The token requests and the REST calls of Salesforce go over `fetch` with the HTTP client of the platform.
- **A run has a host of its own.** The host of a run is one setup: it applies the actions to one connection and keeps
  the channels of the setup by id. An action crosses as `{connector, type, value}`, the type is the name of the action
  of the connector in TypeScript, and the adapter puts the channel object in place of its id.
- **The channels stay what the executor reads.** The host creates the channel from what the setup describes: a
  `TrinoChannel` on the API client with the endpoint, the defaults and the OAuth token, a `SalesforceDatabaseChannel`
  over the Hyper channel of the HTTP client with the tokens, the attached database of Database.com and the bearer
  token. A Hyper over HTTP and the Hyper of a link are channels of the HTTP client that describe themselves to the
  executor, the setup resolves the params of a link with the token of the page. The embedded Hyper and gRPC through the
  native proxy of the desktop app stay channels of the host.
- **The health check runs through the executor.** `check_health` dispatches its start, asks the host to run the probe
  query of the connector with the metadata of a health check (`run_probe`), and maps the outcome to the action of the
  connection. The host runs it with the query executor of the app on the channel of the setup, so it shows up in the
  query viewer. A failed probe fails with the error of the query.
- **Cancellation.** The signal of the caller cancels the run. A run that is cancelled before it starts reports its
  start and its cancellation. A connect runs to its end, a channel that is ready after the cancellation is closed. A
  failed host call keeps what the host failed with, the caller gets the same error.
- **The tests.** `tests/connection_setup_test.rs` runs the setups and the health check on a fake host: the flows, the
  token requests, the channels, failures and cancellations. The tests of the app run the adapters on the module, the
  ones of Salesforce against a fake Salesforce over the HTTP client.
- **Changed on purpose.** The requests of the Salesforce setup and the login go over the HTTP client of the API client,
  not through the methods of `SalesforceApiClientInterface`, the tests answer them as a fake Salesforce. The setup and
  the login of Salesforce log on the target `salesforce_setup`. A health check that is cancelled before its probe
  dispatches its cancellation and runs no probe, one that is cancelled while the probe runs ends at once and the probe
  runs to its end in the executor. A Trino setup with OAuth that is cancelled before it starts reports
  `OAUTH_STARTED` and `OAUTH_CANCELLED`. A cancelled Hyper setup keeps the message of the cancellation of the runtime.
  `buildSalesforceAuthorizationUrl`, `validateSalesforceOAuthCallbackState` and `checkSalesforceConnectionSetup` of
  TypeScript are gone, the crate has them.

## The Trino connector

The Trino connector of the crate (`src/trino/`) does no I/O, the query executor drives its queries. The channel (`TrinoChannel`)
holds the endpoint, the auth with the OAuth token and the default catalog and schema, and turns a request of the
protocol into an HTTP request with its headers. A query (`TrinoQuery`) is a state machine: it asks for requests and
timers by id, takes the responses and the fired timers with the time they happened, and reports the schema, the
progress, the record batches and the end. It follows the next URIs until Trino stops sending one, requests the next
page before it converts the current one, retries busy or unreachable coordinators with growing delays, and fetches the
QueryInfos of the profile only while the profile is shown. The rows of a page become an Arrow record batch with the
coercions of the TypeScript runtime. A timestamp with a named time zone asks the host for the offsets of the zone, the
crate has no time zone database. The setup of a connection (`TrinoSetup`) is a state machine as well: it reports every
step as an action on the connection and asks the host for the PKCE challenge, the login in the browser, the token
request, the channel and the health check. `connection_setup::setup_trino` drives it.

- **Changed on purpose.** Integers keep all their digits, invalid base64 becomes null instead of failing the batch,
  basic auth encodes UTF-8, an error or rows in the response to the statement are handled like a page, a token
  response without a token is an error.

## The client functions and Salesforce

The client functions (`src/clfn/`) and the Salesforce connector (`src/salesforce/`) are ported without I/O, the query
executor runs the calls and the catalog loader registers the specs, `connection_setup::setup_salesforce` drives the
setup. A call is a state machine: it starts from the description of the core, returns the next request,
a wait or the result table, and takes the response with the time. The runtime reads the spec for its requests, and the
core checks it when a binding registers it on the catalog of a connection. The registrations of the connections ask the
host to load a spec and register it once it arrives. A result is a table of typed cells that becomes a record batch or
IPC bytes. The setup of a Salesforce connection is a state machine too: every step returns the actions of the
connection state and what the host does next. The host generates the PKCE challenge, opens the authorization page,
sends the requests and connects the Hyper channel. The REST calls of Salesforce are pairs of a function that builds the
request and one that reads the response, and the metadata of a data space sends its three requests at once. URLs, JSON
pointers and timestamps follow the browser where the origin check and the request text depend on it. Named time zones
other than UTC are not known. The tests answer with made-up responses and run the examples of the Data 360 spec through
the core and `EXPLAIN`.

## The format of workbooks

`src/workbook_format/` holds the storage format of workbooks without I/O: the layout of the storage, the workbook file
with its validation and migrations, the file lists, the workbook tree, bundles, the workbook tables, the archives of
imports and exports, the connections of imports, the eviction of the query result cache and the decisions of the
restore. It takes the contents of files and returns parsed values, validation results, migrated files and the files to
write. The TypeScript runtime calls it for every decision of the format, its modules in `src/storage/` and
`src/workbook/persistence/` read and write the files.

- **Files as values.** `WorkbookData` reads a workbook file leniently: a field of the wrong type reads as absent, a
  malformed entry of the lists of scripts and attachments is left out and marks the lists, and fields the schema
  doesn't know are written again. Validation runs on the JSON (`validate_workbook_json`).
- **Migrations in memory.** The host reads the top-level files of a workbook folder (`MIGRATION_FILES`) into a
  `MigrationFolder`, the steps change it in memory, and the host writes `changes()`: the writes, then the removals. An
  import doesn't write them back.
- **Archives stay with the host.** The host lists the entries of a `.dashql` file, `plan_archive` says what each entry
  is and what the host reads of it. Workbook tables cross as Arrow IPC (`arrow-rs`), the embedded Hyper writes and
  scans their Parquet files. `workbook_archive_entries` orders the entries of an export with their compression. The
  bytes of attachments and results are a type of the host, e.g. a handle of a file or of a slice of an archive.
- **Catalogs as a trait.** The workbook tables carry catalogs as rows, reading and rendering the SQL of catalog files is
  a `CatalogSql`. `CoreCatalogSql` reads a file into a catalog descriptor with the core and renders it like the catalog
  loader.
- **The restore decides, the host acts.** `RestorePlanner` validates workbooks, resolves their copies to connections
  (the manifest wins, unknown ones are registered, the embedded database is a single connection), names the catalogs to
  restore and collects the writes after the restore. `script_list_patch`, `promotion_patch`, `connection_copy_patch`
  and `manifest_connections_patch` build them.
- **Changed on purpose.** Names aren't normalized to NFC, the host passes the names of its listings normalized. The
  natural order follows ICU for ASCII and folds the accents of Latin-1. Bundles and params compare as values, the order
  of keys doesn't count. A field of the wrong type is dropped when a file is written again.

### The bindings

The module binds the format as free functions (`packages/dashql-core-wasm/src/workbook_format.rs`):
`workbookFormat(op, args)` runs an operation on JSON arguments and returns its JSON, `encodeWorkbookTable` and
`decodeWorkbookTable` turn the rows of a workbook table into Arrow IPC and back, `resolveWorkbookScripts` resolves the
scripts of a workbook file over a resolver object of the host, and the class `CacheEviction` steps through an eviction
of the query result cache. `DashQLWorkbookFormat` of `@ankoh/dashql-core` (`DashQL.workbookFormat`) gives the operations
types. The bytes of attachments and results stay with the host, a bundle names them with tokens of the host. The fresh
ids of exports and imports come from `crypto.randomUUID`.

- **Pure calls.** Validation, the file lists of bundles, the connections of exports and imports, the sanitized
  workbook tables of a share, the links of shared workbooks and connections, the questions of a connection import and
  the resolution of the scripts of a native folder that changed on disk are calls of the format.
- **Host-driven.** The migration of a folder (`storage/migration/workbook_migration.ts`): the host reads the top-level
  files, the core migrates them, the host applies the changes. The head of a bundle (`readWorkbookBundleHead`): the host
  reads the top-level files and then the catalog files of the connections that the core names. An import
  (`workbook/persistence/workbook_import.ts`): zip.js lists the entries, the core plans the archive, the host reads the
  entries (the embedded Hyper scans the Parquet files of the workbook tables) and the core builds the bundle. An export
  (`workbook_export.ts`): the core builds the sanitized tables and names the entries of the archive, the embedded Hyper
  writes the Parquet files and zip.js the archive. The eviction (`query_result_cache_eviction.ts`): the host lists and
  deletes the files that the core names. The import of query results: the core decides which results fit the cache.
- **The core when it is needed.** The synchronous calls of the runtime use the core that the platform provided
  (`provideWorkbookFormatCore`: the provider of the core of the app, the storage writer, the test frame) or that the
  package instantiated, the asynchronous ones instantiate it when nothing did yet (`storage/workbook_format.ts`), with
  the loader that the platform sets: the app fetches its module, Node reads the file of the package, the tests use the
  precompiled one. A workbook folder whose workbook file is at the current
  version needs no migration, so the startup of the app checks the folders before it instantiates the core.
- **The workbook tree stays in TypeScript.** The storage of the app reads the tree at startup, before the core is
  instantiated, and the sidebar edits it synchronously. The core has its port (`tree.rs`), the restore gets the
  workbooks of the tree from the host.
- **Changed on purpose.** A migration writes a renamed file and removes the old one, the TypeScript steps renamed it.
  The bundle head of an older folder reads all of its top-level files that the migrations know, the TypeScript steps
  read the ones they touched. `workbookBundleToTables` reads the catalog files with the core, it takes no parser. The
  connection import names the fresh ids of separate connections with `crypto.randomUUID`, it takes no generator.

## The Hyper connector

The HTTP API of Hyper is a module of the crate (`src/hyper/`), sans-IO, the query executor reads its results. The client builds the
requests of the V3 API, the host sends them and hands the responses back. The auth headers come with every request,
the context of the connection holds them.

- **A result is a state machine.** `HyperResultReader` starts from the query response, whose status header names the
  query and whose body is the first chunk. `poll` returns the record batches and the progress so far, the chunk
  requests up to the parallel chunks and a status poll while the query runs without chunks, `receive` takes a
  response. The chunks are decoded in the order of the result as one Arrow stream, a message may span chunks.
- **Errors keep the rich model.** An error response becomes a `HyperErrorInfo` from the JSON body or the status
  header, with the diagnostics of the response for the log. The headers that the gRPC proxy of the desktop app
  forwards decode to the same error.
- **gRPC and the embedded Hyper stay host channels.** A connection over `V3_GRPC` or `WASM` names a channel of the
  host, which runs the query and hands the Arrow IPC of the result over. The module keeps the logic around them: the
  session options and the query queue of the embedded Hyper, the local cloud, the links to a Hyper.
- **The connection helpers move along.** The labels, the outcome of the health check, the setup check of Salesforce,
  the import of stored connections and whether a catalog can be refreshed are functions of `src/connections/`.
- **Changed on purpose.** The chunks are one stream that skips a repeated schema and an end-of-stream marker inside a
  chunk. The client logs nothing, the error carries the diagnostics. A restored connection keeps only its setup params.

## The query executor

`QueryExecutorService` of the TypeScript runtime is an adapter over the executor of the crate (`src/executor/`), bound
as the class `QueryExecutor` of the module (`DashQLQueryExecutor` of `@ankoh/dashql-core`, created with
`DashQL.createQueryExecutor` on the core of the connection of the first query). Its API stayed, its callers and the hooks of the app didn't
change.

- **One HTTP layer.** `src/http/` holds the request, the response with a body of bytes, the headers that compare names
  without case and the URL module of every connector. `Url` parses as the browsers do where the origin check of client
  functions depends on it; `Url::parse` takes HTTP and HTTPS, `Url::parse_with_authority` any scheme with an authority,
  e.g. the endpoint of a Hyper. The functions on the text of a URL leave the next URIs of Trino as the server wrote
  them.
- **Fetch on the host.** `http::HttpHost` adds `fetch` to `host::Host`: it sends a request with the HTTP client of the
  platform and returns the response with any status, a failure in the network is a `HostError`. A `CancellationToken`
  stops the requests of a task, the module aborts the fetch of the host by its id.
- **A query is a task.** `QueryExecutor::execute` runs a query that the host registered in the history of its
  connection: it serves a result from the query result cache or sends the query, reports the progress and the batches,
  touches the relations of the statement, analyzes the result and writes it into the cache after the query. The task
  reports `QueryEvent`s, the adapter applies them to the Rust connection through the dispatch of the registry.
  Cancelling cancels the token: the requests stop, the query is cancelled at the backend and the task ends as
  cancelled.
- **The connectors.** Trino runs on `TrinoQuery` with the requests and timers of the host and keeps a refreshed access
  token on the channel of the host. Hyper over HTTP runs on `HyperResultReader` with the auth headers of the context of
  the connection, Salesforce Data Cloud with its bearer token. A client function call runs on `ClientFunctionCallRun`
  with the spec of the connector and the tokens of the channel.
- **Channels of the host.** A channel that the module doesn't speak stays with the host: the gRPC channel of Hyper in
  the desktop app (through its native proxy), the embedded Hyper, a Trino channel on another API client, the channels
  of tests. The task asks the host to run the query and reads every batch as an Arrow IPC stream, the host learns of
  the views of the profile and of the cancellation right away.
- **Results.** A result crosses to the host once, as one Arrow IPC stream with the event of all batches, and
  `apache-arrow` decodes it. The host keeps the result tables, the Parquet files of the cache, the analysis on the
  compute database and the progress model of the profile.
- **Changed on purpose.** A query that is cancelled before the executor started it rejects with the reason of the
  cancellation. A failure before the query reached the executor, e.g. a spec of client functions that doesn't load,
  rejects. The metrics of a Hyper result over HTTP count its batches and rows. The executor reads the auth headers of
  a Hyper connection once per query.

## The query history of the shell

`ShellQueryExecutionTracker` of the TypeScript runtime (`query/shell_query_execution.ts`) is an adapter over a query
history of its own, bound as the class `QueryHistory` of the module (`packages/dashql-core-wasm/src/query_history.rs`,
`DashQLQueryHistory` of `@ankoh/dashql-core`, created with `DashQL.createQueryHistory`). It kept its API, the shell of
the app didn't change. `reduceQueryAction` of TypeScript is gone, `query/query_execution_state.ts` keeps the types of a
query execution and its actions.

- **A history without a connection.** `QueryHistory` holds a `QueryExecutionHistory` of the crate and takes the query
  actions of a connection, its queries read like the ones of a connection. `Connection` shares the actions and the JSON
  of its queries with it, and the adapters share the mapping of the actions and the projection of a query
  (`query/query_history_native.ts`).
- **The last 100 queries.** `QueryExecutionHistory::with_limit` keeps at most a number of queries: a query that starts
  beyond the limit drops the oldest finished queries, then the oldest active ones, and releases their result tables.
  A later action on a dropped query changes nothing. The history of a connection has no limit.
- **The JavaScript objects stay with the tracker.** It keeps the result tables by id, the cancellations, the errors and
  the progress of the queries, and lists the finished queries before the active ones. A result that the shell shows
  keeps its table after its query left the history.
- **The core comes with the first action.** The tracker takes the core or a function that sets it up. The provider of
  the shell sets up the core of the app, the actions before the core is there wait for it. The provider frees the
  history with the component.
- **Changed on purpose.** An action that changes nothing, e.g. a late failure of a finished query, keeps the snapshot
  and doesn't notify the subscribers. A query id that the history knows is refused instead of replacing the query.

## The runs of workbooks

`runWorkbookExecution`, `runPlannedScript` and the result keys of scripts (`computeScriptResultCacheKey`,
`computeWorkbookResultCacheKeys`) of the TypeScript runtime are adapters over the runs of the crate
(`src/workbook_run/`), bound as `Workbook.run` of the module, which returns a `WorkbookRun` (`DashQLWorkbook.run` and
`DashQLWorkbookRun` of `@ankoh/dashql-core`). `WorkbookExecutionService`, `runWorkbookScript` and
`runWorkbookScriptForResult` kept their APIs, the hooks of the app didn't change.

- **A run is a task on the workbook.** The module shares the workbook with its runs (`Rc<RefCell<Workbook>>`). A run
  analyzes every script and publishes its declarations, then analyzes every script again at the catalog revisions that
  the publishing left (`Workbook::analyze_for_run`). The scripts take the analyses, there is no action that hands them
  over. Before every plan the scripts whose analysis a catalog update outdated analyze again.
- **Plans.** `Workbook::plan_run` plans the scripts with `planner::plan_session`: every script, the targets with what
  they need, or the scripts that a change of inputs affects (`plan::affected_scripts` on the dataflow of the workbook).
  A run of a script needs a statement of its target. The result keys follow the plan (`plan::result_keys`): the host
  derives a key from a signature, the run decides whether the key is reusable.
- **Cached results.** A script with a reusable key whose file the cache holds and that follows no script that runs is
  served from the cache: the run keeps the file, the terminal query of the script reads the cache only, and the run
  plans again with the file as a result that the host provides. A miss runs the script.
- **The schedule.** A node starts once its predecessors released it, at most `max_concurrent_queries` statements of a
  connection run at once, in node order. A statement releases the nodes after it once its result arrived, the node of
  a materialized script once the host wrote its result as Parquet file. The nodes of a connection that can't run or
  could not be set up are skipped with every node that follows them. A failed statement cancels the running ones, the
  run settles once they ended and then releases its files.
- **Writes.** The run registers the queries and the results of the scripts on the workbook and captures the
  visualization of every output (`RegisterQuery`, `RegisterScriptResult`, `SetExecutionVisualization`), then tells the
  host. The adapter projects the workbook again with the action `PROJECT_WORKBOOK`, once per turn.
- **The host.** `RunHost` runs a statement: the adapter hands it to the query executor with the arguments of a planned
  statement (`QueryExecutionArgs` with the title, the description and `QueryMetadata.planned` that the run describes)
  and keeps the result table. The host cancels statements, derives keys, keeps the files of the query result cache,
  writes and mounts the materialized results and the attachments, sets up connections, reports the state of the run
  and the events of the scripts, and yields. A run holds its workbook in TypeScript (`acquireWorkbookExecution`), the
  hooks of the app subscribe to the holds.
- **Cancellation.** `WorkbookRun.cancel` stops a run: the state turns `stopping`, the running statements are cancelled
  through the host, the run ends `cancelled` once they ended. An abort signal of the adapter cancels the run.
- **No borrow across an await.** The run borrows the workbook only between its awaits and tells the host after the
  borrow ended. The host may change the workbook during a statement, the next statement fails the run if a script, the
  order of the scripts or a session changed, a stale text fails it before the first statement.
- **The tests.** `tests/workbook_run_test.rs` runs real workbooks on a fake host: the order of a plan, concurrency per
  connection, failures and cancellation, cached results, materializations, runs of a script and changes of inputs.
  `workbook_execution.test.ts`, `workbook_execution_integration.test.ts` and `script_run.test.ts` of the TypeScript
  runtime run the adapter with a fake executor, the query result cache and the mounts; they read plans with
  `DashQLWorkbook.planRun` and result keys with `DashQLWorkbook.resultKeys`.
- **Changed on purpose.** The run analyzes the scripts on the workbook and the action `APPLY_PLANNER_ANALYSIS` is gone,
  so is `ApplyPlannerAnalysis` of the workbook. The run writes the workbook directly, the adapter dispatches
  `PROJECT_WORKBOOK` instead of the actions of the queries and visualizations. Before a plan only the scripts with an
  outdated analysis analyze again. An attachment edge of the dataflow no longer counts as an edge of a script when a
  change of inputs collects the scripts it affects. Every statement has an abort signal of its own, which the
  cancellation of the run aborts, and reports its result as ready to the run. The result keys are derived one after
  another. A run checks the Rust workbook: a projection of the app with another order of scripts no longer fails a
  run. The `done` of a script and the `started` of a script that it releases come in either order. A plan without the
  mounts of the cache has a mount prefix with a counter instead of a random UUID.

## Typing

Measured in Node on a script of 40 lines (4,660 characters) typed character by character, next to two other scripts,
the way the editor does it: the editor applies the event to the shared session (1.4 to 2.0 ms per keystroke, the
analysis of the core) and reports the update. The reduction then takes 0.6 to 0.9 ms: 0.4 to 0.6 ms in the workbook
(publishing the declarations into the catalog, compiling the visualization, deriving the table parameters, which the
TypeScript reducer did as well, each through a call of its own), 0.2 to 0.3 ms for the projection. Packing the update
for the workbook is 0.09 ms of it, an editor that sends its events to the workbook (`ApplyEditorEvent`) would save
about that.

## Open

- The TypeScript tasks (`compute/tasks/`, `data_frame.ts`) and `processTask` of the app stay for computations that an
  action of the host starts, which only tests do. `ResultComputations` of the query executor stays in TypeScript, the
  crate has its port.
- A result crosses from the query executor to the computations as Arrow IPC that `apache-arrow` writes, and the host
  imports it through `insertArrowTable`, which writes it again; the executor in Rust would hand its IPC over.

- Editors outside of a workbook (the composer, the shell) keep sessions of their own.
- The connections of a native workbook that changed on disk are still created in TypeScript
  (`connections/connection_restore.ts`), the restore of a single workbook could take them over.
- The registry of connections applies its actions in TypeScript, only the decisions of their persistence are Rust.
- The progress model of a query runs in the adapter of the query executor in TypeScript, the Rust history gets the
  plain fields of a progress update, the adapter keeps the structured progress. The planned statement of a query stays
  in TypeScript.
- The executor reports into the history through the dispatch of the registry, the history and the executor are not
  one Rust value yet. The query result cache, the analysis of results and the relations of a statement are calls of
  the host.
- A channel of the host converts its record batches to Arrow IPC, the embedded Hyper decodes its IPC first.
- A profile in the browser: the numbers above are Node, with two other builds on the machine.
- The mock setup of Salesforce (`salesforce_connection_setup_mock.ts`, the mock config of the app) stays in TypeScript,
  it answers from `SalesforceAPIClientMock` without requests. The owner of the cancellation of a setup per connection
  (`connection_setup_cancellation.ts`) holds abort controllers of the host and stays.
- The Salesforce setup reads the HTTP client from a `SalesforceApiClient`, an API client of another kind passes its
  HTTP client next to it.
- The service of the runs (`WorkbookExecutionService`: one run per workbook, the connections that a run takes, the
  changes of inputs that wait for the workbook, stopping a run when a connection drops) and the holds of workbooks stay
  in TypeScript, the run itself is Rust.
- A statement of a run reaches the query executor of the crate through its adapter, which registers the query in the
  history of its connection and keeps the result table; the run and the executor are not one Rust value yet.
- The batches of a catalog update parse on the main thread. A host call to a worker with a core of its own would move
  the bundled functions of Hyper off the event loop.

## Kept on purpose

- A script that publishes its own declarations changes its catalog, so a script that was just analyzed can look
  outdated once more. A second analysis settles it.
- The base name of a new script comes with the action, the random names stay in TypeScript.
- The promotion of the ephemeral workbook needs the names of the other workbooks, the adapter calls `promote` after
  an action until a registry of workbooks moves too.
- The states of the app share the Rust workbook: only the latest state of a workbook can be reduced, like the registry
  does. An older state still reads its scripts as they were, but an action on it acts on the latest workbook.
- The states of a connection share the Rust connection like the ones of a workbook. A spread over a state is lost with
  the next action, the options of `createConnectionState` set the name, the caching and whether it is active.
- The script with the functions of a deleted connection is gone with the connection, the catalog of a deleted
  connection is cleared and other holders see it empty.
- The link to a published workbook stays whole in TypeScript (the workbook file holds more than its ids), the Rust
  workbook knows its ids and whether it is a preview.
