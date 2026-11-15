# Projecting the runtime state

Status: decided and started. The computations cross as views with generated types, the workbook has the first view
with a FlatBuffer payload (`scriptView`). Measured on `995154de1`.

The state of the app lives in the crate `dashql_core_runtime` inside the core module (see
[core_runtime.md](core_runtime.md)): the workbooks with their scripts, the connections with their query histories,
the computations. The React app reads it through adapters that build JavaScript objects and keep their identity. This
document says how the app reads that state: views as JS objects with generated types, the FlatBuffers of the core
inside them, one projection for all slices, and the registries in Rust.

## Decision

- **Transport: serde-wasm-bindgen.** A view is a Rust struct with `Serialize`. The bindings return it as a JS object
  that `serde-wasm-bindgen` builds directly, no JSON string and no `JSON.parse`. What the host hands over (tasks,
  results, filters) is a view with `Deserialize` and crosses the same way.
- **Types: tsify.** The views derive `Tsify`, the declarations land in the `.d.ts` of wasm-bindgen
  (`dashql_core.d.ts`), and `@ankoh/dashql-core` re-exports them. There is no generator target and no generated file
  of its own. The bindings take and return `tsify::Ts<View>`, which is typed in the declarations and fails with a
  `JsError` instead of a panic.
- **The views live in `dashql-core-wasm`**, next to the bindings (`src/computations/view.rs`, `src/workbook/view.rs`).
  The runtime crate stays free of wasm-bindgen and its types are not the contract.
- **FlatBuffers inside the views.** A packed FlatBuffer of the core crosses as a `Uint8Array` in a view, typed as
  `FlatBuffer<T>` of its root table, read in place with the generated accessors, kept by its key.
- **One projection.** Every slice has a revision. The TypeScript runtime keeps a projection per slice while its
  revision doesn't move (`RevisionCache`) and shares the unchanged parts of a new view with the previous one (`share`,
  `packages/dashql-runtime/src/store/projection.ts`). A handle table resolves the JavaScript objects that Rust names
  by id.
- **The registries move into Rust** as one `Runtime` object of the module. The store becomes a cache over the
  revisions of the runtime, with subscriptions per slice.

## Measurements

Node, the release module (`--config=release`, `-Copt-level=3` and `wasm-opt -O3`), per call over 3,000 calls after
200 warm-up calls. The computation is the analysis of a result with 12 columns (6 `Float64`, 6 `Utf8`) and 500 rows
on the embedded Hyper, with the summaries of all columns: its snapshot is 12,684 bytes of JSON. The workbook has
three scripts, one of them of 40 lines (4,226 characters).

| What crosses | Today | serde-wasm-bindgen |
|---|---|---|
| Computation snapshot, `json!` builders and `JSON.parse` | 207.4 µs | |
| Computation snapshot, a struct through `serde_json::to_string` and `JSON.parse` | 49.1 µs | |
| Computation snapshot, a struct as a JS object (`Serializer::new()`, nulls) | | 45.4 µs |
| Computation snapshot, `Serializer::json_compatible()` | | 44.9 µs |
| Computation snapshot, `Ts::from_rust` of tsify | | 44.5 µs |
| Revision of a computation | 0.14 µs | |
| Workbook properties, 303 bytes of JSON (a `serde_json::Value`) | 5.4 µs | 7.7 µs |
| Script snapshot, 315 bytes of JSON (a `serde_json::Value`) | 2.2 µs | 3.2 µs |
| Projection per keystroke: properties, keys, revisions, the changed script | 17.9 µs | 15.3 µs |
| Editor update of the 40-line script (31,128 bytes): the bytes | 15.8 µs | |
| The bytes and `unpack()` to the object API | 73.0 µs | |
| The bytes and the accessors of the root with 3 fields | 11.2 µs | |

- **Large views get faster.** Most of today's cost is the `json!` builders, not the transport: a struct serialized
  to JSON is four times faster than the `serde_json::Value` of today. A struct as a JS object is as fast as a struct as
  JSON and `JSON.parse`, and saves the string.
