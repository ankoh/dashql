# Storage Layout

DashQL stores its data in the Origin Private File System (OPFS) of the app origin, and native sessions in
directories that the user owns. hyperdb-wasm mounts the OPFS root at `/mnt/fs`, so every OPFS path below is also
a Hyper path. Scripts don't name these paths: a Parquet attachment `sessions/<id>/attachments/a.parquet` is the table
parameter `:a`, which the embedded Hyper reads from the mount of the attachments of the session (see Attachments).

## OPFS root

```
<OPFS root>                                    Hyper: /mnt/fs
├── dashql-manifest.json                       app manifest
├── sessiontree/                               folders of the sidebar, registry of the sessions
│   ├── dashql-folder.json                     sessions of the root folder
│   ├── My Sessions/dashql-folder.json         the folder that a new storage starts with
│   └── <folder>/dashql-folder.json            sessions of a folder, folders nest
├── sessions/<session-id>/                     OPFS sessions
│   ├── dashql-session.json                    session metadata
│   ├── scripts/<script-name>                  script text
│   └── attachments/<name>.parquet             attached Parquet files
├── cache/<hash>.<uuid>.parquet[.last_access]  query result cache of the app
├── connections/<connection-id>/               files of a global connection
│   ├── dashql-catalog-relations.sql           catalog of the last refresh
│   ├── dashql-catalog-functions.sql
│   ├── dashql-catalog-changes.sql             catalog changes since the refresh
│   └── monitoring.hyper                       extract of the Hyper log of the connection
├── shell/                                     files of the standalone shell
│   └── salesforce-login-history.json
├── instances/<instance-id>/                   embedded database of one app window
│   ├── compute.hyper                          data frames
│   ├── user.hyper                             database of the embedded Hyper connector
│   ├── snippets.hyper                         the snippets of the snippet search
│   └── logs/hyperd_<timestamp>.log            log files of its Hyper process
└── exports/<export-id>/                       transient Parquet exports
```

| Path | Written by | Lifetime | Part of session bundles |
|------|------------|----------|-------------------------|
| `dashql-manifest.json` | `OPFSStorageBackend` | persistent | no |
| `sessiontree/` | `OPFSStorageBackend` | persistent | no |
| `sessions/<id>/` | `OPFSStorageBackend` | until the session is deleted | yes |
| `connections/<id>/` | `OPFSStorageBackend`, `HyperLogMetrics` | until the connection is deleted | catalog files only |
| `shell/` | `SalesforceLoginHistoryStore` | persistent | no |
| `instances/<id>/` | `createHyperDBOPFSInstance` | one app window | no |
| `cache/` | `createOPFSQueryResultCache` | until evicted | no |
| `exports/<id>/` | `exportArrowTableAsParquet` | one export | no |

"Clear all data" removes `sessiontree/` first, resets the manifest, removes `sessions/`, `connections/` and `shell/` and clears
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

### The session tree

`sessiontree/` registers every session and holds the folders of the sidebar. Every directory of the tree is a
folder, the directory name is the folder name, and holds a `dashql-folder.json` (schema
`proto/json/dashql/app_folder.json`) with `sessions`, one entry per session of the folder in the order of the sidebar:
`path` (the session id), `storageType` and, for native sessions, `nativePath`. The sidebar lists the subfolders of a
folder before its sessions, in the natural order of their names.

A storage without a session tree starts with the folder `My Sessions`, an ordinary folder that the user may rename or
delete. The tree is only created once, a deleted `My Sessions` folder is not created again. New sessions are
registered at the end of the root, except for a session created from the menu of a folder.

- A session is in exactly one folder. Moving a session rewrites the folder files of its old and new folder, the new
  one first, so an interruption duplicates a session instead of losing it. A session that the tree lists twice
  counts where it comes first in the order of the sidebar, and the next change drops the duplicate.
- Renaming or moving a folder copies its directory and then removes the original, the tree holds small folder files
  only. Deleting a folder moves its sessions and the sessions of its subfolders to its parent, no session is deleted.
