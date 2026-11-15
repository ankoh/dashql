# The runtime in Rust

Status: the workbook scripts of the app run on Rust. `packages/dashql-runtime-rs` (crate `dashql_runtime`) holds the
scripts of a workbook, linked into the core module, and `reduceWorkbookScripts` of the TypeScript runtime is an adapter
over it (`workbook/scripts/workbook_native.ts`). The computations run on Rust the same way
(`compute/computation_native.ts`). The connection state and the query execution state are ported as modules of the
crate with their tests, the app doesn't use them yet. The name of the package is provisional.

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
  rename, the script list and the properties of the workbook file. The host batches the writes, the debouncing of the
  storage writer stays in TypeScript. A dropped script leaves the catalog of its connection.
- **Sessions are shared.** The workbook shares the session of a script with a `ScriptSession` handle of the module, the
  editors of the app still apply their events to it and report the update (`ReportEditorUpdate`, the action
  `UPDATE_FROM_PROCESSOR`). The editor that sends its events to `ApplyEditorEvent` of the workbook is the end state.
- **The UI reads projections.** Every script and the workbook have a revision from one counter of the module, it
  changes with every change. `NativeWorkbook.project` builds the `WorkbookScripts` objects of the app from the
  workbook: a script keeps its `ScriptData` while its revision doesn't move, its editor update while the analysis is
  the same, its session handle while it keeps its session. Plain fields cross as JSON, editor updates, staged diffs and
  visualizations as packed FlatBuffers.
- **Actions are method calls.** The class `Workbook` of the module (`packages/dashql-core-wasm/src/workbook.rs`) takes
  typed arguments, `DashQLWorkbook` of `@ankoh/dashql-core` wraps it.
- **No panics.** A panic traps the whole module, a thrown error of a reducer in TypeScript only drops the action.
  Actions return `Result`, a failed action leaves the workbook unchanged, and the crate avoids indexing and unwraps
  on input.
- **I/O stays in TypeScript** until the services move: fetch, OPFS, Web Locks, the embedded Hyper.

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
   frames stay in JavaScript as opaque ids, a state releases one through an effect once nothing in it holds it. Their
   bindings and switches follow, like the ones of the workbook. The computations are switched, see
   [The computations](#the-computations).
5. **The editor and the services.** The editor sends its events to the workbook, the planner runs in the workbook,
   then the services move with async calls of the host, see [The whole runtime in Wasm](#the-whole-runtime-in-wasm).

## The whole runtime in Wasm

The goal: `createRuntime(platform)` builds a runtime of the module, and the TypeScript of `packages/dashql-runtime`
shrinks to the platforms and the adapters of the app.

**What stays in the host.** `RuntimePlatform` (`runtime.ts`) already draws the line: the storage backend (OPFS, the
folders of the desktop app, `node:fs`), `HttpClient` (fetch and the proxy of the desktop app), the scheduler and timers,
`OAuthFlow` (windows and links), the embedded Hyper (`hyperdb-wasm`, a module of its own), the cache of query results
and the sink of the logger. The crate sees them as a trait `Host` with async methods that don't need `Send`. The
module implements it over a JavaScript object whose methods return promises (`wasm-bindgen-futures`), the tests of the
crate over a fake with an executor of a single thread.

**What moves.** The storage writer (debouncing, groups, pausing), the format of workbooks (files, tree, validation,
tables, bundles), the protocols of the connectors over `Host::fetch` (Trino, the REST and query APIs of Salesforce,
gRPC-web of Hyper with `prost`, the client functions), the catalog loader with its SQL, the query executor, the runs
of workbooks, the restore and the persistence of connections, the registries.

**Arrow in Rust.** Most of these read or build Arrow: the catalog loader reads result columns, Trino turns JSON pages
into batches, the client functions build tables, the computations read results. The crate uses `arrow-rs` (arrays,
schema, IPC), a result crosses to the UI as IPC bytes once, and `apache-arrow` decodes it there as today. Hyper
hands its results to the host as IPC bytes already.

**Tasks.** A service is an async function on the runtime: it reads a state, awaits the host without holding a borrow,
then applies an action. `spawn_local` runs it in the browser, cancellation is a token that the action checks. A host
call that fails is an error of the task, never a panic.

**Order.** The host trait and the executor with the storage writer as the first service; the catalog loader and the
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
- The link to a published workbook stays whole in TypeScript (the workbook file holds more than its ids), the Rust
  workbook knows its ids and whether it is a preview.