- **Small views stay in microseconds.** A `serde_json::Value` as a JS object is slower than `JSON.parse` of its
  string (its keys are no static strings that the serializer caches). Per keystroke both paths cost 15 to 18 µs of
  a reduction of about 130 µs and an analysis of about 190 µs (the release module, a catalog without tables).
- **`json_compatible()` gains nothing.** It serializes maps as objects, the views have no maps. The views use
  `Serializer::new()` with `serialize_missing_as_null`, which tsify sets from `#[tsify(missing_as_null)]`.
- **Unpacking is the cost of a FlatBuffer.** Crossing the bytes of an editor update costs 16 µs, unpacking them to
  the object API another 57 µs. The accessors read the bytes in place.

## Generated types

### tsify

`tsify = 0.5.8` with `default_features = False, features = ["js"]` (wasm-bindgen 0.2.104 or newer, the core pins
0.2.105), `serde-wasm-bindgen = 0.6.5`, `serde_bytes = 0.11.19` and `serde_repr = 0.1.21` in
`bazel/crates/core.MODULE.bazel`. tsify is the maintained crate again, `tsify-next` merged back into it.

- **Names.** The TypeScript name is the Rust name. Structs take `#[serde(rename_all = "camelCase")]`, tagged enums
  `#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]`, which gives the unions of today
  (`{ kind: "ordinal"; ... } | { kind: "skipped" }`). A newtype variant over a struct is an intersection
  (`{ kind: "columnAggregation" } & ComputationColumnTask`).
- **Nulls.** Every view takes `#[tsify(missing_as_null)]`: `Option<T>` is `T | null` and crosses as `null`. The
  serializer follows the config of the root view, the attribute on the nested views keeps their declarations
  right. A field with `skip_serializing_if = "Option::is_none"` is `field?: T` and absent, e.g. `ascending` of an
  ordering, which is then the `OrderByConstraint` of the app as it is.
- **Numbers.** `u64`, `i64` and `usize` are `number`. serde-wasm-bindgen fails a value above 2^53 with an error, the
  binding throws, nothing panics. Ids, revisions and milliseconds stay plain integers, no newtypes.
- **Numeric enums.** A unit enum of the app is a `#[wasm_bindgen]` C-style enum of the module with the names of the
  app as variants (`TASK_RUNNING = 1`, `#[allow(non_camel_case_types)]`). wasm-bindgen declares it as a TypeScript
  `enum` and exports it as a frozen object of the glue, `serde_repr` serializes it as its number, and the views name
  it with `#[tsify(type = "TaskStatus")]`. `TaskStatus` of the computations is done: the hand-written enum of the
  runtime re-exports the generated one, its 73 references in 11 files don't change. `ConnectionStatus`, `ConnectionHealth`,
  `QueryExecutionStatus` and `CatalogUpdateTaskStatus` follow the same way, with explicit discriminants where the
  TypeScript enum counts implicitly.
- **Bytes.** A field with `#[serde(with = "serde_bytes")]` crosses as a `Uint8Array`, copied once out of the memory of
  the module. tsify needs a type override for it (`#[tsify(type = "...")]`).
- **No panics.** The deprecated `into_wasm_abi` and `from_wasm_abi` of tsify panic on a failed conversion and leak.
  The bindings take and return `Ts<T>`, convert with `Ts::from_rust` and `to_rust`, and return `Result<_, JsError>`.

### Where the derives live

The views live in `dashql-core-wasm`, next to the bindings that build them from the state. The alternative was view
types in the runtime with `cfg_attr(target_arch = "wasm32", derive(Tsify))`: the derive expands to wasm-bindgen
code, so the runtime would depend on `tsify` and `wasm-bindgen` on wasm32. In the module crate the views cost a mirror
of the runtime types and a `From` per type, which is where the `json!` builders were. The views of the computations
are 34 types in 900 lines.

### The declarations reach the package

