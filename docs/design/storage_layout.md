# Storage Layout

DashQL stores its data in the Origin Private File System (OPFS) of the app origin, and native workbooks in
directories that the user owns. hyperdb-wasm mounts the OPFS root at `/mnt/fs`, so every OPFS path below is also
a Hyper path. Scripts don't name these paths: a Parquet attachment `workbooks/<id>/attachments/a.parquet` is the table
parameter `:a`, which the embedded Hyper reads from the mount of the attachments of the workbook (see Attachments).

## OPFS root

```
<OPFS root>                                    Hyper: /mnt/fs
├── dashql-manifest.json                       app manifest
├── workbooktree/                               folders of the sidebar, registry of the workbooks
│   ├── dashql-folder.json                     workbooks of the root folder
│   ├── My Workbooks/dashql-folder.json         the folder that a new storage starts with
│   └── <folder>/dashql-folder.json            workbooks of a folder, folders nest
├── workbooks/<workbook-id>/                     OPFS workbooks
│   ├── dashql-workbook.json                    workbook metadata
│   ├── scripts/<script-name>                  script text
│   └── attachments/<name>.parquet             attached Parquet files
├── cache/<hash>.<uuid>.parquet[.last_access]  query result cache of the app
├── connections/<connection-id>/               files of a global connection
│   ├── dashql-catalog-relations.sql           relations of the catalog, written and read as SQL
│   ├── dashql-catalog-functions.sql
│   ├── dashql-catalog-state.json              open questions and relations that are gone, see catalog_updates.md
│   └── monitoring.hyper                       extract of the Hyper log of the connection
├── shell/                                     files of the standalone shell
│   └── salesforce-login-history.json
├── instances/<instance-id>/                   embedded database of one app window
│   ├── compute.hyper                          data frames
│   ├── user.hyper                             database of the embedded Hyper connector
│   ├── snippets.hyper                         the snippets of the snippet search
│   ├── <database>.hyper.dblog                 redo log of a database, see cloud.md
│   └── logs/hyperd_<timestamp>.log            log files of its Hyper process
└── exports/<export-id>/                       transient Parquet exports
```

| Path | Written by | Lifetime | Part of workbook bundles |
|------|------------|----------|-------------------------|
| `dashql-manifest.json` | `OPFSStorageBackend` | persistent | no |
| `workbooktree/` | `OPFSStorageBackend` | persistent | no |
| `workbooks/<id>/` | `OPFSStorageBackend` | until the workbook is deleted | yes |
| `connections/<id>/` | `OPFSStorageBackend`, `HyperLogMetrics` | until the connection is deleted | catalog files only |
| `shell/` | `SalesforceLoginHistoryStore` | persistent | no |
| `instances/<id>/` | `createHyperDBOPFSInstance` | one app window | no |
| `cache/` | `createOPFSQueryResultCache` | until evicted | `.dashql` files on request, as result tables (`query_cache.md`, `workbook_tables.md`) |
| `exports/<id>/` | `exportArrowTableAsParquet` | one export | no |

"Clear all data" removes `workbooktree/` first, resets the manifest, removes `workbooks/`, `connections/` and `shell/` and clears
`cache/`, except the files that other windows read right now. It keeps `instances/`, because the running window owns
its instance.

### The manifest

`dashql-manifest.json` (schema `proto/json/dashql/app_manifest.json`) holds:

- `storageVersion`, the version of this layout, see [Versions and migrations](#versions-and-migrations).
- `connections`, the global connections: `id`, `name`, `params`, `paramsDraft`, `createdAt` and
  `cacheQueryResults`, whether the [query result cache](query_cache.md) keeps their results, absent for the default
  of the connector.
- `appSettings`.

Writers hold the Web Lock of the manifest, which all tabs of the app share.

### The workbook tree

`workbooktree/` registers every workbook and holds the folders of the sidebar. Every directory of the tree is a
folder, the directory name is the folder name, and holds a `dashql-folder.json` (schema
`proto/json/dashql/app_folder.json`) with `workbooks`, one entry per workbook of the folder in the order of the sidebar:
`path` (the workbook id), `storageType` and, for native workbooks, `nativePath`. The sidebar lists the subfolders of a
folder before its sessions, in the natural order of their names.

A storage without a workbook tree starts with the folder `My Workbooks`, an ordinary folder that the user may rename or
delete. The tree is only created once, a deleted `My Workbooks` folder is not created again. New workbooks are
registered at the end of the root, except for a workbook created from the menu of a folder.

- A workbook is in exactly one folder. Moving a workbook rewrites the folder files of its old and new folder, the new
  one first, so an interruption duplicates a workbook instead of losing it. A workbook that the tree lists twice
  counts where it comes first in the order of the sidebar, and the next change drops the duplicate.
- Renaming or moving a folder copies its directory and then removes the original, the tree holds small folder files
  only. Deleting a folder moves its sessions and the workbooks of its subfolders to its parent, no workbook is deleted.
- Folder names are not empty, contain no `/` or `\`, are not `.` or `..`, and differ from the names of their
  sibling folders ignoring case.

Writers hold the Web Lock `dashql-workbook-tree`, which all tabs of the app share. The cleanup holds it together with
the lock of the manifest.

### Workbooks

A workbook folder holds `dashql-workbook.json` (schema `proto/json/dashql/app_workbook.json`: `formatVersion`,
`workbookId`, `name`, `connections`, `scripts`, `attachments`, `metadata`) and
the files it lists. Format 8 and older kept `settings.cacheQueryResults`, format 9 drops it: connections decide
whether their results are cached.

- `scripts/` holds one file per script, named by the script.
- `attachments/` holds the attachments, Parquet files that queries read in place: `a.parquet` is the table parameter
  `:a`. A workbook attaches Parquet files only (`validateDataFileName`): adding or importing another file fails, a
  listing of the folder leaves other files out, and a workbook file that lists one is sanitized.
  Workbook bundles rebase these paths when a workbook is imported under a new id.

The greeter at the root of the app shows the ephemeral workbook, a workbook without scripts with `metadata.ephemeral: true`.
It is stored and restored like any other workbook, since its workbook file already holds what it can gain before its first script: the connection picked for it and its attachments. The sidebar always lists it as the last workbook of the root, with the
italic name "New Workbook" and no menu, and the create button of the workbooks jumps to it. Its first script promotes it, whatever created the script: the marker goes, the workbook takes a free
"Untitled" name and the workbook moves to the end of the root. The next ephemeral workbook is created right away.
Every launch ends with exactly one: it creates a missing one and deletes all but the first in restore order. A marked
workbook that holds scripts stopped before its promotion was written, the restore finishes the promotion.

### The query result cache

`cache/` holds the [query result cache](query_cache.md) of the app, for every workbook and connection: one Parquet
file per result named `<hash>.<uuid>.parquet`, and an empty `.last_access` marker whose mtime makes the eviction
least-recently-used. The materialized results of runs are files of their keys too, or transient files
(`<uuid>.transient.parquet`) if their keys aren't reusable. hyperdb-wasm mounts the folder read-write at
`/mnt/external/cache`. A `.dashql` file carries the cached results of its scripts when the export asks for them, an
import adds them to the folder (see Exported Results in `query_cache.md`).

### Connections

Connections are global and referenced by workbooks through `connectionId`. Their folder holds:

- The catalog files. They are a cache of the last catalog refresh and seed the completion before the
  connection comes online. Workbook bundles carry the catalogs of their connections as
  `connections/<id>/dashql-catalog-*.sql`, a `.dashql` file as the rows of its catalog tables (`workbook_tables.md`).
- `monitoring.hyper`, the monitoring database of the connection (`connectionMonitoringDatabasePath`). The monitor of
  the connection in `HyperLogMetrics` fills its tables `query_ends` and `resource_metrics` every 5 seconds with a
  `HyperDBIncrementalExtract` of the Hyper log: the queries whose client context names the connection, its own reads
  and writes included, and the resource samples of the Hyper process. The connection overview reads it on a reader
  connection of the monitor, which attaches it as `monitoring`. It outlives app windows, so the overview keeps the
  history of earlier windows, the tables keep the last 2 hours. A new monitor backfills the retained log from the
  newest extracted timestamp. The file is derived from the log and has no migrations: when its tables no longer
  match the columns of the app, the monitor drops them and backfills the retained log again. Deleting
  the connection stops its monitor, which closes the file, and deletes it; it is never exported.

### Instances

Every app window runs one embedded hyperdb-wasm instance, `setupWebHyperDB` gives it a fresh
`instances/<uuid>/` folder:

- `compute.hyper`, attached as `__dashql_compute`, holds the data frames (`__df_<n>` tables) of the computations.
  Every compute connection attaches it.
- `user.hyper`, attached as `hyper`, is the database of the embedded Hyper connector and the shell
  (`connect({ defaultDatabase: 'hyper' })`).
- `snippets.hyper`, attached as `__dashql_snippets`, holds the `snippets` table of the snippet overlay, one row per
  snippet and connector with the columns `id`, `category`, `connector`, `path` and `body`, the body includes the
  description. `SnippetSearch` fills it on the first search and finds the snippets with `ILIKE`.
- `logs/` holds the log files of the Hyper process of the instance, the instance sets it as `log_file_path`. They
  are rotated by `log_file_size_limit` and `log_file_max_count` (`HYPERDB_WASM_ENGINE_SETTINGS`), and
  `hyper_log()` reads them. The monitors of the connections copy them into `connections/<id>/monitoring.hyper`.

The databases are scratch space: data frames are computed again when queries run in a new window. `HyperDB.terminate()`
drops the three databases and removes the folder. A Web Lock `dashql-instance-<uuid>` is held while the window lives,
and the startup of the next instance removes every instance folder whose lock is free, e.g. after a crash.

Earlier app versions kept these folders in the OPFS root as `dashql-workbook-<uuid>/` and let Hyper write its logs
to the default folder `logs/<process-id>/` in the OPFS root, the cleanup removes both. Hyper still creates an
empty `logs/` folder at startup, before the instance settings apply.

### Transient folders

- `exports/<uuid>/` exists while one Arrow table is exported as Parquet. Hyper only writes to registered targets, so
  the export mounts the folder read-write as `/mnt/external/parquet-export-<uuid>` and removes it afterwards.

## The root of Node

The command line tool keeps its files in a folder of its own with the same layout: `cache/`,
`workbooks/<id>/attachments/` and `instances/<id>/`. The folder is `DASHQL_HOME`, else the nearest `.dashql/` above the
workbook folder, which `dashql session serve` creates in the folder of its session next to the journal of the session
(`docs/wip/agent_session.md`), else `~/.dashql`. In a session the files of a project stay in the project, where the
commands in the sandbox of a harness may write; `.dashql/` ignores itself. `~/.dashql/servers/` keeps a file per running
session server. The modules of the runtime reach it through the handles of
`node/node_directory_handle.ts` instead of `navigator.storage`, and the Node build of hyperdb-wasm mounts it at `/mnt/fs`,
so the Hyper paths are the ones of the browser. `dashql run` mirrors the attachments of a workbook folder into it and
removes its instance folder when it ends. It is not the root of the app: a viewer that shows results of the command line
tool copies them into its own storage. The Web Locks of its query result cache span one process, see
`docs/wip/dashql_runtime.md`.

## Native workbooks

The native app keeps a workbook in a directory that the user chose, the entry of the workbook tree has `storageType: native`
and `nativePath`. The directory has the layout of an OPFS workbook folder (`dashql-workbook.json`, `scripts/`,
`attachments/`), and users may edit its files, see [native file synchronization](native_file_sync.md).

hyperdb-wasm can only read OPFS. When a native workbook loads, its attachments are mirrored into
`workbooks/<id>/attachments/` in OPFS, so the attachments of the workbook read the same in both storage types.
The app remembers the stamp (size and modification time) that each attachment was mirrored with and copies a
file again only when its stamp changed, so the first load of a workbook in an app run copies every attachment.
Connections, the manifest, the workbook tree, the shell files and the instances stay in OPFS.

## Attachments

The embedded Hyper reads the attachments of a workbook from its OPFS folder `workbooks/<id>/attachments/` (of a
native workbook, the mirror), mounted read-only at `/mnt/external/attachments/<id>`
(`workbook/attachments/attachment_mounts.ts`). The app mounts the folder before a plan scans an attachment and before it
reads the columns of a Parquet attachment. A change of the attachments, in the app or in a native folder, marks the
mount stale, its next use refreshes it so Hyper looks up the files again. Closing the workbook removes the mount.

## Hyper paths

| Hyper path | Backed by |
|------------|-----------|
| `/mnt/fs/...` | the OPFS root |
| `/mnt/external/<name>` | browser files and directories registered with `registerExternalFile` and `registerExternalDirectory`, e.g. shell file mounts and Parquet exports |
| `/mnt/external/cache` | the folder `cache/` of the query result cache (`createOPFSQueryResultCache`), mounted read-write while a run or a cache read uses it |

`/mnt/external/` paths only exist while they are registered and are not stored.

## Browser tests

`tests.html` runs on the origin of the app, the dev server and the pages deployment serve it next to the app, so the
tests share its OPFS. They keep every file in `tests/` instead of the OPFS root: the test frame calls
`setOPFSAppFolder('tests')` before it loads a test, `getOPFSRoot()` then returns `tests/` and `hyperOPFSRoot()`
returns `/mnt/fs/tests`, the test engine logs to `tests/logs/`. App code never calls
`navigator.storage.getDirectory()` or writes `/mnt/fs` itself, it goes through these two functions of
`src/platform/opfs_root.ts`. Test databases live in an instance folder of the frame, see `testDatabasePath()`. The
cleanup of the app lists `tests/` as files of the browser tests.

## Versions and migrations

Two versions describe the stored data:

- The storage version, `storageVersion` in the manifest, describes the OPFS root. `migrateStorage` brings an older
  root to the current version at startup with the steps in `src/storage/migration/storage/`, e.g. version 5 moves `dashql-shell/`
  to `shell/`, version 6 drops the `aliases` of the connections, version 7 moves the `sessions` of the manifest into
  the folder `My Sessions` of `sessiontree/`, version 8 moves the connection params under `sidb` to `dbcom`, and version 9
  renames sessions as workbooks: `sessions/` becomes `workbooks/`, `sessiontree/` becomes `workbooktree/`, its folder
  files list `workbooks`, and the setting `agentSessions` becomes `agentWorkbooks`.
- The workbook format version, `formatVersion` in `dashql-workbook.json`, describes one workbook folder. The steps in
  `src/storage/migration/workbook/` run for every reachable workbook folder, and for folders that are registered later.
  Version 11 renames `dashql-session.json` as `dashql-workbook.json`, with `workbookId` and `workbookPath` in place of
  `sessionId` and `sessionPath`. The steps up to version 10 keep the names of sessions, the layout of their version.

The current versions are in `src/storage/migration/versions.ts`. A migration step spells out every file and folder name it
touches instead of using the storage constants of the app: the constants describe the current layout, a step the
layout of its version. Steps are idempotent, because an interrupted migration repeats its last step.

The migration runs before the storage backend is set up. Meanwhile the storage provider shows the setup page with the
step "Apply Migrations", which is skipped when there was nothing to migrate and shows the error when a step fails.
