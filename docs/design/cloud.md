# Cloud

DashQL can use a database connection as its **cloud**: new workbooks start on it, and DashQL keeps the workbooks that
the user publishes in a database of its own there, every version of a workbook as rows of a few shared tables. A link to
a published workbook will ask the recipient to log in to the same connection and open the workbook from there. DashQL is
then a client of the connection and stores its own state in it, next to the data.

The tables of DashQL are the workbook tables of a `.dashql` file (`workbook_tables.md`), merged across the versions of
all workbooks.

## Status

| Part | State |
|------|-------|
| The cloud connection: setting, sidebar badge, Use as Cloud | done |
| New workbooks start on the cloud connection | done |
| The store: publish, update, list, read any version, delete, cleanup (`cloud/cloud_store.ts`) | done, tested against the embedded Hyper |
| Folders, restoring deleted workbooks, search (`cloud/cloud_folders.ts`, `cloud/cloud_store.ts`) | done, tested against the embedded Hyper |
| Migrations of the tables, with a lock for the installer that runs them (`cloud/cloud_store_schema.ts`) | done, tested against the embedded Hyper |
| The installer: finds what is missing, installs and updates the tables (`cloud/cloud_installer.tsx`) | done, tested against the embedded Hyper |
| Reaching the `dashql` database on a Hyper server and on Database.com | open, see Open below |
| The local cloud: a connection of the embedded Hyper that attaches `clouds/local.hyper` as `dashql`, across reloads | done, tested against the embedded Hyper |
| The cloud setup before the workbench, on a cloud link or on request: choose or add the connection, log in, install, list the workbooks (`cloud/cloud_setup_page.tsx`) | done, tested against the embedded Hyper |
| The Cloud overlay in the top bar: choosing the cloud connection, logging in, the installer, Set Up Cloud (`cloud/cloud_overlay.tsx`) | done |
| Cloud and Local in the sidebar, read-only cloud workbooks, import with their origin, publish over or as new | planned |
| The workbooks, connections and storage of the cloud in the Cloud overlay | planned |
| Publish to Cloud in the menus of a workbook and a connection | planned |
| The cloud link: log in to the connection, read the workbook, import it | planned |

## The Cloud Connection

`cloudConnectionId` of the app settings names the cloud connection (`connections/cloud_connection.ts`). The app
manifest persists it with the other settings, and the connection itself is an ordinary connection of the manifest.

- **Which connections.** A Hyper server that speaks `V3_GRPC` or `V3_HTTP`, Database.com, or a local cloud
  (`isCloudCapable`). All speak Hyper SQL, so a `.dashql` file, a hyperd, Database.com and the local cloud share one set
  of tables. The token of a Hyper link lives only in its tab, and Salesforce Data Cloud and Trino don't write.
- **The database.** The cloud store keeps its tables in the database that the sessions of the cloud connection attach
  for DashQL (`cloudDatabaseOf`): a Hyper server and the local cloud attach it as `dashql`, Database.com attaches the
  Hyper Cloud database of its settings as `lakehouse`. The store names the tables `"<database>"."dashql"."<table>"`.
- **One database per session.** Hyper resolves no unqualified name in a session that attaches several databases, not
  even a read, and no search path helps: `CREATE TABLE t` fails with "create statement could not resolve the schema".
  So a cloud connection that attaches only its cloud database lets scripts on it use unqualified names, which then
  land in the cloud database, and one that attaches more needs qualified names.
