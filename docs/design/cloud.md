# Cloud

DashQL can use database connections as **clouds**: DashQL keeps the workbooks that the user publishes to a cloud in a
database of its own there, every version of a workbook as rows of a few shared tables. The app may have several clouds,
all equal. A link to a published workbook will ask the recipient to log in to the same connection and open the workbook
from there. DashQL is then a client of the connection and stores its own state in it, next to the data.

The tables of DashQL are the workbook tables of a `.dashql` file (`workbook_tables.md`), merged across the versions of
all workbooks.

A cloud may hold very many workbooks. Nothing in the app reads all of them: the sidebar lists the clouds, not their
workbooks, the overview of a cloud reads one folder a page at a time and the search runs in the cloud, and the counts of
a cloud come from a single statement.

## Status

| Part | State |
|------|-------|
| Clouds: a list of connections in the settings, sidebar badge, Use as Cloud | done |
| The store: publish, update, read any version, delete, cleanup (`cloud/cloud_store.ts`) | done, tested against the embedded Hyper; the cloud setup runs the cleanup on request |
| Nested folders, paged listings, search, counts (`cloud/cloud_folders.ts`, `cloud/cloud_store.ts`) | done, tested against the embedded Hyper |
| Migrations of the tables, with a lock for the installer that runs them (`cloud/cloud_store_schema.ts`) | done, tested against the embedded Hyper |
| The installer: finds what is missing, installs and updates the tables (`cloud/cloud_installer.tsx`) | done, tested against the embedded Hyper |
| Reaching the `dashql` database on a Hyper server and on Database.com | open, see Open below |
| The local cloud: a connection of the embedded Hyper that attaches `clouds/local.hyper` as `dashql`, across reloads | done, tested against the embedded Hyper |
| The cloud setup before the workbench, on a cloud link or on request: choose or add a cloud, log in, install (`cloud/cloud_setup_page.tsx`) | done, tested against the embedded Hyper |
| Clouds in the sidebar, the overview of a cloud in place of the feed (`cloud/cloud_sidebar.tsx`, `cloud/cloud_overview_page.tsx`) | done, tested against the embedded Hyper |
| Read-only previews, import with the link, publish over or as new, to a chosen cloud (`cloud/cloud_workbooks.ts`) | done |
| A search of the workbooks with SQL in the overview | planned |
| Publishing into a cloud folder, the login as `published_by`, a way to tell published results from local ones in the cache | planned |
| Restoring deleted workbooks and folders in the overview | planned |
| The cloud link: log in to the connection, read the workbook, import it | planned |
| The local cloud keeps its changes across reloads, with a redo log of Hyper | done, tested against the embedded Hyper |

## The Clouds

`cloudConnectionIds` of the app settings lists the cloud connections in the order they became clouds
(`connections/cloud_connection.ts`). The app manifest persists the list with the other settings, and the connections
themselves are ordinary connections of the manifest. All clouds are equal: none is a default.

- **Which connections.** A Hyper server that speaks `V3_GRPC` or `V3_HTTP`, Database.com, or a local cloud
  (`isCloudCapable`). All speak Hyper SQL, so a `.dashql` file, a hyperd, Database.com and the local cloud share one set
  of tables. The token of a Hyper link lives only in its tab, and Salesforce Data Cloud and Trino don't write.
- **The database.** The cloud store keeps its tables in the database that the sessions of a cloud connection attach
  for DashQL (`cloudDatabaseOf`): a Hyper server and the local cloud attach it as `dashql`, Database.com attaches the
  Hyper Cloud database of its settings as `lakehouse`. The store names the tables `"<database>"."dashql"."<table>"`.
- **One database per session.** Hyper resolves no unqualified name in a session that attaches several databases, not
  even a read, and no search path helps: `CREATE TABLE t` fails with "create statement could not resolve the schema".
  So a cloud connection that attaches only its cloud database lets scripts on it use unqualified names, which then
  land in the cloud database, and one that attaches more needs qualified names.
