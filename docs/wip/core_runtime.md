# The core runtime

Status: the workbooks with their scripts, the connections, the computations, the storage writes, the queries, the
restore of the stored state, the persistence of connections and the storage format of workbooks of the app run on Rust.
`packages/dashql-core-runtime` (crate `dashql_core_runtime`) holds the scripts of a workbook, the state of a
connection with the history of its queries, the query history of the shell and the computations, linked into the core
module. The workbooks, the computations, the connections with the histories of their queries, the histories without a
connection and the query executor have no adapter: they are the domains of the `Runtime` class of the module, the app
reads their views through a store and dispatches to them (see [The workbooks](#the-workbooks),
[The computations](#the-computations), [The connections](#the-connections) and [runtime_api.md](runtime_api.md)).
The services of the runtime run on its platform: the storage writer (`runtime/storage.rs` of the bindings over
`src/storage/`) and the restore (`Runtime.restore` over `src/restore/`) on `storage` of the platform, the tasks of the
computations (`compute/service.rs` on the compute database of the platform), the query executor
(`runtime/queries.rs` of the bindings over `src/executor/`): Trino, Hyper over HTTP, Salesforce Data Cloud and the
client functions run their protocols in Rust over the HTTP client of the host, the catalog loader
(`runtime/catalog.rs` of the bindings over `catalog_loader/service.rs`): it schedules the updates of the catalogs, runs
their metadata queries on the executor of the runtime, fetches the metadata of Salesforce and registers the client
functions of the connections, the runs of workbooks (`runtime/runs.rs` of the bindings over `src/workbook_run/`): a
run analyzes, plans and runs the scripts of a workbook of the runtime on its executor, and the setups of the connectors and the health checks (`runtime/setups.rs` of the
bindings over `connection_setup/`): Trino, Salesforce and Hyper set up their connections over the OAuth flows of the
platform, and the imports and exports of workbooks (`runtime/imports.rs` and `runtime/exports.rs` of the bindings over
`src/workbook_format/`): the runtime reads `.dashql` archives, workbook folders and the workbook tables of a cloud,
maps their connections and writes them, and exports workbooks as archives, links and workbook tables, the platform
keeps the ZIP container and the Parquet files (see [The format of workbooks](#the-format-of-workbooks)). The storage of
the platform calls the format for its migrations, validations and evictions.

The runtime is linked into the core module, but it isn't part of the contract of the core. Integrations that use the
core on its own get the classes of the core (`DashQL`, `Catalog`, `ScriptSession`, the shell) and the FlatBuffer
schemas of `proto/fb`. The classes of the runtime (`Runtime`, `QueryProgressFollower`) belong to DashQL
and change with it, their state crosses as JS objects of views with generated types (see
[runtime_projection.md](runtime_projection.md)).

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
  rename, the script list and the properties of the workbook file. The runtime hands them to its storage writer, which
  debounces them. A dropped script leaves the catalog of its connection.
- **Sessions are shared.** The workbook shares the session of a script with a `ScriptSession` handle of the module
  (`Runtime.scriptSession`), the editors of the app apply their events to it and report the update
  (`Runtime.reportEditorUpdate`). The editor that sends its events to `ApplyEditorEvent` of the workbook is the end
  state.
- **The UI reads views.** The workbook, every script and the derived view of a workbook are slices of the runtime
  (see [The workbooks](#the-workbooks)). Plain fields cross as JS objects, editor updates, staged diffs,
  visualizations, processing statistics and the derived references, dataflow and inputs as packed FlatBuffers.
- **Actions are one dispatch.** The workbooks and the connections are domains of `Runtime`
  (`packages/dashql-core-wasm/src/runtime/workbooks.rs`, `runtime/connections.rs`), their actions are the ones of the
  union of the runtime.
  Params, errors, relation names, metadata, progress and metrics cross as JS objects of the views of
  `connection/view.rs` and `query_history/view.rs`, the status, the health, the connector, the catalog updates and
  the queries have numeric enums of the module.
- **A connection owns its catalog.** The connection holds its catalog with the entry ids of all catalogs of the module.
  `Runtime.catalog(connectionId)` is a `Catalog` handle that shares it, `CoreRuntime.catalog` keeps one per connection
  and the app hands it to the scripts of workbooks, so the scripts publish into the catalog of the connection. The
  script with the functions of the connection stays in Rust, the catalog loader replaces its text through the
  connection.
- **Channels and tables stay in JavaScript, under handles.** The channels, the result tables and the records of the
  queries that the host runs itself (their abort controllers) are objects of the handle table of the platform of the
  runtime (`CoreRuntime.handles`, see [runtime_projection.md](runtime_projection.md#handles)). The progress of a query
  is the one of the Rust history. The action that gives an object to the connection hands its handle over, the
  connection keeps the handle where it keeps the object and lets go of it with an effect: `release`, `close` (a
  channel) or `abort` (an active query). A reset or a delete cancels the setup and the catalog updates of the
  connection in Rust (`RegistryEffect::CancelSetup`, `CancelCatalogUpdate`) and stops the queries: the registry clears
  the history (`QueryExecutionHistory::clear`), which aborts the active queries and releases the handles of all
  queries, and the executor cancels the queries that it runs.
- **A connection is a view.** The store reads the view of a connection when its slice changed: when the connection
  changed, when a query started or finished, when the workbooks that use it or its save changed. The progress of a
  query changes only the slice of the query. A view shares its unchanged parts with the previous view (`share`), the
  app reads it as `ConnectionState`.
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
3. **Bindings and the switch.** Done: the workbooks are a domain of the runtime of the module, see
   [The workbooks](#the-workbooks); the app reads their views.
4. **The other state.** The connection state (`src/connections/`, with the Hyper, Trino and Salesforce connectors and
   the catalog updates), the query execution state (`src/query/`, with the progress model and the profile state) and
   the computation state (`src/compute/`, with the cross filters) are ported with their tests. The connections and the
   computations keep their Arrow tables in JavaScript under handles, the computations their data frames as ids of the
   compute database, and run their tasks in Rust. The connections with their query
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
schema, IPC). A query result never lives in the core module: a page that needs a conversion passes through it as the
next part of an Arrow IPC stream, Hyper hands its chunks over as they are, and `apache-arrow` builds the table in
JavaScript (see [The query executor](#the-query-executor)).

**Tasks.** A service is an async function on the runtime: it reads a state, awaits the host without holding a borrow,
then applies an action. `spawn_local` runs it in the browser, cancellation is a token that the action checks. A host
call that fails is an error of the task, never a panic.

**Order.** The host trait and the executor with the storage writer as the first service (done), the format of
workbooks (done); the catalog loader and the
query executor once the connection and query states are switched; the connectors one by one behind the existing
`QueryChannel`; the runs of workbooks (done); the restore (done) and `createRuntime` last. ZIP archives (`zip.js` with
`CompressionStream`) and the compilation of chart specs (`vega-lite`) stay host calls until a reason to move them.

## The workbooks

The workbooks are a domain of `Runtime` (`runtime/workbooks.rs` of the bindings, see
[runtime_api.md](runtime_api.md#step-4-as-built)): the runtime holds the workbooks of the crate in the order they were
registered, with the metadata of their workbook files that a workbook doesn't keep (the origin, the whole link to a
cloud), and the workbooks that the restore refused.

- **Actions by connection id.** An action of a workbook (`dispatch({ workbook: id }, action)`) names a connection by its
  id, the runtime gives the scripts the connection of its registry with the catalog of the connection
  (`script_connection_of`). Creating a workbook is an action of the runtime (`createWorkbook`), it writes the workbook
  file, its script list and its first manifest.
- **Effects stay in Rust.** The effects of an action are writes of the storage writer of the runtime under the keys of
  the workbook (`write_effects`), the host sees none of them.
- **The runtime does what the registry of TypeScript did.** An ephemeral workbook that got a script is promoted with a
  name that no other workbook has, the registry of the connections learns which workbooks use a connection after every
  action that can change it, and an announced catalog of a connection outdates the analyses of the scripts on it
  (`catalog_listener` of the connections).
- **Per keystroke.** `reportEditorUpdate(workbookId, scriptKey, sessionId, update, holdsPendingDiff)` takes the packed
  update of an editor; an update of a session that the script no longer holds is dropped, an editor that holds no
  staged rewrite of the script accepted it. The workbook writes the text of the script, the slice of the script changes,
  the workbook keeps its slice.
- **Slices.** The `workbook` slice changes with the key of what its view shows (`workbook_key`, a hash of everything
  but the texts and analyses of the scripts), the `script` slice with the revision of the script, the `workbookDerived`
  slice with the key of what it derives from (`derived_key`: the names, connections, texts and analyses of the scripts
  and the attachments). The derived view runs the planner of the crate on the workbook (`Workbook::with_planner`) when
  the store reads it: the checked references, the dataflow and the inputs, packed like the free functions of the
  planner. The store of TypeScript reads the payloads of a script once per key (`ScriptProjection`), the FlatBuffers of
  a derived view once per view.
- **Runs.** A run shares the workbook of the runtime (`runWorkbook`, `runScript`), it is live while the runtime holds
  the workbook, and its writes tell the platform. The `run` slice of a workbook shows the run that holds it and the
  state of its last run, see [The runs of workbooks](#the-runs-of-workbooks).
- **The tests.** `runtime_workbooks.test.ts` of `dashql-core-js` (the actions and their writes, a keystroke as the change
  of a script only, the payloads by key, the promotion, a restore of what the runtime wrote) and the tests of the
  runtime package on the embedded Hyper.

## The computations

The computations are the first domain of `Runtime`, the class of the module of [runtime_api.md](runtime_api.md)
(`packages/dashql-core-wasm/src/runtime.rs`, `DashQL.createRuntime(platform)`). The class holds the `ComputeService` of
the crate on `JsPlatform` (`src/host.rs`), the host over the one platform object of TypeScript. The app reads a
computation as a view (`views('computation', ids)`, `ComputationView` of `runtime/computation.rs`), dispatches the
requests of its components (`dispatch({ computation: id }, action)`) and starts an analysis with a command
(`analyzeTable`). `CoreRuntime` of the TypeScript runtime (`core_runtime.ts`) builds the platform object, holds the
store of the views (`store/runtime_store.ts`) and attaches the runtime of the module once the core is there.

- **An analysis runs in Rust.** `analyzeTable(tableId, table, options)` takes the result by its handle in the handle
  table, reads it as Arrow IPC once (`tables.read` of the platform), registers a token of the lifetime of the
  computation and analyzes it: the import, the statistics, the system columns, the summaries of the columns and, with
  the option, an ordering like the one of the result that it replaces. The promise settles with the analysis, after
  the store took its changes.
- **The app asks, the service derives.** The actions of the computations are the requests of the components: an
  ordering (`orderBy`), the selections (`histogramFilter`, `mostFrequentValueFilter`, `clearCrossFilters`), the
  searches (`setResultSearchPattern`), the summary of a column over the selected rows
  (`requestFilteredColumnAggregation`) and `deleteComputation`. The service builds the tasks from the state and runs
  them, see [The tasks of the computations](#the-tasks-of-the-computations). The scheduler of the app, the task
  variants with their promises, the queue of the filters and the search effects of the app went.
- **The compute platform.** `compute` of the platform (`compute/compute_platform.ts`) imports Arrow IPC with
  `insertArrowTable`, creates tables with `createTableAs`, reads them back as Arrow IPC, drops them and aborts the calls
  of a cancelled run. The SELECT of a task runs through the query execution of the app (`setQueryExecution`), e.g. into
  the query history of the connection of the computation. The platform reads the compute database when it is called,
  it arrives after the settings.
- **Arrow tables stay with the host.** Arrow data never lives in the core module: every table of the computations,
  the result of an analysis and the derived tables (filter, ordering, search, statistics, summaries, system columns),
  is an object of the handle table, and the state names it by its handle with what it read of it, the rows, the schema
  and for the statistics the values of their row. A task reads the rows that its plan needs from the IPC of the
  compute database, then hands the table over (`tables.begin` and `tables.finish`). The effects that release and abort
  handles go into the change set, the store applies them when it takes the changes, with the views that no longer name
  them. The app resolves a table with `useTable(handle)`; it formats the summaries for the plots (`resolveSummaries` of
  `compute/computation_types.ts`) and parses the matching rows of a data search from its table
  (`resolveMatchingRows`), once per table.
- **The lifetime of a computation is a handle.** The analysis registers a token in the handle table and hands it
  over; a computation that is replaced or deleted aborts and releases it, which cancels its runs.
- **Data frames are ids of the compute database.** The service allocates them from one counter of the thread, a data
  frame of the runtime is the table `__df_<id>`. Runtimes that share a compute database, e.g. of the shell and of
  tests, don't share table names. The service drops the data frames that the state releases; nothing in the host reads
  a data frame any more.
- **The shell of Hyper** has a runtime of the module of its own (`StandaloneCoreRuntime` of the app) on the database of
  the shell; no bindings of the computations remain besides `Runtime`.
- **The core comes with the first command.** The runtime and the shell create `CoreRuntime` before the core is set
  up. The first command asks the platform for it, the runtime hands its core over on `restore`. A dispatch before the
  core fails: no computation exists without one. A platform without a core instantiates the default one.
- **Changed on purpose.** The tasks that the app scheduled are requests of the app now; a request that the state
  answers runs nothing, the app may ask from any number of components. A failed task of the same inputs is not run
  again until an input changes. An analysis whose computation is gone ends without an error. The tasks of an analysis
  log through the logger of the runtime.

## The connections

The connections are the second domain of `Runtime` (`runtime/connections.rs` of the bindings, see
[runtime_api.md](runtime_api.md#step-2-as-built)). The registry of the crate (`connections/registry.rs`) holds them in
the order they were registered with the histories of their queries, the histories without a connection (the one of
the shell) by name, and hands out the ids of all queries from one sequence.

- **The rules of the registry are Rust.** A connection that workbooks use is never deleted and switches its connector
  only while one workbook uses it, the embedded Hyper is never deleted. The workbooks of the runtime tell the registry
  which workbooks use a connection after every action that can change it.
- **The setups run in the runtime.** `setupConnection` and `cancelSetup` are commands of the runtime, see
  [The setups of the connectors](#the-setups-of-the-connectors). A setup that the host runs itself, the mock of
  Salesforce of the app and the fixtures of tests, applies its steps by the name of the action of the connector
  (`setupStep`, read by `setup_action_from_json`, the inverse of `setup_action_json`); a channel crosses as a handle that
  the connection takes, a step that fails releases it.
- **The saves run in the runtime.** The runtime writes through its storage writer: a change of a connection schedules
  what storage keeps of it (`connection_writes`), a created active connection writes its entry with its creation time,
  a deleted one leaves the app manifest. `saveConnection`
  writes the entry of the app manifest, commits the params and writes the copies of the workbooks; `retrySave` writes
  the copies of the last save again. The view of a connection shows its save.
- **The restore is a command.** `restore` creates the restored connections in the runtime, `restoreWorkbook` adds the
  connections that a single workbook registered.
- **The tests.** `connections/registry.rs` (the order, the ordinals, the rules, a reset that stops the queries, the
  histories without a connection), `connection_setup/mod.rs` (a step read back from its JSON) and
  `runtime_connections.test.ts` of `dashql-core-js` (the views, the steps of a setup with a channel, a setup with its
  probe, a cancelled setup, the description of a connection that comes online, the catalog, a Trino query into the
  history of its connection, cancelling, the memory of the module while a large result streams, the structured
  progress, a reset that stops a query).

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
- **The module.** `JsPlatform` of `packages/dashql-core-wasm/src/host.rs` implements the traits over the platform
  object of the runtime, `JsStorage` of `runtime/storage.rs` the storage and the restore over `storage` of it: their
  members return promises, `JsFuture` awaits them, `spawn_local` of `wasm-bindgen-futures` runs the tasks on the event
  loop, `future_to_promise` gives the results of a service to JavaScript. Every call catches, a member that throws
  fails the call instead of unwinding through the module.
- **The tests.** `tests/storage_writer_test.rs` runs the writer on a fake host: an executor of a single thread, a clock
  that only the test advances and a storage in memory. Debouncing is tested to the millisecond.
- **Signals.** `host::signal` has a value that is sent once and a future that can be cancelled, the writer needs no
  crate for them.

## The storage writer

The writer of the crate (`storage/writer.rs`) is a service of `Runtime`: the workbooks and the connections write
through it, the host runs its commands with `Runtime.storage(command)` (flush, settle, pause and resume the writer or a
workbook, revive, flush and delete a workbook, discard pending writes) and schedules the writes that no state describes
with `storageWrite`, e.g. the scripts that the user kept over a change outside the app. `StorageWriter` of
`storage/runtime_storage.ts` of the TypeScript runtime is the facade of these commands (`CoreRuntime.storage`).

- **Decisions in Rust.** The keys and their chains, debouncing and coalescing (a newer task keeps the timer of the first
  one), pausing the writer and workbooks, flushing, the statistics and the generations of keys, deleted workbooks,
  holding a write that would overwrite a script that changed outside the app, retrying the failed writes of a flushed
  workbook. The tasks that patch the workbook file read it, patch it as a JSON value and skip a write that changes
  nothing (`storage/workbook_file.rs`); a patched file keeps the order of its keys.
- **I/O in the host.** Loading and saving workbook files, scripts and connection files, the exclusive update of the
  connection entries of the app manifest (the host calls back into the writer with the entries), deleting: `storage`
  of the platform (`createRuntimeStorage` over the `StorageBackend` of the platform). The natural
  order of the attachment list follows the collator of the host. A task carries a text or a function that reads the
  latest text when the write runs, e.g. the scripts of a workbook that is written as a whole.
- **Views.** A task is a view of `runtime/storage/view.rs` (`StorageWriteTask`, a union by `type`), the outcome of a
  write (`StorageWriteOutcome`, by `status`), the statistics of a key and the generations of a workbook are views too.
  A text crosses as the string or the function itself. Workbook files and connection entries cross as plain JS values
  (`JsonValue` of `views.rs`), read the way `JSON.stringify` reads them: a member that is undefined is left out, it
  doesn't become null in a file. The variants of a task are read one by one, serde reads the fields of an internally
  tagged enum from a buffer that a function can't pass through.
- **State of the runtime.** The workbooks whose writes a change outside the app holds are the `storage` slice
  (`heldWorkbooks`), resuming a workbook releases it. The statistics of the keys change with every write and are no
  slice, the view of the app reads them when it shows them (`storageStatistics`).
- **Before the core.** A command before the core waits for it (`CoreRuntime.ready`), a flush and a settle have nothing
  to wait for. The app flushes the writer of its runtime when the page hides and pauses it when another tab takes over.
- **Changed on purpose.** A task starts in a task of the host, the TypeScript writer called the backend within
  `writeDurable`. Written bytes count UTF-8 bytes. A durable write of a deleted workbook resolves as cancelled, the
  TypeScript writer threw. Resuming re-arms a timer once, the TypeScript writer could keep the timer of a task that was
  scheduled while paused next to the new one. `getPendingKeys` lists every pending key, a test read the pending tasks
  of the TypeScript writer.

## The restore

The restore of the crate (`src/restore/`) runs as two commands of `Runtime`: `restore(progress)` restores the
connections of the app manifest and the workbooks of the workbook tree of the storage of the platform,
`restoreWorkbook(workbookId)` a single workbook of it, e.g. an import or the folder of `dashql run`. The runtime takes
what they restored, the outcome names the connections and the workbooks (`RestoreOutcome`), the workbooks that were
refused a load are in the list of the workbooks.

- **A host on top of the writer.** `restore::RestoreHost` extends `storage::StorageHost` with the reads of the restore:
  the workbooks of the tree, the connection entries of the app manifest, the scripts and the data files of a workbook,
  the files of a connection, the progress, and whether the storage owns connections. A storage of a single workbook
  folder doesn't, it restores no catalogs and writes no connections. `JsStorage` of the bindings implements it over
  `storage` of the platform, the tests of the crate over a storage in memory (`tests/restore_test.rs`).
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
- **Rust objects reach the runtime as they are.** The result holds the connections and the workbooks of the crate,
  the runtime takes both (`adopt_restored`), a workbook with the id of one it holds replaces it. The connections restore
  their catalog updates from their files in Rust, the host restores nothing.
- **Connections that the runtime holds.** A restore of a single workbook resolves against the connections of the
  runtime with their catalogs and adds the connections that the workbook registered.
- **Migrations stay before the restore.** The storage setup of the app migrates the root and the reachable workbook
  folders before the backend exists, the native backend a folder when it opens it. The restore validates the format
  version and shows an older workbook as invalid.
- **Views.** What a restore restored (`RestoreOutcome`, an invalid workbook with the connector as `ConnectorType`),
  the progress, and the script and data files that the host lists are views of `runtime/storage/restore_view.rs`.
  The connection entries of the app manifest and the stored params of a live connection cross as plain JS values.

The persistence of connections is a module of the crate as well (`src/connection_persistence.rs`), the runtime
decides what storage keeps of a change from the persisted fields of the connection before it and the connection after
it: saved params go to the app manifest and to every workbook that references the connection, drafts, names and the
caching choice to the app manifest with a longer debounce, and an active connection writes its catalog files after
an update and its catalog state after statements and updates. A deleted active connection leaves the app manifest and
its pending file writes are discarded. `Runtime.saveConnection` saves: the entry of the app manifest first, then the
commit of the params, then the copies of the workbooks, all of them durable writes of the writer. The outcomes of a
save are views of `connection_persistence/view.rs`, the saved params cross as objects.

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
- **Cancellation.** A run is a future that can be cancelled. The abort of the lifetime of a computation cancels its
  runs, `AbortDataSearch` the run of the search, `cancel_task` the run of a task; the host aborts the queries of the
  run.
- **No borrow across an await.** The state sits behind a `RefCell` that a task borrows only between its awaits. The
  host learns of a change after the borrow ended, so it may read the state from `changed`.
- **The requests of the app.** The app says what it wants of a computation: an ordering, a selection in a histogram or
  of a frequent value, a search of the columns or of the data, the summary of a column over the selected rows. The
  service derives the tasks from the state and runs them (`order_by`, `histogram_filter`,
  `most_frequent_value_filter`, `set_search_pattern`, `request_filtered_column_aggregation`): a request that the state
  answers, or that a running or failed task of the same inputs answers, runs nothing; a filtering runs one at a time
  and the latest selection after it. After every task the service derives again (`refresh`): a new filter or data
  search orders the rows again, a search that the app asked for before the data frame was there starts once the system
  columns are computed. The search of the column names runs its SQL on the compute database and is a run that a new
  pattern cancels. The rows of a selection of a filter and a data search at once are counted by a query that
  intersects their data frames. Ported from `useCrossFilters`, `useDataTableOrdering` and `useQueryResultSearch` of
  the app.
- **The tests.** `tests/compute_service_test.rs` runs the service on a fake host: an executor of a single thread and a
  compute database in memory that answers the SELECT of a task by its title; the requests of the app run there too.
  `core_runtime.test.ts` of the TypeScript runtime runs an analysis, a filter, an ordering, the summaries over the
  selected rows and both searches through the `Runtime` of the module on the embedded Hyper.
- **Formatting stays with the host.** The analysis of a histogram keeps the minimum and the maximum as Arrow values in
  the type of the column and the lower bounds of the bins as numbers or epoch milliseconds. The host formats them as it
  formats the cells of the grid.
- **The SQL is the one of the TypeScript.** `SqlFrame` builds the same text, numbers print as in JavaScript. The tests
  compare the text; the tests that run the SQL on Hyper stay in TypeScript.
- **Changed on purpose.** The tables of data frames are named by id. The column types come from the schema of the
  result. The data frame of any failed task is dropped, the TypeScript dropped only the one of a data search.

## The catalog loader

The catalog loader of the crate (`src/catalog_loader/service.rs`) is a service of `Runtime`
(`runtime/catalog.rs` of the bindings): it follows the connections of the runtime, schedules the updates of their
catalogs and runs them. The app requests refreshes with `refreshCatalog(connectionId, force)`, a run of the command line
tool stops the loader (`runCatalogLoader(false)`).

- **The loader follows the registry.** A change of the registry that is urgent (a connection that is created, set up,
  saved or refreshed, a query that starts or finishes) asks the loader to follow it at the end of the task. The loader
  keeps weak references of the connections (`follow` in their order, `observe` forgets the others), reads health,
  params, details, catalog updates and the number of running queries of every connection and describes the connections
  that came online.
- **The scheduler and the updates run in Rust.** `CatalogLoader` decides what to start and to abort, the service runs
  an update as a task: it drives `CatalogUpdate`, parses its batches in the module (`CatalogBatch::process`, like the
  restore) and publishes into the catalog of the connection. A publication needs the connection to still run the
  update. The text of the function script is replaced in Rust once its descriptor is published. A failed lookup is
  tried again after a wait, the wake-up is a timer of the host.
- **The queries run on the executor of the runtime.** A metadata query is a query of the history of its connection
  with the issuer `Catalog Update` (`run_internal` of `runtime/queries.rs`): the platform describes where it runs
  (`queries.describe`, as for `executeQuery`), the update registers it (`CatalogUpdateRegisterQuery`) and reads its
  result as Arrow IPC with `arrow-rs`. A query runs in a task of its own, a cancelled update cancels it at the backend.
- **The connection keeps the updates.** The start and the end of an update are actions of the connection
  (`UpdateCatalog` and the outcome of the update), so the connection, its persistence and the scripts that use it see
  them. A reset or a delete of the connection cancels its running updates (`CancelCatalogUpdate`), a forced refresh
  supersedes the running one.
- **A new catalog is announced.** An update that succeeded, partly or wholly, and a registration of client functions
  raise the `catalogVersion` of the view of the connection and outdate the analyses of the scripts of the workbooks that
  use the connection (`CatalogDidUpdate`), in Rust.
- **Salesforce over fetch.** The metadata of a data space comes from the instance over `HttpHost::fetch`
  (`SalesforceMetadataLoad`, three requests at once). An API of Salesforce that the platform passes, e.g. the mock of
  the app, answers it instead (`salesforce.metadata` of the platform).
- **Client functions.** The loader registers the client functions of a connector on the catalog of every connection
  it follows (`ClientFunctionRegistrations`), the platform loads the specs (`extensions.loadSpec`).
- **The tests.** `tests/catalog_loader_test.rs` drives the updates without I/O, `tests/catalog_loader_service_test.rs`
  runs the loader on a fake host: the queue, forced refreshes, the relations of statements with their retries, the
  embedded database, Salesforce and client functions. `runtime_connections.test.ts` of `dashql-core-js` describes a
  Trino connection that comes online, `catalog_updates.integration.test.ts` runs lookups on the embedded Hyper.
- **Changed on purpose.** The requested refreshes are considered before the lookups, so a request that a refresh
  answered and the lookup behind it settle in one pass. The retry wakes at the earliest attempt. Skipped functions and
  duplicate columns come back as warnings of the outcome. A forced refresh doesn't wait for the cancelled update to
  settle at its backend, the update ends as soon as its token is cancelled. The batches parse on the main thread in the
  module, the app has no batch worker anymore. A Hyper update that partly failed logs `Partially updated the catalog`.
  An update logs on the targets of the log of the loader, not on a trace of its own. The loader runs from the creation
  of the runtime, a request before the core is there waits for it.

## The setups of the connectors

The setups of the crate (`src/connection_setup/`) are commands of `Runtime` (`runtime/setups.rs` of the bindings):
`setupConnection(connectionId, options)` sets up a connection with its connector and checks its health,
`authenticateSalesforce(setupId, params, options, onStep)` logs in to Salesforce without a connection (the login of the
shell), `cancelSetup(setupId)` cancels either. The settings pages, the startup, the cloud login, the shell and the
command line tool call them through `CoreRuntime`.

- **A setup is known by an id.** The id of its connection or of a login. A new setup of an id cancels the one that runs,
  a reset or a delete of the connection cancels it (`RegistryEffect::CancelSetup`). The view of the connection shows
  whether a setup runs (`setupRunning`), its steps and how it ended; the command resolves with the outcome
  (`{ status, message, data }`, the tokens and the user of a login).
- **The options.** The params of the setup, those of the connection by default; the params that the channel connects
  with when they differ from the ones that the connection keeps (`channelParams`, the credentials of the environment of
  the command line tool); `forceRelogin`; the redirect page of the OAuth flow of Salesforce (`oauthRedirect`).
- **The OAuth flows of the platform.** `connection_setup::OAuthHost` adds the OAuth flows to `HttpHost`: the PKCE
  challenge and a random id come from the platform (`oauth.pkce`, `crypto.randomUuid`), the core has no SHA-256 and no
  randomness. `authorize_with_loopback` opens the authorization URL and waits for the loopback redirect (Trino),
  `authorize_with_redirect_page` waits for the callback of the redirect page whose state has the flow id (Salesforce),
  in the browser as a window and in the desktop app as a link. The flow of a setup is the one of the platform, a login
  may bring its own (the window that the click of the user opened). A cancelled token aborts the flow
  (`oauth.abort`).
- **A setup is an async function.** It drives the state machine of its connector (`TrinoSetup`, `SalesforceSetup`, the
  steps of a Hyper channel in `connection_setup/hyper.rs`) over the host: it applies every action to the connection
  right away, awaits the platform for the flow, the requests and the channel, and returns the handle of the channel.
  The token requests and the REST calls of Salesforce go over the HTTP client of the platform.
- **The channels stay what the executor reads.** The platform connects a channel from what the setup describes
  (`channels.connect`) and keeps it under a handle that the connection takes: the runtime of TypeScript keeps a
  `TrinoChannel` with the endpoint, the auth, the defaults and the OAuth token; the channel connector of the app connects
  the embedded Hyper, Hyper over gRPC and HTTP and the `SalesforceDatabaseChannel` over the Hyper channel of the HTTP
  client with the tokens and the attached database of Database.com. The setup resolves the params of the link to a
  Hyper with the token that the page holds (`channels.hyperLinkToken`).
- **The health check runs on the executor.** A channel that is ready but not online yet answers a probe:
  `check_health` runs the probe query of the connector as a query of the connection (`run_internal`), so it shows up in
  the query viewer, and maps the outcome to the action of the connection. A failed probe fails with the error of the
  query. The embedded Hyper is online with its channel and runs no probe.
- **Cancellation.** A cancelled setup ends at its next step. A connect runs to its end, a channel that is ready after
  the cancellation is closed. A probe that is cancelled stops at the backend.
- **The tests.** `tests/connection_setup_test.rs` runs the setups and the health check on a fake host: the flows, the
  token requests, the channels, failures and cancellations. `runtime_connections.test.ts` of `dashql-core-js` runs a
  setup with its probe and a cancelled one on the runtime; the tests of the app run the setups of Trino and Salesforce
  and the login of Salesforce on `CoreRuntime` with the OAuth flow of the app, the latter against a fake Salesforce over
  the HTTP client.
- **Changed on purpose.** A setup resolves with its outcome instead of rejecting, the error is in the view of the
  connection and in the log; a failure keeps its message and its details, not the error object of the host. The steps
  of a setup no longer cross as actions of TypeScript. The startup of the app and the command line tool run the probe
  of a connection that isn't online after its channel, e.g. the Hyper of a link. The mock of Salesforce of the app
  marks the health check as succeeded instead of running a probe on its mock channel. The requests of the Salesforce
  setup and the login go over the HTTP client of the platform, the tests answer them as a fake Salesforce. The setup and
  the login of Salesforce log on the target `salesforce_setup`. A Trino setup with OAuth that is cancelled before it
  starts reports `OAUTH_STARTED` and `OAUTH_CANCELLED`.

## The Trino connector

The Trino connector of the crate (`src/trino/`) does no I/O, the query executor drives its queries. The channel (`TrinoChannel`)
holds the endpoint, the auth with the OAuth token and the default catalog and schema, and turns a request of the
protocol into an HTTP request with its headers. A query (`TrinoQuery`) is a state machine: it asks for requests and
timers by id, takes the responses and the fired timers with the time they happened, and reports the schema, the
progress, the record batches and the end. It follows the next URIs until Trino stops sending one, requests the next
page before it converts the current one, retries busy or unreachable coordinators with growing delays, and fetches the
QueryInfos of the profile only while the profile is shown. The rows of a page become an Arrow record batch with the
coercions of the TypeScript runtime, and the executor hands it to the host before it converts the next page. A timestamp with a named time zone asks the host for the offsets of the zone, the
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
host to load a spec and register it once it arrives. The rows of every page are a table of typed cells that becomes a
record batch once the page arrived (`take_rows`); the run keeps no page. A result has no `_next` column: the value
after the last page is known only at the end, after the rows of the pages before it went to the host. The setup of a Salesforce connection is a state machine too: every step returns the actions of the
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
write. The runtime of the module runs it for the restore, the imports and the exports, the storage of the platform for
its migrations, validations and evictions; the platform reads and writes the files.

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

The imports and exports of workbooks are commands of the runtime (`packages/dashql-core-wasm/src/runtime/imports.rs`,
`exports.rs`, `archives.rs`, see "Step 6 as built" of [runtime_api.md](runtime_api.md)): the runtime reads the workbook
from `storage` of the platform, its sources and its archives through `archives`, and runs the format on them. The bytes
of attachments and results stay with the host by handle (`HostFile`: a handle of the handle table and a size), the
rows of the workbook tables cross as Arrow IPC. The fresh ids of exports and imports come from `crypto.randomUuid` of
the platform.

What the storage of the platform calls itself stays a binding of free functions
(`packages/dashql-core-wasm/src/workbook_format.rs`): `workbookFormat(op, args)` runs an operation on JSON arguments and
returns its JSON (the constants with the columns of the workbook tables, the validation of a workbook file and its
description, whether params are those of the embedded Hyper, the check of a UUID, the migration of the top-level files
of a folder, the rename of the `sidb` connections, whether a resolution of a native folder changed it),
`resolveWorkbookScripts` resolves the scripts of a workbook file over a resolver object of the host, and the class
`CacheEviction` steps through an eviction of the query result cache. `DashQLWorkbookFormat` of `@ankoh/dashql-core`
(`DashQL.workbookFormat`) gives them types.

- **Commands of the runtime.** `exportWorkbook` reads the workbook through `storage` (the attachments by handle), the
  cached results through the query result cache (retained while the export reads them), and the live params and names
  of its connections from the registry; the format sanitizes the bundle and builds the workbook tables, the platform
  writes them (`archives.write`). `readImport` reads an archive (`archives.entries`, `readTable`, `readFile`,
  `readText`), a workbook folder (`RuntimeImportFolder`: the top-level files, then the catalog files of the
  connections that the format names, then the scripts and attachments) or the workbook tables of a cloud, and holds
  the bundle as a pending import. `commitImport` maps the connections, adds the results to the cache and writes the
  workbook through `storage`, with the verification and the rollback of a replacement in Rust.
- **Host-driven.** The migration of a folder (`storage/migration/workbook_migration.ts`): the host reads the top-level
  files, the core migrates them, the host applies the changes. The eviction (`query_result_cache_eviction.ts`): the
  host lists and deletes the files that the core names. The scripts of a native folder that changed on disk
  (`native_workbook_sync_react.tsx`): the core resolves them over a resolver of the host.
- **The core when it is needed.** The synchronous calls of the storage use the core that the platform provided
  (`provideWorkbookFormatCore`: the provider of the core of the app, the storage writer, the test frame) or that the
  package instantiated, the asynchronous ones instantiate it when nothing did yet (`storage/workbook_format.ts`), with
  the loader that the platform sets: the app fetches its module, Node reads the file of the package, the tests use the
  precompiled one. A workbook folder whose workbook file is at the current version needs no migration, so the startup
  of the app checks the folders before it instantiates the core.
- **The workbook tree stays in TypeScript.** The storage of the app reads the tree at startup, before the core is
  instantiated, and the sidebar edits it synchronously. The core has its port (`tree.rs`), the restore gets the
  workbooks of the tree from the host, an import finds and updates entries through `storage` (`findWorkbook`,
  `upsertWorkbookEntry`).
- **Changed on purpose.** A migration writes a renamed file and removes the old one, the TypeScript steps renamed it.
  The bundle head of an older folder reads all of its top-level files that the migrations know, the TypeScript steps
  read the ones they touched. The tables of a bundle read the catalog files with the core, they take no parser. The
  connection import names the fresh ids of separate connections with `crypto.randomUuid` of the platform. The
  verification of an imported workbook compares its attachments by name and size, not by their bytes.

## The Hyper connector

The HTTP API of Hyper is a module of the crate (`src/hyper/`), sans-IO, the query executor reads its results. The client builds the
requests of the V3 API, the host sends them and hands the responses back. The auth headers come with every request,
the context of the connection holds them.

- **A result is a state machine.** `HyperResultReader` starts from the query response, whose status header names the
  query and whose body is the first chunk. `poll` returns the chunks and the progress so far, the chunk requests up to
  the parallel chunks and a status poll while the query runs without chunks, `receive` takes a response. The reader
  reads only the status (the query id, the progress, the chunk count, the completion, the errors). The chunks are
  parts of one Arrow IPC stream already, the reader passes them on unread in the order of the result.
- **Errors keep the rich model.** An error response becomes a `HyperErrorInfo` from the JSON body or the status
  header, with the diagnostics of the response for the log. The headers that the gRPC proxy of the desktop app
  forwards decode to the same error.
- **gRPC and the embedded Hyper stay host channels.** A connection over `V3_GRPC` or `WASM` names a channel of the
  host, which runs the query and hands the Arrow IPC of the result over. The module keeps the logic around them: the
  session options and the query queue of the embedded Hyper, the local cloud, the links to a Hyper.
- **The connection helpers move along.** The labels, the outcome of the health check, the setup check of Salesforce,
  the import of stored connections and whether a catalog can be refreshed are functions of `src/connections/`.
- **Changed on purpose.** The chunks are one stream that skips a repeated schema and an end-of-stream marker inside a
  chunk; the host reads it (`QueryResultStream`). The client logs nothing, the error carries the diagnostics. A restored
  connection keeps only its setup params.

## The query executor

The executor of the crate (`src/executor/`) runs the queries of the connections of `Runtime`, its host is Rust
(`runtime/queries.rs` of the bindings). `executeQuery` registers a query in the history of its connection and runs it
once the host described where it runs; `QueryPlatform` of the TypeScript runtime (`query/query_platform.ts`) is the
host half: the description from the view of the connection and the channel of its handle, the channels that the
module doesn't speak and the query result cache. `CoreRuntime.execute` keeps the signature of the executor of today,
its callers and the hooks of the app didn't change.

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
  reports `QueryEvent`s, the host applies them to the history of the connection right away: the relations of a
  statement come from the core (`touched_relations`), the analysis runs on the computations of the runtime and a result
  replaces the computation of the earlier result of its owner.
  Cancelling cancels the token: the requests stop, the query is cancelled at the backend and the task ends as
  cancelled.
- **The connectors.** Trino runs on `TrinoQuery` with the requests and timers of the host and keeps a refreshed access
  token on the channel of the host. Hyper over HTTP runs on `HyperResultReader` with the auth headers of the context of
  the connection, Salesforce Data Cloud with its bearer token. A client function call runs on `ClientFunctionCallRun`
  with the spec of the connector and the tokens of the channel. The runtime loads the spec through the platform
  (`extensions.loadSpec`) with the first call of a connector and keeps it.
- **Channels of the host.** A channel that the module doesn't speak stays with the host: the gRPC channel of Hyper in
  the desktop app (through its native proxy), the embedded Hyper, the channels of tests. A Trino channel of the
  TypeScript runtime only holds the endpoint, the token and the defaults of the session, the TypeScript protocols of
  Trino and of client functions are gone. The task asks the platform to run the query (`channels.open`, `next`,
  `cancel` by query) and follows the metrics of its batches, the batches go into the table of the query. The host
  learns of the views of the profile and of the cancellation right away.
- **Results never live in the core module.** A result passes through the module at most one page at a time, where a
  protocol needs a conversion. It lives in JavaScript and in hyperdb-wasm (through the data frames), held by handle.
  - Hyper over HTTP: the chunks are parts of one Arrow IPC stream. The executor fetches them with
    `ExecutorHost::fetch_result`, and the body of a successful response stays a `Uint8Array` of the host
    (`HttpResponse::host_body`): the module reads the status header only and hands the same object back
    (`QueryEvent::ResultData`).
  - Trino and client functions: every page becomes an Arrow batch and the next part of one Arrow IPC stream
    (`executor::ipc::IpcStreamWriter`), which goes to the host as soon as the page arrived. The peak of the module is
    a page (Trino asks for 32 MB), not the result: a result of 64 pages of 1 MB grows the memory of the module by 5 MB,
    it grew by 200 MB when the executor collected the batches (`query_executor.test.ts` of `dashql-core-js`).
  - A channel of the host (the embedded Hyper, gRPC, a channel of a test) keeps its record batches, the executor sees
    their metrics.
  - The parts go into a table of the platform that was opened for the query (`tables.open`, `tables.push`); once the
    stream ended, `ExecutorHost::finish_result` finishes it (`tables.finish`): `QueryResultStream` of the TypeScript
    runtime frames the parts (a message may span parts, a repeated schema and an end-of-stream marker are skipped) and
    decodes them with `apache-arrow`. A part that doesn't end on a message is an error of the query. The history takes
    the table by its handle, the analysis a handle of its own (`handles.duplicate`). The platform keeps the result
    tables and the Parquet files of the cache.
- **Changed on purpose.** A query that is cancelled before the executor started it rejects with the reason of the
  cancellation. A failure before the query reached the executor, e.g. a spec of client functions that doesn't load,
  rejects. The metrics of a Hyper result over HTTP count its chunks while it streams, and the batches and rows of its
  table once the host built it; no stream counts rows the module doesn't see. A client function call streams once its
  first page arrived, and its result has no `_next` column. The executor reads the auth headers of a Hyper connection once per query.

## The progress of a query

The progress model of a query (`src/query/progress.rs`) runs in the query executor of the crate. The query history
holds the structured progress that the app reads, the TypeScript progress model (`query_progress_model.ts`) is gone.

- **The task owns the model.** The stream of a query creates its `QueryProgressModel` with the first progress payload
  of its engine: the statement stats and the QueryInfos of Trino, the status of a Hyper query over HTTP, and the
  `engineProgress` of a channel of the host (the Hyper status of the web client). The model applies the payload to a
  query profile of `dashql-core-profile`, the progress update carries the structured progress instead of the payload:
  the packed `QueryProfile` with its version, the execution state and the revision. The model ends with the task. A
  malformed payload is logged and changes nothing, the update keeps the structured progress of the previous one.
- **The update stays in the module.** The executor reports a progress into the history of the connection, nothing of it
  crosses. `Runtime.setProgressLayout` sets the layout of the plans, `CoreRuntime` sets the left-to-right layout of the
  progress panels (`createProgressLayoutConfig`).
- **The view of a query carries it.** `QueryView.latestProgressUpdate` has the plain fields and the structured progress
  (`QueryProfileProgressView`): the packed `QueryProfile` and the execution state as packed `QueryProfileEvents`, one
  event per entity with state. The store passes the keys that it holds (the revision and the version of the
  structure, `known` of the `query` kind) and the module leaves those payloads out, so an update of the execution
  state crosses only the events and a batch crosses neither. `queryProgress` of `query/query_progress.ts` folds the
  events into the `ProfileExecutionState` that the panels read, once per view of the progress.
- **The recording stays with the progress.** The model records the payloads of the engine with the milliseconds since
  the first one, the progress of every update shares the recording (`SharedRecording`), so a finished query keeps it.
  `Runtime.queryProgressRecording` returns it as JSON for the download of the panel, `ProfileRecording::from_json` reads it
  and the recordings of the Trino test harness, `replayQueryProgress` replays it up to a point in time. A
  `QueryProgressFollower` replays it with a layout of its own, the panel rotates the plan with it and applies the
  later payloads as they come.
- **Changed on purpose.** The metrics of a progress update are always an object, a host channel that reported none
  reads as zeros. A payload is no longer dropped while the core loads, the core runs the executor. The stats of Trino
  stay JSON of `serde_json` from the response to the recording, a counter above 2^53 no longer stops the progress.

## The query history of the shell

The shell tracks its queries in a history without a connection of its runtime of the module (`StandaloneCoreRuntime`
of the app): `{ history: 'shell-<n>' }`, created with `createHistory` and dropped with the component. The class
`QueryHistory` of the module and `ShellQueryExecutionTracker` went.

- **The queries that the host runs.** `executeTrackedQuery` of `query/tracked_query_execution.ts` tracks a query that
  the host runs itself in a history of the runtime, of a connection or without one (`trackQuery` and the steps of its
  lifecycle): the shell, and the SQLFrame queries of the computations in the history of the connection of their
  result. The history hands out the id and keeps the record of the host under a handle, an abort of the handle (a
  reset of the connection) cancels it.
- **The last 100 queries.** `QueryExecutionHistory::with_limit` keeps at most a number of queries: a query that starts
  beyond the limit drops the oldest finished queries, then the oldest active ones, and releases their result tables.
  A later action on a dropped query changes nothing. The history of a connection has no limit.
- **Read as views.** The shell reads its history (`history` slice, the finished queries then the active ones) and its
  queries (`query` slices) through the store. A result that the shell shows keeps its computation after its query left
  the history.
- **Changed on purpose.** The history exists once the runtime has its core; a query of the shell before that runs
  untracked. A query id that the history knows is refused instead of replacing the query.

## The runs of workbooks

The runs of workbooks are a service of `Runtime` (`runtime/runs.rs` of the bindings) on the run of the crate
(`src/workbook_run/`): `runWorkbook(workbookId, options, listener)`, `runScript(workbookId, scriptKey, options)`,
`stopRun(workbookId)` and `resultKeys(workbookId, targets)`, the `run` slice of a workbook
(`WorkbookRunView`: the run that holds it, the state of its last run of the whole workbook, the inputs whose change
waits). `CoreRuntime` of the TypeScript runtime has the same commands, the app reads the slice with
`useWorkbookExecution` and runs a script with `useScriptRun`.

- **A run is a task on the workbook.** The module shares the workbook with its runs (`Rc<RefCell<Workbook>>`). A run
  analyzes every script and publishes its declarations, then analyzes every script again at the catalog revisions that
  the publishing left (`Workbook::analyze_for_run`). The scripts take the analyses, there is no action that hands them
  over. Before every plan the scripts whose analysis a catalog update outdated analyze again.
- **Plans.** `Workbook::plan_run` plans the scripts with `planner::plan_session`: every script, the targets with what
  they need, or the scripts that a change of inputs affects (`plan::affected_scripts` on the dataflow of the workbook).
  A run of a script needs a statement of its target. The result keys follow the plan (`plan::result_keys`): the
  platform derives a key from a signature (`resultCache.key`), the run decides whether the key is reusable.
  `resultKeys` plans without analyzing and returns the reusable keys, for the cache indicators and the exports.
- **Cached results.** A script with a reusable key whose file the cache holds and that follows no script that runs is
  served from the cache: the run keeps the file (`resultCache.retain`), the terminal query of the script reads the
  cache only, and the run plans again with the file as a result that the platform provides. A miss runs the script.
- **The schedule.** A node starts once its predecessors released it, at most `max_concurrent_queries` statements of a
  connection run at once (a Hyper server four, the others one), in node order. A statement releases the nodes after
  it once its result arrived, the node of a materialized script once its result is written as Parquet file
  (`mounts.write`). The nodes of a connection that can't run or could not be set up are skipped with every node that
  follows them. A failed statement cancels the running ones, the run settles once they ended and then releases its
  files (`mounts.release`).
- **Statements on the executor.** A statement is a query of the history of its connection that the runtime runs
  itself (`Connections::run_statement`): the platform describes where it runs with the options of the statement
  (`queries.describe`: the cache with the signature of its key, whether it publishes and analyzes its result, a call
  of a client function), the executor reports its result as ready to the run before the analysis and its end after.
  The result table stays in the history, a materialization writes it by its handle. Its failure keeps the query, the
  details and the target of its error.
- **Writes.** The run registers the queries and the results of the scripts on the workbook and captures the
  visualization of every output (`RegisterQuery`, `RegisterScriptResult`, `SetExecutionVisualization`), the runtime
  tells the platform that it changed. A run is live while the runtime holds its workbook.
- **One run per workbook.** A run holds its workbook until it ended. A run of the workbook takes the connections of
  its scripts and starts only while the compute database is set up, no run holds the workbook or one of its
  connections, none of them is connecting and none runs a query that isn't an SQLFrame query of a computation; it
  refuses otherwise and says why (`RunOutcome.refused`). It runs statements on the connections that were online when
  it started, a preview of a published workbook only on the embedded Hyper. A run of a script refuses a held workbook
  and a preview, analyzes an outdated script first and shows a plan that fails, or a run that fails before its
  statements, as a failed query of the script.
- **Changes of inputs wait.** A change of inputs while the workbook is busy merges into the inputs that wait and stops
  the run that holds it. The runs follow the registry (`follow` at the end of the task of a change): the inputs that
  wait start once nothing blocks, when a run ended or a connection changed; after 5 s the change is dropped with a
  warning.
- **Stopping.** `stopRun` stops a run: the state turns `stopping`, the running statements are cancelled on the
  executor and their channels of the host at once, the run ends `cancelled` once they ended. A connection that drops
  from online stops the runs that run statements on it, a deleted workbook its run, a destroyed runtime every run.
- **The command line tool.** A listener with `prepareConnection` sets up the connections that statements run on
  before the first statement; such a run takes every connection of the workbook and needs no compute database. The
  listener hears the events of the scripts (`script`), a failure with what the platform failed with and the query of
  the statement. `analyze: false` leaves the results unanalyzed.
- **Attachments.** The runtime reads the columns of the Parquet attachments without columns once per file and stamp
  (`mounts.attachmentColumns`) when attachments change, after a restore and when the registry changes, and sets them
  with `SetAttachmentColumns`. A run mounts the attachments of its workbook before a statement scans them
  (`mounts.attachments`).
- **The platform.** `resultCache` has `key`, `retain` and `release` besides the reads and writes of the executor;
  `mounts` (`createRunMounts` of `workbook/scripts/run_mounts.ts`, null without a compute database that reads Parquet
  files) has the files of a run by its number: `prefix`, `fileName`, `write`, `use`, `release`, and the attachments.
- **No borrow across an await.** The run borrows the workbook only between its awaits and tells the platform after
  the borrow ended. The workbook may change during a statement, the next statement fails the run if a script, the
  order of the scripts or a session changed, a stale text fails it before the first statement.
- **The tests.** `tests/workbook_run_test.rs` runs real workbooks on a fake host: the order of a plan, concurrency per
  connection, failures and cancellation, cached results, materializations, runs of a script and changes of inputs.
  `workbook/workbook_runs.test.ts` of the TypeScript runtime runs the service on the runtime with channels of the
  tests: the holds, the blockers, stopping, previews, changes of inputs, runs of scripts, cached results and the
  events. `//packages/dashql-cli:test` runs workbooks on a fake Trino and the embedded Hyper: materializations across
  connections, attachments, the cache, interrupts.
- **Changed on purpose.** The run analyzes the scripts on the workbook and the action `APPLY_PLANNER_ANALYSIS` is gone,
  so is `ApplyPlannerAnalysis` of the workbook. Before a plan only the scripts with an outdated analysis analyze again.
  An attachment edge of the dataflow no longer counts as an edge of a script when a change of inputs collects the
  scripts it affects. The result keys are derived one after another. A run checks the Rust workbook. The `done` of a
  script and the `started` of a script that it releases come in either order. A plan without the mounts of the cache
  has a mount prefix with a counter instead of a random UUID. A run that doesn't start resolves with the reason
  instead of returning silently. A change of inputs that waits starts when what blocked it changed, not by polling. A
  plan error of a script is recorded in the history of its connection without a round trip through the executor.

## Typing

The typing benchmark (`packages/dashql-core-js/tests/bench_typing.mjs`) types a script of 40 lines (3,773 characters)
character by character next to two other scripts against an empty catalog, the way the editor does it: the editor
applies the event to the shared session of the script, packs its update and reports it to the runtime
(`reportEditorUpdate`); the store takes the changes and reads the view of the typed script with the newest processing
statistics (the editor update is the one that the editor reported, its key crosses, its bytes don't), and reads the
derived view of the workbook when it moved, its FlatBuffers read. It runs on the release module (`wasm-opt -O3`) in
Node and prints the 10th percentile and the median of every step:

```bash
bazel run --config=release //packages/dashql-core-js:bench_typing [-- --passes=3]
```

Measured on step 4 of [runtime_api.md](runtime_api.md) against its base `eeca6cc9a` (the reducer of TypeScript
reported the update to the class `Workbook` of the module, wrote its effects through the storage writer of the module
and projected the workbook and the typed script), three alternating runs of one pass each on a machine with a load of
about 2.3 on 16 cores, the range of the medians and of the 10th percentiles:

| Per keystroke | Base, p10 / p50 | Runtime, p10 / p50 |
|---|---|---|
| The editor applies the event to the session | 96–98 / 148–155 µs | 100–102 / 153–155 µs |
| The update: reported and written (base: the reduction with its writes) | 47–49 / 79–82 µs | 41–42 / 72–74 µs |
| The projection: the changes and the view of the script | 9–10 / 11–12 µs | 12–13 / 16–17 µs |
| The update and the projection | 59–60 / 93–97 µs | 57–58 / 92–95 µs |
| The derivation: references, dataflow, inputs (base: the three calls of the core) | 14–15 / 29–30 µs | 26–27 / 41–43 µs |

The update is faster: the effects go to the writer in Rust instead of through TypeScript. The projection crosses the
change set of every domain and the view of the script, 4 to 5 µs more than the two reads of the base and within the
budget of 25 µs. The derivation ran in the app before, for every mounted editor and the dataflow once per keystroke
behind a signature of every script; the base row counts only its three calls of the core on a plan request built
once, not the request that the app built per keystroke nor the graph. The runtime derives when the store reads the
derived view and crosses its three FlatBuffers.

With the runs in the runtime (step 5), one run of three passes at a load of about 1.7: the editor 81 / 145 µs, the
update 31 / 67 µs, the projection 11 / 15 µs, the update and the projection 44 / 84 µs, the derivation 25 / 35 µs (p10 /
p50). The change set crosses the `run` slices as well, a keystroke changes none of them.

## Open

- The actions of the success of a task and the scheduler tasks that the host would run remain in the state of the
  crate for its tests; the host can't reach them.
- A result crosses from the query executor to the computations as Arrow IPC that `apache-arrow` writes
  (`tables.read` of the platform), and the compute platform imports it through `insertArrowTable`, which writes it
  again. The parts of the stream could go to the compute database as they arrive instead.

- Editors outside of a workbook (the composer, the shell) keep sessions of their own.
- The storage of the platform calls the format through the binding `workbook_format.rs` for its migrations, the
  validation, the eviction of the query result cache and the scripts of a native folder that changed on disk. It goes
  when the storage moves into the runtime.
- The connections of a native workbook that changed on disk are read from the copies of its file in TypeScript
  (`connections/connection_restore.ts`) and created in the runtime, the restore of a single workbook could take them
  over.
- The query executor reads where a query runs from the host (`QueryPlatform`): the target of the channel of the
  connection and the key of the query result cache. The key needs the signature of the params of the connector and
  SHA-256 of the platform.
- A profile in the browser: the numbers of "Typing" are Node.
- The mock setup of Salesforce (`salesforce_connection_setup_mock.ts`, the mock config of the app) stays in TypeScript,
  it answers from `SalesforceAPIClientMock` without requests. The owner of the cancellation of a setup per connection
  (`connection_setup_cancellation.ts`) holds abort controllers of the host and stays.
- The Salesforce setup reads the HTTP client from a `SalesforceApiClient`, an API client of another kind passes its
  HTTP client next to it.
- The batches of a catalog update parse on the main thread. A host call to a worker with a core of its own would move
  the bundled functions of Hyper off the event loop.

## Kept on purpose

- A script that publishes its own declarations changes its catalog, so a script that was just analyzed can look
  outdated once more. A second analysis settles it.
- The base name of a new script comes with the action, the random names stay in TypeScript.
- A new connection is created with its name, its caching choice and whether it is active (`createConnection`).
- The script with the functions of a deleted connection is gone with the connection, the catalog of a deleted
  connection is cleared and other holders see it empty.
- The link to a published workbook is kept whole in the metadata of the workbook of the runtime (the workbook file
  holds more than its ids), the workbook of the crate knows its ids and whether it is a preview.