- **The local cloud.** To try the cloud without a server, a local cloud is a connection like one to a Hyper server, on
  the embedded Hyper: its params are `{ protocol: 'WASM', attachedDatabases: [{ path: 'clouds/local.hyper', alias:
  'dashql' }] }` (`createLocalCloudParams`). Its session attaches only that database, created on first use unless it
  exists and never dropped, in the `clouds` folder of the OPFS of the app that the OPFS cleanup leaves alone
  (`embeddedAttachedDatabasePath`). So everything runs as on a server: the statements of the store go through the query
  executor and show in the queries viewer, the catalog lists the tables of DashQL, new workbooks start on it, and the
  published workbooks survive a reload. Only a database of the `clouds` folder makes a connection of the embedded Hyper
  a local cloud (`embeddedCloudDatabases`), the embedded Hyper of the app ignores its other attached databases as it
  always did, and workbooks that name the embedded Hyper never take the local cloud for it. The setup page offers a new
  Local Cloud, connects it without a click, and the reset of the installer drops its tables (`dropCloudStore`) to try the
  installer again. Only the window that owns the app runs the embedded Hyper, so one window at a time reaches it.
- **Choosing it.** The row menu of a capable connection in the sidebar offers Use as Cloud, and the row menu of the cloud
  connection offers Stop Using as Cloud. The Cloud overlay of the top bar lists the capable connections when there is no
  cloud connection, and offers Stop Using as Cloud as well. Deleting the connection leaves a setting that names nothing, which reads as no
  cloud connection.
- **The sidebar.** The cloud connection is always listed, first in its group, with a cloud badge next to its status.

## New Workbooks

A new workbook starts on the connection of the latest Hyper link of the tab, otherwise on the cloud connection, otherwise
on the embedded Hyper (`newWorkbookConnection`). Within a workbook, a new script keeps taking the connection of its
neighbor or the pending connection of the workbook (`newScriptConnection`). The fallbacks for connections that are
missing stay on the embedded Hyper: a workbook whose connection is gone, attachments, and the compute of data frames.

## Published Workbooks

DashQL keeps its state in a database of its own in the cloud connection, `dashql`, all of it in the schema `dashql`
(`cloud/cloud_store.ts`):