- **The local cloud.** To try the cloud without a server, a local cloud is a connection like one to a Hyper server, on
  the embedded Hyper: its params are `{ protocol: 'WASM', attachedDatabases: [{ path: 'clouds/local.hyper', alias:
  'dashql' }] }` (`createLocalCloudParams`). Its session attaches only that database, created on first use unless it
  exists, in the `clouds` folder of the OPFS of the app that the OPFS cleanup leaves alone
  (`embeddedAttachedDatabasePath`). The file stays until the local cloud is deleted or all data of the app is cleared,
  a local cloud created after that starts empty. So everything runs as on a server: the statements of the store go through the query executor
  and show in the queries viewer, and the catalog lists the tables of DashQL. Only a database of the `clouds` folder makes a connection of the embedded Hyper a local cloud
  (`embeddedCloudDatabases`), the embedded Hyper of the app ignores its other attached databases as it always did, and
  workbooks that name the embedded Hyper never take the local cloud for it. The setup page offers a new Local Cloud,
  connects it without a click, and the reset of the installer drops its tables (`dropCloudStore`) to try the installer
  again.
- **Reloads keep changes.** The embedded Hyper writes an attached database to its file only when a session detaches
  it, and a reload ends the worker without that. So the app starts Hyper with `experimental_redo_log`
  (`HYPERDB_WASM_ENGINE_SETTINGS`): Hyper logs every commit to `<file>.dblog` and replays it on the next attach, the log
  empties once the session detaches the database and goes away when the database is dropped. It costs about 15% of the
  written data and well under a millisecond per small write. The setting applies to the engine, so the databases of
  the instance folder keep a log as well. `platform/hyperdb/integration/redo_log.test.ts` and `cloud/local_cloud.test.ts` cover the reload.
- **Deleting a local cloud.** A local cloud exists only to be one, so its menus delete it rather than stop using it:
  Delete Local Cloud in its row of Clouds, its overview and the setup page (`useCloudRemoval`). After a confirmation
  the workbooks that would only start new scripts on it fall back to the embedded Hyper, it leaves the list of clouds,
  and its connection is deleted (`useDeleteLocalCloud`). While scripts of workbooks run on it, the deletion is refused.
  Deleting a connection of the embedded Hyper, also from the connections of the sidebar, closes its session and then
  drops the databases of the `clouds` folder that it attached, unless another connection attaches them
  (`useDeleteConnection`, `HyperDB.dropAttachedDatabase`). Only the window that owns the app runs the embedded Hyper, so one window at a time reaches it.
- **Choosing.** The row menu of a capable connection in the sidebar offers Use as Cloud, and the row menu of a cloud
  offers Stop Using as Cloud, as do the menu of a cloud on a server in Clouds, its overview and the setup page. Deleting the
  connection leaves an id in the list that names nothing, which is skipped.
- **The connections of the sidebar.** The clouds are always listed, first in their group in the order of the list, with
  a cloud badge next to their status.

## New Workbooks

A new workbook starts on the connection of the latest Hyper link of the tab, otherwise on the embedded Hyper
(`newWorkbookConnection`). A cloud is no default, the app may have several. Within a workbook, a new script keeps taking the connection of its
neighbor or the pending connection of the workbook (`CreateScript` of the workbook in the core runtime). The fallbacks for connections that are
missing stay on the embedded Hyper: a workbook whose connection is gone, attachments, and the compute of data frames.

## Published Workbooks

DashQL keeps its state in a database of its own in every cloud connection, `dashql`, all of it in the schema `dashql`
(`cloud/cloud_store.ts`):

```
dashql                                      the database of DashQL
└── dashql                                  the schema of DashQL
    ├── cloud_store                         one row: the version of the tables, the oldest clients, the lock
    ├── workbook_folders                    one row per folder, with its parent
    ├── workbooks                           one row per published workbook: its folder, whether it was deleted
    ├── workbook_versions                   one row per version of a published workbook, with its workbook row
    ├── workbook_connections                the workbook tables, the rows of every version,
    ├── workbook_scripts                    keyed by (workbook_id, version_id)
    ├── connection_catalog_tables
    ├── connection_catalog_columns
    ├── connection_catalog_functions
    ├── connection_catalog_function_params
    ├── workbook_attachments                the attachments and results of every version,
    ├── workbook_results                    each naming its table
    ├── workbook_attachment_<32 hex>        one table per attachment of a version
    └── workbook_result_<32 hex>            one table per result of a version
```

The rows of a version are keyed by `(workbook_id, version_id)`, both of the type `uuid`. The merged tables have the
columns of the workbook tables after the key. The `workbook` table has no table of its own, its row is part of the row
of the version. `dashql.workbook_versions`, a list that only grows by publishing:

