# Workbook Tables

A workbook that leaves the app travels as the rows of a fixed set of tables. A `.dashql` file is a ZIP that holds each
table as a Parquet file, `<table>.parquet`. The cloud keeps published workbooks in the same tables, the rows of all
versions merged and keyed by workbook and version (`cloud.md`). File and schema share one converter, the workbook format of
the core runtime (`workbook_format/tables.rs`); only the sink differs. The runtime of the module exports and imports them
(`runtime/exports.rs` and `runtime/imports.rs` of `dashql-core-wasm`), the platform keeps the ZIP container and the
Parquet files (`storage/workbook_archives.ts` of `packages/dashql/src/runtime`), and a cloud writes and reads the rows itself
(`storage/workbook_tables.ts` has their types). The tables hold exactly one workbook, so no row names its workbook.

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
before the registered workbook changes.

## Tables

| Table | Columns |
|-------|---------|
| `workbook` | `workbook_id`, `format_version`, `name`, `metadata` (JSON text), one row |
| `workbook_connections` | `position`, `connection_id`, `name`, `params` (JSON text, sanitized for sharing) |
| `workbook_scripts` | `position`, `name`, `connection_id`, `text` |
| `connection_catalog_tables` | `table_id`, `connection_id`, `database_name`, `schema_name`, `table_name` |
| `connection_catalog_columns` | `table_id`, `position`, `column_name`, `column_type` |
| `connection_catalog_functions` | `function_id`, `connection_id`, `database_name`, `schema_name`, `function_name`, `is_aggregate`, `return_type` |
| `connection_catalog_function_params` | `function_id`, `position`, `param_name`, `param_type` |
| `workbook_attachments` | `position`, `name`, `table_name` |
| `workbook_results` | `cache_key`, `table_name` |
| `workbook_attachment_<32 hex>` | the data of one attachment |
| `workbook_result_<32 hex>` | one cached query result |

- **Names.** A table is named after what its rows belong to: the workbook or a connection of it. The cloud keeps the
  tables of all published workbooks side by side under the same names (`cloud.md`).
- **Data tables.** Every attachment and every cached query result is a table of its own. `workbook_attachments` and
  `workbook_results` name them. The text columns are `text`, the ids, `position` and `format_version` are `integer`, `is_aggregate` is
  `boolean`.
- **Workbook file.** A reader assembles the workbook file from the rows and migrates it in memory like the top-level
  files of a workbook folder (`read_workbook_bundle_head`). `format_version` keeps the workbook migrations in charge.
- **Catalogs.** The catalog files of a connection are rows: its tables with their columns, and its functions with their
  parameters. A table has a `table_id` and a function a `function_id`, numbered across the connections of the workbook in
  the order of their declarations. A column names its table and a parameter its function by that id, so the overloads
  of a function stay apart. The ids aren't declared as keys, the tables have none. An empty database or schema name means the declaration
  names none. An export reads the SQL of the files with the core into a catalog descriptor
  (`CoreCatalogSql` of `workbook_format/catalog.rs`), an import renders the files again from the rows. The files on disk stay SQL
  (`catalog_updates.md`). A rendered file reads back as the same rows, it isn't the text of the original file.
- **Connections only.** Sharing a connection writes a workbook without scripts that holds the connection.

## `.dashql` Files

A `.dashql` file is a ZIP whose entries are named after their tables:

```
workbook.parquet
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

- **Writing.** The runtime reads the workbook from the storage and the cached results from the query result cache, and
  hands the platform the entries of the archive in order (`archives.write`): the rows of a table as Arrow IPC, which
  the embedded Hyper writes as Parquet (`exportArrowTableAsParquet`), and the attachments and results by handle, which
  are Parquet files already and go in unchanged. The core names the entries and their compression. Empty tables are
  left out, and a reader takes a missing table as one without rows.
- **Compression.** The entries are deflated. Hyper compresses the pages of a Parquet file with Snappy, but not its
  footer, which is most of a small table: deflate halves the workbook tables, and an attachment that Hyper wrote as
  well. Hyper takes no Parquet option but `codec`, and deflate over Snappy pages comes out smaller than over plain ones.
  A query result stays stored, an import reads it as a slice of the archive (`query_cache.md`).
- **Reading.** The platform lists the entries (`archives.entries`), the core decides what each entry is
  (`plan_archive`). The embedded Hyper mounts every workbook table and scans it (`archives.readTable`), the core reads
  the rows of the Arrow IPC. The attachments and results stay with the platform by handle, a stored result as a slice
  of the archive with its CRC-32 (`archives.readFile`). An archive without `workbook.parquet` is an archive of an older
  version, which holds the files of a workbook folder (`dashql-workbook.json`, `scripts/`, `attachments/`,
  `connections/<id>/`, `results/`). The import still reads it, without the embedded Hyper.

## Links

A link carries a `.dashql` file inline, base64url-encoded once in the `zip` parameter:

```
https://dashql.app/?zip=<base64url>
dashql://localhost?zip=<base64url>
```

Links never carry query results and leave out the catalogs by default. Links of older versions carry the archive inside
an app event, `?data=<base64url of {"workbook": <base64url of the ZIP>}>`, and still open. The `data` parameter stays for
the small JSON app events, such as Hyper links (`hyper_links.md`) and OAuth redirects.
