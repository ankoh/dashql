# The runtime in Rust

Status: the workbook scripts, the connections and the computations of the app run on Rust.
`packages/dashql-runtime-rs` (crate `dashql_runtime`) holds the scripts of a workbook, the state of a connection with
the history of its queries and the computations, linked into the core module. `reduceWorkbookScripts` of the TypeScript
runtime is an adapter over the workbook (`workbook/scripts/workbook_native.ts`), `reduceConnectionState` one over the
connection (`connections/connection_native.ts`), `reduceComputationState` one over the computations
(`compute/computation_native.ts`). The storage writer is the first service on a host (`storage/storage_writer.ts`
over `src/storage/`). The catalog loader, the connectors and the tasks of the computations are ported
without I/O and not used yet. The name of the package is provisional.

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
   the computation state (`src/compute/`, with the cross filters) are ported with their tests. Arrow tables and data
   frames stay in JavaScript as opaque ids, a state releases one through an effect once nothing in it holds it. The
   connections with their query histories and the computations are switched: the bindings, the adapters and the tests
   of the runtime and the app run on Rust, see [The computations](#the-computations).
5. **The editor and the services.** The editor sends its events to the workbook, the planner runs in the workbook,
   then the services move with async calls of the host, see [The whole runtime in Wasm](#the-whole-runtime-in-wasm).
   The host trait, the executor and the storage writer are done, see [The storage writer](#the-storage-writer).

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

**Order.** The host trait and the executor with the storage writer as the first service (done); the catalog loader and the
query executor once the connection and query states are switched; the connectors one by one behind the existing
`QueryChannel`; the runs of workbooks; the restore and `createRuntime` last. ZIP archives (`zip.js` with
`CompressionStream`) and the compilation of chart specs (`vega-lite`) stay host calls until a reason to move them.

## The computations

`reduceComputationState` of the TypeScript runtime is an adapter over the computation state of the crate
(`compute/computation_native.ts`), bound as the class `Computations` of the module
(`packages/dashql-core-wasm/src/computations.rs`, `DashQLComputations` of `@ankoh/dashql-core`, created with
`DashQL.createComputations`). Ids, versions and names cross as typed arguments, tasks, results and cross filters as
JSON, a computation is read as a JSON snapshot once its revision moved.

- **The host owns the JS objects by id.** `NativeComputations` gives the Arrow tables, the data frames, the filter,
  ordering and search tables, the statistics and the summaries ids. It keeps an object while the state holds it and
  lets go of it on `ReleaseArrowTable` and `ReleaseDataFrame`, aborts the lifetime of a dropped computation on
  `AbortComputation` and the controller of a superseded search on `AbortDataSearch`. An object of an action that the
  state didn't take stays with the host.
- **Data frames that the host reads.** The reference counts of the `DataFrameRegistry` are gone: the state holds a data
  frame once, the host holds one while it reads it (`acquire`, `release`, e.g. the search of the columns). A data frame
  is dropped once neither holds it.
- **The projection keeps identity.** A computation keeps its object while its revision doesn't move; in a changed one
  the version, the searches, the arrays of summaries and the tracked tasks keep theirs while they are the same. A
  tracked task names its scheduler task, the projection shows the task as the app scheduled it with the version and
  the progress of the state. The column groups with their Arrow types, the cross filters and the matching rows of a
  data search stay with the host, the state keeps them by value.
- **The core comes with the first action.** The runtime and the shell create the computations before the core is set
  up. The first action asks the platform for it and the actions wait until it is there, the runtime hands its core
  over on `restore`. A platform without a core instantiates the default one.
- **Changed on purpose.** The progress of a task that the scheduler doesn't know is dropped, the TypeScript reducer
  registered such a task as a new one. A failed action is logged and leaves the state as it is.

## The host and the executor

`dashql_runtime::host` holds what every service asks of the platform: the trait `Host` with the clock (`now`), timers
(`sleep`, a future that clears its timer when it is dropped), tasks (`spawn`, a task starts after the caller returned)
and the log. A service adds a trait for its I/O on top, the storage writer `storage::StorageHost` with the operations of
the storage backend that it uses. Their async methods don't need `Send`: the futures of the module hold JavaScript
values and run on one thread. A failed host call returns a `HostError`, the error of the task: it keeps what the host
failed with and hands it back unchanged, and the host classifies the failures that the runtime decides on, e.g. a
script that changed outside the app.

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

## The tasks of the computations

The tasks that summarize, filter, order and search a result are ported to `src/compute/tasks/`, the app doesn't use
them yet. A task is sans-IO: its plan holds a `TaskQuery`, the SELECT that creates the table of a new data frame and
the read of that table in the order the task needs. The host runs both on the embedded Hyper and hands the read
batches to the `finish` of the plan, which returns the values of the action of the state. A data frame is the table
`__df_<id>` of the compute database, the caller allocates the id. A query, a read or a finish that fails leaves the
data frame to the caller, which drops it. The analysis of a result is a sequence of steps: the column groups and the
import of the result with row numbers from 1, the statistics, the system columns, then the summary of every ordinal and
string column.

- **Results are Rust values.** A result is a `ResultTable` of Arrow record batches (`arrow-rs`), read from and written
  to IPC at the boundary. The statistics, the summaries and their analyses are values of the crate; the state still
  knows them by host ids until the switch, then an `Arc<ResultTable>` replaces the id of an Arrow table and `Drop`
  replaces `ReleaseArrowTable`.
- **Formatting stays with the host.** The analysis of a histogram keeps the minimum and the maximum as Arrow values in
  the type of the column and the lower bounds of the bins as numbers or epoch milliseconds. The host formats them as it
  formats the cells of the grid.
- **The SQL is the one of the TypeScript.** `SqlFrame` builds the same text, numbers print as in JavaScript. The tests
  compare the text; the tests that run the SQL on Hyper stay in TypeScript.
- **Changed on purpose.** The tables of data frames are named by id. The column types come from the schema of the
  result. The data frame of any failed task is dropped, the TypeScript dropped only the one of a data search.

## The catalog loader

The catalog loader is a module of the crate (`src/catalog_loader/`), sans-IO and not used yet. It generates the
metadata SQL of the connectors, reads the result batches into tables and publishes descriptors and table updates into
the connection layer of the catalog of a connection.

- **An update is a state machine.** `CatalogUpdate::start` takes a connection, its relations or none for a full
  refresh, and returns the update with the action that registers it. `next` asks the host for queries to run, the Data
  Cloud metadata of a Salesforce connection, a catalog batch to parse in the batch worker or the moment to publish, the
  answers go back with `answer_queries`, `answer_salesforce_metadata`, `answer_batch` and `publish`. The outcome names
  the action that finishes the update and the new text of the function script, which the host sets.
- **Batches publish only while they are current.** `CatalogGenerations` counts the batches of a catalog, a newer one
  or a reset of the connection supersedes the older ones, and an update that was superseded or cancelled publishes
  nothing.
- **The scheduler hands out the updates.** `CatalogLoader` follows the connections, takes the requests for refreshes
  and the end of every update, and returns the updates to start and to abort and when to schedule again. The timers,
  the cancellation tokens and the logs stay with the host.
- **Changed on purpose.** The requested refreshes are considered before the lookups, so a request that a refresh
  answered and the lookup behind it settle in one pass. The retry wakes at the earliest attempt. Skipped functions and
  duplicate columns come back as warnings of the outcome.

## The Trino connector

The Trino connector of the crate (`src/trino/`) does no I/O, the app doesn't use it yet. The channel (`TrinoChannel`)
holds the endpoint, the auth with the OAuth token and the default catalog and schema, and turns a request of the
protocol into an HTTP request with its headers. A query (`TrinoQuery`) is a state machine: it asks for requests and
timers by id, takes the responses and the fired timers with the time they happened, and reports the schema, the
progress, the record batches and the end. It follows the next URIs until Trino stops sending one, requests the next
page before it converts the current one, retries busy or unreachable coordinators with growing delays, and fetches the
QueryInfos of the profile only while the profile is shown. The rows of a page become an Arrow record batch with the
coercions of the TypeScript runtime. A timestamp with a named time zone asks the host for the offsets of the zone, the
crate has no time zone database. The setup of a connection (`TrinoSetup`) is a state machine as well: it reports every
step as an action on the connection and asks the host for the PKCE challenge, the login in the browser, the token
request, the channel and the health check.

- **Changed on purpose.** Integers keep all their digits, invalid base64 becomes null instead of failing the batch,
  basic auth encodes UTF-8, an error or rows in the response to the statement are handled like a page, a token
  response without a token is an error.

## The client functions and Salesforce

The client functions (`src/clfn/`) and the Salesforce connector (`src/salesforce/`) are ported without I/O, the app
doesn't use them yet. A call is a state machine: it starts from the description of the core, returns the next request,
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

`src/workbook_format/` holds the storage format of workbooks without I/O, the app doesn't use it yet: the layout of the
storage, the workbook file with its validation and migrations, the file lists, the workbook tree, bundles, the workbook
tables, the archives of imports and exports, the eviction of the query result cache and the decisions of the restore.
It takes the contents of files and returns parsed values, validation results, migrated files and the files to write.

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
  a `CatalogSql` of the catalog of a connection.
- **The restore decides, the host acts.** `RestorePlanner` validates workbooks, resolves their copies to connections
  (the manifest wins, unknown ones are registered, the embedded database is a single connection), names the catalogs to
  restore and collects the writes after the restore. `script_list_patch`, `promotion_patch`, `connection_copy_patch`
  and `manifest_connections_patch` build them.
- **Changed on purpose.** Names aren't normalized to NFC, the host passes the names of its listings normalized. The
  natural order follows ICU for ASCII and folds the accents of Latin-1. Bundles and params compare as values, the order
  of keys doesn't count. A field of the wrong type is dropped when a file is written again.

## Typing

Measured in Node on a script of 40 lines (4,660 characters) typed character by character, next to two other scripts,
the way the editor does it: the editor applies the event to the shared session (1.4 to 2.0 ms per keystroke, the
analysis of the core) and reports the update. The reduction then takes 0.6 to 0.9 ms: 0.4 to 0.6 ms in the workbook
(publishing the declarations into the catalog, compiling the visualization, deriving the table parameters, which the
TypeScript reducer did as well, each through a call of its own), 0.2 to 0.3 ms for the projection. Packing the update
for the workbook is 0.09 ms of it, an editor that sends its events to the workbook (`ApplyEditorEvent`) would save
about that.

## Open

- Editors outside of a workbook (the composer, the shell) keep sessions of their own.
- The loader patches workbook files and connection entries with the TypeScript helpers of `storage_writer.ts`
  (`patchWorkbookConnection`, `upsertConnectionEntry`), the writer has its own in Rust until the restore moves.
- The query history of the shell (`query/shell_query_execution.ts`) still runs on `reduceQueryAction` in TypeScript.
- The progress model of a query runs in the query executor in TypeScript, the Rust history gets the plain fields of a
  progress update, the adapter keeps the structured progress. The planned statement of a query stays in TypeScript.
- A profile in the browser: the numbers above are Node, with two other builds on the machine.

## Kept on purpose

- A script that publishes its own declarations changes its catalog, so a script that was just analyzed can look
  outdated once more. A second analysis settles it.
- The base name of a new script comes with the action, the random names stay in TypeScript.
- `ApplyPlannerAnalysis` exists because the engine of the runs is still TypeScript.
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