| Column | Type | |
|--------|------|-|
| `workbook_id` | `uuid` | the id of the workbook, the same for all its versions |
| `version_id` | `uuid` | a fresh id of the version |
| `format_version` | `integer` | the rest of the workbook row |
| `name` | `text` | |
| `metadata` | `text` | |
| `state` | `text` | `uploading`, `ready` or `deleting` |
| `created_at` | `timestamptz` | |
| `ready_at` | `timestamptz` | when the version turned ready, null before |
| `updated_at` | `timestamptz` | when the state last changed |
| `published_by` | `text` | the login of the cloud connection that published, null if unknown |
| `app_version` | `text` | the version of DashQL that published, null if unknown |

- **Publishing.** A new workbook gets a fresh id. The row of the version comes first, in state `uploading`. Then the
  rows of the merged tables are inserted under its key. Every attachment and every result gets a table under a fresh
  name, its row in `workbook_attachments` or `workbook_results` is inserted first, then the table is created and
  filled. Last, the row of the version turns `ready` with a single `UPDATE`.
- **Updating.** An update names the workbook and adds a version the same way. The current version of a workbook is the
  one that turned ready last, by `ready_at` and then by version id, so readers see the earlier version until the
  `UPDATE` and the new one after it, never a half-written one.
- **No conflicts.** Two publishes of the same workbook at the same time both become versions, the one that turns ready
  last is the current one.
- **Time travel.** The earlier versions stay. A listing numbers the versions of a workbook in the order they turned
  ready (`listCloudWorkbookVersions`), a reader reads any of them by its id (`readCloudWorkbook` with `versionId`).
  Nothing prunes them yet. The listings of the folders compute the latest version of a workbook and its number in SQL
  (`latestVersionsSQL`): `row_number()` over the ready versions of the workbook by `ready_at` and the id, and their
  `count(*)` as the number, the same numbers as `listCloudWorkbookVersions`.
- **Deleting.** Deleting a workbook marks its row in `workbooks` (Workbooks and Folders below). A cleanup removes the
  workbook later with all its versions. A version is removed in the reverse order of a publish: its row turns
  `deleting`, the tables of its attachments and results are dropped, its rows of the merged tables are deleted, and its
  row goes last. Every step can run again.
- **Nothing without a row.** The row of a version exists before anything else of the version and goes after it, and
  the row that names a data table exists before the table and goes after it. Anything that a failure leaves behind is
  found from a row. A failed publish removes what it wrote. What a lost connection leaves behind is found by the row
  of its version: a cleanup removes the versions in state `deleting` and those that stay `uploading` longer than an
  hour (`cleanupCloud`). Younger uploads may be uploads of other clients and are left alone. A publish that finds its
  row gone at the end, because a cleanup took it for abandoned, removes what it wrote, and a cleanup also removes the
  rows of the merged tables whose key has no row of a version.
- **Shared data tables.** A data table that a row of another version names is never dropped. No client shares data
  tables between versions yet, every publish uploads its own. A client that shares them, to publish an unchanged result
  only once, can rely on every client keeping a table that it names. It has to insert its row before it relies on the
  table, and check that the table still exists before its version turns ready.
- **Only data tables are dropped.** The store drops a table only if its name has the form `workbook_attachment_<32 hex>`
  or `workbook_result_<32 hex>`, whatever a row says.
- **Statements.** The store needs `CREATE SCHEMA`, `CREATE TABLE`, `CREATE TABLE ... AS SELECT`, `ALTER TABLE ... ADD
  COLUMN`, `INSERT`, `UPDATE`, `DELETE`, `SELECT` and `DROP TABLE`, one statement at a time and no transactions. It runs
  them through a function that takes SQL and returns Arrow (`CloudQuery`).
- **Inserts.** Rows travel as `INSERT INTO t (...) SELECT CAST(v.c0 AS <type>), ... FROM (VALUES ('...', ...), ...)`:
  every value as the string literal of its text, cast once per column. The attachment and result tables are Parquet
  files, the embedded Hyper reads them and casts every value to text, so every type that Hyper reads back from its text
  travels the same way. A statement takes rows up to 512 KiB of SQL.
- **Limits.** A publish sends at most 64 MiB of data, measured as the text of the values of the attachments and results
  (`maxDataBytes`). Parquet files that are larger already are refused before anything is sent, a table whose text goes
  past the limit stops the publish and it is removed. The error suggests publishing without the query results.
