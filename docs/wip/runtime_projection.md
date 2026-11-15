# Projecting the runtime state

Status: a proposal, nothing is built. Measured on `0e3d4fc94`.

The state of the app lives in the crate `dashql_core_runtime` inside the core module (see
[core_runtime.md](core_runtime.md)): the workbooks with their scripts, the connections with their query histories,
the computations. The React app reads it through hand-written adapters that build JavaScript objects and keep their
identity. This document proposes how the app reads that state with less hand-written code: types generated from Rust,
one projection for all slices, and the registries in Rust.

## Recommendation

- **Generate the types with ts-rs** from Rust view types (`Serialize` + `TS`), into one file of
  `@ankoh/dashql-core` next to the generated FlatBuffer code. The hand-written JSON of the bindings and the
  hand-written interfaces of `dashql-core-js` go.
- **One projection.** Every slice has a revision. A parent view lists its children as `[id, revision]`, the
  runtime of TypeScript keeps one cache per kind keyed by id and revision, shares unchanged sub-objects
  structurally, and resolves the JavaScript objects that Rust names by id through one handle table.
- **Effects on handles.** Rust names JavaScript objects by handle and asks for three things: release, close,
  abort. The per-state effect code goes.
- **The registries move into Rust** as one `Runtime` object of the module. The store becomes a cache over the
  revisions of the runtime, with subscriptions per slice. `UpdateQueue` only schedules notifications.
- **Six steps**, each green and shape-preserving for the consumers until the last. About 2,500 to 3,000 lines of
  TypeScript go, the per-keystroke cost must not rise.

## What the adapters do today

Line counts of `wc -l`; the split into categories is by reading and counts whole functions, so it is approximate.

| File | Lines | Types | Identity | Projection | Effects and handles | Action mapping | Rest |
|---|---|---|---|---|---|---|---|
| `workbook/scripts/workbook_native.ts` | 404 | 40 | 90 | 95 (annotations 30) | 85 (storage writes 70, sessions) | 60 (create, adopt, connection args) | 35 |
| `workbook/scripts/workbook_scripts.ts` | 640 | 200 (25 action symbols) | | | 30 (`WorkbookScriptsEffects`) | 180 (`reduceWorkbookScripts`, `settle`, guards) | 230 selectors |
| `workbook/scripts/script_types.ts` | 171 | 75 | | | | | 95 helpers |
| `connections/connection_native.ts` | 503 | 45 | 60 (`Part`, revisions) | 200 (`detailsProto`, catalog updates, queries) | 155 (channels, tasks, query records, tables, effects) | | 40 |
| `connections/connection_state.ts` | 578 | 200 (40 action symbols, enums) | | | 30 | 300 (`reduceConnectionState`, `reduceSetupStep`) | 50 create, destroy |
| `compute/computation_native.ts` | 1,379 | 30 | 60 (`reuseArray`, `projectedTasks`) | 450 (`tableState`, `aggregate`, `trackedTask`, analyses) | 200 (object table, `settle`, effects) | 400 (`call`, values to Rust) | 200 `ComputeHost` |
| `compute/computation_types.ts` | 534 | 384 | | | | | 150 |
| `compute/computation_state.ts` | 247 | 119 | | | | 65 (20 action symbols) | 60 |
| `query/query_execution_state.ts` | 630 | 220 | | | | 320 (`reduceQueryAction` of the shell) | 90 metrics |

The bindings add two hand-written mirrors of the same shapes:

- `packages/dashql-core-wasm/src/{workbook,connection,computations,storage_writer}.rs` build their JSON with 68
  `json!` calls and parse arguments by hand: about 520 lines in `*_json` and `parse_*` functions plus the inline
  `snapshot()`, `queries()` and `properties()` methods.
- `packages/dashql-core-js/src/{workbook,connection,computations,storage_writer,restore}.ts` declare the same
  shapes again as interfaces: about 660 lines.

What the categories hold:

- **Type definitions.** The JSON shapes three times (Rust `json!`, `dashql-core-js`, the app types) and the enums
  twice: `ConnectionStatus`, `ConnectionHealth`, `QueryExecutionStatus`, `TaskStatus` and `CatalogUpdateTaskStatus`
  are `#[repr(u8)]` in Rust and numeric TypeScript enums with 555 member references in 111 files of the app and the
  runtime. The bindings cast the numbers across.
- **Identity keeping.** Each adapter does it differently: by revision per script (`projected`), by `JSON.stringify`
  of the source per part (`Part<T>` of the connection), by `reuseArray` and `sameVersion` per field (the
  computations), and by mutating maps in place (`queriesActive`, `restoreCatalogUpdates`). The last breaks the rule
  that a snapshot handed to `useSyncExternalStore` never changes.
