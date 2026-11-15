# The runtime in Rust

Status: the workbook scripts of the app run on Rust. `packages/dashql-runtime-rs` (crate `dashql_runtime`) holds the
scripts of a workbook, linked into the core module, and `reduceWorkbookScripts` of the TypeScript runtime is an adapter
over it (`workbook/scripts/workbook_native.ts`). The connection state, the query execution state and the computation
state are ported as modules of the crate with their tests, the app doesn't use them yet. The name of the package is
provisional.

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
   bindings and switches follow, like the ones of the workbook.
5. **The editor and the services.** The editor sends its events to the workbook, the planner runs in the workbook,
   then the services move with async calls of the host.

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