- **Types.** Every type that a Parquet file of Hyper holds comes back unchanged, `cloud_store.test.ts` publishes one
  value of each. A Parquet file has lost the padding of `char(n)` and the length of `varchar(n)` already, a
  `timestamptz` comes back as the same instant in UTC. An `interval`, a nested array or an `oid` can't be in a Parquet
  file. An attachment that the embedded Hyper can't read, e.g. one with a struct or a map column, fails the publish with
  an error that names it.
- **Ids.** Workbooks and versions have UUIDs, kept as `uuid`, 16 bytes that compare with the text of a UUID. Hyper
  doesn't return a `uuid` as Arrow, so the store selects every id as text, lowercase with dashes, and takes only ids of
  that form. `cloud/hyper_uuid.test.ts` checks what the store relies on, and tells when Hyper returns a `uuid` as Arrow
  and the casts can go. Anyone else who queries the tables of DashQL has to cast the ids as well, `SELECT *` fails.
- **Reading.** A reader selects the rows of a version from the merged tables and converts the attachment and result
  tables to Parquet with the embedded Hyper, the workbook then imports like a `.dashql` file.

### Workbooks in the App

The workbook list of the sidebar always has two folders at the top level: Clouds with a row per cloud
(`cloud/cloud_sidebar.tsx`), empty without one, and Local with the local workbooks and folders below it. Local only
groups the rows, its folders and workbooks are the top level of the workbook tree.

- **Clouds.** Clouds is expanded at first and its row shows the number of clouds. Its menu, also on a right click, adds
  one: Add Cloud opens the setup page. The row of a cloud shows the logo of its connector, its name, its health and the
  number of its workbooks once they were counted. Its menu opens the overview, logs in, refreshes, opens the setup page
  for the cloud and stops using it. A local cloud logs in without a click (`useLocalCloudAutoLogin`). The sidebar never
  lists the workbooks of a cloud, only the preview that is open, below its cloud.
- **The overview.** A click on a cloud shows its overview in place of the feed, like the overview of a connection
  (`cloud/cloud_overview_page.tsx`). It closes when another workbook is shown or the connection stops being a cloud. Its
  header names the cloud with its health and offers Refresh, the setup page and Stop Using as Cloud. While the cloud is
  not online it offers Log In with the error of the last login. Otherwise tiles show the version of the tables of
  DashQL, the number of workbooks, folders and versions and when the last version was published, and the installer
  follows in its compact form (`CloudConnectionInstaller`).
- **Browsing.** Once the tables can be read, a search field and New Folder sit above the path of the folder that is
  shown, from the cloud down, and its folders and workbooks. A folder shows how many folders and workbooks it holds and
  opens on a click, a segment of the path goes back up. A workbook shows its latest version, who published it and
  when, a click opens it read-only and its caret lists its versions. The menu of a folder renames it, moves it to the
  folder above and deletes it, the menu of a workbook opens it, imports it, moves it to the folder above and deletes it
  from the cloud. A folder or a workbook dragged onto a folder or a segment of the path moves there
  (`moveCloudFolder`, `moveCloudWorkbook`). A folder that the overview creates is named right away.
- **Pages.** The overview reads a folder a page of 100 entries at a time (`listCloudEntries`), the next page when the
  end of the list comes into view or on Load More. After every look at the cloud, e.g. after a change, the listing is
  read again with as many entries as it showed, at most 1000.
- **Search.** The search field lists the workbooks of the whole cloud whose latest version has the text in its name or
  in a script, ignoring case, with the folder of each, in pages like a folder. The cloud runs the search, the overview
  waits for a pause in the typing. The request carries the search as an object (`CloudSearch`), the search with SQL
  will be another kind of it.
- **The link.** A local workbook knows the published workbook it came from or was published to, `metadata.cloud` of
  its workbook file: the cloud connection, the id of the published workbook and of the version that was opened or
  published last (`WorkbookCloudLink`). The properties of the workbook write it with its name
  (`setCloudLink`). A `.dashql` file, a link and a publish never carry it (`shared_workbook_tables`), whoever
  reads the workbook links it again.