- **Projection.** Mostly reshaping: milliseconds to `Date` (`toDate` on 13 metrics of a query), the details of a
  connection into the protobuf shape of the JSON schema (`detailsProto` adds placeholders for missing OAuth steps),
  `Immutable.List` of statistics, `Map`s of queries. The annotations of a script are derived from its editor update.
- **Effects and handles.** The JavaScript objects that Rust knows by id: script session handles, channels, abort
  controllers of catalog updates, queries and data searches, `LoggableException`s with their key values, the
  structured progress of a query, result tables (`arrow.Table`), data frames and the decoded Arrow tables of the
  computations. Each adapter has its own id maps and its own forgetting rules.
- **Action mapping.** A `switch` per state from symbol actions to typed method calls, with guards that the Rust side
  repeats (unknown script keys, refused actions of a cloud preview).

Findings:

- **Effects make a round trip.** `writeWorkbookEffects` turns the `WorkbookEffect`s of the Rust workbook into tasks
  of the storage writer, which is Rust as well (`storage/writer.rs`). With the registries in Rust they never leave
  the module.
- **Selectors repeat Rust.** `workbookScriptList`, `workbookConnectionCopies` and `workbookScriptListWrite` rebuild
  what `properties().scriptList` already returns; `freeWorkbookName` is `free_workbook_name`.
- **Crossings grow with the scripts.** A projection of a workbook calls `properties()`, `scriptKeys()` and
  `scriptRevision(key)` per script, then `scriptSnapshot`, `scriptStatistics` and maybe more for each changed one.
- **Every keystroke replaces the registry.** `replaceWorkbookScriptsInRegistry` copies both maps, so every
  subscriber of `useWorkbookScriptsRegistry` (8 files) renders again, and the followers of `runtime.ts` run.

## Generated types

The shapes that cross are views, not the state: the state holds `Rc<ScriptSession>`, catalogs and Arrow arrays.
Each slice gets a view type in `dashql_core_runtime::view` with `#[derive(Serialize, TS)]` and a function
that builds it (`Workbook::view`, `ConnectionState::view`, ...). The views are the contract, the snapshot tests of
the crate cover them (`tests/snapshots/runtime_views/`). Actions and effects get `Deserialize` and `Serialize`
the same way.

### Options

| | ts-rs | specta | tsify | typeshare | JSON Schema |
|---|---|---|---|---|---|
| How | derive, `export_to_string` at build time | derive, exporter crate | derive, declarations in the wasm-bindgen `.d.ts` | CLI parses the Rust sources | schemars derive, then `json-schema-to-typescript` |
| Serde attributes | yes (`serde-compat`, default) | yes | yes | yes | yes |
| Numeric TS enums | `#[ts(repr(enum))]` keeps the discriminants | no | no, string unions | no | numbers without names |
| Adjacently tagged enums (`{type, value}`) | yes | yes | yes | partly | yes |
| Depends on | `ts-rs`, `thiserror` | `specta`, `specta-typescript` (2.0 release candidates) | `wasm-bindgen` in the crate that derives | a CLI binary | `schemars`, the existing Node tool |
| Bazel | a `rust_binary` and a `genrule` | the same | nothing extra | a CLI from crate_universe, a rule | two genrules, a schema in between |
| Output | one `.ts` file | one `.ts` file | inside `dashql_core.d.ts` | one `.ts` file | a schema and a `.ts` file |

- **tsify** keeps no file of its own, but it needs `wasm-bindgen` in the crate that derives. `dashql_core_runtime`
  is sans-IO and tested natively, the derives would have to sit on copies in `dashql-core-wasm`. It emits string
  unions for enums, so the 555 enum references would change.
- **specta** has been a release candidate for a long time and splits its exporters into crates that move with it.
- **typeshare** parses source text, which misses types from macros and generics, and adds a tool to Bazel.
- **JSON Schema** fits the files that users write by hand (`proto/json/dashql/app_workbook.json`), where the schema is
  the source. For in-memory views the Rust type is the source, and a schema between Rust and TypeScript is a third
  artifact to keep in sync.

### ts-rs, recommended

- **Crate universe.** `crate_core.spec(package = "ts-rs", version = "=12.0.1", features = ["no-serde-warnings"])`
  in `bazel/crates/core.MODULE.bazel`; `serde-compat` is its default. The lockfile follows the repin rule of the
  repository.