```
dashql                                      the database of DashQL
└── dashql                                  the schema of DashQL
    ├── cloud_store                         one row: the version of the tables, the oldest clients, the lock
    ├── workbook_folders                    one row per folder
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
  Nothing prunes them yet.
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

### Workbooks and Folders

Where a workbook is shown and whether it was deleted belongs to the workbook, not to a version: moving a workbook
creates no version, and reading an earlier version doesn't move it back. Every change is a single-row `UPDATE`.

| Table | Columns |
|-------|---------|
| `workbooks` | `workbook_id uuid`, `folder_id uuid` (null at the top), `created_at`, `created_by`, `updated_at`, `deleted_at` |
| `workbook_folders` | `folder_id uuid`, `name`, `created_at`, `created_by`, `updated_at`, `deleted_at` |

- **A row per workbook.** The publish of a new workbook writes its row before the version row, in the folder that the
  publish names or at the top. An update leaves the folder alone. A row without versions that is older than an hour is
  left from a publish that never got to its version, a cleanup removes it. Two clients that publish the first version of
  a workbook under the same id may write two rows, the one created first counts.
- **Deleting and restoring.** Deleting a workbook sets `deleted_at`. The workbook and its versions are hidden from then
  on, and a publish to it is refused. Restoring clears `deleted_at`. A cleanup removes workbooks that were deleted more
  than 30 days ago (`purgeAfterSeconds`), with all their versions, their rows last. A publish that races a delete adds a
  version that stays hidden.
- **Folders don't nest.** The top holds folders and workbooks, a folder holds workbooks (`cloud/cloud_folders.ts`). So a
  folder names no parent, and loops, the parents of deleted folders and moves into subfolders can't happen. Nesting
  would be a nullable `parent_id`, a migration that only adds.
- **Folder changes.** Renaming a folder and moving a workbook are single `UPDATE`s. Deleting a folder sets its
  `deleted_at`, its workbooks show at the top from then on, and a cleanup removes the folder after 30 days and moves its
  workbooks to the top for good. A workbook whose folder doesn't exist shows at the top as well.
- **Names.** Clients refuse a folder whose name another folder has, ignoring case. Two clients that create folders of
  the same name at the same time get both, readers show them side by side.
- **Order.** The cloud keeps no order, folders and workbooks are sorted by name, numbers in names by their value. The
  order of the workbooks of a local folder stays a local preference.
- **Search.** `searchCloudWorkbooks` finds the workbooks whose latest versions have a text in their names or in the text
  of a script, ignoring case. The scripts are searched with a single query over `workbook_scripts`.
- **Two trees.** The folders of the sidebar and the folders of the cloud are two trees and aren't synced. Publishing
  names a cloud folder for a new workbook, moving it on one side doesn't move it on the other.

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

### Setting Up the Cloud

The cloud setup is a page like the one of the app loader, a card before the workbench (`cloud/cloud_setup_page.tsx`).
The app loader shows it once after the setup of the app when the URL points to the cloud, a link with the parameter
`?cloud` (`isCloudLink`), and whenever Set Up Cloud of the Cloud overlay asks for it (`app/loading/cloud_setup_gate.tsx`).
Any other start goes to the workbench without a login, also with a cloud connection: the cloud is then reached through
the Cloud button of the top bar. It shows the step that the cloud still needs:

| Step | When | What the page shows |
|------|------|---------------------|
| `choose` | no cloud connection | the connections that can be one with Use, and new ones: Hyper Server, Database.com and Local Cloud |
| `configure` | on Edit Settings or for a new connection | the settings of the connection with their Connect |
| `login` | the cloud connection is not online | the connection with Log In and Edit Settings, the error of the last login |
| `install` | the cloud connection is online | the connection, the installer and the number of workbooks and folders |

- **Log In.** The page logs in with the saved settings, the setup that Connect of the settings runs (`useCloudLogin`).
  Database.com opens its OAuth popup on the click, it keeps no refresh token, so every start of the app logs in again.
  The local cloud logs in without a click.
- **Skipping.** At the start of the app the page offers Continue Without Cloud, the cloud connection stays set and the
  app goes on without it. Once the tables are current the page closes by itself, so a cloud link to a cloud that is
  online and installed only shows the card for the look at the tables. The link keeps its parameter, a reload asks
  again.
- **The Cloud overlay.** The overlay of the top bar shows the cloud connection in one line, its logo, name and health,
  with Log In while it is not online and Stop Using as Cloud. Without a cloud connection it lists the connections that
  can be one, with Use. Once the connection is online the installer follows in the same compact form, in a section
  of its own below a separator, Installation, as on the page. Set Up Cloud opens the page. The local cloud logs in without a click in both (`useLocalCloudAutoLogin`).
- **The cloud state.** `CloudStateProvider` looks at the cloud whenever the cloud connection comes online and after the
  installer ran: what the installer finds and the folders and workbooks of the cloud, listed when this DashQL may read
  the tables (`useCloudState`). The page shows the number of workbooks from it, the sidebar will list them.

### The Installer

The cloud setup and the Cloud overlay show the installer when the cloud connection is online (`cloud/cloud_installer.tsx`),
and asks to connect it otherwise. The installer looks at the tables first (`inspectCloudStore`), with `SELECT`s only, and
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
- **The local cloud.** With a local cloud as cloud connection, the whole path runs in the browser: the setup page, the
  overlay, the installer and its statements through the query executor. The tests run them against the embedded Hyper
  the same way, and a test reopens the local cloud in a new `HyperDB` to check that it keeps the tables.

### Open

- **Reaching the database.** A Hyper server attaches databases per connection (`attachedDatabases` of the connection
  params), so the cloud connection needs `dashql` attached, and the database has to exist before it is attached; the
  installer says so when it can't reach it. Database.com is Hyper, so the statements of the store behave there as in the
  tests against the embedded Hyper, in the Hyper Cloud database that its settings name. Whether a login may create the
  schema `dashql` there is a matter of the org and untested.
- **Links.** A cloud link will carry the sanitized params of the connection and the id of the workbook, and the id of
  a version to open that version instead of the latest one.
- **Atomic statements.** The store relies on a single-row `UPDATE` being atomic, its condition checked against the
  row it changes, which Hyper guarantees: the version that turns ready and the lock depend on it.