- **Previews.** A click on a published workbook opens its latest version, a click on a version that version
  (`useCloudWorkbooks().open`). A preview is a local workbook like any other, under a fresh id with `preview` in its
  link, loaded in a step of its own: the version is downloaded and imported like a `.dashql` file, its query results go
  into the result cache. A card in place of the feed shows the steps like the card of an imported file: download,
  resolve the connections, add the query results, save the scripts, save the attachments, open the workbook. A step
  that the version has nothing for is skipped, a failed step stays on the card until it is closed
  (`CloudWorkbookLoadingCard`, `cloud_workbook_loading.ts`). A preview is listed below its cloud and not in Local, its
  menu imports or closes it. One preview at a time: opening another discards the others, and a preview that was shown
  is discarded once another workbook is shown (`CloudPreviewCleanup`). Opening a version that is shown already shows it
  again.
- **The connections of a preview.** A preview keeps the connections of the version, they need not exist in the app.
  The import asks nothing (`connections: 'preview'`): the embedded Hyper is the one of the app, a connection that the
  app has with the same params is used, one that may consolidate with an existing one uses the first candidate, and
  the others are registered for the preview and removed with it, also after a reload: the connections of a preview
  that the app manifest doesn't keep and no other workbook uses (`previewConnections`). The bar shows them greyed with
  a lock, they open nothing; the embedded Hyper is shown as it is.
- **Running a preview.** Execute All runs a preview with no special case but one: only the embedded Hyper counts as
  online (the runs of the runtime). The scripts of the other connections serve the published results from the
  cache or are skipped, like the scripts of a connection that is not connected. The published results stay in the
  cache after the preview is gone, the cache can't tell them from the results of local runs yet.
- **Read-only.** A preview changes nothing until it is imported. The feed page provides `WorkbookReadOnlyContext`: the
  cards have a dashed border and a lock where the run button is, no connection and no actions, the editors are
  read-only, and there is no composer, no adding of scripts or attachments, no agent and no dashboard or dataflow view.
  A single script doesn't run (`runScript`), and the workbook refuses what changes the scripts, the names, the
  inputs or the connections of the scripts (`Workbook::is_cloud_preview` of the core runtime). The bar says Read-only
  preview next to Execute All and offers Import instead of Share and Export.
- **Importing.** Import in the bar promotes a preview: it drops `preview` (`setCloudLink`), the workbook
  stays where it is with its results and is listed in Local from then on. A preview whose connections used an existing
  one that a regular import asks about, or a preview that outlived the page, is imported again instead, now with the
  questions, and the preview is discarded. Import in the menu of a published workbook or a version imports it with the
  questions right away. Each import is a local workbook of its own, an import never replaces a local workbook.
- **Publishing.** The menu of a local workbook offers Publish to Cloud, with several clouds Publish to <cloud> for each
  one. A workbook linked to a published workbook of a cloud offers Publish New Version and Publish as New Workbook for
  that cloud instead, naming the cloud when there are several. The workbook is exported like a shared `.dashql` file,
  with the catalogs and the cached query results and without the login hints (`exportWorkbook` of the runtime with
  the format `tables`, which retains the cached results until the publish sent them), and its link follows the
  published version and its cloud. Results that are too large
  to publish are left out. A publish to a deleted workbook fails, Publish as New Workbook publishes it again. A new
  workbook lands at the top of the cloud.
- **Deleting.** The menu of a published workbook deletes it from the cloud. Local workbooks linked to it keep their
  link.

### Workbooks and Folders

Where a workbook is shown and whether it was deleted belongs to the workbook, not to a version: moving a workbook
creates no version, and reading an earlier version doesn't move it back. Every change is a single-row `UPDATE`, or a
few that can each run again.

| Table | Columns |
|-------|---------|
| `workbooks` | `workbook_id uuid`, `folder_id uuid` (null at the top), `created_at`, `created_by`, `updated_at`, `deleted_at` |
| `workbook_folders` | `folder_id uuid`, `parent_id uuid` (null at the top), `name`, `created_at`, `created_by`, `updated_at`, `deleted_at` |

- **A row per workbook.** The publish of a new workbook writes its row before the version row, in the folder that the
  publish names or at the top. An update leaves the folder alone. A row without versions that is older than an hour is
  left from a publish that never got to its version, a cleanup removes it. Two clients that publish the first version of
  a workbook under the same id may write two rows, the one created first counts, by `created_at` and then the folder
  id, and a deleted row hides the workbook. A listing shows the workbook once.