`//packages/dashql-core-js:wasm_assets` copies `dashql_core.d.ts` as before, `computations.ts` re-exports the types
(`export type { ComputationSnapshot, ... } from './wasm/dashql_core.js'`) and the enum
(`export { TaskStatus } from ...`). The runtime and the app import them from `@ankoh/dashql-core`. There is no new
Bazel step.

## FlatBuffers

The payloads of the core keep their schemas in `proto/fb`, the contract of the core. A view carries such a payload
as its bytes and a key:

```rust
#[tsify(type = "FlatBuffer<buffers_editor.EditorUpdate> | null")]
pub editor_update: Option<FlatBufferBytes>,   // #[serde(with = "serde_bytes")] Vec<u8>
```

- **Typed by the root table.** `src/views.rs` of the module declares `FlatBuffer<T> = Uint8Array & { ... }` and
  imports the generated accessors of `src/gen/` into the declarations, so a field reads as
  `FlatBuffer<buffers_editor.EditorUpdate>`.
- **Read in place.** `readFlatBuffer(bytes, root)` of `@ankoh/dashql-core` wraps the bytes in a `ByteBuffer` and
  returns the accessor object of the root table. Nothing is copied, nothing is unpacked; a consumer that needs the
  object API unpacks what it reads.
- **Kept by key.** `FlatBufferCache` holds the accessor object of a slot (e.g. a script) with its key and returns the
  same object while the key doesn't move. The host passes the key it holds (`scriptView(key, known)`), the module
  leaves the bytes of that key out. A per-keystroke view crosses no editor update that the editor reported itself.
- **Proved on the editor update** (`flatbuffer_view.test.ts`): the bytes of the view are the bytes the accessors read,
  the same key crosses no bytes and keeps the object, a new analysis crosses again.

What crosses how:

| Kind | Crosses as | Examples |
|---|---|---|
| The state of DashQL | serde objects of views | workbook, script, connection, query, computation, effects, actions |
| Payloads of the core | FlatBuffers in views, by key | editor updates, staged diffs, compiled visualizations, processing statistics, completions, query profiles |
| Tables | Arrow IPC, once per table id | results, the tables of the computations |

## One projection

### Views and revisions

- **A view per slice.** `WorkbookView`, `ScriptView`, `ConnectionView`, `QueryView`, `ComputationSnapshot` (built).
  A view holds plain fields, ids of handles and the FlatBuffer payloads with their keys.
- **Revisions nest.** Every slice has its revision from `next_revision`. A parent lists its children as
  `[id, revision]`: the workbook its scripts in feed order, the connection its active and finished queries, the
  computations their tables. A parent that only lists children doesn't change its own revision when a child changes.
- **One crossing per kind.** `views(kind, ids)` returns the views of many slices as one array. A keystroke reads the
  workbook (with its list) and one script: two crossings, independent of the number of scripts.

The `Runtime` of the registries keeps a set of changed roots and hands it over with `takeChanges()`. Below the roots
the lists of the parents say what changed.

### The cache

`packages/dashql-runtime/src/store/projection.ts`, built:

- **`RevisionCache<K, V>`.** The projection of a slice by id, built again when its revision moved, with the previous
  projection at hand. `retain(ids)` forgets the slices that went.
- **`share(prev, next)`.** Walks a fresh view against the previous one: equal primitives stay, arrays and plain
  objects whose members all stay return the previous object, typed arrays and class instances compare by identity.
  It costs the size of the changed slice. A part of a view that didn't change keeps its object, and the hydration
  keeps what it built from it by comparing identities.
- **The computations use both.** A computation keeps its state while its revision doesn't move. The state of a changed
  computation keeps its version, its column groups, its tracked tasks, its skipped summaries, its orderings and its
  searches while their parts of the view are the same. The JSON keys of the column groups and of the tracked tasks,
  the conversions of the orderings and of the statistics fields, and `parseContext` went.
- **Views are immutable.** Nothing writes into a projected view. An older state reads as it was, an action acts on
  the latest Rust object as today.