- **Derive without a feature.** The views derive `TS` on every platform. Nothing in the module calls the impls, the
  optimizer drops them. A feature would need a second `rust_library` of the crate with other `crate_features`; it is
  the fallback if the size check of step 1 fails.
- **The generator.** `//packages/dashql-core-runtime:runtime_ts_gen`, a `rust_binary` that prints
  `export_to_string` of the root types (views, actions, effects) into one file; a `genrule` writes `runtime.ts`.
  `//packages/dashql-core-js:compile_inputs` copies it to `src/gen/runtime.ts` like `dashql_buffers_ts_gen`, and
  `src/runtime_types.ts` re-exports it. The file is a build output, nothing is checked in, no file sits next to
  another.
- **Names.** Structs take `#[serde(rename_all = "camelCase")]`; ts-rs follows serde. Actions take
  `#[serde(tag = "type", content = "value", rename_all = "SCREAMING_SNAKE_CASE")]`, which is the `VariantKind` shape
  of the app. `Option<T>` is `T | null`.
- **Enums keep their numbers.** Unit enums are `#[repr(u8)]` with
  `#[ts(repr(enum), rename_all = "SCREAMING_SNAKE_CASE")]` and serialize as their number through a small
  `serialize_repr!` macro of the crate (no `serde_repr`). The generated `enum ConnectionHealth { NOT_STARTED = 0, ... }`
  replaces the hand-written one with the same names and values. Step 1 checks that the pinned ts-rs does this.
- **Numbers.** ts-rs maps `u64` and `i64` to `bigint`, `JSON.parse` returns numbers. The views use three newtypes
  with a hand-written `TS` impl of `number`: `Id`, `Revision` and `Millis` (epoch milliseconds). They also name the
  units.
- **What it replaces.** About 560 of the 660 lines of interfaces in `dashql-core-js`, and the `json!` builders and
  `parse_*` functions of the bindings (about 520 lines), against about 250 lines of view structs.

## One projection

### Views and revisions

- **A view per slice.** `WorkbookView`, `ScriptView`, `ConnectionView`, `QueryView`, `ComputationView`. A view
  holds plain fields, ids of handles, and the keys of the buffers that cross apart (below).
- **Revisions nest.** Every slice has its revision from `next_revision`. A parent lists its children as
  `[id, revision]`: the workbook its scripts in feed order, the connection its active and finished queries (as
  `queries()` does today), the computations their tables. A parent that only lists children doesn't change its own
  revision when a child changes; the list is read with the parent.
- **One crossing per kind.** `views(kind, ids)` returns the views of many slices as one JSON array. A keystroke reads
  the workbook (with its list) and one script: two crossings, independent of the number of scripts.

Rust could also report the changed `(kind, id, revision)` of every action. With nested revisions the projection
needs that only for the roots: the `Runtime` of step 4 keeps a set of changed workbooks, connections and
computations and hands it over with `takeChanges()`. Below the roots the lists of the parents say what changed.

### The cache

`packages/dashql-runtime/src/store/projection.ts`, about 200 lines:

```ts
interface SliceCache<V> {
    /// The view of a slice, read again when its revision moved
    get(id: string | number, revision: number): V;
    /// Forget the slices that are not in the list
    retain(ids: Iterable<string | number>): void;
}
```

- **Structural sharing.** `share(prev, next)` walks a fresh view against the cached one: equal primitives stay,
  arrays and objects whose members all stay return the previous object. It costs the size of the changed slice,
  never of the workbook, and replaces `Part<T>`, `reuseArray`, `sameVersion` and the in-place maps.
- **Lists of children.** `projectChildren(prev, refs, cache)` returns the previous array or map when every child
  kept its object and the order is the same, as `NativeWorkbook.project` does for `scripts`, `scriptRefs` and
  `scriptOrder` today.
- **Views are immutable.** Nothing writes into a projected object. An older state reads as it was, an action acts on
  the latest Rust object as today.

### Handles

One `HandleTable` per runtime (`register(object) -> Id`, `get(id)`, `release(id)`) replaces the id maps of the three
adapters. Rust keeps the handle id where it keeps the JavaScript object today (a query holds the handle of its abort
controller and its result table, a connection the handle of its channel). The effects become three verbs:

| Effect | Today |
|---|---|
| `{ type: 'release', handle }` | `releaseResultTable`, `releaseChannel`, `releaseDataFrame`, forgetting tasks and query records |
| `{ type: 'close', handle }` | `closeChannel` |
| `{ type: 'abort', handle, reason }` | `abortCatalogUpdates`, `stopQueries`, `abortComputation`, `abortDataSearch` |