- **Deleting and restoring.** Deleting a workbook sets `deleted_at`. The workbook and its versions are hidden from then
  on, and a publish to it is refused. Restoring clears `deleted_at`. A cleanup removes workbooks that were deleted more
  than 30 days ago (`purgeAfterSeconds`), with all their versions, their rows last. A publish that races a delete adds a
  version that stays hidden.
- **Folders nest.** A folder names its parent, null at the top (`cloud/cloud_folders.ts`). Creating a folder refuses a
  parent that is missing or deleted. Moving a folder refuses a target that is missing or deleted, the folder itself and
  its descendants: it walks up from the target, a query per level, at most 64 levels (`CLOUD_FOLDER_DEPTH`), and stops
  at a folder that it saw already. `readCloudFolderPath` walks up the same way for the path of the overview.
- **Orphans.** A folder whose parent, or a workbook whose folder, is deleted or missing shows at the top. So a race or a
  delete that stopped halfway leaves nothing hidden. `CloudFolder.parentId` is the parent as shown.
- **Folder changes.** Renaming a folder and moving a workbook or a folder are single `UPDATE`s, moving a workbook
  updates every row of the workbook. Deleting a folder runs three `UPDATE`s that can each run again: its folders move
  to its parent, its workbooks move to its parent, and it gets `deleted_at`. A cleanup removes a folder 30 days after it
  was deleted and moves what still names it to the top first.
- **Loops.** Two clients that move two folders into each other at the same time make a loop. It can't be reached from
  the top and shows nowhere, until a cleanup puts the folders of the loop at the top: a `WITH RECURSIVE` walk up from
  every folder with a parent, at most 64 levels, finds the folders that come back to themselves (`rerooted`). Their
  subtrees stay with them.
- **Names.** Clients refuse a folder whose name a sibling has, ignoring case, with one query for the siblings. The
  siblings at the top include the folders whose parent is deleted or missing. Two clients that create folders of the
  same name at the same time get both, as do the folders that a delete moves up next to one of the same name, readers
  show them side by side.
- **Listing.** A listing reads one folder a page at a time, its folders first and then its workbooks, each by the
  lowercase name, a workbook without a name as the empty one, and then by the id (`listCloudEntries`). The cloud keeps
  no order of its own, numbers in names compare as text. A page is one statement: the folders and the workbooks of the
  page, each limited to the size of the page plus one, the next page starts after the last entry by its kind, name and
  id (`CloudCursor`), no `OFFSET`. A page may hold folders and workbooks, a folder comes with the number of its folders
  and its workbooks. A listing of a folder that is gone is empty.
- **Search.** A listing with a search (`CloudSearch`) lists the workbooks of the whole cloud whose latest version has
  the text in its name or in the text of a script, ignoring case, with the name of the folder of each, in the order and
  the pages of a folder. The text is compared with `strpos`, so `%` and `_` are no patterns.
- **Counts.** `readCloudStats` counts the workbooks with a ready version, the folders and the ready versions of the
  workbooks that weren't deleted, and finds when the last version was published, in one statement of scalar subqueries.
- **Missing tables.** A cloud without the tables of DashQL lists no entries and counts zeros. Writers need the tables:
  the folders, publishing and the cleanup fail with `CloudStoreSetupError` until the installer created them.
- **Two trees.** The folders of the sidebar and the folders of a cloud are two trees and aren't synced. Moving a
  workbook on one side doesn't move it on the other.

### Evolving the Tables

Clients of different versions share the tables, an app that wasn't reloaded keeps the version it started with. The
tables evolve by migrations (`CLOUD_MIGRATIONS`), a list that only grows, and the first one creates the tables. A
migration declares the tables it creates and the columns it adds, so the columns of the tables follow from the number of
migrations that ran (`cloudColumnsAfter`). The `cloud_store` table has one row:

| Column | Type | |
|--------|------|-|
| `version` | `integer` | the number of migrations that ran |
| `min_reader` | `integer` | the oldest client that may read, by the number of migrations it knows |
| `min_writer` | `integer` | the oldest client that may write |
| `lock_owner` | `uuid` | a fresh id of the client that runs migrations, null without one |
| `lock_expires_at` | `timestamptz` | when the lock is free again unless renewed |

