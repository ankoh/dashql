# Workbook Tables

A workbook that leaves the app travels as a version: the rows of a fixed set of tables. A `.dashql` file is a ZIP that
holds each table as a Parquet file, `<table>.parquet`. A cloud keeps published workbooks in tables of the same names and
columns, the rows of all versions of all workbooks side by side (`cloud.md`): a `.dashql` file is a cloud that holds
one version. Every row starts with the key of its version, `(workbook_id, version_id)`. File and cloud share one
converter, the workbook format of the core runtime (`workbook_format/tables.rs`); only the sink differs. The runtime of
the module exports and imports them (`runtime/exports.rs` and `runtime/imports.rs` of `dashql-core-bindings`), the
platform keeps the ZIP container and the Parquet files (`workbook_archives.ts` of `packages/dashql/src/runtime`), and a
cloud writes and reads the rows itself (`storage/workbook_tables.ts` has their types).

## Sharing a Workbook

| Way | What travels | Where |
|-----|--------------|-------|
| `.dashql` file | the workbook tables as Parquet entries of a ZIP, the query results on request | this document |
| Link, `?zip=` | the same ZIP inline, without query results and by default without catalogs | Links below |
| Hosted folder, `?workbook=` | a workbook folder on a static host, read over HTTP | `workbook_publishing.md` |
| Cloud | the rows of the workbook tables in the tables of a cloud connection | `cloud.md` |

Every way imports through the import of the runtime (`readImport` and `commitImport`, the app asks its questions in
`workbook_import_provider.tsx`): the connections of the workbook are matched with the registered ones, and a workbook
whose id is registered already asks to be replaced or copied. A replacement writes a staged copy first and verifies it
before the registered workbook changes, and copies the files of the registered workbook aside as they are, whatever
their format: a failure after the registered workbook changed writes them back. The catalogs of the connections are a
cache, a failure to seed them leaves the import alone. The names of the scripts and attachments of the tables are taken
in NFC.

### Default View

A workbook opens in its default view: `defaultView` of `dashql-workbook.json` and `default_view` of
`workbook_versions`, `dashboard` or `dataflow`. The field is optional, absent (or unknown) means the feed, and the feed
is never written. A shared workbook opens in it wherever it arrives, e.g. in its dashboard. The bookmark left of the
arrows of the view switch marks the view that shows as the default one (filled while the default view shows, again on
the bookmarked view returns the workbook to the feed), and the overlays of the link and of the file pick it as well
(`Default View` of the export settings). Both change the workbook (`setDefaultView`), not only the export. The app opens
the default view whenever it shows another workbook, unless the URL names a view (`?view=`) or the shell is open.

## Tables

| Table | Columns after the key |
|-------|-------------------------|
| `workbook_versions` | `format_version`, `name`, `metadata` (JSON text), `default_view`, one row per version |
| `workbook_connections` | `position`, `connection_id`, `name`, `params` (JSON text, sanitized for sharing) |
| `workbook_scripts` | `position`, `name`, `connection_id`, `text` |
| `connection_catalog_tables` | `table_id`, `connection_id`, `database_name`, `schema_name`, `table_name` |
| `connection_catalog_columns` | `table_id`, `position`, `column_name`, `column_type` |
| `connection_catalog_functions` | `function_id`, `connection_id`, `database_name`, `schema_name`, `function_name`, `is_aggregate`, `return_type` |
| `connection_catalog_function_params` | `function_id`, `position`, `param_name`, `param_type` |
| `workbook_attachments` | `position`, `name`, `table_name` |
| `workbook_results` | `cache_key`, `table_name`, `script_name` |
| `workbook_attachment_<32 hex>` | the data of one attachment, no key |
| `workbook_result_<32 hex>` | the stored result of one script, no key |

- **Names.** A table is named after what its rows belong to: the workbook or a connection of it. The cloud keeps the
  tables of all published workbooks side by side under the same names and columns (`cloud.md`), only its versions
  table has more: the columns of the store after these.
- **The key.** `workbook_id` and `version_id` are the first columns of every table but the data tables, a version row
  has a key of its own, every other row the key of its version. An export writes one version under a fresh
  `version_id`, every export of a workbook is a version of its own. A reader takes the tables of exactly one version
  and doesn't read the key of their rows. A cloud gives a published version a key of its own (`cloud.md`), so the key
  of a file doesn't carry over into it. In a file the key is `text`, in a cloud `uuid`.
