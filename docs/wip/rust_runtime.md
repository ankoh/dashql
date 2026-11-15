# The runtime in Rust

Status: a spike. `packages/dashql-runtime-rs` (crate `dashql_runtime`) holds the scripts of a workbook and every
action of the reducer of the TypeScript runtime, tested in Rust (stages 1 and 2). The app still runs on the TypeScript
runtime (`docs/wip/dashql_runtime.md`), nothing switches until the spike decides. The name of the package is
provisional.

## Why

The reducers of the TypeScript runtime are hard to follow. `reduceWorkbookScripts` copies JavaScript objects as if the
state were immutable while it changes the script sessions of the core in place, frees core objects of the previous
state after the reduction and schedules storage writes on the way. Most of what it does is calling the core:
analyzing, publishing into catalogs, compiling, rewriting tags, checking references.

[rust_logic.md](rust_logic.md) kept the reducers in TypeScript because they hold Wasm handles, rely on object identity
and would need a crossing per state read. That holds for a reducer in TypeScript that calls into the core. It doesn't
hold for state that lives next to the core: a runtime crate linked into the same Wasm module owns the script sessions
and catalogs as plain Rust values, `Drop` frees them, and the calls into the core are function calls without packed
buffers in between. The boundary moves to what the UI reads.

## Architecture

- **One Wasm module.** The runtime crate is linked into the core module (`//packages/dashql-core-wasm:core_wasm`).
  A module of its own would duplicate the core and split the catalogs.
- **The workbook owns its scripts.** `Workbook` holds the `ScriptSession` of every script, its connection (with the
  shared catalog), its latest analysis and its query ids. An action changes the workbook in place and returns
  `WorkbookEffect`s: the files to write, delete or rename, the script list and the properties of the workbook file.
  The host batches the writes, the debouncing of the storage writer stays in TypeScript.
- **The editor talks to the workbook.** An editor event goes to `ApplyEditorEvent` of the workbook, which applies it
  to the session of the script, publishes the declarations and returns the editor update. The round trip of
  `UPDATE_FROM_PROCESSOR` goes away.
- **The UI reads versioned snapshots.** Every script and the workbook have a revision that changes with every change.
  The app keeps a snapshot per script and asks for a new one only when the revision moved, so unchanged scripts keep
  their identity for React. Editor updates and diffs cross as the FlatBuffers they are today.
- **No panics.** A panic traps the whole module, a thrown error of a reducer in TypeScript only drops the action.
  Actions return `Result`, a failed action leaves the workbook unchanged, and the crate avoids indexing and unwraps
  on input. The app restores from storage after a trap.
- **I/O stays in TypeScript** until the services move: fetch, OPFS, Web Locks, the embedded Hyper.

## Stages

1. **Scripts and the core actions.** Done: create (with a base name made unique, at an index, on the connection of the
   neighbors), delete, rename, reorder, set the text, editor events, analysis of outdated scripts, catalog updates,
   query ids, renaming the workbook, the script list of the workbook file. `tests/workbook_test.rs`.
2. **The rest of the reducer.** Done: staged rewrites with accept and reject (a user edit accepts), chart specs,
   inputs, moving scripts between connections (catalogs that share entry ids), picking, replacing and detaching
   connections, attachments and their columns, table parameters, rewriting the references of renamed scripts and
   attachments, the compiled visualization of a script and the one of a run, processing statistics, the analyses of
   the planner, cloud previews and links, the promotion of the ephemeral workbook, the replacement from storage.
   The other annotations (tables, flow and board positions, `@manual`) are in the editor update that the UI reads.
3. **Bindings.** A `Workbook` class in the core module with `apply` for packed actions and snapshots per revision,
   and the TypeScript adapter behind `WorkbookScriptsRegistryService`.
4. **The switch.** The reducer tests of the runtime (`workbook_scripts.test.ts`, the planner analysis, the registry
   service) pass against the adapter, then the app switches and the TypeScript reducer goes.

## Deciding

The spike goes on to the switch when:

- the reducer tests of the TypeScript runtime pass against the Rust workbook,
- a burst of typing shows no snapshot cost in a profile of the app,
- the core module doesn't grow noticeably,
- the Rust workbook reads clearly better than `workbook_scripts.ts`.

Otherwise the crate goes and [rust_logic.md](rust_logic.md) stands.

## Kept on purpose

- A script that publishes its own declarations changes its catalog, so a script that was just analyzed can look
  outdated once more. The TypeScript reducer behaves the same, a second analysis settles it.
- The base name of a new script comes with the action, the random names stay in TypeScript for now.
- A cloud preview refuses a change with an error, where the TypeScript reducer logs a warning and returns the state.
- `ApplyPlannerAnalysis` exists because the engine of the runs is still TypeScript. Once the workbook plans its runs
  itself, the analyses of the planner are its own and the action goes.
- The promotion of the ephemeral workbook needs the names of the other workbooks, the host calls `promote` after an
  action until a registry of workbooks moves too.
