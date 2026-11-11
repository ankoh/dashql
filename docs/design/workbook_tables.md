# Workbook Tables

A workbook that leaves the app travels as the rows of a fixed set of tables. A `.dashql` file is a ZIP that holds each
table as a Parquet file, `<table>.parquet`, written and read by one converter (`storage/workbook_tables.ts`). The
tables hold exactly one workbook, so no row names its workbook.

## Sharing a Workbook

| Way | What travels | Where |
|-----|--------------|-------|
| `.dashql` file | the workbook tables as Parquet entries of a ZIP, the query results on request | this document |
| Link, `?zip=` | the same ZIP inline, without query results and by default without catalogs | Links below |
| Hosted folder, `?workbook=` | a workbook folder on a static host, read over HTTP | `workbook_publishing.md` |

Every way imports through the portable import (`workbook_import_provider.tsx`): the connections of the workbook are
matched with the registered ones, and a workbook whose id is registered already asks to be replaced or copied.

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

- **Names.** A table is named after what its rows belong to: the workbook or a connection of it.
- **Data tables.** Every attachment and every cached query result is a table of its own. `workbook_attachments` and
  `workbook_results` name them. The text columns are `text`, the ids, `position` and `format_version` are `integer`, `is_aggregate` is
  `boolean`.
- **Workbook file.** A reader assembles the workbook file from the rows and migrates it in memory like the top-level
  files of a workbook folder (`readWorkbookBundleHead`). `format_version` keeps the workbook migrations in charge.
- **Catalogs.** The catalog files of a connection are rows: its tables with their columns, and its functions with their
  parameters. A table has a `table_id` and a function a `function_id`, numbered across the connections of the workbook in
  the order of their declarations. A column names its table and a parameter its function by that id, so the overloads
  of a function stay apart. The ids aren't declared as keys, the tables have none. An empty database or schema name means the declaration
  names none. An export reads the SQL of the files with the core into a catalog descriptor
  (`connections/catalog/catalog_structure.ts`), an import renders the files again from the rows. The files on disk stay SQL
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

- **Writing.** The embedded Hyper writes the workbook tables (`exportArrowTableAsParquet`). Attachments and results are
  Parquet files already, so they go in unchanged. Empty tables are left out, and a reader takes a missing table as one
  without rows.
- **Compression.** All entries are stored without compression: Parquet compresses its own pages, and an import reads a
  result as a slice of the archive (`query_cache.md`).
- **Reading.** The embedded Hyper mounts every workbook table and scans it (`readWorkbookTableParquet`). An archive
  without `workbook.parquet` is an archive of an older version, which holds the files of a workbook folder
  (`dashql-workbook.json`, `scripts/`, `attachments/`, `connections/<id>/`, `results/`). The import still reads it,
  without the embedded Hyper.

## Links

A link carries a `.dashql` file inline, base64url-encoded once in the `zip` parameter:

```
https://dashql.app/?zip=<base64url>
dashql://localhost?zip=<base64url>
```

Links never carry query results and leave out the catalogs by default. Links of older versions carry the archive inside
an app event, `?data=<base64url of {"workbook": <base64url of the ZIP>}>`, and still open. The `data` parameter stays for
the small JSON app events, such as Hyper links (`hyper_links.md`) and OAuth redirects.