- Folder names are not empty, contain no `/` or `\`, are not `.` or `..`, and differ from the names of their
  sibling folders ignoring case.

Writers hold the Web Lock `dashql-session-tree`, which all tabs of the app share. The cleanup holds it together with
the lock of the manifest.

### Sessions

A session folder holds `dashql-session.json` (schema `proto/json/dashql/app_session.json`: `formatVersion`,
`sessionId`, `name`, `connections`, `scripts`, `attachments`, `metadata`) and
the files it lists. Format 8 and older kept `settings.cacheQueryResults`, format 9 drops it: connections decide
whether their results are cached.

- `scripts/` holds one file per script, named by the script.
- `attachments/` holds the attachments, Parquet files that queries read in place: `a.parquet` is the table parameter
  `:a`. A session attaches Parquet files only (`validateDataFileName`): adding or importing another file fails, a
  listing of the folder leaves other files out, and a session file that lists one is sanitized.
  Session bundles rebase these paths when a session is imported under a new id.

The greeter at the root of the app shows the ephemeral session, a session without scripts with `metadata.ephemeral: true`.
It is stored and restored like any other session. The sidebar always lists it as the last session of the root, with the
italic name "New Session" and no menu, and the create button of the sessions jumps to it. Its first script promotes it, whatever created the script: the marker goes, the session takes a free
"Untitled" name and the session moves to the end of the root. The next ephemeral session is created right away.
Every launch ends with exactly one: it creates a missing one and deletes all but the first in restore order. A marked
session that holds scripts stopped before its promotion was written, the restore finishes the promotion.

### The query result cache

`cache/` holds the [query result cache](query_cache.md) of the app, for every session and connection: one Parquet
file per result named `<hash>.<uuid>.parquet`, and an empty `.last_access` marker whose mtime makes the eviction
least-recently-used. The materialized results of runs are files of their keys too, or transient files
(`<uuid>.transient.parquet`) if their keys aren't reusable. hyperdb-wasm mounts the folder read-write at
`/mnt/external/cache`.

### Connections

Connections are global and referenced by sessions through `connectionId`. Their folder holds:

- The catalog files. They are a cache of the last catalog refresh and seed the completion before the
  connection comes online. Session bundles carry the catalogs of their connections as
  `connections/<id>/dashql-catalog-*.sql`.
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

Earlier app versions kept these folders in the OPFS root as `dashql-session-<uuid>/` and let Hyper write its logs
to the default folder `logs/<process-id>/` in the OPFS root, the cleanup removes both. Hyper still creates an
empty `logs/` folder at startup, before the instance settings apply.

### Transient folders

- `exports/<uuid>/` exists while one Arrow table is exported as Parquet. Hyper only writes to registered targets, so
  the export mounts the folder read-write as `/mnt/external/parquet-export-<uuid>` and removes it afterwards.

## Native sessions

The native app keeps a session in a directory that the user chose, the entry of the session tree has `storageType: native`
and `nativePath`. The directory has the layout of an OPFS session folder (`dashql-session.json`, `scripts/`,
`attachments/`), and users may edit its files, see [native file synchronization](native_file_sync.md).

hyperdb-wasm can only read OPFS. When a native session loads, its attachments are mirrored into
`sessions/<id>/attachments/` in OPFS, so the attachments of the session read the same in both storage types.
The app remembers the stamp (size and modification time) that each attachment was mirrored with and copies a
file again only when its stamp changed, so the first load of a session in an app run copies every attachment.
Connections, the manifest, the session tree, the shell files and the instances stay in OPFS.

## Attachments

The embedded Hyper reads the attachments of a session from its OPFS folder `sessions/<id>/attachments/` (of a
native session, the mirror), mounted read-only at `/mnt/external/attachments/<id>`
(`session/attachments/attachment_mounts.ts`). The app mounts the folder before a plan scans an attachment and before it
reads the columns of a Parquet attachment. A change of the attachments, in the app or in a native folder, marks the
mount stale, its next use refreshes it so Hyper looks up the files again. Closing the session removes the mount.

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
  the folder `My Sessions` of `sessiontree/` and version 8 moves the connection params under `sidb` to `dbcom`.
- The session format version, `formatVersion` in `dashql-session.json`, describes one session folder. The steps in
  `src/storage/migration/session/` run for every reachable session folder, and for folders that are registered later.

The current versions are in `src/storage/migration/versions.ts`. A migration step spells out every file and folder name it
touches instead of using the storage constants of the app: the constants describe the current layout, a step the
layout of its version. Steps are idempotent, because an interrupted migration repeats its last step.

The migration runs before the storage backend is set up. Meanwhile the storage provider shows the setup page with the
step "Apply Migrations", which is skipped when there was nothing to migrate and shows the error when a step fails.