`invalidateCatalogBatch` and `cancelSetup` stay named effects, they act on services, not on handles. A data frame
is released through its `DataFrameRegistry`, a session handle through `destroy`: the kind of a handle names its
release.

### Hydration

A view carries ids and numbers, the consumers read objects and `Date`s. Until the consumers move (step 6), a
hydrator per kind turns a view into the object of today:

- it resolves handles (`resultTable`, `cancellation`, `details.value.channel`, `scriptSession`),
- turns `Millis` into `Date`, arrays into the `Map`s and `Immutable.List` the consumers expect,
- is memoized by the identity of the view (`WeakMap<View, Hydrated>`), so shared views give shared objects without
  a second mechanism.

`detailsProto` and its placeholders go: the view of the details is the shape the app reads, decided once in Rust.

### What stays special

- **Editor updates by key.** `ScriptView.editorUpdateKey` names the analysis; the packed `EditorUpdate` crosses only
  when the key changed, and the update that the editor reported is taken as it is (`knowUpdate`). Per keystroke this
  is the largest object, it must not be unpacked twice.
- **Packed FlatBuffers.** Staged diffs, compiled visualizations and processing statistics cross as packed buffers,
  read when their key moved.
- **Arrow tables.** A table of the computations crosses as IPC once per table id and is decoded lazily; the
  formatters (`ArrowTableFormatter`) are built with the decoded table. Result tables of queries stay JavaScript
  handles until the query executor moves.
- **The compute host.** `NativeComputations` implements `ComputeHost` (import, create, query, drop, cancel). That is
  I/O, not projection, and stays until the compute database is a host of the runtime.

### Per keystroke

Today: 0.6 to 0.9 ms per reduction, 0.2 to 0.3 ms of it projection (see "Typing" in core_runtime.md). With the
projection above a keystroke costs two crossings and one `JSON.parse` of a workbook list and a script view, one
`share` over about 15 fields, and no FlatBuffer unpacking. A view serialized from a struct with `serde_json::to_string`
is cheaper than building a `serde_json::Value` with `json!`. The check of every step: the Node measurement of
core_runtime.md, the projection must not exceed today's.

## The registries in Rust

`Runtime`, a class of the module created with `DashQL.createRuntime`, holds what the registries hold in TypeScript:
the workbooks by id, the connections by id, the computations, the invalid workbooks, and the index of the workbooks
of a connection, derived in Rust instead of being maintained by hand (`reindexWorkbookScriptConnections`).

- **What moves with them.** The promotion of the ephemeral workbook needs the names of the other workbooks
  (a quirk of "Kept on purpose" goes). `CATALOG_DID_UPDATE` reaches every workbook of a connection inside Rust
  (`applyConnectionWorkbookScriptsAction`). The decisions of `ConnectionPersistence` read the connection before and
  after inside the module. The `WorkbookEffect`s go to the storage writer of the runtime without leaving the module.
- **Dispatch.** `runtime.dispatch(action)` takes the generated action union as JSON. Actions that carry JavaScript
  objects carry handles: the caller registers the channel, the table or the abort controller first. Actions on the
  hot path stay typed methods: `reportEditorUpdate` with its packed buffer, the batches of a result stream.
- **Constants stay.** `SET_SCRIPT_TEXT` and the other action constants become string constants of the generated
  names; the call sites don't change, the uses of `action.type.description` do.
- **The store is a cache.** `RuntimeStore` holds the slice caches and the roots, and subscriptions per slice:
  `useWorkbook(id)`, `useScript(workbookId, key)`, `useConnection(id)`, `useQuery(connectionId, queryId)`,
  `useComputation(tableId)`. A keystroke notifies the subscribers of one workbook and one script, not every
  subscriber of the registry. The registry objects of today (`WorkbookScriptsRegistry`, `ConnectionRegistry`) are
  projections of the roots, rebuilt when the roots or their membership change.
- **`UpdateQueue`.** Rust applies an action once, in call order, and a failed action leaves the state as it was; the
  queue no longer guards that. Step 4 keeps the queue as it is, the actions apply in its flush and the projection
  runs once per flush instead of once per action. Applying an action at once and queueing only the notification
  (after the task, or before the frame for the progress of a stream) is a decision of its own: a caller that reads
  the store right after a dispatch would see the new state, and the tests show where that matters.
- **Direct writes go.** The 27 calls of `store.update` and the setters of the registries (allocate, delete, restore,
  invalid workbooks) become methods of the runtime.
- **Re-entrancy.** A listener may dispatch while the store notifies. The runtime notifies after its borrow ended,
  like the services of the host do; a dispatch inside a borrow is a wasm-bindgen "recursive use" error, not a
  panic, and a test covers it.
