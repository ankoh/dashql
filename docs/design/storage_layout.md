# Storage Layout

DashQL stores its data in the Origin Private File System (OPFS) of the app origin, and native workbooks in
directories that the user owns. hyperdb-wasm mounts the OPFS root at `/mnt/fs`, so every OPFS path below is also
a Hyper path. Scripts don't name these paths: a Parquet attachment `workbooks/<id>/attachments/a.parquet` is the table
parameter `:a`, which the embedded Hyper reads from the mount of the attachments of the workbook (see Attachments).
A runtime in Node keeps the parts it needs in the same layout (see The root of Node), and an older storage migrates at
startup (see Versions and migrations).

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
│   ├── attachments/<name>.parquet             attached Parquet files
│   └── results/<script>.<key>.<gen>.parquet   the stored result of each script
├── connections/<connection-id>/               files of a global connection
│   ├── dashql-catalog-relations.sql           relations of the catalog, written and read as SQL
│   ├── dashql-catalog-functions.sql
│   ├── dashql-catalog-state.json              open questions and relations that are gone, see catalog_updates.md
│   └── monitoring.hyper                       extract of the Hyper log of the connection
├── clouds/local.hyper                          the database of the local cloud, see cloud.md
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
| `workbooks/<id>/` | `OPFSStorageBackend`, the results by `createWorkbookResultFiles` | until the workbook is deleted | yes, without `results/`; `.dashql` files carry the results on request, as result tables (`workbook_results.md`, `workbook_tables.md`) |
| `connections/<id>/` | `OPFSStorageBackend` | until the connection is deleted | catalog files only |
| `shell/` | `SalesforceLoginHistoryStore` | persistent | no |
| `clouds/` | the embedded Hyper, when a local cloud attaches its database | until the connection of the local cloud is deleted | no |
| `instances/<id>/` | `createHyperDBOPFSInstance` | one app window | no |
| `exports/<id>/` | `exportArrowTableAsParquet` | one export | no |

"Clear all data" drops the databases of the local clouds through the embedded Hyper, removes `workbooktree/`, resets the
manifest, removes `workbooks/` with the results of the scripts, `connections/`, `shell/` and `clouds/`. It keeps
`instances/`, because the running window owns its instance.

### The manifest

`dashql-manifest.json` (schema `proto/json/dashql/app_manifest.json`) holds:

