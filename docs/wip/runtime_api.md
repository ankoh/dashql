# The API between the app and the runtime

Status: decided on 2026-11-15 (see [Decisions](#decisions)). Step 1 is built: the frame (`Runtime`, `JsPlatform`,
`RuntimeStore`, the hooks) with the computations as its first domain, see [Step 1 as built](#step-1-as-built). Step 2
is built: the connections with their query histories, the query executor and the saves of connections, see
[Step 2 as built](#step-2-as-built). Measured on `a9029aa2f` (the progress model of queries in Rust). It takes as
given what is landing next to it: the progress model (landed), the streaming of results through the host (result data
never lives in the core module, every Arrow table is a host object by handle, the computations' tables included) and
the handle table of the host with the effects `release`, `close` and `abort`. Numbers marked as measured come from
that commit; the rest are estimates.

The logic of DashQL is Rust (see [core_runtime.md](core_runtime.md)), but every step of the port kept the TypeScript
API of the runtime so that the app didn't change. That left three layers between the app and the Rust state: the
bindings of each state class, a wrapper of `@ankoh/dashql-core` for each, and the adapters of
`packages/dashql-runtime` that build the old TypeScript objects again. This document drops that constraint. It derives
the API from what the app and the command line tool actually use: one `Runtime` object of the module, one platform
object of TypeScript that the runtime calls, and a thin store with hooks that read views directly. It replaces the
steps of [runtime_object.md](runtime_object.md) that keep the app unchanged and step 6 of
[runtime_projection.md](runtime_projection.md); the decisions on views, tsify, FlatBuffers by key and revisions stay.

## Where it stands

### The layers (measured)

| Layer | Where | Lines |
|---|---|---|
| The crate | `packages/dashql-core-runtime/src` | 39,925, tests 17,772 |
| Bindings of the runtime classes | `packages/dashql-core-wasm/src`, all but `lib.rs` (1,389) and `shell.rs` (424) | 8,942 |
| of which the classes with their hosts | `computations.rs`, `connection.rs`, `workbook.rs`, `workbook_run.rs`, `query_executor.rs`, `catalog_loader.rs`, `storage_writer.rs`, `query_history.rs`, `restore.rs`, `connection_setup.rs`, `connection_persistence.rs`, `workbook_format.rs` | 5,765 |
| of which the views | `*/view.rs`, `views.rs` | 3,177 |
| Wrappers of `@ankoh/dashql-core` per class | `computations.ts`, `connection.ts`, `workbook.ts`, `query_history.ts`, `query_executor.ts`, `storage_writer.ts`, `restore.ts`, `connection_setup.ts`, `catalog_loader.ts`, `connection_persistence.ts` | 1,730 of 4,618 |
| The runtime package | `packages/dashql-runtime/src` without tests, 183 files | 23,656 |

The bindings implement the host traits of the crate seven times (`grep "impl .*Host for"`: the storage writer, the
restore, the executor, the catalog loader, the setups, the runs, the computations), over eight host interfaces of
the declarations. The crate has ten host traits: `Host`, `HttpHost`, `StorageHost`, `RestoreHost`, `OAuthHost`,
`SetupHost`, `ExecutorHost`, `CatalogLoaderHost`, `RunHost`, `ComputeHost`.

The files of the runtime package by what happens to them under the new seam (measured lines, the classification is
a judgment per file):

| Group | Files | Lines |
|---|---|---|
| A. Glue: registries, services, adapters, `UpdateQueue`, `runtime.ts` | 32 | 7,343 |
| B. State types and action unions that the app reads | 19 | 3,055 |
| C. Domain helpers the app calls (labels, connector infos, params, script names, inputs, catalog SQL) | 29 | 2,230 |
| D. Storage, import and export over the workbook format of the core | 16 | 1,824 |
| E. Setups and auth flows of Trino and Salesforce in TypeScript | 4 | 496 |
| F. Connector clients and host channels (Hyper over gRPC and HTTP, Salesforce API, embedded Hyper) | 11 | 1,718 |
| G. Platform: storage backends, result cache, embedded Hyper, logger, http, OAuth, Node | 35 | 3,983 |
| H. UI formatting (`arrow_formatter.ts`, the profile symbols) | 3 | 742 |
| I. Command line support (lint, format, the journal of sessions) | 6 | 651 |
| J. The revision cache (`store/projection.ts`) | 1 | 73 |
| K. Utilities | 14 | 606 |
| L. Test helpers | 13 | 935 |

The largest files of group A: `computation_native.ts` 1,316, `query_executor_service.ts` 733, `storage_writer.ts`
541, `workbook_native.ts` 442, `workbook_execution.ts` 426, `connection_native.ts` 396.

### How the app uses the runtime (measured)

A scan with the type checker of TypeScript over the sources of `packages/dashql-app/src` (466 files without tests and
`src/tests`) and `packages/dashql-cli/src` (17 files): every import from `@ankoh/dashql-runtime/*` and
`@ankoh/dashql-core`, every property read whose object has a type declared in the runtime or in `dashql-core-js`,
every object literal whose `type` is an action symbol of the runtime, every call of a hook declared in the binding
modules.

- **Imports.** 276 of 466 files import the runtime or the core: 790 import declarations from 130 modules, 568
  distinct names. 172 files import a domain module (`workbook/`, `connections/`, `query/`, `compute/`), 133 a module
  of the platform or the utilities (the logger alone in 74 files).
- **The services are reached in 9 files.** Only the binding modules touch the `Runtime` object:
  `workbook_scripts_registry.tsx`, `connection_registry.tsx`, `query_executor.tsx`, `use_workbook_execution.ts`,
  `catalog_loader.tsx`, `connection_persistence.tsx`, `script_selection.ts`, `computation_registry.tsx` and
  `runtime_provider.tsx` (816 lines with `store_hooks.ts`). The seam of services is already narrow; the seam of state
  is wide.
- **The state is read in 110 files.** 4,683 property reads on runtime types in all; the state objects:

| Type | Reads | Files | Fields read, by count |
|---|---|---|---|
| `ConnectionState` | 267 | 52 | connectionId 118, params 41, connectionHealth 35, connectorInfo 22, details 13, name 10, paramsDraft 6, queriesActive 5, catalog 5, queriesFinished 4, queriesActiveOrdered 3, instance 2, 3 more |
| `WorkbookScripts` | 220 | 28 | workbookId 105, scripts 45, instance 21, scriptOrder 20, scriptRefs 15, name 7, workbookMetadata 3, attachments 2, native 2 |
| `ScriptData` | 206 | 22 | scriptKey 64, scriptSession 30, annotations 23, fileName 20, latestQueryId 20, editorUpdate 17, connection 16, pendingDiff 10, analysisOutdated 3, statistics, externalChanges, latestResultQueryId |
| `TableComputationState` | 176 | 12 | 22 fields: dataFrame 23, tableId 19, dataTable 16, columnGroups 16, filterTable 15, version 13, tasks 11, dataSearch 10, ... |
| `QueryExecutionState` | 125 | 27 | status 33, queryId 28, resultTable 20, queryMetadata 9, metrics 9, traceId 8, error 4, latestProgressUpdate 3, servedFromCache 3, cacheDeleted 3, 3 more |
| `ConnectionRegistry` | 39 | 23 | connections 39 |
| `WorkbookScriptsRegistry` | 27 | 9 | workbookScriptsMap 25, invalidWorkbooks 2 |
| `ConnectionReferences` | 18 | 9 | workbooksOf 11, connectionsOf 6 |
| `StorageWriter` | 43 | 11 | 19 methods: flush, pause, resume, write, deleteWorkbook, the pauses of a workbook, statistics, external changes |

  22 files take a `WorkbookScripts` as a prop and 15 a `ScriptData`. The app reaches into the core through the state:
  `WorkbookScripts.instance` (21 reads) and `ScriptData.scriptSession` (30 reads) hand it the `DashQL` instance and
  the shared `ScriptSession` of a script.
- **Hooks.** 42 hooks of the binding modules, 189 calls in 68 files. The most used: `useConnectionRegistryStore` 17
  calls in 14 files, `useConnectionReferences` 12 in 11, `useScriptSelection` 10, `useConnectionRegistry` 9,
  `useQueryExecutor` 9 in 8, `useConnectionById` 8, `useComputationRegistry` 7 in 6, `useWorkbookExecution` 7,
  `useConnectionAllocator` 7, `useWorkbookScriptsRegistry` 6. Counted by name including the injected dependencies of
  components: `useWorkbookScripts` appears in 6 files, `useWorkbookScriptsRegistry` in 8, `useConnectionRegistry`
  in 12, `useQueryExecutor` in 12.
- **Actions.** 77 action literals in 31 files, 40 kinds: `SET_SCRIPT_TEXT` and `DELETE_COMPUTATION` 8 each,
  `SET_PENDING_CONNECTION` 4, `SET_SCRIPT_VIS_SPEC`, `ACCEPT_PENDING_DIFF`, `REJECT_PENDING_DIFF`,
  `ANALYZE_OUTDATED_SCRIPT`, `CREATE_SCRIPT`, `SET_CROSS_FILTERS` 3 each, the rest one or two. One of them is the
  keystroke (`UPDATE_FROM_PROCESSOR` in `script_editor.tsx`). The tests have 136 in 37 files.
- **Services and commands.** `executor.execute` and `cancel` through `useQueryExecutor` and `useCancelQuery` (13
  files), `watchProfile` (1), the runs through `useWorkbookExecution` (9 files) and `runWorkbookScript` (4), the saves
  through `useConnectionSave` and `useConnectionSaver` (5), the catalog queue (1), the setups through
  `createTrinoSetup`, `createSalesforceSetup`, `SetupRun` and `performHealthCheck` (6 files), the restore and the
  merges of a single workbook (`app_setup.ts`, `workbook_import_provider.tsx`, `workbook_workbench_sidebar.tsx`), the
  imports and exports (`readWorkbookBundleFromZip`, `exportWorkbookAsUrl`, `exportWorkbookAsSharedZip`,
  `exportWorkbookAsSharedTables`, `planConnectionImport`, `importWorkbookQueryResults`: 7 files), the storage writer
  directly (11 files), whole-registry writes through the setters (`app_setup.ts`, `workbook_import_provider.tsx`).
- **Derived state in the app.** The checked script references (`script_reference_reports.ts`), the dataflow graph
  (`dataflow_graph.ts`) and the inputs (`deriveWorkbookInputs`) are computed in TypeScript from the whole workbook,
  cached in maps of the module by a signature of every script (`workbookAnalysisSignature`).

### Hot and rare

- **Per keystroke.** The editor applies the event to the shared session and dispatches `UPDATE_FROM_PROCESSOR`
  (`script_editor.tsx`). The reduction costs 128 µs median, its projection 25 µs (the release module, "Typing" in
  core_runtime.md). Then the registry store notifies every subscriber of the whole registry: the 6 files with
  `useWorkbookScripts` and the 8 with `useWorkbookScriptsRegistry` render again, with every child that takes the
  workbook or a script as a prop. Each mounted editor and the dataflow compute the signature of every script of the
  workbook again. The reads on this path are the `ScriptData` fields of the editor (`scriptSession`, `editorUpdate`,
  `pendingDiff`, `externalChanges`, `analysisOutdated`, `connection.catalog`), of a row of the feed and of its header
  (`annotations`, `latestQueryId`, `statistics`, `fileName`).
- **Per result batch and progress update.** `useQueryState` subscribes to the store of all connections and searches
  every connection for its query on every change; the 12 files with `useConnectionRegistry` render on every event of
  every query, the internal queries of the computations included.
- **Rare.** Everything else: the settings of connections (params, drafts, details, saves, setups), the sidebar and the
  lists, imports and exports, the cloud pages, the restore.

### The command line tool (measured)

13 of 17 files import the runtime; 12 of them only for lint, format, the reports and the journal of sessions, which
don't use the `Runtime`. `run_command.ts` alone uses it, in about 30 places: `createRuntime` with the Node platform,
`catalogLoader.stop`, `restoreSingleWorkbook` and the two merges of the restored workbook into the registries,
`connections.dispatch` with the setup actions of Hyper and Trino around `connectEmbeddedHyper`,
`setupTrinoConnection` and `performHealthCheck` (its `prepareConnection`, with the credentials of the environment),
`executor.execute`, `cancel` and `flushCacheWrites`, `runWorkbookExecution` with `scriptRunServices` and its
`ScriptRunEvent` listener, the `latestProgressUpdate` of the active queries for its live view, the result cache, and
`destroy`. The CLI needs: a headless runtime on a platform, restoring one workbook folder, preparing a connection
with credentials that are never written, a run with a listener of script events, the progress of the queries of the
run, and a flush at the end.

## The API

### Principles

- **One object each side.** `Runtime` is the only class of the module that the app holds next to the classes of the
  core (`DashQL`, `ScriptSession`, `Catalog`). `RuntimePlatform` is the only object the runtime calls.
- **Reads are views by revision.** The app reads plain objects with generated types (serde-wasm-bindgen, tsify), with
  FlatBuffers by key inside and handles of host objects where a value is JavaScript. Nothing is hydrated into the
  objects of today.
- **Writes are one dispatch, async work are commands.** The 40 kinds of actions the app dispatches are synchronous
  changes of state: one generated union. The work that takes time and returns a result has a method each.
- **Derived state is Rust.** Lists, references, labels, the dataflow, the inputs and the index of the workbooks of a
  connection are computed by the runtime and read as slices with revisions, never derived again in the app.
- **Result data stays with the host.** A view names an Arrow table by its handle; the platform holds the table.

### The Rust side

```ts
// Generated by wasm-bindgen and tsify, re-exported by @ankoh/dashql-core as `Runtime`
export class Runtime {
    static create(core: DashQL, platform: RuntimePlatform): Runtime;

    // Reads, from the store only (never per render)
    takeChanges(): ChangeSet;
    views<K extends ViewKind>(kind: K, ids: ViewId<K>[], known?: KnownKeys<K>): ViewOf<K>[];

    // Writes
    dispatch(target: Target, action: Action): Outcome;
    reportEditorUpdate(workbookId: string, scriptKey: number, update: Uint8Array): void;

    // Commands
    executeQuery(connectionId: string, args: QueryArgs): QueryTicket;   // { queryId, done: Promise<QueryOutcome> }
    cancelQuery(queryId: number): Promise<void>;
    watchProfile(queryId: number, shown: boolean): void;
    runWorkbook(workbookId: string, options: RunOptions, events?: (event: ScriptRunEvent) => void): Promise<RunOutcome>;
    runScript(workbookId: string, scriptKey: number, options: RunScriptOptions): Promise<RunOutcome>;
    stopRun(workbookId: string): Promise<void>;
    setupConnection(connectionId: string, options: SetupOptions): Promise<SetupOutcome>;
    cancelSetup(connectionId: string): void;
    refreshCatalog(connectionId: string, force: boolean): void;
    saveConnection(connectionId: string, params: ConnectionParams | null, retry: string[] | null): Promise<SaveOutcome>;
    restore(progress?: (progress: RestoreProgress) => void): Promise<RestoreOutcome>;
    restoreWorkbook(source: StorageSource): Promise<RestoreOutcome>;
    importWorkbook(archive: HandleId, plan: ImportAnswers | null): Promise<ImportOutcome>;
    exportWorkbook(workbookId: string, format: ExportFormat): Promise<HandleId>;
    storage(command: StorageCommand): Promise<void>;                   // flush, pause, resume, settle, by workbook
    flush(): Promise<void>;
    destroy(): Promise<void>;

    // The core objects the editor and the composer use
    scriptSession(workbookId: string, scriptKey: number): ScriptSession;
    catalog(connectionId: string): Catalog;
}
```

- **`Runtime` owns the state and the services** as in [runtime_object.md](runtime_object.md): the workbooks, the
  connections with their histories, the computations, the storage writer, the executor, the catalog loader, the
  setups, the run service; the services call each other in Rust. The seven hosts and their JSON events go.
- **The typed `views`.** `ViewKind`, `ViewOf<K>` and `ViewId<K>` are one interface map emitted from Rust
  (`typescript_custom_section` next to the tsify declarations), the binding takes and returns
  `unchecked_param_type`/`unchecked_return_type` with it. One crossing per kind and flush.
- **Domain methods where the usage says so.** A command exists for every async service call site of the app and the
  CLI above (15 commands, 17 with `flush` and `destroy`), not per state change. A generic `dispatch` would type their
  results poorly and the callers await them; a method per action would add 40 methods for changes that differ only in
  their payload.
- **`reportEditorUpdate`** stays a typed method for the hot path, with the packed update of the editor and no
  object crossing. Applying the events of the editor in the workbook (`ApplyEditorEvent`) replaces it later.
- **`scriptSession` and `catalog`** return the shared handles of the core. The editor, the composer and the format
  commands keep using the core API on them (30 and 21 reads today go through these two).

### Views

| Kind | Id | Holds | Read by (measured groups) | Hot |
|---|---|---|---|---|
| `workbookList` | root | ids in sidebar order, names, metadata, invalid workbooks with their reasons | sidebar, cloud sidebar, names, labels, pickers (9 files read `workbookScriptsMap`) | no |
| `workbook` | id | name, metadata, script keys in feed order, refs by file name, attachments, cloud link, the connections it uses, whether held by a run | page, feed, dashboard, commands, share and save overlays (28 files) | when scripts come and go |
| `script` | (workbook, key) | key, file name, connection id, annotations, latest and result query ids, analysis outdated, the editor update, staged diff, visualization and statistics as FlatBuffers by key, external changes | editor, feed row, headers, diagnostics, dashboard card (22 files) | per keystroke |
| `workbookDerived` | id | the checked references per script, the dataflow graph, the inputs with their controls | editors, dataflow, input strip | when an analysis changes their result |
| `connectionList` | root | ids by type, the listed ones with ordinals and labels, health per id | pickers, labels, connection lists (23 files read `connections`) | no |
| `connection` | id | connector, name, params, draft, details, health, status, catalog revision, catalog updates, the queries as `[id, revision]` active and finished, the workbooks that use it, the save state | settings, overview, badges (52 files) | per query event |
| `query` | id | status, metadata, metrics, error, the progress (FlatBuffer by key, landed in `a9029aa2f`), the handle of the result table, cache fields | feed footer, result view, progress panel, query viewer (27 files) | per progress update |
| `computation` | table id | column groups, tasks with progress, filters, orderings, searches, the handles of its tables and data frames | result view, toolbar, details, charts (12 files) | per task step |
| `run` | workbook id | state, kind, held | 9 files of `useWorkbookExecution` | per statement |
| `storage` | root | statistics, paused workbooks, pending keys, external changes | storage view, native sync (11 files) | no |

- **Revisions nest without bubbling.** A workbook lists its script keys, not their revisions: a keystroke changes the
  script slice and leaves the workbook slice alone. The change set names every changed slice.
- **Names stay where they can.** A view keeps the field name the app reads today (`connectionId`, `params`,
  `connectionHealth`, `scriptOrder`, `latestQueryId`, ...), so the migration of reads is mostly a change of the type
  and of the hook. Maps become arrays or records, `Date`s milliseconds, symbols strings of the generated unions,
  JavaScript objects handles.
- **Handles.** A result table, a data frame's table, a channel, an error with its stack: an id of the handle table
  of the platform. The app resolves it with `useTable(handle)` or `platform.handles.get(handle)`.

### Actions

```ts
type Target = { workbook: string } | { connection: string } | { computation: number } | 'app';
type Action = { kind: 'setScriptText'; value: SetScriptText } | { kind: 'createScript'; value: CreateScript } | ...;
type Outcome = { ok: true; id?: string | number } | { ok: false; error: DetailedError };
```

- **Generated.** A Rust enum with `#[serde(tag = "kind", content = "value", rename_all = "camelCase")]` and tsify. It
  is adjacently tagged: `{ kind, value }` mirrors `{ type, value }` of today, and serde reads the tag first without
  buffering, which internally tagged enums need (the restore views had to read their variants one by one).
- **Applied at once.** The action changes the state in Rust in the call and returns its outcome; a failed action leaves
  the state as it was. Creating a workbook, a script or a connection returns its id in the outcome.
- **The app-level actions** (`'app'`): create and delete a workbook, delete an invalid one, allocate a connection,
  promote the ephemeral workbook. The setters that replace whole registries (`useWorkbookScriptsRegistrySetter`,
  `useConnectionRegistrySetter`) go: their two callers become `restoreWorkbook` and `importWorkbook`.

### The change set and the flush

- After its first change the runtime calls `platform.changed(urgent)` once. Progress and result batches are not
  urgent; everything else is.
- The store flushes at the end of the task when urgent, before the next frame otherwise: `takeChanges()` returns the
  changed slices as `[kind, id, revision]` and the effects on handles (`release`, `close`, `abort`); the store applies
  the effects to the handle table, reads `views(kind, ids)` once per changed kind, shares each view with the previous
  one (`share` of `projection.ts`) and notifies the subscribers of the changed slices only.
- A read right after `dispatch` sees the last flush, as today. A command resolves after the flush that holds its
  change; `flush()` flushes at once for the CLI and the tests.

### The platform object

The runtime calls one TypeScript object. Its members are the I/O halves of the ten host traits, grouped; what the
hosts are told today about registries (`report`, `update_started`, `update_finished`, `workbook_changed`, `state`,
`dispatch`, `changed` of the computations) goes, those are changes of the runtime now.

```ts
export interface RuntimePlatform {
    handles: HandleTable;                       // register, get, release; close and abort by handle
    clock: { now(): number; sleep(ms: number): Promise<void> };
    log(level: LogLevel, message: string, details: [string, string][]): void;
    crypto: { sha256(bytes: Uint8Array): Promise<Uint8Array>; randomUuid(): string };
    http: { fetch(request: HttpRequest, operation: HandleId): Promise<HttpResponse> };
    storage: StorageBackend;                    // the workbook files, scripts, attachments, manifest, connection files
    oauth: OAuthPlatform;                       // flow info, loopback, redirect page
    channels: {                                 // the embedded Hyper, gRPC through the native proxy, test channels
        connect(request: ChannelRequest, operation: HandleId): Promise<HandleId>;
        open(channel: HandleId, query: ChannelQuery, operation: HandleId): Promise<HandleId | null>;
        next(stream: HandleId): Promise<ChannelMessage>;
        cancel(stream: HandleId): Promise<void>;
        profileDetail(stream: HandleId, shown: boolean): void;
    };
    tables: {                                   // Arrow tables by handle, result data never enters the module
        begin(schema: Uint8Array): HandleId;    // an IPC schema message
        append(table: HandleId, ipc: Uint8Array): void;
        finish(table: HandleId): TableSummary;  // rows, bytes, for the views
    };
    compute: ComputePlatform | null;            // import a table by handle, create from SELECT, query, drop, cancel a run
    resultCache: ResultCachePlatform | null;    // lookup, read and write by handle, touch, retain, release, mounts
    extensions: { loadSpec(extension: string): Promise<string> };
    connections?: { prepare(connectionId: string): Promise<ConnectionParams | null> };   // the CLI's credentials
    changed(urgent: boolean): void;
}
```

- **One implementation per platform**, not per service: `createBrowserPlatform`, `createElectronPlatform` and
  `createNodePlatform` build it from the pieces of today (`StorageBackend`, `HttpClient`, `OAuthFlow`, the embedded
  Hyper, `QueryResultCache`, the logger). The five copies of clock, timers, log and fetch in the adapters and the seven
  host objects of the bindings become this one object and `host.rs` of the bindings (`JsPlatform`, implementing all
  host traits once).
- **The platform owns the handle table and the tables.** The streaming of results that is landing hands the bytes of
  Hyper over HTTP through untouched and the pages of Trino and of client functions as IPC one at a time, into
  `tables.append`. The compute database imports and creates its tables by handle; the derived tables of the
  computations are handles too.
- **Late pieces.** The compute database and the API of Salesforce arrive after the settings: the platform reads them
  when called (`compute` is a getter), as `setComputeDatabase` and `setSalesforce` do today.

### React

```ts
const runtime = useRuntime();                                   // the facade: dispatch, commands, the platform
const workbook = useView('workbook', workbookId);               // WorkbookView | null, re-renders with that slice only
const script = useView('script', [workbookId, scriptKey]);
const connections = useView('connectionList', ROOT);
const table = useTable(query?.resultTable ?? null);             // arrow.Table from the handle table
const dispatch = useDispatch({ workbook: workbookId });         // (action) => Outcome
```

- **`RuntimeStore`** (TypeScript, `store/runtime_store.ts`): a `RevisionCache` per kind keyed by id, subscriptions per
  `(kind, id)`, the flush above. `useView` is `useSyncExternalStore` over one slice; `getSnapshot` reads the cache,
  never the module. A slice keeps its object while its revision doesn't move.
- **Generic hooks, typed by the map of views.** `useView`, `useViews`, `useDispatch`, `useTable`, `useRuntime`. Named
  hooks stay only as one-line aliases where a name helps (`useWorkbook`, `useScript`, `useConnection`, `useQuery`,
  `useComputation`, `useRun`).
- **The app keeps its own stores** (the script selection, focus, view modes) on `Store` of `utils/store_hooks.ts`,
  which moves into the app.

### Per keystroke

- The editor applies the event to the session (unchanged) and calls `reportEditorUpdate` in its update listener. The
  workbook applies the update as today (the reduction of 128 µs median), marks the script slice and the
  `workbookDerived` slice if the result of the derivation changed, and hands its effects to its writer in Rust.
- The flush is two crossings at most: `takeChanges` and the view of the script, plus the derived view when it moved.
  The projection budget is today's 25 µs median; the typing benchmark of core_runtime.md runs with every step and
  must not exceed it.
- The subscribers of that script render. The workbook, the other scripts, the sidebar and the connections don't. The
  app no longer computes `workbookAnalysisSignature` over every script per keystroke and per editor.

## What the app changes

By the numbers above, in the order of their width:

| Change | Measured extent | How |
|---|---|---|
| Imports of state types and helpers move to the views and to the app | 172 files import a domain module | codemod of import paths; the types are generated |
| Reads of state objects become reads of views | 110 files, 4,683 reads | same field names where possible; the typecheck (`:tsc_typecheck_test`) lists every miss |
| Whole-registry and whole-workbook subscriptions become slices | 14 files with the two workbook hooks, 12 with `useConnectionRegistry`, 14 with `useConnectionRegistryStore`, 22 and 15 files that take a workbook or a script as a prop | by hand: a parent passes ids, a child reads its slice |
| Action literals become the generated union | 77 sites in 31 files, 136 in 37 test files | codemod: a table from the 40 symbols to their kinds, `{ type: X, value }` to `{ kind: 'x', value }` |
| Service calls become commands | 9 binding modules (816 lines), 6 setup files, 7 import and export files, 11 storage writer files | the binding modules are rewritten (to about 200 lines), the call sites keep their hook names |
| Derived state comes from views | `script_reference_reports.ts`, `dataflow_graph.ts`, the inputs | the module caches go |
| Core access through the state | 21 reads of `instance`, 30 of `scriptSession` | `runtime.core`, `runtime.scriptSession(...)` |

- **Mechanical where it can be.** Views keep the names of the fields the app reads, the codemod of actions is a
  table, the codemod of imports is a table. ts-morph scripts in the scratch of the agent, not in the repo.
- **Type-driven.** Each domain step replaces the type of the state with its view in one commit; the typecheck of the
  app fails at every read that changed shape, and the step is done when it passes.
- **Not mechanical:** splitting components that take a whole workbook into a parent that passes ids and children
  that read their slice. That is where the re-renders go, and it is limited to the workbook page, the feed, the
  dashboard and the dataflow (the 22 and 15 prop files).
- **Tests.** 43 test files of the app read state types and 21 call the registry hooks; they move with their domain.
  `TestRuntime` creates a runtime over a test platform.

## What goes and what stays

### `packages/dashql-runtime` (23,656 lines measured, about 11,900 remain, estimate)

| Group | Today (measured) | After (estimate) | What remains |
|---|---|---|---|
| A. Glue | 7,343 | 800 | the facade `createRuntime` (120), `RuntimeStore` with `projection.ts` (300), the platform builder of the module (300), the handle table (80) |
| B. State types and actions | 3,055 | 300 | the types of the platform interfaces; everything else is generated |
| C. Domain helpers | 2,230 | 1,300 | connector infos and descriptors, labels for the UI, script formatting, input controls; catalog SQL and names move to Rust or to views |
| D. Storage, import, export | 1,824 | 900 | zip.js, Parquet through the embedded Hyper, the folders of migrations; the planning is in the format already, the orchestration moves into the commands |
| E. Setups in TypeScript | 496 | 150 | the mock of the Salesforce auth flow for the app config |
| F. Connector clients | 1,718 | 1,718 | the channels of the platform |
| G. Platform | 3,983 | 3,983 | |
| H, I, J, K | 2,072 | 2,000 | |
| L. Test helpers | 935 | 750 | a test platform replaces the fakes per service |

The logic that is the runtime itself is the facade, the store and the platform builder, about 800 lines; the rest of
the package is the platforms (browser, Electron, Node), the connector clients, the UI helpers and the support of the
CLI. The glue tests of the package (about 7,200 lines measured: `workbook_scripts`, the registries,
`connection_state`, `query_executor_service`, `catalog_loader_service`, the runs, `script_run`, the computations,
`runtime`, `storage_writer`, `app_state_loader`) move to the tests of the crate on the fake host or go.

### `packages/dashql-core-js` (4,618 lines measured)

- **Goes, about 2,100:** the wrappers per class (1,730 measured), `workbook_format.ts` (289 measured) once the imports
  and exports are commands, the factories of the runtime classes in `api.ts` (about 80).
- **Added, about 60:** the re-exports of `Runtime`, the views, the actions and the map of view kinds.
- **Stays:** the core (`api.ts` without the factories, the dataflow, lookups, tokens, batches, `flatbuffer_view.ts`).

### `packages/dashql-core-wasm` (10,755 lines measured)

- **Goes, about 5,000:** the eleven classes of the runtime with their seven hosts, their JSON events and their effect
  types (5,765 measured), less what `runtime.rs` keeps.
- **Added, about 2,000:** `runtime.rs` (the class, `dispatch`, `views`, `takeChanges`, the commands, about 700),
  `host.rs` (`JsPlatform` over one object, about 700), the action union with its conversions (about 400), the list
  and derived views (about 300).
- **Stays:** the views (3,177 measured, they are the contract), `lib.rs`, `shell.rs`.
- Net about −3,000 lines of bindings. The crate gains the runtime object, the run service and the derived slices,
  about +2,500 lines and +1,500 of tests (the estimates of runtime_object.md plus the derived slices).

## Migration

One domain at a time, end to end: the Rust surface, the platform calls, the hooks, the components and the deletion
of its glue in the same step. Each step keeps the app, the CLI and the tests green and is one agent's work; the steps
run in this order. The first step pays for the frame (the object, the platform, the store); every later step
deletes more than it adds.

0. **Prerequisites, landing now.** The streaming of results through the host and the handle table with the three
   effects. No step below starts before both are on main.
1. **The frame and the computations** (done, see [Step 1 as built](#step-1-as-built)). `Runtime` with the change set, `views`, `dispatch` and the computations (the
   smallest consumer set: 12 files, the views exist); `JsPlatform` with `clock`, `log`, `handles`, `tables`,
   `compute`; `RuntimeStore`, `useView`, `useDispatch`, `useTable`. The shell of Hyper keeps its own bindings for now
   (decision 3). Deletes `computation_native.ts`, `compute/computations.ts`, `data_frame.ts`, `analyze_table.ts`,
   `computation_tasks.ts`, most of `computation_state.ts` and `computation_types.ts`, `computations.rs` of the bindings
   and its wrapper. TypeScript about −2,000, +700.
2. **Connections, query histories, the executor and the saves** (done, see [Step 2 as built](#step-2-as-built)). The connections enter the runtime with their
   histories; the executor reports into them; the platform gets `http`, `channels`, `resultCache`, `crypto`;
   `executeQuery`, `cancelQuery`, `watchProfile`, `saveConnection`. The 52 files of `ConnectionState`, the 27 of
   `QueryExecutionState`, the shell's history. Deletes `connection_native.ts`, the registry service and state,
   `connection_persistence_service.ts`, `query_executor_service.ts`, `query_history_native.ts`,
   `tracked_query_execution.ts`, `shell_query_execution.ts`, `connection_state.ts` and `query_execution_state.ts` but
   their UI parts, and the bindings `connection.rs`, `query_history.rs`, `query_executor.rs`,
   `connection_persistence.rs`. TypeScript about −3,000, +200. The workbooks read their catalogs through
   `runtime.catalog(id)` until step 4.
3. **The setups and the catalog loader** on the connections and the executor of the runtime; the platform gets
   `oauth` and `extensions`; `setupConnection`, `cancelSetup`, `refreshCatalog`. The 6 setup files and the settings
   pages. Deletes `connection_setup_native.ts`, `connection_setup_cancellation.ts`, `health_check.ts`,
   `catalog_loader_service.ts`, the Trino and Salesforce setup wrappers, `connection_setup.rs` and
   `catalog_loader.rs`. TypeScript about −900.
4. **The workbooks, the storage writer and the restore.** The workbooks enter the runtime with the index of their
   connections, the promotion and the fan-out of catalog updates; the writer and the restore are services of it; the
   platform gets `storage`; `reportEditorUpdate`, `restore`, `restoreWorkbook`, `storage`; the derived slices replace
   the module caches of the app. The 28 and 22 files of the workbook and the script, the editor, the CLI's restore.
   Deletes `workbook_native.ts`, the registry service and state, `workbook_scripts.ts` but its UI parts,
   `storage_writer.ts`, `app_state_loader.ts`, `workbook_script_connections.ts`, `UpdateQueue`, `workbook.rs`,
   `storage_writer.rs`, `restore.rs`. TypeScript about −2,800, +200. The typing benchmark gates it.
5. **The runs.** The run service of runtime_object.md; `runWorkbook` with its listener of script events, `runScript`,
   `stopRun`, the `run` slice; the CLI runs on it with `connections.prepare` of its platform. Deletes
   `workbook_execution_service.ts`, `workbook_execution.ts` but the event types, `script_run.ts`, `rerun_query.ts`,
   `workbook_run.rs`. TypeScript about −900.
6. **Imports and exports.** `importWorkbook`, `exportWorkbook` over the format of the core and the `tables` and
   `storage` of the platform. Deletes the orchestration of `workbook_import.ts`, `workbook_export.ts`,
   `workbook_connection_import.ts`, `workbook_query_results.ts`, `workbook_format.rs` and its wrapper. TypeScript about
   −1,100.
7. **The rest.** `runtime.ts` becomes the facade; the old hook names, `storeWithoutRuntime` and the binding modules
   of the app go.

### Step 1 as built

The frame and the computations, built on `665945575` (the handle table), before the streaming of results landed.

- **`Runtime`** (`packages/dashql-core-wasm/src/runtime.rs`, `DashQL.createRuntime(platform)`): `takeChanges()`,
  `views(kind, ids, known?)`, `dispatch(target, action)`, the command `analyzeTable(tableId, table, options)` and
  `destroy()`. The map of view kinds is emitted next to the declarations (`RuntimeViews`, `ViewKind`, `ViewId<K>`,
  `ViewOf<K>`, `KnownKeys<K>`), `views` is declared generic through an interface that merges into the class. A kind
  joins with a variant of `Target`, its actions in `RuntimeAction`, its slices in `takeChanges` and a branch of
  `views`. `Target` is `{ computation: number }`, the change set `{ changes: { kind, id, revision | null }[], effects }`
  with the effects `release` and `abort`, the outcome of a dispatch `{ ok, changed, error }`. Every argument is a
  `Ts<T>` or a checked number: a wrong type, an unknown kind or an id that is no integer throws a JS error, the module
  stays usable (`runtime.test.ts` of `dashql-core-js`).
- **The actions of the computations are requests**, not the 18 actions of the TypeScript reducer: `deleteComputation`,
  `orderBy`, `histogramFilter`, `mostFrequentValueFilter`, `clearCrossFilters`, `setResultSearchPattern`,
  `requestFilteredColumnAggregation`. The service of the crate derives the tasks from the state and runs them, the
  scheduler of the app, the queue of its filters, its search effects and the column search on the data frames went
  into `compute/service.rs` (core_runtime.md, "The tasks of the computations").
- **`JsPlatform`** (`src/host.rs`): `Host` and `ComputeHost` once, over the `RuntimePlatform` object with `clock`,
  `log`, `handles`, `tables` (`begin`, `append`, `finish` and `read`: the analysis reads its result by handle) and
  `compute`, a getter. It collects the effects on handles and calls `changed(urgent)` once until the host takes the
  changes, again when a change becomes urgent: a dispatch is urgent, a step of a task is not. Every member is reached
  through `Reflect` and caught, a missing or throwing member fails the call with a `HostError`.
- **`RuntimeStore`** (`packages/dashql-runtime/src/store/runtime_store.ts`): a `RevisionCache` per kind, subscriptions
  per slice, the flush at the end of the task when urgent and before the next frame otherwise, one `views` call per
  changed kind, `share` with the previous view, the effects applied to the handle table. `CoreRuntime`
  (`core_runtime.ts`) builds the platform object, owns the handle table and the store, attaches the runtime of the
  module when the core arrives and has the commands (`analyzeTable`, `deleteComputation`, `flush`, `destroy`).
- **Hooks** (`packages/dashql-app/src/runtime/runtime_hooks.tsx`): `useView(kind, id)`, `useDispatch(target)`,
  `useTable(handle)`, `useCoreRuntime()`, with the aliases `useComputation`, `useComputationDispatch` and
  `useDeleteComputation`. `useRuntime()` stays the TypeScript facade of the services until step 7, `CoreRuntime` is its
  `coreRuntime`. `StandaloneCoreRuntime` gives the shell of Hyper a runtime of the module of its own, so no bindings
  of the computations remain besides `Runtime` (decision 3 holds for the history of the shell).
- **Field names.** The view keeps the names of `TableComputationState`, which is now its alias; tables are handles
  (`dataTable`, `filterTable.dataTable`, ...), the column groups keep `{ type, value }` with the kinds as strings, the
  versions are `{ data, filter }`, the cross filters an array. The app formats the summaries for the plots from the
  view and the tables (`resolveSummaries`), the plot cells read the objects they read before.
- **The handle table** of the platform is the one of `CoreRuntime`; the connections keep `handlesOf(instance)` until
  step 2 moves them onto the platform.

Measured (`git diff --numstat`, sources without tests):

| Package | Deleted | Added | Tests deleted | Tests added |
|---|---|---|---|---|
| `dashql-runtime` | 2,463 | 770 | 2,364 | 214 |
| `dashql-core-js` | 328 | 58 | 187 | 88 |
| `dashql-core-wasm` | 1,325 | 807 | | |
| `dashql-core-runtime` | 14 | 508 | 1 | 167 |
| `dashql-app` | 756 | 371 | 482 | 264 |

TypeScript lost 3,547 lines and gained 1,199 without tests, Rust gained 508 in the crate (the requests of the app) and
lost 518 in the bindings. The release module shrank from 12,990,508 to 12,842,126 bytes (−1.1%), gzip (`-9`) from
3,582,389 to 3,529,794 bytes (−1.5%): the class `Computations` with its readers of the actions of the host is larger
than `Runtime`, the platform and the requests.

What step 2 needs of the frame: a `Target` and the actions of the connections, the `connection` and `query` kinds in
`takeChanges` and `views` (the revisions of `taken` per kind), `http`, `channels`, `resultCache` and `crypto` on the
platform and in `JsPlatform`, the handle table of the connections on the platform instead of `handlesOf(instance)`,
and the executor reporting into the runtime instead of the `analyzeTable` command (`QueryExecutorService` calls
`coreRuntime.analyzeTable` and `deleteComputation` until then).

### Step 2 as built

The connections, their query histories, the query executor and the saves of connections, built on `d8ab9080f` (step 1).

- **`Runtime` holds the connections** (`packages/dashql-core-wasm/src/runtime/connections.rs`): the registry of the
  crate (`connections::registry::ConnectionRegistry`) keeps the connections in the order they were registered, the
  histories without a connection (the shell) by name, and hands out the ids of all queries from one sequence; a query
  id names a query of one history. It applies the rules of the TypeScript registry: a connection that workbooks use is
  never deleted and switches its connector only while one workbook uses it, the embedded Hyper is never deleted. The
  workbooks that use a connection come from the host (`setConnectionReferences`, from the registry of the workbooks)
  until the workbooks are part of the runtime (step 4).
- **The unions.** `Target` gained `{ connection: string }`, `{ history: string }` and `'app'`. `RuntimeAction` gained the
  actions of a connection (`setDraft`, `discardDraft`, `commitParams`, `rename`, `setQueryResultCaching`,
  `deleteConnection`, `resetConnection`, `switchConnectorType`, `relationsTouched`, `updateCatalog`,
  `catalogUpdateRegisterQuery`, `catalogUpdateFinished`, `restoreCatalogUpdates`, `replaceFunctionScriptText`), one
  `setupStep` for every step of a setup and of a health check by the name of the action of its connector
  (`setup_action_from_json` of the crate reads it, the inverse of `setup_action_json`; a channel crosses as a handle
  that the connection takes), the lifecycle of the queries that the host runs itself (`trackQuery`, `querySending`,
  `queryRunning`, `queryProcessingResults`, `queryProcessedResults`, `querySucceeded`, `queryFailed`,
  `queryCancelled`, `queryReceivedAllBatches`, `queryCacheDeleted`), `createHistory`, `dropHistory`, and the actions
  of the runtime (`createConnection`, `setConnectionReferences`). The outcome names what an action created (`id`: the
  id of a connection or of a query).
- **The views.** `connectionList` (`'root'`: the connections in order with whether they are listed and their ordinal,
  the ids by connector), `connection` (by id: the fields with the names the app reads, `connectionId`,
  `connectionStatus`, `connectionHealth`, `connectorType`, `params`, `paramsDraft`, `details` with the channel as a
  handle, `catalogUpdates`, `catalogRelationEntryId`, `catalogNameDefaults`, `metrics`, the queries as
  `queriesActiveOrdered`/`queriesFinishedOrdered`, `queriesRunning` (the active queries that are not the SQLFrame
  queries of computations), `workbooks` and `save`), `query` (by id: the text, the metadata with the planned
  statement as opaque JSON, the trace, the status, the metrics in milliseconds, the error, the latest progress with
  its structured progress, the result table as a handle) and `history` (by name: the queries of a history without a
  connection). A connection changes when it is set up, saved or refreshed and when a query starts or finishes; the
  progress and the batches of a query change only the slice of the query. The store passes the keys of the structured
  progress that it holds (`known` of the `query` kind) and keeps the payloads that don't cross again.
- **The executor reports into the runtime.** `executeQuery(connectionId, args, request, failure, events)` registers the
  query in the history of its connection right away and returns `{ queryId, done }`; it runs once the host described
  where it runs (the request: the target of a channel that the module speaks or of the host, the cache key, whether it
  publishes and analyzes its result). The host of the executor is Rust (`runtime/queries.rs`): the events go into the
  history, the parts of a result into a table of the platform (`tables.open`, `push`, `finish`), the analysis of a
  result onto the computations of the runtime (`analyze_table` with a handle of its own, `handles.duplicate`), a result
  replaces the computation of the earlier result of its owner in Rust, and the relations that a statement touched come
  from the core (`touched_relations`) and go into the connection. `cancelQuery`, `watchProfile(queryId, shown)`,
  `setProgressLayout`, `flushCacheWrites`, `queryProgressRecording` and `followQueryProgress` complete it.
  `QueryPlatform` of the runtime package (`query/query_platform.ts`) is the host half: it describes the request from the
  view of the connection and the channel of its handle, runs the queries of the channels that the module doesn't speak
  (`channels` by query: `open`, `next`, `cancel`, `profileDetail`) and keeps the query result cache over the compute
  database (`resultCache`: `lookup`, `read`, `touch`, `write`).
- **`JsPlatform` grew** `http` (`fetch` and `abort` by id), `channels`, `resultCache`, `crypto.randomUuid`,
  `cancelSetup`, `handles.get` and `handles.duplicate`, `tables.open` and `tables.push`, and a target for the log. The
  hosts of the executor and of the history of the shell in the bindings went. The handle table of the connections is
  the one of the platform (`CoreRuntime.handles`), `handlesOf(instance)` went.
- **The saves run in the runtime.** `setStorageWriter(writer)` gives the runtime the writer of the module; every change
  of a connection schedules what storage keeps of it (`connection_writes` of the crate) and a created active
  connection writes its entry. `saveConnection(connectionId, params)` writes the app manifest, commits the params and
  writes the copies of the workbooks, `retrySave(connectionId, workbookIds)` writes the copies again; the view of the
  connection shows the save (`save: { saving, outcome }`).
- **The catalog loader and the setups** (step 3) stay services with hosts of their own on the runtime: the loader
  follows the connections of the runtime (`CatalogLoader.follow(runtime)`) and applies the start and the end of an
  update as actions of the runtime; a setup applies its steps through `setupStep`, `runtimeActionOf` of
  `connections/connection_state.ts` maps the action symbols of the setups (and the few of the settings) to the union.
  The restore adopts its connections into the runtime (`adoptRestoredConnection`).
- **The shell** tracks its queries in a history without a connection of its `StandaloneCoreRuntime`
  (`{ history: 'shell-<n>' }`, at most 100 queries), the computations of its results run on the same runtime; the
  bindings `QueryHistory` and `QueryExecutor` went.
- **TypeScript.** `CoreRuntime` (`core_runtime.ts`) has the commands (`execute`, `cancel`, `watchProfile`,
  `createConnection`, `dispatchConnection`, `saveConnection`, `retrySave`, `catalog`, `channel`, `allocateId`) and
  reads the connections of the last flush as a registry (`registry()`, a map of the views that keeps its identity until
  a connection changes) or as the runtime holds them now (`connection`, `connections`, `query`). `ConnectionState` and
  `QueryExecutionState` are the generated views with the params typed as the app's params; the reducer, the
  projection and the registry service went. The store has subscriptions to a kind (`subscribeKind`, `all`).
- **Hooks** (`connection_registry.tsx`, `query_executor.tsx`, `connection_persistence.tsx` of the app):
  `useConnection(id)`, `useQuery(id)`, `useQueryProgress(query)`, `useQueryResultTable(query)`, `useQueryReader()`,
  `useAllQueries()`, `useScriptConnectionOf()`; the hooks of today keep their names over the runtime
  (`useConnectionById`, `useConnectionRegistry`, `useConnectionDispatch`, `useQueryExecutor`, `useQueryState`,
  `useConnectionSave`). `useQueryState` reads the slice of one query instead of scanning every connection.
- **Changed on purpose.** The progress and the batches of a query render only the components of that query, a
  component that lists the queries of a connection renders when one starts or finishes. A switched connection keeps its
  place in the order of registration. A query that needs the analysis without a compute database fails in its history
  instead of before it. A query that is cancelled before the host described it ends as cancelled without a request.
  The connections of a native workbook that changed on disk join the runtime when they are read and leave it again if
  the reload is declined. The error of a query keeps its message and its details (`queryErrorDetails`), not the target
  of the log. A catalog update keeps the message of its error, not the error object.

Measured (`git diff --numstat`, sources without tests):

| Package | Deleted | Added | Tests deleted | Tests added |
|---|---|---|---|---|
| `dashql-runtime` | 2,947 | 1,359 | 2,346 | 645 |
| `dashql-core-js` | 658 | 56 | 445 | 428 |
| `dashql-core-wasm` | 1,676 | 2,512 | | |
| `dashql-core-runtime` | 65 | 514 | | |
| `dashql-app` | 434 | 580 | 743 | 789 |

TypeScript lost 4,039 lines and gained 1,995 without tests, Rust gained 1,285 net (the registry in the crate, the
executor host and the connections of the runtime object in the bindings, the unit tests of the crate counted as
source). The release module grew from 12,848,617 to 13,142,874 bytes (+2.3%), gzip (`-9`) from 3,537,360 to 3,626,774
bytes (+2.5%): most of it is the reader of the roughly 40 variants of `RuntimeAction` (serde) and the host of the
executor; folding the lifecycle actions of a query into one variant is the next saving.

What step 3 needs: the setups move into the runtime as commands (`setupConnection`, `cancelSetup`) on the connections
and the executor that are there now; `runtimeActionOf` with the action symbols of the setups, `SetupRun` and the host of
`connection_setup.rs` go. The catalog loader becomes a service of the runtime on the registry it follows already
(`refreshCatalog`), its host with `updateStarted`, `updateFinished` and `runQuery` goes; it runs its metadata queries
on the executor of the runtime instead of `CoreRuntime.execute`. The platform gets `oauth` and `extensions` (the specs
of the client functions, which `QueryPlatform` loads today when it describes a call).

### The order

Steps 2 and 4 are the wide ones. Step 4 can go before 2 and 3 if the editor matters more than the connections
(decision 7); it then reads the connections through their bindings for a while.

## Risks

- **Re-entrancy into one Rust object.** Every platform call happens inside a method of `Runtime`. The bindings take
  `&self` with the state in `RefCell`s and never call the platform inside a borrow; `changed` only schedules. A
  platform method that calls back into the runtime synchronously gets the wasm-bindgen error "recursive use", not a
  panic. A test per platform member calls back into the runtime.
- **Flush timing.** Actions apply at once, views lag until the flush. A component that dispatches and reads in the
  same handler reads the previous state, as today. Tests that relied on the order of the `UpdateQueue` move to
  `flush()` or to awaiting the command.
- **The width of the app diffs.** Steps 2 and 4 change about 50 and 40 files each; the codemods carry the actions and
  imports, the typecheck finds the reads, the splitting of components is by hand. Render counts change (fewer);
  tests that count renders need care.
- **Two copies of `@ankoh/dashql-core` in the browser bundle.** Views are plain objects and the generated enums are
  numbers, so they cross either copy. The only classes are `Runtime` and the classes of the core; nothing uses
  `instanceof` on them. A `Runtime` created by one copy is used only through the facade of the runtime package.
- **Wasm size.** The module is about 12.96 MB optimized, 3.57 MB gzipped (measured in runtime_projection.md). The
  seven hosts and the JSON events go, the action union with its `Deserialize` and the runtime object come. Measured
  with every step, like the views.
- **Panics.** A panic traps the module and every workbook and connection with it. The rules of the crate hold:
  `Result` on input, no indexing, no unwraps.
- **The editor and the shared session.** The editor keeps writing to a session that the workbook owns. A session
  handle that outlives its script must fail, not read freed memory; the handle is dropped with the slice.
- **The CLI.** It runs on the same commands; its live view reads the `query` slices of the run. Its tests against the
  fake Trino (`//packages/dashql-cli:test`) gate step 5.

## Decisions

Taken on 2026-11-15.

1. **Dispatch and commands.** One generated union for the 40 synchronous actions plus 15 commands. The actions are
   where the app is wide, the commands where it is narrow.
2. **Field names of the views.** The views keep the names the app reads today, the migration of the components is
   mechanical (codemods driven by tables and the type checker).
3. **The shell of Hyper.** It keeps its own bindings (`QueryHistory`, `Computations`) for now; a runtime of the shell
   is decided later.
4. **The editor.** The shared `ScriptSession` with `reportEditorUpdate` stays, `ApplyEditorEvent` comes later.
5. **Hooks.** Generic `useView(kind, id)` with one-line aliases.
6. **The package.** `packages/dashql-runtime` splits into a runtime of about 800 lines (the facade, the store, the
   platform builder) and a `dashql-platform` package with the platforms, the clients and the CLI support.
7. **The order.** Computations, connections, setups, workbooks: the glue of the connections and queries goes first and
   the workbooks build on them.
8. **Derived slices.** The references, the dataflow and the inputs move into Rust with step 4, which ends the renders
   of every subscriber per keystroke.
9. **Reading after a dispatch.** Reads see the last flush, per frame; urgent changes such as the editor's flush per
   task.

## Decided against

- **Keeping the TypeScript API of the registries and services.** It is what built the three layers; the app's
  services are reached in 9 files, the cost of changing them is small.
- **Hydrating views into the objects of today.** It keeps the adapters (groups A and B) and their identity rules.
- **A generic dispatch for async work.** The results of queries, runs, setups and saves differ; a method each types
  them.
- **Subscriptions to whole registries.** They are why a keystroke renders every workbook consumer and a progress
  update every connection consumer.
- **Result data in the core module.** Decided with the streaming: tables are host objects by handle; this supersedes
  "Result tables" and slice 4 of runtime_object.md.
- **Reading the module in `getSnapshot`.** A crossing per read; the store holds the views of the last flush.