- **The followers.** The catalog loader and the runs follow the changed roots of `takeChanges()` instead of every
  new registry object.

## Migration

Each step keeps the app and the tests green, the steps up to 5 keep the objects that the consumers read.

1. **Views and generated types.** View structs with `Serialize` and `TS`, actions and effects with `Deserialize`.
   The bindings serialize views instead of `json!`; the JSON keeps its shape, which a test of the bindings compares
   against the old output before the old builders go. `dashql-core-js` re-exports the generated types and the
   enums. Gone: about 560 lines of TypeScript interfaces, about 520 lines of Rust JSON code. Added: about 250
   lines of view structs, the generator target. Checks: the enum mapping of the pinned ts-rs, the size of the
   optimized module.
2. **Handles and the three effects.** `HandleTable`, Rust keeps handle ids, the effects become release, close and
   abort. Gone: the id maps and the effect switches of the three adapters, about 250 lines.
3. **The cache and the hydrators.** `projection.ts`, `views(kind, ids)` in the bindings, the parents list their
   children. The connection first (smallest, and its in-place maps go), then the workbook, then the computations.
   `workbook_native.ts` from 404 to about 150 lines, `connection_native.ts` from 503 to about 180, the projection of
   `computation_native.ts` from about 450 to about 150. Added: about 200 lines. Net: about 650 lines gone.
4. **The `Runtime` object.** The registries, the index, the promotion, the fan-out of connection actions and the
   effects to the storage writer in Rust; the store as a cache with subscriptions per slice; the queue as above.
   Gone: `workbook_scripts_registry_state.ts` (226), most of `connection_registry_state.ts` (263),
   `writeWorkbookEffects` (70), the selectors that repeat Rust (about 120), parts of the registry services. About
   600 lines of TypeScript, about 400 lines of Rust added.
5. **Actions through one dispatch.** The generated action unions, string constants, one `dispatch`. Gone: the
   switches of `reduceWorkbookScripts`, `reduceConnectionState`, `reduceSetupStep` and `NativeComputations.call`
   with the value builders, about 900 lines, against about 150 lines of handle registration.
6. **Consumers on views.** Components move to the hooks per slice and read numbers and handle ids; the hydrators
   go kind by kind. The query history of the shell moves to the Rust history, and `reduceQueryAction` (about 320
   lines) goes with it. About 600 lines.

In sum about 2,500 to 3,000 of the about 6,600 lines of the adapters, the type shells, the registries and the
type mirrors of `dashql-core-js`.

## Risks

- **Per keystroke.** The projection is the part of a keystroke that this changes. Step 3 lands only with the Node
  measurement at or below today, and a measurement in the browser (open in core_runtime.md) belongs to it.
- **Wasm size.** Serde derives on about 100 types add code, the deleted `json!` builders take some away. Budget:
  the optimized module grows by at most 2% (about 90 KB); otherwise the `TS` derive goes behind a feature and the
  views lose the fields that no consumer reads.
- **Two copies of `@ankoh/dashql-core`.** The generated types are erased; the generated enums exist in both copies
  with the same numbers, so comparisons hold. The cache and the handle table never use `instanceof` or the classes
  of the package, they go through the instance (`DashQL.createRuntime`, as `createWorkbook` and
  `createComputations` do today). One `Runtime` object per instance makes the problem smaller than one object per
  workbook and connection.
- **Generator limits.** If `#[ts(repr(enum))]` doesn't keep the names and numbers, the enums stay hand-written in
  `dashql-core-js` with a test that compares them with the generated unions of numbers.
- **Semantics of the queue.** Applying actions at once changes what a caller reads right after a dispatch; step 4
  doesn't do it, a later step decides with the tests.
- **Errors lose their stacks.** A `LoggableException` stays a handle until the consumers read `{ message, details }`
  of the view; dropping the handle drops the stack of the JavaScript error.
- **Many consumers.** 73 files read `ConnectionState`, 57 `WorkbookScripts`, 37 `ScriptData`, 31
  `QueryExecutionState`. Step 6 moves them in small batches behind the hydrators, there is no flag day.

## Decided against

- **serde-wasm-bindgen.** Building JavaScript objects field by field through the boundary costs more than one
  `JSON.parse` of a string, and the identity keeping needs a walk anyway.
- **Views as FlatBuffers.** The schemas of `proto/fb` are the contract of the core; the views belong to DashQL and
  change with it (see core_runtime.md). The FlatBuffer path stays for the buffers that the core produces.
- **Serialize on the state types.** The state holds sessions, catalogs and Arrow arrays, and its field names are
  not the contract. The views decide what crosses.