- **Opening.** Every operation of the store opens the tables first (`openCloudStore`), which costs a `SELECT` of the
  store row once the tables are current. A client refuses to read when it knows fewer migrations than `min_reader`,
  and to write when it knows fewer than `min_writer`, with an error that asks to update DashQL.
- **Readers.** Listing and reading never create, migrate or wait. A reader that knows migrations that no writer ran yet
  selects only the columns that exist, a missing column reads as null and a missing table as one without rows. A cloud
  without the tables of DashQL reads as empty. So readers go on while an installer migrates, and a login without the
  rights to create or alter tables can still open what others published.
- **Writers.** Publishing, deleting and the cleanup need every column they write. They never create or migrate: tables
  that are missing or miss migrations that the client knows fail with `CloudStoreSetupError`, which names whether the
  installer has to install or to update.
- **The installer.** Only the installer creates and migrates (`installCloudStore`), see below.
- **Creating.** The installer creates the store row with `CREATE TABLE cloud_store AS SELECT ...`, a single
  statement, so the table never exists without its row. Of two installers that try at the same time one fails, reads the
  row of the other and goes on. A store row whose first migration never ran counts as not installed.
- **Locking.** An installer that finds fewer migrations than it knows takes the lock with a single `UPDATE` that sets
  `lock_owner` to its id where the lock is free or expired, and reads the row back: the client whose id it finds holds
  the lock. It runs the missing migrations one by one, and after every migration it counts it and renews the lock with
  an `UPDATE` that names its id. At the end, or when a migration fails, it releases the lock. A client that finds the
  lock taken looks again every second, until the migrations ran or the lock expired, at most for as long as a lock
  holds. A lock holds for 2 minutes and is renewed after every migration, so an installer that lost its connection
  blocks the other installers for 2 minutes at most.
- **Migrations only add.** A migration adds tables and nullable columns, it never renames, retypes or drops. Every
  statement names its columns, so an older client leaves a new column null and never reads it, and a newer client takes
  null for the value of an older one. A migration may run again, also after it stopped halfway, since a lock can expire
  while it runs: it creates a table and adds a column only if it is missing.
- **Breaking migrations.** A migration that older clients can't live with declares it (`breaks`), and before it runs
  `min_writer`, or `min_writer` and `min_reader`, rise to its number. A publish checks at its start, so one that started
  before may still finish. A change that would rewrite the tables makes new ones next to them instead: newer clients
  write the new tables and read both, the published versions stay where they are. Migrations only declare tables and
  columns so far, a migration that copies rows would be the first to run code.
- **Formats of workbooks.** Every version row carries the `format_version` of its workbook. A reader migrates older
  formats like those of a file, and refuses a newer format than it knows with an error that asks to update DashQL.
- **A migration per column.** The first migration spells out its tables and never changes. A column that the
  workbook tables gain needs a migration that adds it, a test checks that the migrations create every column that the
  store uses.

### Setting Up a Cloud

The cloud setup is a page like the one of the app loader, a card before the workbench (`cloud/cloud_setup_page.tsx`).
The app loader shows it once after the setup of the app when the URL points to the cloud, a link with the parameter
`?cloud` (`isCloudLink`), and whenever the app asks for it (`app/loading/cloud_setup_gate.tsx`): Add Cloud of
Clouds, and Cloud Setup of a cloud. A request names the cloud to set up or none, then the page lets the
user choose one, and on a cloud link the page sets up the only cloud. Any other start goes to the workbench without a
login, also with clouds: a cloud is then reached through its row in the sidebar. The page shows the step that the
cloud still needs:

| Step | When | What the page shows |
|------|------|---------------------|
| `choose` | no cloud chosen | the clouds with Set Up, the connections that can be one with Use, and new ones: Hyper Server, Database.com and Local Cloud |
| `configure` | on Edit Settings or for a new connection | the settings of the connection with their Connect |
| `login` | the cloud connection is not online | the connection with Log In and Edit Settings, the error of the last login |
| `install` | the cloud connection is online | the connection, the installer and the number of workbooks and folders, the cleanup once the tables are current |

- **Log In.** The page logs in with the saved settings, the setup that Connect of the settings runs (`useCloudLogin`).
  Database.com opens its OAuth popup on the click, it keeps no refresh token, so every start of the app logs in again.
  The local cloud logs in without a click.