- `storageVersion`, the version of this layout, see [Versions and migrations](#versions-and-migrations).
- `connections`, the global connections: `id`, `name`, `params`, `paramsDraft` and `createdAt`. The
  `cacheQueryResults` of earlier versions, whether runs reused the [stored results](workbook_results.md) of their
  scripts, is read and dropped: every connection reuses them.
- `appSettings`.

Writers hold the Web Lock of the manifest, which all tabs of the app share.

### The workbook tree

`workbooktree/` registers every workbook and holds the folders of the sidebar. Every directory of the tree is a
folder, the directory name is the folder name, and holds a `dashql-folder.json` (schema
`proto/json/dashql/app_folder.json`) with `workbooks`, one entry per workbook of the folder in the order of the sidebar:
`path` (the workbook id), `storageType` and, for native workbooks, `nativePath`. The sidebar lists the subfolders of a
folder before its workbooks, in the natural order of their names. The core reads the tree of the folder files and
decides how a change of its workbooks rewrites them (`workbook_format/tree.rs`, `readWorkbookTree` and
`changeWorkbookTree` of the core), and it decides the names of folders (`folderNameError`, `freeFolderName`); the
storage backends of `@akohn/dashql` (`platform/storage/opfs_storage_backend.ts`, `composite_storage_backend.ts`) list
the directories and write the files.

A storage without a workbook tree starts with the folder `My Workbooks`, an ordinary folder that the user may rename or
delete. The tree is only created once, a deleted `My Workbooks` folder is not created again. New workbooks are
registered at the end of the root, except for a workbook created from the menu of a folder.

- A workbook is in exactly one folder. Moving a workbook rewrites the folder files of its old and new folder, the new
  one first, so an interruption duplicates a workbook instead of losing it. A workbook that the tree lists twice
  counts where it comes first in the order of the sidebar, and the next change drops the duplicate.
- Renaming or moving a folder copies its directory and then removes the original, the tree holds small folder files
  only. Deleting a folder moves its workbooks and the workbooks of its subfolders to its parent, no workbook is deleted.
- Folder names are not empty, contain no `/` or `\`, are not `.` or `..`, and differ from the names of their
  sibling folders ignoring case.

Writers hold the Web Lock `dashql-workbook-tree`, which all tabs of the app share. The cleanup holds it together with
the lock of the manifest.

The composite backend holds the tree in memory, and the sidebars of a tab listen to it (`subscribeWorkbookTree`,
`useWorkbookTree` of `storage/storage_provider.tsx`): a change that one sidebar writes, e.g. the one of the drawer, or a
deleted workbook shows in the other one too. A moved workbook shows right away, the other changes once they are written,
and once no change of the tree is being written the backend reads the tree again as it is stored.

### Workbooks

A workbook folder holds `dashql-workbook.json` (schema `proto/json/dashql/app_workbook.json`: `formatVersion`,
`workbookId`, `name`, `defaultView`, `connections`, `scripts`, `attachments`, `metadata`) and
the files it lists. Format 8 and older kept `settings.cacheQueryResults`, format 9 drops it.

- `scripts/` holds one file per script, named by the script. Names compare in NFC and without case: two names that
  differ only there denote the same file. A name holds no `/`, `\`, NUL or `:` (an alternate data stream on NTFS).
  `<name> (recovered).sql` is a recovery copy, see below.
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

The storage writer debounces the writes of the scripts (100 ms) and the page writes the pending ones on `pagehide`, but
a browser doesn't wait for writes when a page unloads: a reload right after an edit, or while the write of a script is
still going, keeps the script as it was before. Chromium writes a file into a swap file `<name>.crswap` and moves it
over the script when the write closes.

### The results of the scripts

`workbooks/<id>/results/` holds the [stored results](workbook_results.md) of the scripts of the workbook: one Parquet
file per script named `<script>.<key>.<gen>.parquet`, and the transient files of runs (`<uuid>.transient.parquet`).
Workbooks never share results. hyperdb-wasm mounts the folder read-write at `/mnt/external/results/<id>`. A native
workbook keeps its results here as well, next to the mirror of its attachments: a workbook that moves to a native
folder keeps them, and so does a workbook that a native folder of the same id replaces (`relocateWorkbookToNative` and
`registerNativeWorkbook` remove only its workbook file, scripts and attachments from `workbooks/<id>/`; the keys of the
results tell whether they fit the scripts of the folder). A `.dashql` file carries the results
of its scripts when the export asks for them, an import adds them to the folder (see Exported and Published Results in
`workbook_results.md`). Up to storage version 9 the app kept one query result cache for every workbook in `cache/`;
the migration to version 10 removes it.

### Connections

Connections are global and referenced by workbooks through `connectionId`. Their folder holds:

- The catalog files. They are a cache of the last catalog refresh and seed the completion before the
  connection comes online. Workbook bundles carry the catalogs of their connections as
  `connections/<id>/dashql-catalog-*.sql`, a `.dashql` file as the rows of its catalog tables (`workbook_tables.md`).
- `monitoring.hyper` (`STORAGE_CONNECTION_MONITORING_FILE`), the monitoring database with the extract of the Hyper
  log that earlier versions kept for the connection overview. The app writes it no more, the metrics of the Hyper log
  are a demo (`examples.md`). A file of an earlier version stays until the connection is deleted with its folder; it
  is never exported.

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

A runtime in Node keeps its files in a folder of its own with the same layout: `workbooks/<id>/results/`,
`workbooks/<id>/attachments/` and `instances/<id>/`. The modules of the runtime reach it through the handles of
`node/node_directory_handle.ts` instead of `navigator.storage`, and the Node build of hyperdb-wasm mounts it at `/mnt/fs`,
so the Hyper paths are the ones of the browser. It is not the root of the app. The Web Locks of its stored results span
one process, see `docs/design/dashql_runtime.md`.

## Native workbooks

The native app keeps a workbook in a directory that the user chose, the entry of the workbook tree has `storageType: native`
and `nativePath`. The directory has the layout of an OPFS workbook folder (`dashql-workbook.json`, `scripts/`,
`attachments/`), and users may edit its files, see [native file synchronization](native_file_sync.md).

### Recovery copies

The writes of a native workbook wait while the app asks whether to reload a folder that changed outside the app, or
while a check reads it. When the window closes meanwhile (`pagehide` of a page that goes away, the flush of Electron
before a window closes), the pending edits of its scripts would be lost. The flush keeps each of them as a recovery
copy next to its script, `scripts/<name> (recovered).sql` (`(recovered 2)` and on when the name is taken). A copy never
replaces a file, the disk version of the script stays. The next launch restores the copy as a script of its own, the
user keeps one of the two versions. Pending deletions and renames of such a workbook are not kept, the files stay as
they are on disk.

### Mirrored attachments

hyperdb-wasm can only read OPFS. When a native workbook loads, its attachments are mirrored into
`workbooks/<id>/attachments/` in OPFS, so the attachments of the workbook read the same in both storage types.
The app remembers the stamp (size and modification time) that each attachment was mirrored with and copies a
file again only when its stamp changed, so the first load of a workbook in an app run copies every attachment.
Connections, the manifest, the workbook tree, the shell files and the instances stay in OPFS.

## Attachments

The embedded Hyper reads the attachments of a workbook from its OPFS folder `workbooks/<id>/attachments/` (of a
native workbook, the mirror), mounted read-only at `/mnt/external/attachments/<id>`
(`AttachmentMounts` of `platform/workbook/attachment_mounts.ts` of `@akohn/dashql`, one per runtime). The runtime mounts the
folder before a plan scans an attachment and before it reads the columns of a Parquet attachment. A change of the
attachments, in the app or in a native folder, marks the mount stale, its next use refreshes it so Hyper looks up the
files again. Deleting the workbook removes the mount, and so does destroying the runtime.

## Hyper paths

| Hyper path | Backed by |
|------------|-----------|
| `/mnt/fs/...` | the OPFS root |
| `/mnt/external/<name>` | browser files and directories registered with `registerExternalFile` and `registerExternalDirectory`, e.g. shell file mounts and Parquet exports |
| `/mnt/external/results/<id>` | the folder `workbooks/<id>/results/` of the stored results of a workbook (`createWorkbookResultFiles`), mounted read-write once a run or a read of a stored result uses it |

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

Two versions describe the stored data. Both migrations are steps of the runtime of the core
(`packages/dashql-core-storage/src/workbook_format/`), the platform reads and writes the files.

- The storage version, `storageVersion` in the manifest, describes the OPFS root. `migrateStorage` of the core
  (a static function of the module, `DashQL.migrateStorage`) brings an older root to the current version at startup with the steps of `storage_migration.rs`, e.g. version 5 moves
  `dashql-shell/` to `shell/`, version 6 drops the `aliases` of the connections, version 7 moves the `sessions` of the
  manifest into the folder `My Sessions` of `sessiontree/`, version 8 moves the connection params under `sidb` to
  `dbcom`, and version 9 renames sessions as workbooks: `sessions/` becomes `workbooks/`, `sessiontree/` becomes
  `workbooktree/`, its folder files list `workbooks`, and the setting `agentSessions` becomes `agentWorkbooks`. Then
  every workbook folder that the workbook tree registers is brought to the current workbook format, the native ones
  through the platform, which claims them for the app first. A fresh storage gets a manifest with the current version,
  the only place that stamps it: the storage of the app keeps the version of the manifest it writes. A storage of a
  newer version is refused.
- The workbook format version, `formatVersion` in `dashql-workbook.json`, describes one workbook folder. The steps are
  in `migration.rs`. `migrate_folder` reads the top-level files of the folder, migrates them in memory, and writes the
  changed files first and removes the others after. A folder whose workbook file is at the current version is only
  read. Besides the startup, the runtime migrates a folder that the platform keeps elsewhere (`storage.workbookFolder`,
  a native workbook folder or a folder that is the storage of a runtime in Node) whenever it reads a workbook file of
  an older format, e.g. after a checkout of an older commit or a native folder that an import registers.
  Version 11 renames `dashql-session.json` as `dashql-workbook.json`, with `workbookId` and `workbookPath` in place of
  `sessionId` and `sessionPath`. The steps up to version 10 keep the names of sessions, the layout of their version.

The current versions come from the core (`DashQL.storageVersions()`), the only source of them. A migration step spells out every file and
folder name it touches instead of using the storage constants of the app: the constants describe the current layout, a
step the layout of its version. Steps are idempotent, because an interrupted migration repeats its last step: the tests
of the core interrupt the migration at every write and run it again (`storage_migration_test.rs`). The step of version
3 removes the catalogs that an interrupted run copied under fresh ids it doesn't plan again, a step that needs a fresh
id fails without one.

The migration runs before the storage backend is set up, without a runtime, over the storage root of the platform
(`createStorageRoot` of `storage/storage_root.ts`: the files and directories of the OPFS root by path, and the native
folders of the desktop app). The storage provider instantiates the core first and holds the lock of the manifest
meanwhile. It shows the setup page with the step "Apply Migrations", which is skipped when there was nothing to
migrate and shows the error when a step fails.