### Handles

One `HandleTable` per runtime (`register(object) -> Id`, `get(id)`, `release(id)`) replaces the id maps of the three
adapters. Rust keeps the handle id where it keeps the JavaScript object today. The effects become three verbs:

| Effect | Today |
|---|---|
| `{ type: 'release', handle }` | `releaseResultTable`, `releaseChannel`, `releaseDataFrame`, forgetting tasks and query records |
| `{ type: 'close', handle }` | `closeChannel` |
| `{ type: 'abort', handle, reason }` | `abortCatalogUpdates`, `stopQueries`, `abortComputation`, `abortDataSearch` |

`invalidateCatalogBatch` and `cancelSetup` stay named effects, they act on services, not on handles.

### Hydration

A view carries ids and numbers, the consumers read objects and `Date`s. Until the consumers move, a hydrator per
kind turns a view into the object of today: it resolves handles, turns milliseconds into `Date`, arrays into the
`Map`s and `Immutable.List` the consumers expect. With `share` it compares the parts of the view by identity and keeps
what it built. `detailsProto` of the connection goes, the view of the details is the shape the app reads.

### What stays special

- **Arrow tables.** A table of the computations crosses as IPC once per table id and is decoded lazily. Result tables
  of queries stay JavaScript handles until the query executor moves.
- **The compute host.** `NativeComputations` implements `ComputeHost` (import, create, query, drop, cancel). Its
  calls get the context as a view (`ComputeCallContext`) and the effects of a task as `ComputationEffect[]`.

### Per keystroke

The projection of a keystroke costs 15 to 18 µs on either transport. With the views of the workbook it costs two
crossings, one `share` over about 15 fields and no FlatBuffer unpacking. The check of every step stays the Node
measurement of "Typing" in core_runtime.md: the projection must not exceed today's.

## The registries in Rust

`Runtime`, a class of the module created with `DashQL.createRuntime`, holds what the registries hold in TypeScript:
the workbooks by id, the connections by id, the computations, the invalid workbooks, and the index of the workbooks
of a connection, derived in Rust instead of maintained by hand (`reindexWorkbookScriptConnections`).

- **What moves with them.** The promotion of the ephemeral workbook, the fan-out of `CATALOG_DID_UPDATE` to the
  workbooks of a connection, the decisions of `ConnectionPersistence`, and the `WorkbookEffect`s to the storage writer
  of the runtime without leaving the module.
- **Dispatch.** `runtime.dispatch(action)` takes the generated action union as a JS object. Actions that carry
  JavaScript objects carry handles. Actions on the hot path stay typed methods: `reportEditorUpdate` with its packed
  buffer, the batches of a result stream.
- **The store is a cache.** `RuntimeStore` holds the slice caches and the roots, with subscriptions per slice:
  `useWorkbook(id)`, `useScript(workbookId, key)`, `useConnection(id)`, `useQuery(connectionId, queryId)`,
  `useComputation(tableId)`. A keystroke notifies the subscribers of one workbook and one script.
- **`UpdateQueue`.** The first step keeps the queue, the actions apply in its flush and the projection runs once per
  flush. Applying an action at once and queueing only the notification is a decision of its own.
- **Re-entrancy.** The runtime notifies after its borrow ended. A dispatch inside a borrow is a wasm-bindgen
  "recursive use" error, not a panic, and a test covers it.

## Migration

Each step keeps the app and the tests green, the steps up to 5 keep the objects that the consumers read.

1. **Views and generated types.** Views with `Serialize` and `Tsify`, the inputs with `Deserialize`, the bindings on
   `Ts<T>`, `@ankoh/dashql-core` re-exports the declarations and the enums. Done for the computations: their JSON
   readers and builders, the hand-written interfaces of `dashql-core-js` and `TaskStatus` went. Next the connection,
   the workbook, the storage writer and the restore (68 `json!` calls left in the bindings of the state, 65 more in
   the format of workbooks).
