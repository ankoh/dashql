# The API between the app and the runtime

Status: decided on 2026-11-15 (see [Decisions](#decisions)). Step 1 is built: the frame (`Runtime`, `JsPlatform`,
`RuntimeStore`, the hooks) with the computations as its first domain, see [Step 1 as built](#step-1-as-built). Step 2
is built: the connections with their query histories, the query executor and the saves of connections, see
[Step 2 as built](#step-2-as-built). Step 3 is built: the setups of the connections and the catalog loader, see
[Step 3 as built](#step-3-as-built). Step 4 is built: the workbooks, the storage writer and the restore, see
[Step 4 as built](#step-4-as-built). Step 5 is built: the runs of workbooks, see [Step 5 as built](#step-5-as-built).
Step 6 is built: the imports and exports of workbooks, see [Step 6 as built](#step-6-as-built).
Step 7 is built: one facade over the runtime of the module, the hooks over its views and the description of the queries
in Rust, see [Step 7 as built](#step-7-as-built). Step 8 is built: the migrations of the storage, the eviction of the
query result cache and the checks of native workbook folders run in the runtime, see
[Step 8 as built](#step-8-as-built). The sections before the migration describe the state when this
document was written. Measured on `a9029aa2f` (the progress model of queries in Rust). It takes as
given what is landing next to it: the progress model (landed), the streaming of results through the host (result data
never lives in the core module, every Arrow table is a host object by handle, the computations' tables included) and
the handle table of the host with the effects `release`, `close` and `abort`. Numbers marked as measured come from
that commit; the rest are estimates. The packages that the measurements and the sections as built name are folders of
`packages/dashql` (`@ankoh/dashql`) now: `packages/dashql-core-js` (`@ankoh/dashql-core`) is `src/core`,
`packages/dashql-runtime` is `src/runtime` and `packages/dashql-platform` is `src/platform`, see
[dashql_runtime.md](dashql_runtime.md).

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
| `storage` | root | holds, failed writes, pending keys, external changes | storage view, native sync (11 files) | no |

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
3. **The setups and the catalog loader** (done, see [Step 3 as built](#step-3-as-built)) on the connections and the executor of the runtime; the platform gets
   `oauth` and `extensions`; `setupConnection`, `cancelSetup`, `refreshCatalog`. The 6 setup files and the settings
   pages. Deletes `connection_setup_native.ts`, `connection_setup_cancellation.ts`, `health_check.ts`,
   `catalog_loader_service.ts`, the Trino and Salesforce setup wrappers, `connection_setup.rs` and
   `catalog_loader.rs`. TypeScript about −900.
4. **The workbooks, the storage writer and the restore** (done, see [Step 4 as built](#step-4-as-built)). The workbooks enter the runtime with the index of their
   connections, the promotion and the fan-out of catalog updates; the writer and the restore are services of it; the
   platform gets `storage`; `reportEditorUpdate`, `restore`, `restoreWorkbook`, `storage`; the derived slices replace
   the module caches of the app. The 28 and 22 files of the workbook and the script, the editor, the CLI's restore.
   Deletes `workbook_native.ts`, the registry service and state, `workbook_scripts.ts` but its UI parts,
   `storage_writer.ts`, `app_state_loader.ts`, `workbook_script_connections.ts`, `UpdateQueue`, `workbook.rs`,
   `storage_writer.rs`, `restore.rs`. TypeScript about −2,800, +200. The typing benchmark gates it.
5. **The runs** (done, see [Step 5 as built](#step-5-as-built)). The run service of runtime_object.md; `runWorkbook`
   with its listener of script events, `runScript`, `stopRun`, the `run` slice; the CLI runs on it with
   `connections.prepare` of its platform. Deletes
   `workbook_execution_service.ts`, `workbook_execution.ts` but the event types, `script_run.ts`, `rerun_query.ts`,
   `workbook_run.rs`. TypeScript about −900.
6. **Imports and exports** (done, see [Step 6 as built](#step-6-as-built)). `importWorkbook`, `exportWorkbook` over the
   format of the core and the `tables` and `storage` of the platform. Deletes the orchestration of `workbook_import.ts`, `workbook_export.ts`,
   `workbook_connection_import.ts`, `workbook_query_results.ts`, `workbook_format.rs` and its wrapper. TypeScript about
   −1,100.
7. **The rest** (done, see [Step 7 as built](#step-7-as-built)). `runtime.ts` becomes the facade; the old hook names,
   `storeWithoutRuntime` and the binding modules of the app go.
8. **The storage migrations, the native folders and the eviction** (done, see [Step 8 as built](#step-8-as-built)). The
   migrations of the storage root and of workbook folders, the checks of the native workbook folders that change outside
   the app with the restore of their connections, and the eviction of the query result cache move onto the runtime.
   Deletes `workbook_format.rs` of the bindings with `DashQLWorkbookFormat`, `workbook_migration.ts`, the storage steps
   of the app, `query_result_cache_eviction.ts`, `connection_restore.ts`, `workbook_format.ts` and
   `workbook_validation.ts`. TypeScript about −900.

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
| `dashql-app` | 437 | 599 | 922 | 1,017 |

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

### Step 3 as built

The setups of the connections, the health checks and the catalog loader, built on `0857d61ac` (step 2).

- **The setups are commands.** `setupConnection(connectionId, options)` sets up a connection with the setup of its
  connector (`connection_setup` of the crate) on a host of the runtime (`runtime/setups.rs` of the bindings) and checks
  its health unless the connection is online with its channel; `authenticateSalesforce(setupId, params, options,
  onStep)` logs in without a connection (the login of the shell); `cancelSetup(setupId)` cancels either. A setup is
  known by an id, the id of its connection or of a login: a new setup of an id cancels the one that runs, a reset or a
  delete of the connection cancels it in Rust (`RegistryEffect::CancelSetup`). The options are `params` (the params of
  the connection by default), `channelParams` (the params that the channel connects with while the connection keeps
  `params`, the credentials of the environment of the command line tool; this replaces `connections.prepare` of the
  platform), `forceRelogin` and `oauthRedirect`. The outcome is `{ status, message, data, authentication }`, the
  command resolves, a failure is in the view of the connection and in the log as well.
- **The steps go to the connection.** A step of a setup is applied to the connection right away (`Connections::apply`),
  the channel of a ready step is the handle that the platform returned. The view of the connection shows whether a
  setup runs (`setupRunning`). `runtimeActionOf` and the action symbols of TypeScript went, the app dispatches the
  generated union (`setDraft`, `discardDraft`, `rename`, `setQueryResultCaching`, `deleteConnection`,
  `resetConnection`). The action `setupStep` stays for the setups that the host runs itself: the mock of Salesforce of
  the app config (`salesforce_connection_setup_mock.ts`) and the fixtures of tests (`setupStepAction`).
- **The health check is a query of the runtime.** `run_internal` of `runtime/queries.rs` runs a query that the runtime
  issues itself in a task of its own: it is a query of the history of its connection, the platform describes where it
  runs (`queries.describe`, the same description as for `executeQuery`; `queries.forget` when it ended), a cancelled
  token cancels it at the backend, and the result is read as Arrow IPC before the run is forgotten. The probe of a
  health check and the metadata queries of the catalog loader run on it; `channelOverride` of the query arguments went.
- **The catalog loader is a service of the runtime** (`runtime/catalog.rs`). It follows the registry: an urgent change
  of the registry asks it to follow at the end of the task (`follow_later`). The start and the end of an update are
  actions of the connection, a metadata query is registered with its update, a reset or a delete cancels the running
  updates (`ConnectionEffect::CancelCatalogUpdate`, the handles of the updates are no longer set). An update that
  announces a new catalog raises `catalogVersion` of the view of the connection; `createRuntime` of TypeScript follows it
  and dispatches `CATALOG_DID_UPDATE` to the workbooks until they are part of the runtime. `refreshCatalog(connectionId,
  force)` requests a refresh, `runCatalogLoader(running)` starts and stops the loader (the command line tool and the
  tests stop it). `CatalogLoaderHost` of TypeScript with `updateStarted`, `updateFinished` and `runQuery` went with the
  class `CatalogLoader` of the module.
- **The platform grew** `oauth` (`pkce`, `flowInfo`, `authorizeWithLoopback`, `authorizeWithRedirectPage`, `abort`,
  each flow belongs to a setup by its id), `extensions` (`loadSpec`: the executor loads the spec of a client function
  call with the first call of a connector, `QueryPlatform` no longer loads it), `salesforce` (a getter, the metadata of
  the mock of the app), `queries` (`describe`, `forget`) and `channels.connect` and `channels.hyperLinkToken`.
  `cancelSetup` of the platform went. `CoreRuntime` builds them: a Trino channel is a `TrinoChannel` of the runtime, the
  other channels come from the `ChannelConnector` of the platform (`setChannelConnector`; the app installs its clients of
  Hyper and Salesforce with `ChannelConnectorProvider`, the command line tool connects its embedded Hyper), the OAuth
  flow is the one of the platform or the one that a login brings.
- **The crate.** `SetupHost::open_trino_channel` became `connect_trino_channel`, async with the id of the host, so that
  every channel is a handle of the platform; `TrinoAuthParams::to_json` describes the channel. `ConnectionEffect` and
  `RegistryEffect` gained `CancelCatalogUpdate`.
- **TypeScript.** Deleted: `connection_setup_native.ts`, `connection_setup_cancellation.ts`, `health_check.ts`,
  `catalog_loader_service.ts` and its test, `trino_connection_setup.ts`, `salesforce_connection_setup.ts`,
  `salesforce_authentication.ts`, `hyper_connection_state.ts`, `trino_connection_state.ts`, the tests of the reducers
  of Trino and Salesforce through the symbols, `connection_setup.ts` and `catalog_loader.ts` of `dashql-core-js`,
  `trino_connector.tsx` of the app; `connection_setup.rs` and `catalog_loader.rs` of the bindings. The app's
  `useConnectionSetup(connectionId)` has `run(params)`, `cancel()` and `reset()` over the runtime; the settings pages,
  the cloud login, the startup (`useInitialMemorySetup` over `InitialSetups`) and the shell use the commands.
- **Changed on purpose.** A setup resolves with its outcome instead of rejecting with what the host failed with. A
  connection that is not online once its channel is ready runs the probe, also the Hyper of a link at startup; the
  embedded Hyper runs none, also in the command line tool. The mock of Salesforce marks its health check as succeeded
  instead of running a probe on its mock channel. The catalog loader runs from the creation of the runtime and follows
  the registry in Rust, not the flushes of the store. A refresh that is requested before the core is there waits for it.

Measured (`git diff --numstat` with the new files, sources without tests; the test helpers of `testing/` and
`src/tests/` count as tests):

| Package | Deleted | Added | Tests deleted | Tests added |
|---|---|---|---|---|
| `dashql-runtime` | 1,446 | 329 | 780 | 59 |
| `dashql-core-js` | 158 | 9 | 7 | 96 |
| `dashql-core-wasm` | 1,099 | 1,224 | | |
| `dashql-core-runtime` | 9 | 61 | 8 | 8 |
| `dashql-app` | 429 | 292 | 347 | 329 |
| `dashql-cli` | 47 | 43 | | |

TypeScript lost 2,080 lines and gained 673 without tests (−1,407 net), and 1,134 lines of tests for 492. Rust gained
1,285 and lost 1,108: the bindings of the setups and the loader (`connection_setup.rs`, `catalog_loader.rs`, 981 lines
with their hosts) became `runtime/setups.rs`, `runtime/catalog.rs` and the queries of the runtime (`run_internal`)
over the platform. The module built with `--compilation_mode=opt`, without wasm-opt, grew from 16,753,862 to 16,788,613
bytes (+0.2%), gzip (`-9`) from 4,047,094 to 4,050,059 bytes (+0.1%): the two hosts with their JSON readers went, the
commands and the platform calls came. The release module of `eeca6cc9a` (`--config=release`, with `wasm-opt -O3`) is
13,165,480 bytes, gzip (`-9`) 3,631,990 bytes.

What step 4 needs: the workbooks enter the runtime with the index of their connections, which replaces
`setConnectionReferences` and the follow of `catalogVersion` in `createRuntime` (a new catalog analyzes the scripts of
the connection in Rust); the storage writer and the restore become services of it on `storage` of the platform
(`setStorageWriter` and `adoptRestoredConnection` go); `reportEditorUpdate`, `restore`, `restoreWorkbook` and `storage`
are the commands. The restore restores the catalog updates of a connection in Rust instead of `restoreCatalogUpdates`.
The startup of the app then sets up the connections of the workbook it opens from the workbook slice instead of
`useWorkbookConnections`.

### Step 4 as built

The workbooks, the storage writer and the restore, built on `eeca6cc9a` (step 3).

- **`Runtime` holds the workbooks** (`packages/dashql-core-wasm/src/runtime/workbooks.rs`): the workbooks of the crate in
  the order they were registered, with the metadata of their workbook files that a workbook doesn't keep (the origin,
  the whole link to a cloud), and the workbooks that the restore refused. An action names a connection by its id, the
  runtime gives the scripts the connection of its registry with its catalog (`script_connection_of` of the crate). The
  effects of an action are writes of the storage writer of the runtime, an ephemeral workbook that got a script is
  promoted, the registry of the connections learns which workbooks use a connection after every action that can change
  it (this replaces `setConnectionReferences`), and an announced catalog outdates the analyses of the scripts on the
  connection in Rust (this replaces the follow of `catalogVersion` and `CATALOG_DID_UPDATE` in `createRuntime`).
- **The unions.** `Target` gained `{ workbook: string }`. `RuntimeAction` gained the actions of a workbook
  (`createScript`, `deleteScript`, `renameScript`, `reorderScripts`, `setScriptText`, `acceptPendingDiff`,
  `rejectPendingDiff`, `setScriptVisSpec`, `setWorkbookInput`, `analyzeOutdatedScript`, `registerQuery`,
  `registerScriptResult`, `renameWorkbook`, `setScriptConnection`, `setPendingConnection`, `replaceConnection`,
  `detachConnection`, `setWorkbookAttachments`, `setAttachmentColumns`, `renameAttachment`, `setCloudLink`,
  `replaceFromStorage`) and of the runtime (`createWorkbook`, `deleteWorkbook`); `setConnectionReferences` and
  `restoreCatalogUpdates` went. The base name of a new script comes with the action, the random names stay in
  TypeScript.
- **The views.** `workbookList` (`'root'`: the workbooks with their names, whether they are ephemeral or a cloud
  preview, and the invalid workbooks), `workbook` (by id: the name, the metadata, the pending connection, the cloud
  link, the attachments, the script list of the workbook file, the keys, file names and connections of the scripts in
  feed order, the connections it uses), `script` (by key, script keys are unique in the module: the fields of the
  script and its payloads as FlatBuffers by key, as before), `workbookDerived` (by workbook: the checked references,
  the dataflow and the inputs as FlatBuffers, the planner of the crate run on the workbook when the store reads it,
  `Workbook::with_planner`) and `storage` (`'root'`: the workbooks whose writes a change outside the app holds). A
  keystroke changes the `script` slice and the `workbookDerived` slice, the `workbook` slice keeps its revision while a
  hash of what its view shows doesn't move (`workbook_key`), the derived slice while a hash of the names, connections,
  texts and analyses of the scripts and the attachments doesn't (`derived_key`).
- **The commands.** `reportEditorUpdate(workbookId, scriptKey, sessionId, update, holdsPendingDiff)` (an update of a
  stale session is dropped, an editor that holds no staged rewrite accepted it), `scriptSession`, `isAnalysisOutdated`,
  `attachTableParameters`, `matchesStoredScripts`, `restore(progress)`, `restoreWorkbook(workbookId)`,
  `deleteInvalidWorkbook`, `storage(command)` (`flush`, `settle`, `flushWorkbook`, `deleteWorkbook`), `storageHold` and
  `storageRelease` (holds with reasons), `storageReviveWorkbook`, `storageCancelPendingWrites`, `storageWrite` (the
  writes that no state describes under the key the task names), `storagePendingKeys`, `storageWriteGenerations`,
  `storageStatistics` (no slice: they change with every write), `isWorkbookHeld`, and the runs on a workbook of the runtime: `startWorkbookRun`, `planRun`, `resultKeys`,
  `analyzeForRun` (step 5 makes them `runWorkbook` and `runScript`). `setStorageWriter` and `adoptRestoredConnection`
  went with the classes `Workbook`, `StorageWriter`, `AppRestore` and `RestoredState` of the module.
- **The platform grew `storage`** (`RuntimeStorage`): the reads and writes of the storage writer and the reads of the
  restore. `JsStorage` (`runtime/storage.rs`) is the host of the writer and of the restore over it, the writer of the
  runtime is created with the runtime and the connections write through it. `createRuntimeStorage` of
  `storage/runtime_storage.ts` builds it over the `StorageBackend` of the platform.
- **The restore runs in the runtime.** `restore` and `restoreWorkbook` run the restore of the crate on `storage` of the
  platform and take the restored connections and workbooks (`adopt_restored`); the catalog updates of a connection are
  restored from its files in Rust. The outcome names them (`RestoreOutcome`). The command line tool restores the
  folder of a run with `restoreWorkbook`; the app restores at startup with `restore` and an import or a duplicate with
  `restoreWorkbook`.
- **TypeScript.** `WorkbookScripts` and `ScriptData` are the projections of the `workbook` and `script` slices with the
  names the app reads (`workbook_projection.ts`: the payloads of a script once per key, the session handle of its
  session, the scripts by file name), `WorkbookDerived` the projection of the derived view (the reference reports, the
  dataflow and the inputs read from its FlatBuffers). The store takes a projection per kind (`ViewProjection`), the
  structured progress of the queries is one. `CoreRuntime` has the commands (`createWorkbook`, `deleteWorkbook`,
  `dispatchWorkbook`, `reportEditorUpdate`, `restore`, `restoreWorkbook`, ...) and `storage`, the facade of the commands
  of the writer (`StorageWriter` of `runtime_storage.ts`). `createRuntime` has no registry of the workbooks and no
  writer of its own, the runs read the workbooks of the store. Deleted: `workbook_native.ts`, the registry service and
  state of the workbooks, `storage_writer.ts`, `app_state_loader.ts`, `workbook_script_connections.ts`, `UpdateQueue`,
  `script_reference_reports.ts` of the app, `restore.ts` and `storage_writer.ts` of `dashql-core-js` and most of its
  `workbook.ts`, the bindings `workbook.rs`, `storage_writer.rs` and `restore.rs` (their views moved to
  `runtime/workbooks/view.rs` and `runtime/storage/`).
- **Hooks** (`workbook/scripts/workbook_scripts_registry.tsx` of the app): `useWorkbookScripts(id)` (the slice and the
  dispatch), `useScript(key)`, `useWorkbookDerived(id)`, `useWorkbookScriptMap(id)` (the scripts of a workbook for the
  views that show all of them: the feed, the dashboard, the dataflow), `useWorkbooks()`, `useWorkbookList()`,
  `useWorkbookReader()`, `useWorkbookScriptsDispatch()`, `useInvalidWorkbooks()`, `useWorkbookScriptsCreation()`,
  `useWorkbookScriptsDeletion()`. The editor reports its updates with `reportEditorUpdate`; the dataflow, the reference
  marks of the editors and the input strip read the derived view, the module caches with `workbookAnalysisSignature`
  went. The startup sets up the connections of the workbook it opens from the `connectionIds` of its slice. The
  storage writer is the one of the runtime (`useStorageWriter`), the `RuntimeProvider` flushes it when the page hides
  and pauses it when another tab takes over.
- **Changed on purpose.** An action applies at once and returns its outcome synchronously, a read sees it with the next
  flush; the callers that awaited the next state flush and read. A keystroke renders the subscribers of its script and
  of the derived view, not of the workbook. The statistics of the writes are read when the view of the writer shows
  them, not pushed. The row of a script takes its connector from the view of its connection. An update of a session
  that a script no longer holds is dropped in Rust. The workbooks that use a connection are derived in Rust after every
  action that can change them.

Measured (`git diff --numstat` with the new files, sources without tests; the test helpers of `testing/` and
`tests/` count as tests; the bindings count the views that moved files as deleted and added, about 815 lines):

| Package | Deleted | Added | Tests deleted | Tests added |
|---|---|---|---|---|
| `dashql-runtime` | 2,580 | 920 | 2,406 | 570 |
| `dashql-core-js` | 576 | 152 | 350 | 356 |
| `dashql-core-wasm` | 2,121 | 2,486 | | |
| `dashql-core-runtime` | 5 | 16 | 3 | 2 |
| `dashql-app` | 907 | 1,037 | 678 | 570 |
| `dashql-cli` | 14 | 8 | | |

TypeScript lost 4,076 lines and gained 2,108 without tests (−1,968 net), and 3,434 lines of tests for 1,496 (the tests
count the benchmark). Rust gained about 365 net in the bindings: `workbook.rs`, `storage_writer.rs` and `restore.rs`
(1,189 lines) became `runtime/workbooks.rs`, `runtime/storage.rs` and the commands and slices of `runtime.rs`. The
release module (`--config=release`) grew from 13,165,480 to 13,419,875 bytes (+1.9%), gzip (`-9`) from 3,631,990 to
3,673,026 bytes (+1.1%): the readers of the 24 new variants of `RuntimeAction` and the storage commands, the slices and
the derived view came, the three classes with their JS hosts went. The typing benchmark is in "Typing" of
[core_runtime.md](core_runtime.md): the projection of a keystroke is 16 to 17 µs median, the update and the projection
92 to 95 µs against 93 to 97 µs of the base.

What step 5 needs: `runWorkbook(workbookId, options, events)`, `runScript` and `stopRun` replace `startWorkbookRun`,
`planRun`, `resultKeys` and `analyzeScript` and the host of a run (`WorkbookRunHost` of `workbook_run.rs` with its
statements through `CoreRuntime.execute`): the statements run on the executor of the runtime, the mounts, the query
result cache and the attachments go to the platform. The service of the runs (`WorkbookExecutionService`: one run
per workbook, the connections a run takes, waiting changes of inputs, stopping a run when a connection drops) and the
holds of the workbooks (`acquireWorkbookExecution`) move into Rust as the `run` slice; `useWorkbookExecution` and
`useScriptRunServices` read it. The command line tool runs on `runWorkbook` with its
listener of script events and reads the progress from the `query` slices.

### Step 5 as built

The runs of workbooks, built on `44fc50a09` (step 4).

- **The commands.** `runWorkbook(workbookId, options, listener)` runs all scripts, the `targets` with what they need
  or the scripts that a change of `inputs` affects, `refresh` reads no cached results, `analyze: false` leaves the
  results unanalyzed (the command line tool). `runScript(workbookId, scriptKey, { refresh })` runs a script with the
  scripts it references, `stopRun(workbookId)` stops the run of a workbook, `resultKeys(workbookId, targets)` plans
  without analyzing and returns the reusable result keys of the scripts (the cache indicators of the feed, the exports
  and the publishes of a workbook). Both runs resolve with `{ outcome, error }`: `RunOutcome` (`refused` with the
  reason when the run didn't start, the queries of the outputs, the failure, whether a statement was launched) and
  what the platform failed with. `startWorkbookRun`, `planRun`, `analyzeForRun`, the `resultKeys` with a host and the
  class `WorkbookRun` went with `workbook_run.rs` of the bindings and its `WorkbookRunHost`.
- **The listener** (`RunListener`) hears the events of the scripts (`script(file, event, error)`, the
  `WorkbookScriptRunEvent`s of before, a failure with its details, its target and the query of its statement) and may
  prepare the connections (`prepareConnection(connectionId)`): such a run sets them up before its first statement,
  takes every connection of the workbook and needs no compute database. This is how the command line tool sets up
  its connections with the credentials of the environment; `connections.prepare` of the platform wasn't needed.
- **The run service is Rust** (`runtime/runs.rs` of the bindings). One run holds a workbook; a run of the workbook
  takes the connections of its scripts and starts only while the compute database is set up and they are idle (no
  other run holds one, none connects, none runs a query but SQLFrame queries), and runs statements on those that were
  online when it started, a preview only on the embedded Hyper. A change of inputs while the workbook is busy stops
  its run, waits in the slice and starts when the run ended or the registry changed (`follow_listener` of the
  connections, called where the catalog loader follows), or is dropped after 5 s. A connection that drops from online
  stops the runs on it, a deleted workbook and a destroyed runtime stop theirs. A run of a script refuses a held
  workbook and a preview, analyzes an outdated script and records a plan error, or a failure before the first
  statement, as a failed query of the script in the history of its connection. The runtime reads the columns of new
  Parquet attachments once per file and stamp when attachments change, after a restore and when the registry changes.
- **Statements on the executor of the runtime.** The host of a run (`RuntimeRunHost`) runs a statement as a query that
  the runtime runs itself (`Connections::run_statement`, next to `run_internal`): the platform describes it
  (`queries.describe` with the options of a statement: `analyzeResults`, `publishResults`, `throwOnError`,
  `clientFunctionCall`, `cache: { signature, refresh, only }`), the executor reports `ResultsReady` to the run, the
  result table stays in the history of the connection and a materialization writes it by its handle. A cancel
  cancels the query on the executor and the channel of the host at once (`channels.cancel`, which cancels a stream once
  for every caller). `CoreRuntime.execute` is no longer on the path of a run.
- **The slice.** `run` by workbook (`WorkbookRunView`: `held`, the kind of the run that holds the workbook or null,
  `state`, the `WorkbookRunState` of its last run of the whole workbook, kept after it ended, and `pendingInputs`). It
  changes with the hold, every state of a run and the inputs that wait.
- **The platform grew** `resultCache.key` (the key of a signature on a connection, `computeQueryCacheKeyForConnection`),
  `resultCache.retain` and `release` (a cached file a run keeps), and `mounts` (a getter, null without a compute
  database that reads Parquet files): `prefix`, `fileName(run, key)`, `write(run, path, table)`, `use(run, path)`,
  `release(run)`, `attachments(workbookId)`, `attachmentColumns(workbookId, fileName)`. `createRunMounts`
  (`workbook/scripts/run_mounts.ts`) builds it over the query result cache, a run names its files by its number.
- **The crate.** `RunOptions.analyze`, `workbook_run/json.rs` went (the description of a statement is built in the
  bindings).
- **TypeScript.** `CoreRuntime` has `runWorkbook(workbookId, options, { onScript, prepareConnection })`, `runScript`,
  `stopRun`, `stopRuns` and `resultKeys`, the errors of failures are built in `workbook_execution.ts`
  (`workbookRunError`, `scriptRunEvent`), which keeps only the event types, `ScriptPlanError` and
  `workbookExecutionIsBusy`. `createRuntime` has no `execution` and follows no registries. Deleted:
  `workbook_execution_service.ts`, `script_run.ts`, `rerun_query.ts`, the run host, the holds and the mounts of
  `workbook_execution.ts`, their tests (`workbook_execution.test.ts`, `workbook_execution_integration.test.ts`,
  `script_run.test.ts`, `workbook_execution_service.test.ts`), `DashQLWorkbookRun` of `dashql-core-js`;
  `workbook_run.rs` and `workbook_run/view.rs` of the bindings (the views moved to `runtime/runs/view.rs`).
  `workbook/workbook_runs.test.ts` tests the service on a runtime with channels of the tests, the command line tool
  tests the runs end to end.
- **Hooks** (`workbook/scripts/use_workbook_execution.ts` of the app): `useWorkbookExecution(id)` reads the `run`
  slice (`state`, `busy`, `ready`, `runActive`, `start`, `stop`), `useScriptRun()` runs a script, `useScriptResultKey()`
  is the key of the cache indicator of a script. The feed, the dashboard, the header of a script and Ctrl+E run scripts
  with `useScriptRun`, the exports and the publishes retain the cached results with `resultKeys`.
- **The command line tool** runs on `runWorkbook` with `onScript` and `prepareConnection`, stops with `stopRun`, reads
  the result of a script from the history of its connection and the progress from the `query` views. Its output and
  exit codes are unchanged (`//packages/dashql-cli:test`).
- **Changed on purpose.** A run that doesn't start resolves with the reason (`refused`) instead of returning silently.
  A change of inputs that waits starts when what blocked it changed instead of a poll every 100 ms. A plan error of a
  script is recorded in the history without a round trip through the executor. The statements of a run are queries
  of the runtime: the caller of `CoreRuntime.execute` no longer sees them, and a cancel reaches the channel of the host
  through the platform. An empty workbook refuses a run of the app and runs empty in the command line tool. The state
  of a run reaches the app with the next flush of the store. `destroy` stops the runs before it writes what is pending.

Measured (`git diff --numstat` with the new files, sources without tests; the test helpers of `testing/` and
`tests/` count as tests; `dashql-cli` counts its README):

| Package | Deleted | Added | Tests deleted | Tests added |
|---|---|---|---|---|
| `dashql-runtime` | 957 | 237 | 2,032 | 594 |
| `dashql-core-js` | 34 | 8 | | |
| `dashql-core-wasm` | 757 | 1,462 | | |
| `dashql-core-runtime` | 38 | 4 | 2 | 2 |
| `dashql-app` | 106 | 102 | 74 | 46 |
| `dashql-cli` | 71 | 38 | | |

TypeScript lost 1,167 lines and gained 384 without tests (−783 net), and 2,106 lines of tests for 640. Rust gained
about 670 net in the bindings: `workbook_run.rs` with its views (740 lines) became `runtime/runs.rs`, its views,
`run_statement` and the platform calls. The release module (`--config=release`) grew from 13,419,875 to 13,526,490
bytes (+0.8%), gzip (`-9`) from 3,673,026 to 3,718,380 bytes (+1.2%): the run service with its futures, the slice and
the views of the outcome came, the extern host of the runs went. The typing benchmark is in "Typing" of
[core_runtime.md](core_runtime.md), unchanged within its noise.

What step 6 needs: `importWorkbook(archive, plan)` and `exportWorkbook(workbookId, format)` over the format of the
core (`workbook_format.rs` and its wrapper go) on `tables` and `storage` of the platform. The exports and publishes
read the reusable result keys with `resultKeys` and retain the cached files with `resultCache.retain`/`release` of the
platform already (`retainWorkbookQueryResults`, `countWorkbookQueryResults`); an export command can do that in Rust and
hand the Parquet files to the archive by handle. `importWorkbookQueryResults` adds results to the cache in
TypeScript; an import command needs a `resultCache.import` of the platform. The restore of an imported workbook is
`restoreWorkbook` already.

### Step 6 as built

The imports and exports of workbooks, built on `3f6d09704` (step 5).

- **The commands.** `exportWorkbook(workbookId, options, consume)` exports a workbook as a `.dashql` archive (a Blob of
  the handle table), as a link (`linkBase`; without results and, by default, without catalogs) or as the workbook
  tables, which go to `consume` and stay readable until it settled (a cloud). The options are `format`, `results`,
  `withCatalog`, `withLoginHint` and `preserveUuids`; the outcome names the archive or the link and the cached results
  that the export carries (`ExportedResults`). `exportConnection(connectionId, { linkBase, withLoginHint })` is the link
  of a connection, `exportedResults(workbookId)` counts the cached results that an export would carry. `readImport(source)`
  reads a `.dashql` archive (`{ archive }`, a handle), a workbook folder (`{ folder }`, a `RuntimeImportFolder`) or the
  workbook tables of a cloud (`{ tables }`, the rows of each table as Arrow IPC) into a pending import and resolves
  with an `ImportPreview`: the workbook file, its counts, the cached results, the registered workbook with the same id,
  the questions about the connections and the catalog files that didn't parse. `commitImport(importId, answers,
  onStep)` writes it with the answers (`connections`, `preview`, `conflict`: `replace` or `create-new`, `workbookId`,
  `metadata`, `results`, `restore`) and resolves with `ImportOutcome` (the id, the outcome of the results, the
  registered connections, whether it was restored). `dropImport(importId)` lets go of it. The plan's
  `importWorkbook(archive, plan)` became the two steps because the app asks its questions between them; a commit that
  fails keeps the import for another try.
- **The export in Rust** (`runtime/exports.rs`). It writes the pending writes of the workbook first, reads the workbook
  from `storage` (the attachments by handle, `storage.loadDataFile`), the live params and names of its connections
  from the registry, and the cached results under the keys of `resultKeys`, retained (`resultCache.retain`, `file`)
  until the export ended. The format prunes the connections, sanitizes them for sharing, gives fresh ids and builds the
  workbook tables; `archives.write` of the platform writes the rows as Parquet and adds the files by handle.
- **The import in Rust** (`runtime/imports.rs`). An archive: the platform lists the entries, `plan_archive` decides,
  the platform scans the workbook tables into Arrow IPC (`archives.readTable`) and hands the attachments and results
  over by handle (`readFile`, a stored result as a slice with its CRC-32). A folder: the runtime reads the top-level
  files (the workbook file alone when it is current), migrates them in memory, reads the catalog files of the
  connections that the format names, then the scripts and attachments. The catalogs that don't parse are left out.
  The connections map to the stored connections with their live params and to the connections of the runtime that
  workbooks use (`plan_connection_import`). A commit applies the answers, adds the results to the cache
  (`plan_result_import`, `resultCache.import` with the CRC-32) and writes the workbook through `storage`: a fresh write
  with its verification (the scripts, the attachments by name and size and the workbook file, read back) and a delete
  on failure; a replacement through a verified staged copy, its entry routed to the origin private file system and the
  old workbook written back when the swap fails; a native folder registered in place (the runtime validates it and
  seeds the catalogs, `storage.registerNativeWorkbook` migrates and registers it, the runtime reconciles its file
  lists). A fresh copy is restored into the runtime (`Restorer` of `runtime.rs`, which `restoreWorkbook` uses as well).
- **The platform grew** `archives` (`write`, `bytes`, `entries`, `readText`, `readTable`, `readFile`, `close`;
  `createRuntimeArchives` of `storage/workbook_archives.ts` over zip.js and the embedded Hyper, which is set up when an
  archive first needs it; the app passes it as `archives` of the platform of `createRuntime`, the command line tool has
  none), `storage.loadDataFile`, `saveDataFile`, `findWorkbook`, `upsertWorkbookEntry`, `deleteWorkbookFiles` and
  `registerNativeWorkbook`, `resultCache.file`, `import` and `capacity`, and the size in `resultCache.lookup`.
  `storage.listAttachments` hands the names over in NFC, the runtime orders them.
- **The binding of the format shrank.** `workbook_format.rs` of the bindings keeps what the storage of the platform
  calls itself: the constants with the columns of the workbook tables (the schema of a cloud), the validation and its
  descriptions, `isLocalHyperWasmParams`, `isValidUuid`, the migrations of folders and of `sidb` connections, the
  resolution of the scripts of a native folder that changed on disk and the eviction of the query result cache. Its
  readers of bundles, tables, archives, plans of connections and results, `encodeWorkbookTable`, `decodeWorkbookTable`
  and `workbookLink` went, and so did those methods of `DashQLWorkbookFormat`. The rest goes when the storage moves.
- **TypeScript.** `CoreRuntime` has `exportArchive`, `exportLink`, `exportTables`, `exportConnectionLink`,
  `exportedResults`, `readImport`, `commitImport` and `dropImport`. Deleted: `workbook_import.ts`, `workbook_export.ts`,
  `workbook_connection_import.ts`, `workbook_query_results.ts` and their tests, `storage/workbook_bundle.ts` and its
  test, `storage/workbook_tables_parquet.ts`, the converters of `storage/workbook_tables.ts` (it keeps the names and the
  row types that a cloud writes), and `storage/workbook_import_transaction.ts` of the app with the bundle methods of
  `CompositeStorageBackend` (`prepareNativeWorkbook`, `readWorkbookBundle`, `writePortableWorkbookBundle`,
  `registerPreparedNativeWorkbook`, ...); the composite backend registers a native folder (`registerNativeWorkbook`) and
  reads one for an import (`importFolder`).
- **The app.** `WorkbookImportProvider` has `readImport`, `prepareImport` (the connection dialog), `commitImport` (the
  pause of the writer and the reload for a replacement or a native folder), `dropImport` and `importWorkbook` (read,
  the conflict dialog, prepare, commit). A dropped file, a link, a shared URL (`readWorkbookFromHttp`, a folder over
  HTTP), a native folder, a folder of the browser (`browserWorkbookFolder`) and a version of a cloud import through it;
  the cards and the connection dialog read the preview and its questions. The save overlay, the share overlays and the
  publish to a cloud export through `CoreRuntime`, the connection maps and `useWorkbookArchiveWriter` went. A cloud reads
  a version as the Arrow IPC of its tables (`readCloudWorkbook`) and publishes the tables of `exportTables`.
- **Changed on purpose.** Every export writes the pending writes of its workbook first, not only a publish, and takes
  the params and names of the connections from the runtime. A pack of the save overlay that is no longer needed is
  ignored instead of aborted. The verification of an imported workbook compares the attachments by name and size, not
  by their bytes. A commit that fails can be tried again with the same import, e.g. after the user chose again. The
  budget of a shared URL drops the optional files after it is spent, not all of them. A publish retries without the
  query results only when it carried some. The logs of imports and exports come from Rust.

Measured (`git diff --numstat` with the new files, sources without tests; the test helpers of `testing/`, `tests/`,
`test_fixture.ts`, `cloud_test_tables.ts` and `import_test_sources.ts` count as tests):

| Package | Deleted | Added | Tests deleted | Tests added |
|---|---|---|---|---|
| `dashql-runtime` | 1,032 | 300 | 703 | 4 |
| `dashql-core-js` | 173 | 28 | 20 | 201 |
| `dashql-core-wasm` | 609 | 1,837 | | |
| `dashql-app` | 1,275 | 703 | 594 | 615 |

TypeScript lost 2,480 lines and gained 1,031 without tests (−1,449 net), and 1,317 lines of tests for 820. Rust gained
about 1,230 net in the bindings: `runtime/imports.rs`, `runtime/exports.rs` and `runtime/archives.rs` (about 1,830
lines with the platform calls and the views) came, about 600 lines of the JSON readers of `workbook_format.rs` went.
The release module (`--config=release`) grew from 13,526,490 to 13,628,426 bytes (+0.8%), gzip (`-9`) from 3,718,380
to 3,762,803 bytes (+1.2%): the futures of the import and the export, their views and the writes with their
verification came, the JSON readers of bundles, tables and plans went. The typing benchmark is unchanged (one run of
one pass: the editor 80 / 145 µs, the update 31 / 67 µs, the flush 11 / 15 µs, the derivation 25 / 36 µs, p10 / p50).

What step 7 needs: `runtime.ts` becomes the facade over `CoreRuntime`; the old hook names (`useConnectionRegistry`,
`useWorkbookScripts`, `useQueryExecutor`, ...), `storeWithoutRuntime` and the binding modules of the app go. What the
package keeps is the platform (the storage backends with their migrations and the eviction, `workbook_archives.ts`,
the query result cache, the embedded Hyper, the HTTP client, the logger, Node), the connector clients and channels,
the store with its projections, and helpers for the UI (labels, connector infos, formatting, computation types). The
logic that is left in it: `QueryPlatform` (the description of a query from the view of its connection, the cache key
of a connection with SHA-256), the query result cache with its eviction, the migrations of workbook folders and of the
storage, and the binding of the format that they call (`workbook_format.rs`, `DashQLWorkbookFormat`).

### Step 7 as built

The cleanup, built on `9e56c08e7` (step 6): one facade over the runtime of the module, the hooks over its views, the
description of the queries in Rust.

- **One object.** `Runtime` of `packages/dashql-runtime/src/runtime.ts` is the class that `createRuntime(platform)`
  returns and that the app, the shell of Hyper, the command line tool and the tests hold. `CoreRuntime`
  (`core_runtime.ts`) and the interface of the old `Runtime` with its `coreRuntime` went into it. It builds the one
  platform object of the module, owns the handle table and the store, attaches the module once the core is there
  (`module`, `ready()`, `setCore`) and has typed commands where a caller needs more than the module returns: the core set
  up on the first call, the flush of the store after a command, handles for the objects that cross (`execute`,
  `cancel`, `watchProfile`, `analyzeTable`, `createConnection`, `createWorkbook`, `deleteWorkbook`, the setups, the saves,
  the restores, the runs, the imports and exports, `reportEditorUpdate`). The wrappers that only forwarded went: the app
  and the command line tool call the module directly (`runtime.module?.stopRun(id)`, `cancelSetup`, `dropImport`,
  `flushCacheWrites`, `exportConnection`, `(await runtime.ready()).exportedResults(id)`) and read the store
  (`runtime.store.get(kind, id)`, `all(kind)`) instead of `registry()`, `connections()`, `workbook()`, `workbookScripts()`
  and `query()`. `dispatch` logs a refused action, `dispatchConnection`, `dispatchWorkbook` and `deleteComputation` went.
  `RuntimePlatform` of TypeScript has every member but the logger and the scheduler optional.
- **The description of a query is Rust.** `executeQuery(connectionId, args, failure, events)` takes the options of the
  query in its arguments (`QueryOptions`: analyze, publish, throw on error, a call of a client function, the read
  timeout, the cache with the script signature) instead of a promise of a request from the host. `Connections::describe`
  of `runtime/queries.rs` builds the request from the connection of the registry: the target, the cache key, whether the
  statement touches relations (not on Salesforce), the details of the log. The queries that the runtime runs itself, the
  probes, the metadata queries and the statements of runs, are described the same way. The platform describes only the
  channel of the connection by its handle (`channels.describe(queryId, channel, query)`: a Trino channel or a Hyper
  channel over HTTP that the executor speaks, else a channel of the host, the tokens of a Salesforce channel for a call
  of a client function) and lets go of it with `channels.forget`. `queries.describe` and `queries.forget` of the
  platform went, `request_from_json` of the crate too.
- **The key of the query result cache is Rust.** `executor::cache_key` of the crate has the signature of the connector
  (`connection_cache_signature` over the descriptors of Hyper, Trino and Salesforce that were ported before) and the
  text that the key hashes (`result_key_input`: the namespace, the signature with its keys sorted and the script
  signature, each after its length in UTF-16 code units, the text of the TypeScript key so the cached files keep their
  keys; a test compares it with texts that the TypeScript function wrote). The digest is `crypto.sha256` of the
  platform, no crate of SHA-256 came. `Connections::result_key` serves the queries and the result keys of the runs;
  `resultCache.key` of the platform went. The Salesforce signature leaves out missing fields like `JSON.stringify`.
- **TypeScript of the queries.** `query/query_channels.ts` (`QueryChannels`) is what stays of `QueryPlatform`: the
  channels of the host by query, the query result cache over the compute database and `execute` for callers in
  TypeScript (the result table, the error of a failed query, the abort signal of the caller, the log of a trace, the
  refreshed token of a Trino channel). `query_platform.ts`, `query_result_cache_key.ts`, `createConnectionParamsSignature`
  and the `cacheSignature` of the connector descriptors went. `CancelQuery` takes the query id only.
- **The hooks of the app** (`packages/dashql-app/src/runtime/runtime_hooks.tsx`): `useRuntime`, `useOptionalRuntime`,
  `useView`, `useDispatch`, `useTable`, the aliases `useWorkbook`, `useScript`, `useWorkbookDerived`, `useWorkbookList`,
  `useConnection`, `useConnectionList`, `useQuery`, `useComputation`, `useComputationDispatch`, the reads of several
  slices `useWorkbooks`, `useWorkbookScriptMap`, `useConnections`, `useConnectionViews`, `useAllQueries`, and
  `useQueryProgress`, `useQueryResultTable`, `useQueryProfileDetail`, `useWorkbookExecution`, `useScriptRun`,
  `useScriptResultKey`, `StandaloneRuntime`. The binding modules of the app went: `connection_registry.tsx`,
  `query_executor.tsx`, `workbook_scripts_registry.tsx`, `use_workbook_execution.ts` and `catalog/catalog_loader.tsx`,
  with `useConnectionRegistry`, `useConnectionRegistryStore`, `useConnectionReferences`, `useConnectionById`,
  `useConnectionAllocator`, `useConnectionDispatch`, `useWorkbookConnections`, `useWorkbookScripts`, `useQueryExecutor`,
  `useCancelQuery`, `useQueryState`, `useQueryReader`, `useCatalogLoaderQueue`, `useCoreRuntime`,
  `useOptionalCoreRuntime`, `useDeleteComputation`, `useStorageWriter`, `useOptionalStorageWriter`, `useStorage` and
  `StandaloneCoreRuntime`. What the app adds about the user interface stays in the app: the drafts of the forms of
  connections (`connection_draft.ts`), the state of a save (`connection_persistence.tsx`), creating and deleting
  workbooks with the selection and the invalid workbooks (`workbook_lifecycle.ts`). `connection_registry_state.ts` of the
  runtime went: the list of the connections says which are listed and their ordinals (`connectionOrdinals(list)`,
  `isListedConnection(list, id)` of `connection_label.ts`), the workbooks of a connection and the connections of a
  workbook are fields of their views.
- **Dead code that went.** `catalog_batch.ts` and its test, `trinoSessionDefaults`, `testing/mocks/connection_references.ts`,
  and the exports that nothing called any more (`channelOf`, `filterMatches`, `createQueryExecutionMetrics`,
  `isQueryCacheMiss`, `getHyperCloudAttachedDatabase`, `validateWorkbookData`, `loadRuntimeCore`,
  `orderedWorkbookScripts`, `persistedConnectionId`, `isRefusedByCloudPreview`, ...).
- **Changed on purpose.** A query whose connection is unknown fails in the runtime without a call of the platform. A
  query is described when its task first runs, right after `executeQuery` returned, not in the call. The platform
  forgets the channel of every query when it ends, also of the queries of TypeScript. A refused action of any target is
  logged. Cancelling a query needs no connection id. A component that asks for the executor no longer gets a new
  function when the compute database arrives. A runtime is destroyed asynchronously everywhere: it stops its runs and its
  catalog loader and writes what is pending before it frees the module.

Measured (`git diff HEAD --numstat` with the new files; the test helpers of `testing/` and `tests/` count as tests; a
moved test file counts as deleted and added):

| Package | Deleted | Added | Tests deleted | Tests added |
|---|---|---|---|---|
| `dashql-runtime` | 2,015 | 1,326 | 593 | 300 |
| `dashql-core-js` | 2 | 3 | 42 | 42 |
| `dashql-core-wasm` | 127 | 282 | | |
| `dashql-core-runtime` | 69 | 113 | | |
| `dashql-app` | 1,281 | 967 | 1,110 | 1,100 |
| `dashql-cli` | 18 | 20 | | |

TypeScript lost 3,316 lines and gained 2,316 without tests (−1,000 net), and 1,745 lines of tests for 1,442. Rust
gained 395 and lost 196: the description of a query, the key of the cache and their tests. The release module
(`--config=release`) grew from 13,628,426 to 13,672,855 bytes (+0.3%), gzip (`-9`) from 3,762,803 to 3,775,707 bytes
(+0.3%): the description and the key moved in, the reader of the request JSON went. The typing benchmark is unchanged
(one run of one pass: the editor 79 / 143 µs, the update 29 / 66 µs, the flush 11 / 14 µs, the derivation 24 / 34 µs,
p10 / p50).

What is left in `packages/dashql-runtime/src` (14,697 lines in 138 files without tests and test helpers, 15,769 with
the 1,072 lines of `testing/`; 6,772 lines of tests in 60 files):

| Kind | Lines | What |
|---|---|---|
| Facade and store | 2,139 | `runtime.ts` (898: the class, its commands and the platform object of the module), `store/` (the store, the projections, the handle table, the tables), the projections of the script and progress views, `runtime_storage.ts` |
| Platform | 5,256 | the storage backends and the archives, the query result cache in OPFS, the embedded Hyper (`platform/hyperdb/`), the logger, HTTP, OAuth, the compute platform, the files of runs and attachments, `query_channels.ts`, utilities |
| Connector clients | 2,197 | Hyper over gRPC and HTTP, the API of Salesforce, Trino, the embedded Hyper channel, the result streams, the tracked queries of the host |
| UI helpers | 2,684 | the Arrow formatter, the types of the computation views, connector infos and descriptors, labels, params, script names and formatting, inputs, the profile symbols |
| CLI and Node | 1,315 | `node/`, lint, format and reports of SQL, the journal of a session |
| Remaining logic | 882 | the migrations of folders and of the storage with `workbook_format.ts` and the validation, the eviction of the cache, the restore of connections of a changed native folder, the mock setup of Salesforce, the catalog SQL of the shell |
| Test helpers in the sources | 224 | `hyperdb_http_client_mock.ts` |

Since the migration started the package went from 32,400 lines without tests to 23,656 when this document was written
and to 14,697 now.

### Step 8 as built

The migrations of the storage, the native workbook folders and the eviction of the query result cache, built on
`e31b504b8` (step 7). It retires the last binding of the workbook format.

- **The migrations are commands.** `migrateStorage()` brings the storage root of the platform to the current storage
  version with the steps of `workbook_format/storage_migration.rs` of the crate (the eight storage steps of the app,
  versions 2 to 9, with the consolidation of the connections of version 3), then every workbook folder that the
  workbook tree registers to the current workbook format, and resolves with `StorageMigrationOutcome` (`steps`,
  `workbooks`, `storageVersion`, `formatVersion`). `migrate_folder` of `migration.rs` migrates a folder over a
  `FolderHost`: the top-level files are read, migrated in memory, written first and removed after; a folder at the
  current version is only read. The restore migrates a folder that the platform keeps elsewhere
  (`storage.workbookFolder`, e.g. a native workbook folder or the folder of a run of the command line tool) before it
  first reads its workbook file, an import migrates a native folder after it registered it, and
  `migrateWorkbookFolder(workbookId)` migrates one on request: the command line tool calls it before it reads the
  workbook id of its folder. The app migrates its storage before the storage is set up, with the static
  `Runtime.migrateStorage(root, log)` of the module and no runtime, over the storage root (`createStorageRoot` of `storage/storage_root.ts` over the OPFS root, the native folders of the desktop
  app claimed by the platform), with the lock of the manifest; the core provider moved above the storage provider for
  it.
- **The platform grew** `storageRoot` (`RuntimeStorageRoot`: `readText`, `writeText`, `createDirectory`, `remove`,
  `list`, `copyDirectory` by path, `nativeFolder`), `storage.workbookFolder` (`RuntimeWorkbookFolder`: `readText`,
  `writeText`, `remove`, `stampFolder`, `acknowledgeFolder`, `findExternalChanges`, the `NativeStorageBackend` of
  a native workbook), `storage.attachmentsChanged`, and `resultCache.files` and `resultCache.remove`.
  `registerNativeWorkbook` no longer migrates.
- **The eviction is Rust.** After every write of a file of a key (a result of the executor, a materialized result of a
  run under a reusable key, an imported result) the runtime evicts (`JsPlatform::evict_cache` over `evict_to_fit` of
  `workbook_format/eviction.rs`): it lists the files of the cache, removes the least recently read ones that nobody
  reads until the limits of `resultCache.capacity` hold, and logs a failure. The cache of the platform only lists,
  sizes and removes files (`fileStats`, `remove` of `QueryResultCache`), `writeTable` and `importFile` no longer evict.
- **The native folders are Rust.** `checkWorkbookFolders(workbookIds)` queues checks of the folders of workbooks
  (`runtime/external.rs`), one at a time: the writes of the workbook are held, the stamps of the folder are compared
  with the acknowledged ones, changed attachments are listed again, the scripts of a folder that changed are resolved
  against the connections of the runtime (`resolve_workbook_scripts`; a connection that only the workbook file names
  joins the runtime from its copy with `connection_state` of the restore and leaves it again unless the reload is
  applied). When the scripts differ from the app, the `storage` view asks (`externalChanges`: `workbookId`, `prompt`,
  `pendingWrites`) and the check waits for `answerExternalChange(workbookId, prompt, reload)`: a reload replaces the
  scripts, cancels the writes that it replaces, saves the connections that joined and writes the script list, a
  refusal writes the scripts of the app over the disk, no answer keeps the app version until the next check. A local
  edit during a question without pending writes asks again, a decision that the writes overtook starts the check
  over. `NativeWorkbookSync` of the app asks for the checks (once per workbook, on focus, for the held workbooks) and
  shows each question of the view once as the native dialog.
- **The format helpers.** The invalid workbooks of the restore and of the `workbookList` view carry the description of
  their error (`RestoredInvalidWorkbook.description`), `InvalidWorkbook` of the app is that view. The columns of the
  workbook tables are `Runtime.workbookTables()` (`DashQL.workbookTables()`, the generated `WorkbookTableSchema`);
  `workbookTableColumns` of the runtime package reads them from a core that a runtime or the test frame provided.
- **Deleted.** `workbook_format.rs` of the bindings (`workbookFormat`, `resolveWorkbookScripts`, `CacheEviction`),
  `workbook_format.ts` of `dashql-core-js` and its test; `storage/workbook_format.ts`, `storage/workbook_validation.ts`,
  `storage/migration/workbook_migration.ts` and its test, `storage/migration/migration_folder.ts`,
  `storage/query_result_cache_eviction.ts` and its test and `connections/connection_restore.ts` of the runtime package;
  the storage steps of the app (`storage/migration/storage/v2_*.ts` to `v9_*.ts`, the test of v3), `storage_root.ts`,
  `readStoredWorkbookScripts` and the check of `native_workbook_sync_react.tsx`, the loaders of the core for the format
  (`setWorkbookFormatCoreLoader`, `provideWorkbookFormatCore`, `instantiateBeforeProvider`) and
  `DEBOUNCE_DURATION_WORKBOOK_WRITE`.
- **Tests.** The storage steps and the plan of the connections of version 3 are tested in the crate
  (`storage_migration_test.rs`, the tests of the app and of `workbook_migration.test.ts` ported), the eviction in the
  unit tests of `eviction.rs` and through a run (`workbook_runs.test.ts`), the migrations on the runtime over a root of
  Node and a folder (`node/storage_root.node.test.ts`) and over the OPFS mock of the app
  (`storage_migration.test.ts`), the native folders with the tests of the app (`native_workbook_sync.test.tsx`).
- **Changed on purpose.** The storage setup of the app instantiates the core before it migrates, also when nothing
  needs a step; a folder at the current version costs one read as before. A failed eviction is logged instead of
  failing the write that triggered it. A failed question about a changed folder logs in the app and in the runtime. A
  connection that a changed workbook file brings along is written to the app manifest only when the reload is applied.
  The errors of an unreadable manifest of a migration are the ones of the JSON reader of Rust.

Measured (`git diff HEAD --numstat` with the new files; the test helpers of `testing/`, `tests/` and the test frame
count as tests, the unit tests of the crate count as source):

| Package | Deleted | Added | Tests deleted | Tests added |
|---|---|---|---|---|
| `dashql-runtime` | 415 | 207 | 125 | 154 |
| `dashql-core-js` | 134 | 12 | 56 | |
| `dashql-core-wasm` | 267 | 1,026 | | |
| `dashql-core-runtime` | 6 | 1,055 | | 826 |
| `dashql-app` | 1,124 | 130 | 146 | 40 |
| `dashql-cli` | 1 | 3 | | |

TypeScript lost 1,674 lines and gained 352 without tests (−1,322 net), and 327 lines of tests for 194. Rust gained
1,808 net: the storage steps with the plan of the connections (`storage_migration.rs`, 886 lines), the checks of the
native folders (`runtime/external.rs`, 514), the migrations over the platform (`runtime/migrations.rs`, 193) and the
eviction over a host came, `workbook_format.rs` of the bindings (255) went; 826 lines of tests of the crate came. The
release module (`--config=release`) grew from 13,672,855 to 13,892,509 bytes (+1.6%), gzip (`-9`) from 3,775,707 to
3,868,442 bytes (+2.5%): the futures of the storage steps, the migrations over the platform and the checks of the
native folders came, the JSON operations of the format binding went. The typing benchmark is unchanged (one run of one
pass: the editor 79 / 145 µs, the update 30 / 67 µs, the flush 11 / 14 µs, the derivation 24 / 35 µs, p10 / p50).

What is left in `packages/dashql-runtime/src` (14,489 lines in 133 files without tests and test helpers, 15,564 with
the 1,075 lines of `testing/`; 6,802 lines of tests in 59 files), cut anew by file:

| Kind | Lines | What |
|---|---|---|
| Facade and store | 2,106 | `runtime.ts`, `store/`, the projections of the workbook, script and progress views, `runtime_storage.ts` |
| Platform | 5,222 | the storage backends, the storage root of the migrations, the archives, the query result cache in OPFS, the embedded Hyper, the logger, HTTP, OAuth, the compute platform, the files of runs and attachments, `query_channels.ts`, utilities |
| Connector clients | 1,677 | Hyper over gRPC and HTTP with its mock, the API of Salesforce with its mock, Trino, the embedded Hyper channel, the result streams, the tracked queries of the host |
| UI helpers | 3,633 | the Arrow formatter, the types of the computation views, connector infos and descriptors, labels, params, the query states, script names and formatting, inputs, the profile symbols |
| CLI and Node | 1,310 | `node/`, lint, format and reports of SQL, the journal of a session |
| Remaining logic | 317 | the mock setup of Salesforce, the catalog SQL of the shell |
| Test helpers in the sources | 224 | `hyperdb_http_client_mock.ts` |

### The split as built

Decision 6, built on `c42f4e67e` (step 8): `packages/dashql-runtime` split into the runtime and a new
`packages/dashql-platform` (`@ankoh/dashql-platform`). A move and a rename: no file changed but its imports, the tests
are the ones of before. What goes where is in [dashql_runtime.md](dashql_runtime.md#what-goes-where).

| Where | Sources | Tests | Test helpers |
|---|---|---|---|
| `dashql-runtime` | 2,940 lines in 15 files | 1,661 in 11 | 259 in 3 |
| `dashql-platform` | 10,982 in 106 | 4,783 in 42 | 759 in 8 |
| `dashql-app` (moved in) | 567 in 12 | 358 in 6 | |

The 14,489 lines of step 8 are all accounted for. The runtime is larger than the 800 lines of the decision: `runtime.ts`
alone has 915, and the adapters of the platform of the core (`query_channels.ts` 387, `runtime_storage.ts` 260, the
projections of the workbook views 216, the archives, the tracked queries, the result streams, the compute platform,
the files of runs, `createNodePlatform`) belong to it, since they name the `RuntimePlatform` of the facade, the handle
table or the core's platform types.

- **The direction.** The runtime imports the platform, the platform neither the runtime nor the app.
  `//packages/dashql-platform:boundary_test` fails on `@ankoh/dashql-runtime` and on a relative import out of the
  package, `//packages/dashql-runtime:boundary_test` allows the platform only by its name (`src/node` alone may import
  `@ankoh/dashql-platform/node/`). The modules that would have closed a cycle went with their importers:
  `query/query_progress.ts` to the platform (`query_execution_state.ts` names its types), the archives, the tracked
  queries and `createNodePlatform` stayed in the runtime (they take the handle table or return the `RuntimePlatform`),
  the mock setup of Salesforce and the marking of deleted query results moved into the app (they take a `Runtime`).
- **The app** got the helpers only it uses: `connection_label.ts` with `embedded_connection.ts`, the Hyper links of a
  tab, `salesforce_connection_setup_mock.ts`, `query_result_cache_clear.ts`, `workbook_link.ts`, `script_name.ts`,
  `script_format.ts` with `config/app_settings.ts`, `catalog_object_id.ts`, `script_rename.ts` and
  `attachment_rename.ts`, at the same paths under `packages/dashql-app/src`. Their tests run in the browser tests of
  the app only.
- **The tests.** A test that creates a runtime stays in the runtime with the test runtime and its fixtures, also when it
  tests a module of the platform (the catalog updates of an embedded channel, the tracked queries, the migrations over a
  root of Node, `hyper_link.test.ts` went to the app with its module). The platform has its own `test_node`, the three
  type checks, the boundary and editor tests; the browser tests of the app run the tests of both packages
  (`:platform_browser_test_files`, `platform/src/<path>`).
- **The codemod.** A script moved the modules with `mv` and rewrote the imports: the relative imports of the runtime
  and of the modules for the app that reach another package became deep imports (`@ankoh/dashql-platform/<path>`,
  `@ankoh/dashql-runtime/<path>`), and `@ankoh/dashql-runtime/<path>` and `packages/dashql-runtime/src/<path>` of a
  moved module became the platform or the relative path in the app. It changed 408 files of the app, 18 of the command
  line tool, 23 of the runtime, 14 of the modules for the app and 7 documents; the platform needed none.
- **Build.** `//:node_modules/@ankoh/dashql-platform`, the `npm_translate_lock` data of `MODULE.bazel`, the importer of
  `pnpm-lock.yaml`, `.bazelignore`, the path of the root `tsconfig.json`, `__PLATFORM_PATH__` of the Vite config of the
  app, the dependencies of the app, the command line tool and the runtime. Rust and Wasm are unchanged; comments in the
  crates that name old paths of `packages/dashql-runtime/src` were left.

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
   platform builder) and a `dashql-platform` package with the platforms, the clients and the CLI support. Done, see
   [The split as built](#the-split-as-built): the runtime has 2,940 lines with the adapters of the platform. Both are
   folders of `packages/dashql` with the bindings of the core module.
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