- **Data tables.** Every attachment and every stored result of a script is a table of its own. `workbook_attachments`
  and `workbook_results` name them, the name is unique across versions. A row of `workbook_results` names the file name
  of its script and the key in the name of its file (`workbook_results.md`); archives of earlier versions name only the
  key. The text columns are `text`, the ids of the catalogs, `position` and `format_version` are `integer`,
  `is_aggregate` is `boolean`.
- **Evolving.** A reader reads a missing nullable column as null and a missing table as one without rows, so a later
  version adds nullable columns and tables without breaking readers. A change that a reader must not ignore raises
  `format_version`, which a reader refuses when it is newer than it knows.
- **Workbook file.** A reader assembles the workbook file from the rows and migrates it in memory like the top-level
  files of a workbook folder (`read_workbook_bundle_head`). `format_version` keeps the workbook migrations in charge.
- **Catalogs.** The catalog files of a connection are rows: its tables with their columns, and its functions with their
  parameters. A table has a `table_id` and a function a `function_id`, numbered across the connections of the version in
  the order of their declarations. A column names its table and a parameter its function by that id, so the overloads
  of a function stay apart. The ids aren't declared as keys, the tables have none. An empty database or schema name means the declaration
  names none. An export reads the SQL of the files with the core into a catalog descriptor
  (`parse_catalog_sql` of `catalog_loader/tables.rs`), an import renders the files again from the rows like the catalog
  loader writes them. The files on disk stay SQL
  (`catalog_updates.md`). A rendered file reads back as the same rows, it isn't the text of the original file.
- **Connections only.** Sharing a connection writes a workbook without scripts that holds the connection.

## `.dashql` Files

A `.dashql` file is a ZIP whose entries are named after their tables:

```
workbook_versions.parquet
workbook_connections.parquet
workbook_scripts.parquet
connection_catalog_tables.parquet           (with catalogs only, the same for the columns,
connection_catalog_columns.parquet           functions and parameters)
connection_catalog_functions.parquet
connection_catalog_function_params.parquet
workbook_attachments.parquet                (with attachments only)
workbook_attachment_<id>.parquet
workbook_results.parquet                    (with query results only)
workbook_result_<id>.parquet
```

- **Writing.** The runtime reads the workbook from the storage and the stored results from the results of the workbook, and
  hands the platform the entries of the archive in order (`archives.write`): the rows of a table as Arrow IPC, which
  the embedded Hyper writes as Parquet (`exportArrowTableAsParquet`), and the attachments and results by handle, which
  are Parquet files already and go in unchanged. The core names the entries and their compression. Empty tables are
  left out, and a reader takes a missing table as one without rows.
- **Compression.** The entries are deflated. Hyper compresses the pages of a Parquet file with Snappy, but not its
  footer, which is most of a small table: deflate halves the workbook tables, and an attachment that Hyper wrote as
  well. Hyper takes no Parquet option but `codec`, and deflate over Snappy pages comes out smaller than over plain ones.
  A query result stays stored, an import reads it as a slice of the archive (`workbook_results.md`).
- **Reading.** The platform lists the entries (`archives.entries`), the core decides what each entry is
  (`plan_archive`). The embedded Hyper mounts every workbook table and scans it (`archives.readTable`), the core reads
  the rows of the Arrow IPC. The attachments and results stay with the platform by handle, a stored result as a slice
  of the archive with its CRC-32 (`archives.readFile`).
- **Older archives.** An archive without `workbook_versions.parquet` is an archive of an older version, which holds
  the files of a workbook folder (`dashql-workbook.json`, `scripts/`, `attachments/`, `connections/<id>/`,
  `results/`). The import still reads it, without the embedded Hyper. The first archives of workbook tables, of
  v0.0.19, held `workbook.parquet` and no key; they aren't read.

## Links

A link carries a `.dashql` file inline, base64url-encoded once in the `zip` parameter:

```
https://dashql.app/?zip=<base64url>
dashql://localhost?zip=<base64url>
```

Links never carry query results and leave out the catalogs by default. Links of older versions carry the archive inside
an app event, `?data=<base64url of {"workbook": <base64url of the ZIP>}>`, and still open. The `data` parameter stays for
the small JSON app events, such as Hyper links (`hyper_links.md`) and OAuth redirects.