2. **Handles and the three effects.** `HandleTable`, Rust keeps handle ids, the effects become release, close and
   abort. The id maps and the effect switches of the three adapters go.
3. **The cache and the hydrators.** `projection.ts` is built and the computations use it. Then `views(kind, ids)` in
   the bindings, the parents list their children, the connection (its in-place maps go) and the workbook with its
   FlatBuffer payloads by key (`scriptView` is its first view).
4. **The `Runtime` object.** The registries, the index, the promotion, the fan-out of connection actions and the
   effects to the storage writer in Rust; the store as a cache with subscriptions per slice.
5. **Actions through one dispatch.** The generated action unions, string constants, one `dispatch`. The switches of
   `reduceWorkbookScripts`, `reduceConnectionState`, `reduceSetupStep` and `NativeComputations.call` go.
6. **Consumers on views.** Components move to the hooks per slice and read numbers and handle ids; the hydrators go
   kind by kind. The query history of the shell moves to the Rust history.

### The computations, step 1

| | Deleted | Added |
|---|---|---|
| `dashql-core-wasm/src/computations.rs` (the JSON readers and builders) | 716 | 276 |
| `dashql-core-wasm/src/computations/view.rs` (34 views and their conversions) | | 903 |
| `dashql-core-js/src/computations.ts` (the interfaces, the JSON of the calls) | 395 | 96 |
| `dashql-runtime/src/compute/computation_native.ts` (keys, conversions, the parsed context) | 154 | 96 |
| `dashql-runtime/src/compute/computation_types.ts` (`TaskStatus`) | 5 | 3 |
| `dashql-runtime/src/store/projection.ts` and its test (for every slice) | | 124 |

TypeScript lost 287 lines without the generic projection, Rust gained 463: a view with its `From` takes two lines per
field where a `json!` builder took one, and the inputs are views too. The shapes exist once, in Rust.

## Risks

- **Wasm size.** The views of the computations, their `Deserialize` impls through serde-wasm-bindgen and the editor
  update view grow the optimized module from 12,275,611 to 12,457,717 bytes (+1.5%), gzip from 3,280,244 to
  3,355,769 bytes (+2.3%), 182 KB for 34 views and one FlatBuffer view. The other states have about as many views
  again; the size is measured with every step, and an input that only a test needs goes back to typed arguments.
- **Two copies of `@ankoh/dashql-core`.** The generated types are erased; the generated enums are numbers in both
  copies, so comparisons hold. The cache and the handle table never use `instanceof` or the classes of the package.
- **The declarations import the generated FlatBuffer code** by a relative path (`../gen/dashql/buffers/`). The path
  holds in the sources of the package and in its `dist`; a move of either breaks the types of the FlatBuffer views,
  the typecheck of the package catches it.
- **Semantics of the queue.** Applying actions at once changes what a caller reads right after a dispatch; step 4
  doesn't do it, a later step decides with the tests.
- **Errors lose their stacks.** A `LoggableException` stays a handle until the consumers read `{ message, details }`
  of the view.
- **Many consumers.** 73 files read `ConnectionState`, 57 `WorkbookScripts`, 37 `ScriptData`, 31
  `QueryExecutionState`. Step 6 moves them in small batches behind the hydrators.

## Decided against

- **JSON strings with types from ts-rs.** The first version of this proposal. It needs a generator binary and a
  genrule, maps `u64` to `bigint` (newtypes with hand-written impls), and the string costs a `JSON.parse` that a JS
  object built directly doesn't. ts-rs keeps the names of numeric enums, the C-style enums of wasm-bindgen do that
  too.
- **`into_wasm_abi` of tsify.** Deprecated: a failed conversion panics and leaks. `Ts<T>` is typed the same way.
- **Views as FlatBuffers.** The schemas of `proto/fb` are the contract of the core; the views belong to DashQL and
  change with it. The FlatBuffer path stays for the payloads that the core produces.
- **Serialize on the state types.** The state holds sessions, catalogs and Arrow arrays, and its field names are
  not the contract. The views decide what crosses.
