# Storage Layout

DashQL stores its data in the Origin Private File System (OPFS) of the app origin, and native sessions in
directories that the user owns. hyperdb-wasm mounts the OPFS root at `/mnt/fs`, so every OPFS path below is also
a Hyper path: `sessions/<id>/attachments/a.csv` is `/mnt/fs/sessions/<id>/attachments/a.csv` in SQL.

## OPFS root

```
<OPFS root>                                    Hyper: /mnt/fs
├── dashql-manifest.json                       app manifest
├── sessions/<session-id>/                     OPFS sessions
│   ├── dashql-session.json                    session metadata
│   ├── scripts/<script-name>                  script text
│   ├── attachments/<file-name>                attached data files
│   └── cache/<hash>.arrow[.last_access]       query result cache
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
| `sessions/<id>/` | `OPFSStorageBackend` | until the session is deleted | yes, except `cache/` |
| `connections/<id>/` | `OPFSStorageBackend`, `HyperLogMetrics` | until the connection is deleted | catalog files only |
| `shell/` | `SalesforceLoginHistoryStore` | persistent | no |
| `instances/<id>/` | `createHyperDBOPFSInstance` | one app window | no |
| `exports/<id>/` | `exportArrowTableAsParquet` | one export | no |

"Clear all data" empties the sessions of the manifest and removes `sessions/`, `connections/` and `shell/`. It keeps
`instances/`, because the running window owns its instance.

### The manifest

`dashql-manifest.json` (schema `proto/json/dashql/app_manifest.json`) holds:

- `storageVersion`, the version of this layout, see [Versions and migrations](#versions-and-migrations).
- `sessions`, one entry per session: `path` (the session id), `storageType` and, for native sessions, `nativePath`.
- `connections`, the global connections: `id`, `name`, `params`, `paramsDraft` and `createdAt`.
- `appSettings`.

Writers hold the Web Lock of the manifest, which all tabs of the app share.

### Sessions

A session folder holds `dashql-session.json` (schema `proto/json/dashql/app_session.json`: `formatVersion`,
`sessionId`, `name`, `connections`, `scripts`, `attachments`, `metadata`, `settings`) and
the files it lists:

- `scripts/` holds one file per script, named by the script.
- `attachments/` holds data files that queries read in place, e.g. `external('/mnt/fs/sessions/<id>/attachments/a.csv')`.
  Session bundles rebase these paths when a session is imported under a new id.
- `cache/` holds the [query result cache](query_cache.md): one Arrow IPC stream per result, and an empty
  `.last_access` marker whose mtime makes the eviction least-recently-used.

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
  snippet and connector with its id, category, path, description and text. `SnippetSearch` fills it on the first search
  and finds the snippets with `ILIKE`.
- `logs/` holds the log files of the Hyper process of the instance, the instance sets it as `log_file_path`. They
  are rotated by `log_file_size_limit` and `log_file_max_count` (`HYPERDB_WASM_ENGINE_SETTINGS`), and
  `hyper_log()` reads them. The monitors of the connections copy them into `connections/<id>/monitoring.hyper`.

The databases are scratch space: data frames are computed again when queries run in a new window. `HyperDB.terminate()`
drops both databases and removes the folder. A Web Lock `dashql-instance-<uuid>` is held while the window lives,
and the startup of the next instance removes every instance folder whose lock is free, e.g. after a crash.

Earlier app versions kept these folders in the OPFS root as `dashql-session-<uuid>/` and let Hyper write its logs
to the default folder `logs/<process-id>/` in the OPFS root, the cleanup removes both. Hyper still creates an
empty `logs/` folder at startup, before the instance settings apply.

### Transient folders

- `exports/<uuid>/` exists while one Arrow table is exported as Parquet. Hyper only writes to registered targets, so
  the export mounts the folder read-write as `/mnt/external/parquet-export-<uuid>` and removes it afterwards.

## Native sessions

The native app keeps a session in a directory that the user chose, the manifest entry has `storageType: native`
and `nativePath`. The directory has the layout of an OPFS session folder (`dashql-session.json`, `scripts/`,
`attachments/`, `cache/`), and users may edit its files, see [native file synchronization](native_file_sync.md).

hyperdb-wasm can only read OPFS. When a native session loads, its attachments are mirrored into
`sessions/<id>/attachments/` in OPFS, so the attachment paths of the session work in both storage types.
The app remembers the stamp (size and modification time) that each attachment was mirrored with and copies a
file again only when its stamp changed, so the first load of a session in an app run copies every attachment.
Connections, the manifest, the shell files and the instances stay in OPFS.

## Hyper paths

| Hyper path | Backed by |
|------------|-----------|
| `/mnt/fs/...` | the OPFS root |
| `/mnt/external/<name>` | browser files and directories registered with `registerExternalFile` and `registerExternalDirectory`, e.g. shell file mounts and Parquet exports |

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
  root to the current version at startup with the steps in `migration/storage/`, e.g. version 5 moves `dashql-shell/`
  to `shell/` and version 6 drops the `aliases` of the connections.
- The session format version, `formatVersion` in `dashql-session.json`, describes one session folder. The steps in
  `migration/session/` run for every reachable session folder, and for folders that are registered later.

The current versions are in `migration/versions.ts`. A migration step spells out every file and folder name it
touches instead of using the storage constants of the app: the constants describe the current layout, a step the
layout of its version. Steps are idempotent, because an interrupted migration repeats its last step.

The migration runs before the storage backend is set up. Meanwhile the storage provider shows the setup page with the
step "Apply Migrations", which is skipped when there was nothing to migrate and shows the error when a step fails.
