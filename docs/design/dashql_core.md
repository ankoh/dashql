# DashQL core

The core of DashQL is Rust. One WebAssembly module, the core module, holds the SQL language of DashQL (scanner, parser,
analyzer, catalog, completion, formatter), the editor sessions of scripts, the query profiles of Hyper and Trino, the
shell, and the runtime of DashQL: the state of the app and its services. The TypeScript of `@ankoh/dashql` binds it
and supplies its I/O, see [dashql_runtime.md](dashql_runtime.md).

This document is the map of the Rust side: the crates, the module, the runtime with its services, the host traits and
the rules that keep the module alive. The deep design docs are linked where a topic has one.

## The crates

| Crate | Path | What | Depends on |
|---|---|---|---|
| `dashql_buffers` | `proto/fb` | The FlatBuffers schemas of the core (`proto/fb/dashql/*.fbs`) and their Rust code | |
| `dashql_parser` | `packages/dashql-parser` | Scanner (logos), the LALR(1) tables that bison computes from `grammar/`, keywords | buffers |
| `dashql_core` | `packages/dashql-core` | The language: scripts, analyzer, catalog, cursor, completion, formatter, script diff, signatures, packing into FlatBuffers | parser, buffers |
| `dashql_core_script` | `packages/dashql-core-script` | Scripts on the core: editor sessions (`script_session.rs`), the compilation of scripts, batch processing of catalog SQL, the relations that statements touch, the renderer specs of `VISUALIZE` statements | core, parser, buffers |
| `dashql_core_profile` | `packages/dashql-core-profile` | The query profile: Hyper plans and Trino stages parsed into operators, edges, fragments and pipelines, their layout, and the progress of a running query as events | buffers |
| `dashql_core_shell` | `packages/dashql-core-shell` | The shell: prompt, VT100 renderer, the effect protocol of queries and dot commands (`SHELL.md`) | core, parser, buffers |
| `dashql_core_runtime` | `packages/dashql-core-runtime` | The runtime: workbooks, the planner across scripts, connections, queries, computations and the services, without I/O | core, script, profile, parser, buffers, `arrow-rs` |
| `dashql_core_wasm` | `packages/dashql-core-wasm` | The wasm-bindgen bindings of all of the above: the classes of the core and the `Runtime` of DashQL with its platform | all of the above |
| `dashql_dataflow` | `packages/dashql-dataflow` | The layout of the dataflow canvas with ELK (elk-rs) | |
| `dashql_dataflow_wasm` | `packages/dashql-dataflow-wasm` | The second module, for the layout only, loaded when the canvas opens, so the core module carries no ELK | dataflow |

All third-party crates of these come from the isolated `@core_crates` universe (`bazel/crates/core.MODULE.bazel`).
`packages/dashql-native-proxy` (the gRPC proxy of the desktop app) is Rust as well but not part of the core.

The language is the contract of the core: integrations that use the core on its own get the classes of the core
(`Catalog`, `Script`, `ScriptSession`, the shell, through `DashQL` of `packages/dashql/src/core/api.ts`) and the
FlatBuffers of `proto/fb`. The runtime (`Runtime`, `QueryProgressFollower`) is linked into the same module but belongs
to DashQL and changes with it; its state crosses as views with generated types.

## The core module

- **Build.** `//packages/dashql-core-wasm:dashql_core_wasm` is a `rust_shared_library` for `wasm32`,
  `:dashql_core_bindgen` runs wasm-bindgen (`target = "web"`), and `:core_wasm` is the shipped `dashql_core_bg.wasm`.
  The generated glue and the Wasm reach TypeScript as `@ankoh/dashql-wasm` (`//packages/dashql:dep_wasm`), the
  declarations of the glue import the FlatBuffers as `@ankoh/dashql-flatbuffers`.
- **Release.** `--config=release` builds with `-c opt`, `-Copt-level=3` and stripping, and `optimize_wasm`
  (`bazel/wasm_tools.bzl`) runs `wasm-opt -O3` and `wasm-strip`; a dev build copies the module unchanged. The release
  module is in the order of 14 MB, about 4 MB with gzip.