- **Skipping.** At the start of the app the page offers Continue Without Cloud, the cloud stays a cloud and the
  app goes on without it. Once the tables are current the page closes by itself, so a cloud link to a cloud that is
  online and installed only shows the card for the look at the tables. The link keeps its parameter, a reload asks
  again.
- **Cleanup.** Clean Up runs `cleanupCloud` (`cloud/cloud_cleanup.tsx`) and says what it removed: the workbooks and
  folders that were deleted more than 30 days ago, the versions that are being deleted and the uploads that were
  abandoned, and it moves the folders of a loop to the top. It walks every folder with a parent, so it runs only on
  request, and the counts of the cloud follow. At the start of the app the page closes itself when the tables are
  current, the cleanup is reached through Cloud Setup of the cloud.
- **The cloud state.** `CloudStateProvider` looks at every cloud whenever its connection comes online, after the
  installer ran and after every change of the overview: what the installer finds and, when this DashQL may read the
  tables, the counts of the cloud (`useClouds`, `useCloudState`). It never lists workbooks. The page and the overview
  show the counts, the sidebar the number of workbooks, and every look counts up a revision that the listings of the
  overview read again on.

### The Installer

The cloud setup and the overview of a cloud show the installer when the cloud connection is online
(`cloud/cloud_installer.tsx`), and ask to connect it otherwise. The installer looks at the tables first (`inspectCloudStore`), with `SELECT`s only, and
finds one of five states:

| State | What the installer shows |
|-------|--------------------------|
| `unreachable` | The connection reaches no database `dashql`, a probe of `"dashql"."pg_catalog"."pg_namespace"` fails. It asks to attach one. |
| `missing` | No store row, or one whose first migration never ran. Install DashQL, with the steps it runs. |
| `outdated` | The tables miss migrations that this DashQL knows. Update DashQL, with the migrations it runs. |
| `current` | Nothing to do, also when a newer DashQL ran more migrations than this one knows. |
| `newer` | A breaking migration of a newer DashQL raised `min_writer` above this DashQL. It asks to update DashQL. |

- **Compact.** The installer is one line, an indicator, a few words of what it found and its actions: Check Again,
  Install or Update, and for the local cloud Reset. The steps follow as one line each.
- **Steps.** Installing and updating are one action (`installCloudStore`). The installer lists its steps, creating the
  schema and the store row if there is none and every missing migration, its tooltip names the tables and columns it
  adds and whom it breaks. It marks every step as it starts and ends (`onProgress`) and looks at the tables again when it is done.
- **Failures.** The step that failed shows the error of the statement, e.g. a login without the rights to create
  tables, and the installer offers to try again. The steps that ran stay counted in the store row, a second run starts
  after them.
- **Another installer.** When another client holds the lock, the installer says so and waits for it when started. The
  steps that the other client ran count as done.
- **The local cloud.** With a local cloud, the whole path runs in the browser: the setup page, the overview, the
  installer and its statements through the query executor. The tests run them against the embedded Hyper
  the same way, and a test reopens the local cloud in a new `HyperDB` to check that it keeps the tables.

### Open

- **Reaching the database.** A Hyper server attaches databases per connection (`attachedDatabases` of the connection
  params), so the cloud connection needs `dashql` attached, and the database has to exist before it is attached; the
  installer says so when it can't reach it. Database.com is Hyper, so the statements of the store behave there as in the
  tests against the embedded Hyper, in the Hyper Cloud database that its settings name. Whether a login may create the
  schema `dashql` there is a matter of the org and untested.
- **The cost of a listing.** A page reaches the client as one page, but the cloud computes the latest version of every
  workbook for it, a window over all ready versions. With very many versions a table of the latest versions, kept by
  the publish, would make a page cost what it shows.
- **A search with SQL.** The search field of the overview will take a query over the tables of DashQL, another kind of
  `CloudSearch`, and list the workbooks that it finds in the same pages.
- **Links.** A cloud link will carry the sanitized params of the connection and the id of the workbook, and the id of
  a version to open that version instead of the latest one.
- **A cleanup by schedule.** The cleanup runs when a user asks for it in the cloud setup. A cloud that nobody sets up
  keeps its deleted workbooks hidden in the tables; a scheduled job of the cloud could run it instead.
- **Atomic statements.** The store relies on a single-row `UPDATE` being atomic, its condition checked against the
  row it changes, which Hyper guarantees: the version that turns ready and the lock depend on it.