- **One module.** The runtime is linked into the core module. A module of its own would duplicate the core and split
  the catalogs: the workbook owns the script sessions and the catalogs of its connections as plain Rust values, `Drop`
  frees them, and calls into the core are function calls.
- **Panics.** The module aborts on a panic: the call traps without dropping its guards, and the module must not be used
  anymore. `installPanicHook` reports the message to `globalThis.__dashqlCorePanic` first, and the app shows
  `core_panic_overlay.tsx`. This is why the runtime crates deny panicking code, see [The rules](#the-rules).
- **Views.** The views of the runtime are Rust structs with `Serialize` and `Tsify` next to the bindings
  (`*/view.rs`, `views.rs` of `dashql-core-wasm`). serde-wasm-bindgen builds the JS objects directly, tsify writes their
  declarations into the `.d.ts` of wasm-bindgen. `Option<T>` is `T | null` (`missing_as_null`), `u64` is `number` and
  fails above 2^53 instead of panicking, a unit enum of the app is a wasm-bindgen C-style enum named by `app_enum!`, and
  a FlatBuffer payload is a `Uint8Array` typed as `FlatBuffer<T>` of its root table, read in place with
  `readFlatBuffer`. The bindings take and return `Ts<T>` and fail with a `JsError`, never with the panicking
  conversions of tsify.

## The runtime

`Runtime` of `packages/dashql-core-wasm/src/runtime.rs` is the one class of the runtime. `Runtime::create(platform)`
wires the services of `dashql_core_runtime` on `JsPlatform`, the host over the platform object of TypeScript. The
state sits in the services behind `RefCell`s; every method takes `&self`. The seam (views, `takeChanges`, `dispatch`,
the commands) is described from the TypeScript side in [dashql_runtime.md](dashql_runtime.md#the-seam); the change
marks are `runtime/changes.rs`.

| Domain | Crate (`dashql-core-runtime/src`) | Bindings (`dashql-core-wasm/src/runtime/`) |
|---|---|---|
| Workbooks and scripts | `workbook.rs`, `visible_scripts.rs`, `attachments.rs`, `names.rs` | `workbooks.rs`, `attachments.rs` |
| The planner, references, dataflow, inputs | `planner/` | `workbooks.rs` (the derived view) |
| Connections and their histories | `connections/`, `query/` | `connections.rs` |
| Setups and health checks | `connection_setup/`, `trino/`, `salesforce/`, `hyper/` | `setups.rs` |
| The query executor | `executor/`, `http/`, `trino/`, `hyper/`, `clfn/`, `salesforce/` | `queries.rs` |
| Computations | `compute/` | `computation.rs`, `compute_tracking.rs` |
| The catalog loader | `catalog_loader/` | `catalog.rs` |
| Runs of workbooks | `workbook_run/` | `runs.rs`, `runs/cached_results.rs` |
| The storage writer | `storage/` | `storage.rs` |
| Restore and the persistence of connections | `restore/`, `connection_persistence.rs` | `storage.rs`, `src/runtime.rs` |
| The workbook format: imports, exports, migrations, eviction | `workbook_format/` | `imports.rs`, `exports.rs`, `archives.rs`, `migrations.rs`, `external.rs`, `src/host.rs` |
| Handles | `handles.rs` | `src/host.rs` |

### Workbooks and scripts

- **The workbook owns its scripts** (`Workbook` of `workbook.rs`): every script with its session, the shared
  connection of its scripts with the catalog, its latest editor update, its staged rewrite, its query ids and its cached
  result, plus the attachments and the table parameters. An action changes the workbook in place and returns
  `WorkbookEffect`s, the writes of the storage writer under the keys of the workbook. A failed action leaves the
  workbook unchanged.
- **The runtime holds the workbooks** in the order they were registered, with the metadata of their workbook files that
  a workbook doesn't keep, and the workbooks that the restore refused. An action names a connection by id; the runtime
  gives the scripts the `ScriptConnection` of that connection (`restore::script_connection_of`), one per connection and
  shared by all its scripts. All catalogs take their entry ids, and the scripts their keys, from one source
  (`workbook::new_catalog`); script keys are unique in the module.
- **The rules of the registry are Rust.** An ephemeral workbook that got a script is promoted with a free name, the
  registry of connections learns which workbooks use a connection after every action that can change it, and an
  announced catalog outdates the analyses of the scripts on it (`CatalogDidUpdate`).
- **Analyses.** `WorkbookScript::is_analysis_outdated` is the one predicate: the flag, a text that changed, or an
  analysis that is no longer current with the catalog. A publish into the catalog that changes its version marks the
  other scripts on that catalog outdated. The scripts that editors show are analyzed by `visible_scripts.rs`: the
  selected one at once, the others once the changes pause for 150 ms. Other scripts stay outdated until something needs
  their analysis, e.g. a run. See [core_analysis_catalog.md](core_analysis_catalog.md).
- **Editor events.** `applyEditorEvent` applies a packed `EditorEvent` to the session, checks the text version that
  the editor shows (`STALE_TEXT_VERSION`) and the session generation, accepts a staged rewrite on an edit of the user,
  writes the text only when it changed, and derives the table parameters only when the text or the analysis changed.
- **The derived view** (`Workbook::with_planner`) runs the planner over the scripts: the checked references, the
  dataflow and the inputs, packed as FlatBuffers. See [planner.md](planner.md),
  [planner_dependencies.md](planner_dependencies.md), [script_references.md](script_references.md),
  [dataflow.md](dataflow.md) and [workbook_inputs.md](workbook_inputs.md).
- **Attachments.** Parquet files in the `attachments` folder of a workbook, the table parameter of their name
  (`sales.parquet` is `:sales`). `attachFiles` names a new one and writes it through the storage writer; the view of the
  workbook is the one list of its attachments. The runs read their columns once per file and stamp.

### Connections, setups and channels

- **The registry** (`connections/registry.rs`) holds the connections in the order they were registered with the
  histories of their queries, the histories without a connection by name (the shell's keeps 100 queries), and hands
  out all query ids from one sequence. A connection that workbooks use is never deleted, the embedded Hyper is never
  deleted.
- **A connection owns its catalog**; `Runtime.catalog` hands out a read-only handle of it. The script with the
  functions of the connection stays in Rust.
- **The rules of the connectors are Rust** and show in the view: whether a connection caches query results
  (`cachesQueryResults`), whether it is open, the label of its health, whether its queries read attachments, whether
  its catalog can be refreshed (`canRefresh`). Sharing params (`sanitizeConnectionParams`,
  `connectionParamsShareEqual`) is `workbook_format/sharing.rs`.
- **Tokens stay in the runtime.** The view summarizes them (`ConnectionTokenSummary`: type, scope, instance, tenant,
  issue and expiry); the PKCE verifier and the codes never cross; `revealConnectionSecrets` hands the raw values out on
  request.
- **Setups are commands** (`setupConnection`, `authenticateSalesforce`, `cancelSetup`; `connection_setup/`). A setup
  is an async function that drives the state machine of its connector (`TrinoSetup`, `SalesforceSetup`, the steps of a
  Hyper channel), applies every step to the connection at once, and awaits the platform for the OAuth flow, the token
  requests and the channel. Its outcome resolves, a failure is in the view of the connection and the log.
- **Setup attempts are fenced by epochs.** A setup begins an attempt (`ConnectionState::begin_setup`) and its steps
  carry the epoch (`ConnectionAction::SetupStep`). A later setup, a reset or a delete begins the next one; the steps of
  a replaced attempt change nothing and the channel of such a ready step is released. A cancellation stops the wait for
  a connect, a channel that connects after it is closed.
- **OAuth.** `connection_setup::OAuthHost` adds the flows to `HttpHost`: the PKCE challenge and random ids come from the
  platform, `authorize_with_loopback` serves Trino, `authorize_with_redirect_page` Salesforce. See
  [oauth_salesforce.md](oauth_salesforce.md).
- **Channels.** A Trino connection owns its channel in Rust (`trino::SharedTrinoChannel` in its details): the endpoint,
  the auth, the defaults and the access token, with one shared refresh that runs to its end in a task of its own;
  queries, catalog loads, probes and runs share it and the connection keeps the new token
  (`TrinoAction::AccessTokenRefreshed`). Every other channel is an object of the host that the platform connects
  (`channels.connect`) and keeps under a handle that the connection takes.
- **Health checks** run the probe of the connector as a query of the connection (`check_health`), so it shows in the
  query viewer. The embedded Hyper is online with its channel and runs no probe.
- **Opened workbooks.** `setUpOpenedWorkbook` sets up the connections of an opened workbook that need nothing of the
  user (`connections/open_setup.rs`): the embedded Hyper, and the Hyper of a link once the tab holds its token.

### Queries and the executor

- **Description in Rust.** `executeQuery` registers the query in the history of its connection and describes it
  (`queries.rs`): the target on the channel of the connection, the key of its result, whether the statement touches
  relations, and the options of the caller (`QueryOptions`: analyze, publish, throw on error, a client function call,
  the read timeout, the cache). The platform describes only a channel of the host by its handle (`channels.describe`).
- **The cache key** is the lowercase hex SHA-256 of the signature of the connection (`connection_cache_signature`) and
  the semantic signature of the script (`executor/cache_key.rs`); the digest comes from `crypto.sha256` of the platform.
  See [query_cache.md](query_cache.md).
- **One run object per query.** `QueryRun` of `queries.rs` lives from the registration of a query to the end of its
  last follow-up (the write of the result into the cache, the touch of a cached entry). Its token is the one
  cancellation of the query: `cancelQuery`, a reset of the connection and a caller that stops waiting cancel it while
  the query is described, loads the spec of its client functions, runs or is analyzed. The run owns its result table,
  the history and the analysis take handles of their own.
- **The executor** (`executor/`, `QueryExecutor::execute`) serves a result from the cache or sends the query, reports
  `QueryEvent`s into the history, touches the relations of the statement (`touched_relations` of the core script crate),
  analyzes the result on the computations and writes it into the cache. The history decides the latest result of an
  owner and reports the superseded queries; the runtime deletes their computations.
- **The connectors are sans-IO state machines** driven by the executor over `HttpHost::fetch`: Trino (`TrinoQuery`,
  pages of up to 32 MB as Arrow batches, retries, the profile only while it shows, named time zones through
  `ExecutorHost::time_zones` since the crate has no time zone database), Hyper over HTTP (`HyperResultReader`, the
  chunks passed on unread), Salesforce Data Cloud, and client functions (`ClientFunctionCallRun` with the spec that the
  catalog loader registered, see [client_functions.md](client_functions.md)). A fetch whose future is dropped is
  aborted. The gRPC channel of Hyper and the embedded Hyper stay channels of the host.
- **Results never live in the module.** A result passes through it at most one page at a time, see
  [dashql_runtime.md](dashql_runtime.md#results-stay-in-javascript).
- **Progress.** The `QueryProgressModel` of a query (`query/progress.rs`) applies the progress payloads of its engine to
  a query profile of `dashql-core-profile`; the view of the query carries the packed `QueryProfile` and its events by
  key. The model records the payloads, `queryProgressRecording` returns them and a `QueryProgressFollower` replays them.
  See [trino_plan.md](trino_plan.md).
- **Queries the runtime runs itself** (`run_internal`, `run_statement`): health probes, the metadata queries of the
  catalog loader and the statements of runs are queries of their connection's history, described like any other.

### Computations

The tasks that summarize, filter, order and search a result run in `compute/service.rs` on a `ComputeHost`. A task is
planned sans-IO in `compute/tasks/`: a SELECT that creates the table of a data frame (`__df_<id>`) and the read of that
table. The app sends requests (`orderBy`, `histogramFilter`, `mostFrequentValueFilter`, `setResultSearchPattern`,
`requestFilteredColumnAggregation`, ...); the service derives the tasks from the state and runs them, a request that the
state answers runs nothing. The SELECTs of the tasks are listed in the query history of the connection of the result,
or in the history that the analysis names (`compute_tracking.rs`), and a reset of the connection aborts them. The tables
stay with the host by handle; formatting of values stays with the host. See
[vegalite_crossfilter.md](vegalite_crossfilter.md).

### The catalog loader

The loader (`catalog_loader/service.rs`, scheduled by `CatalogLoader` of `scheduler.rs`) follows the connections of the
runtime, schedules the updates of their catalogs and runs them as tasks: metadata queries on the executor, the batches
parsed in the module (`CatalogBatch::process`), published into the catalog of the connection while the connection still
runs the update. Salesforce metadata comes over fetch, client functions are registered on the catalogs of their
connectors with specs that the platform loads (`extensions.loadSpec`). A busy connection keeps its requested refreshes
and is looked at again after 10 ms. `refreshCatalog(id, force)` requests a refresh, `runCatalogLoader(false)` stops the
loader. See [catalog_updates.md](catalog_updates.md) and [catalog_batching.md](catalog_batching.md).

### Runs of workbooks

`runWorkbook`, `runScript`, `stopRun` and `resultKeys` (`runs.rs` over `workbook_run/`):

- A run analyzes the outdated scripts and publishes their declarations until none is outdated
  (`Workbook::analyze_for_run`), plans with `planner::plan_session` (all scripts, targets with what they need, or the
  scripts that a change of inputs affects, `plan::affected_scripts`), derives the result keys, serves the cached ones
  and plans again with their files.
- A node starts once its predecessors released it, at most `max_concurrent_queries` statements of a connection at once
  (four for a Hyper server, one otherwise). A failed statement cancels the running ones; the nodes of a connection that
  can't run or be set up are skipped with what follows them.
- One run holds a workbook. A run of the whole workbook takes the connections of its scripts and starts only while they
  are idle; otherwise it resolves `refused` with the reason. A change of inputs while the workbook is busy stops the run
  and waits in the `run` slice, it is dropped after 5 s.
- The run borrows the workbook only between its awaits; a script, an order or a session that changed during a statement
  fails the run at the next one.
- A workbook that is deleted or replaced (a restore or an import under the same id) takes its `run` slice with it: the
  run that holds it stops, the inputs that wait are dropped, and a run changes the slice only while it holds it.
- A listener may prepare connections (`prepareConnection`), which is how `dashql run` sets up its connections.

See [workbook_graph_execution.md](workbook_graph_execution.md).

### Storage

- **The storage writer** (`storage/writer.rs`) decides the keys (all formats in `storage/keys.rs`), debouncing and
  coalescing, flushing, statistics and generations. The tasks that patch the workbook file read it as `WorkbookData` and
  keep fields the schema doesn't know (`storage/workbook_file.rs`).
- **Holds with reasons.** A hold of the writer or of a workbook has a `HoldReason` (external change, reload, import,
  handover, pause) and is counted. A flush writes past a hold of the writer, never past the hold of a workbook.
- **Failed writes are state.** A failed task stays pending and runs again after a backoff (one second, doubled, at most
  a minute) until a write of its key succeeds or it is cancelled. The `storage` view lists the holds and the failed
  writes; an export refuses a workbook whose writes failed or are held.
- **The restore** (`restore/`) runs as `restore` and `restoreWorkbook` over `RestoreHost`: the connections of the app
  manifest with the catalogs of their files, then the workbooks of the tree, validated and resolved to their connections
  by `RestorePlanner`. The runtime adopts the Rust objects as they are. A workbook that fails validation or whose
  connections or scripts fail shows as invalid.
- **The persistence of connections** (`connection_persistence.rs`) decides what storage keeps of a change of a
  connection; `saveConnection` writes the app manifest first, then commits the params, then the copies in the
  workbooks.
- **The workbook format** (`workbook_format/`) is the storage format without I/O: layout, the workbook file with its
  validation and migrations, file lists, the workbook tree, bundles, the workbook tables, the archives, the connections
  of imports, the eviction of the query result cache and the storage migrations. Its steps read and write files over
  `FolderHost`, `StorageRootHost` and `CacheHost`. See [storage_layout.md](storage_layout.md),
  [workbook_tables.md](workbook_tables.md) and [native_file_sync.md](native_file_sync.md).
- **Commands over the format.** `exportWorkbook`, `exportConnection`, `readImport`, `commitImport`, `dropImport`
  (archives through `archives` of the platform, results by handle), the static `migrateStorage`,
  `migrateWorkbookFolder`, `checkWorkbookFolders` with `answerExternalChange` for folders that change outside the app,
  and the eviction after every write of a cached result (`JsPlatform::evict_cache` over `evict_to_fit`).

## The host

`dashql_core_runtime::host::Host` is what every service needs: the clock (`now`), timers (`sleep`, a future that clears
its timer when dropped), tasks (`spawn`) and the log. A service adds a trait for its I/O:

| Trait | Adds |
|---|---|
| `http::HttpHost` | `fetch` with a `CancellationToken` |
| `storage::StorageHost`, `restore::RestoreHost` | The operations of the storage backend, the reads of the restore |
| `connection_setup::OAuthHost`, `SetupHost` | The OAuth flows, PKCE and random ids; connecting and closing channels, the token of a Hyper link, the probe of a health check |
| `executor::ExecutorHost` | The events of a query, the query result cache, the analysis of a result, result tables, host channels, time zones |
| `catalog_loader::CatalogLoaderHost` | The start and end of updates, metadata queries, the specs of client functions |
| `workbook_run::RunHost` | Statements, the result keys, preparing connections, cached results, the files of a run (mounts), the workbook |
| `compute::host::ComputeHost` | The compute database by handle |
| `workbook_format`: `FolderHost`, `StorageRootHost`, `CacheHost`, `CatalogSql` | Folders, the storage root, the files of the cache, catalog SQL |

A host call that fails returns a `HostError`, the error of the task: it keeps what the host failed with and hands it
back unchanged. `host::signal` has a value sent once and a future that can be cancelled.

**`JsPlatform`** (`packages/dashql-core-wasm/src/host.rs`) implements `Host`, `HttpHost` and `ComputeHost` once over
the platform object. The bindings of each service implement its traits over `JsPlatform`: `QueryHost` of
`runtime/queries.rs`, `LoaderHost` of `catalog.rs`, `RuntimeSetupHost` of `setups.rs`, `RuntimeRunHost` of `runs.rs`,
`ComputeTracker` of `compute_tracking.rs`, `JsStorage` of `storage.rs` (the writer and the restore), `JsFolder` and
`JsStorageRoot` of `migrations.rs`. Every member is reached through `Reflect` and every call catches: a member that
throws or is missing fails the call with a `HostError`. `JsPlatform` collects the effects on handles and the marked
slices and calls `changed(urgent)`.

The tests of the crate implement the traits over fakes: an executor of a single thread, a clock that only the test
advances, a storage and a compute database in memory.

## The rules

The module runs on one thread and a panic kills it. The runtime crates follow these rules:

- **Async without `Send`.** Futures of the module hold JavaScript values, so the host traits need no `Send`. In the
  module, `spawn_local` of `wasm-bindgen-futures` runs the tasks on the event loop, `JsFuture` awaits the promises of
  the platform and `future_to_promise` hands results to JavaScript.
- **No borrow across an await.** A service keeps its state behind a `RefCell`. A task reads it, awaits the host without
  holding a borrow, then applies the result. What the host is told (writes, statistics, notifications, the log) is
  collected while the state is borrowed and passed on after, so the platform may call the runtime again from any of
  its members. A slice whose state a task holds reads as busy (`try_borrow`) instead of failing.
- **No panics.** Actions return `Result`, a failed action leaves the state unchanged, input is never indexed or
  unwrapped, a value of JavaScript is converted with a checked conversion. `dispatch` never throws.

`//bazel:rust_safety_lints` enforces the last two with Clippy: `unwrap_used`, `expect_used`, `panic` and
`await_holding_refcell_ref` are denied outside of tests. `dashql-core-runtime` and `dashql-core-wasm` set it as their
`lint_config`; `rust_safety_test` of `bazel/rust_safety.bzl` makes Clippy a test,
`//packages/dashql-core-runtime:clippy_test` and `//packages/dashql-core-wasm:clippy_test` (over
`:dashql_core_wasm_lint`, a host build of the same sources). A new crate of the runtime takes the same `lint_config` and
a `rust_safety_test`. See "Clippy" in [build_bazel_targets.md](../agents/build_bazel_targets.md).

### What stays in TypeScript

The DOM, I/O and things that cross per value stay in TypeScript: fetch, OPFS, Web Locks, the embedded Hyper, ZIP
archives (zip.js), the compilation of chart specs (vega-lite), the formatting of cells (`Intl`), React and CodeMirror.
A port to Rust crosses per operation, never per value; never panics on engine input; names its offset unit (the editor
APIs count UTF-16 code units, the core UTF-8 bytes); and keeps within the budget of the main thread, since a call into
the core blocks it. The geometry of the query profile (`views/query_profile/profile_scene.ts`, `ui/graph/graph_edges.ts`
of the app) is the largest pure piece of TypeScript that could move next to `profile_layout.rs`.

## Tests

| Target | Tests |
|---|---|
| `//packages/dashql-parser:all`, `//packages/dashql-core:all`, `//packages/dashql-core-script:all`, `//packages/dashql-core-profile:all` | The language, sessions and profiles, with the snapshot tests of `tests/snapshots` |
| `//packages/dashql-core-runtime:all` | The services on fake hosts (`tests/*_test.rs`: workbooks, the planner, connections, setups, the executor, Trino, Hyper, client functions, computations, the catalog loader, runs, the storage writer, the restore, the workbook format and migrations), the planner and dataflow snapshots, the Hyper validation of the planner, Clippy |
| `//packages/dashql-core-wasm:all` | The parts of the bindings that call no JS on the host (the change marks), Clippy |
| `//packages/dashql:test_core_node` | The bindings and the runtime of the module in Node, see [dashql_runtime.md](dashql_runtime.md#tests) |

New core outputs get snapshot tests, derived graphs come from the analyzer and the planner. How to run them is in
[build_bazel_targets.md](../agents/build_bazel_targets.md).

## Further reading

- The language: [core_parser.md](core_parser.md), [sql_grammar.md](sql_grammar.md),
  [core_analysis_catalog.md](core_analysis_catalog.md), [core_completion.md](core_completion.md),
  [core_completion_ranking.md](core_completion_ranking.md), [sql_formatter_coverage.md](sql_formatter_coverage.md),
  [core_quirks.md](core_quirks.md), [vis_comments.md](vis_comments.md).
- The workbook: [planner.md](planner.md), [planner_dependencies.md](planner_dependencies.md),
  [script_references.md](script_references.md), [dataflow.md](dataflow.md), [workbook_inputs.md](workbook_inputs.md),
  [workbook_graph_execution.md](workbook_graph_execution.md).
- Connections and queries: [catalog_updates.md](catalog_updates.md), [catalog_batching.md](catalog_batching.md),
  [client_functions.md](client_functions.md), [query_cache.md](query_cache.md), [trino_plan.md](trino_plan.md),
  [oauth_salesforce.md](oauth_salesforce.md), [hyper_links.md](hyper_links.md).
- Storage: [storage_layout.md](storage_layout.md), [workbook_tables.md](workbook_tables.md),
  [native_file_sync.md](native_file_sync.md), [cloud.md](cloud.md), [workbook_publishing.md](workbook_publishing.md).
- Tooling: [rust_analyzer.md](../agents/rust_analyzer.md), [build_rust_coverage.md](../agents/build_rust_coverage.md).
