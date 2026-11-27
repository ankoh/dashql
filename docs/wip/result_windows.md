# Result Windows

Status: steps 1, 2 and 5 landed, and the stored results keep the order of their rows (Row order). The others are planned
and land one by one, step 5 before step 3: every reader of a whole result moves to the compute database first, then the
result of the embedded Hyper stops being an Arrow table without a fallback. This document fixes how DashQL stops holding
whole results in the JavaScript heap: the grid reads the rows it shows, the embedded Hyper writes its results to Parquet
without passing them through JavaScript, and a result in JavaScript is let go once its file exists.

## Where results live today

A result is an Arrow table of the handle table (`store/runtime_tables.ts`), the rule of
[dashql_runtime.md](../design/dashql_runtime.md#results-stay-in-javascript). A query of 500 MB over a dropped Parquet
file therefore holds 500 MB of JavaScript heap, and more on its way:

1. The embedded Hyper scans the file by byte ranges, then streams every row to JavaScript, where the batches become
   one table.
2. The analysis imports the table into the compute database (`importTable` of `runtime/compute_platform.ts`):
   `insertArrowTable` writes the whole table as one Arrow IPC buffer, mounts it as a file and creates `__df_<id>` from
   it.
3. The stored result of the script (`writeTable` of `workbook_result_files.ts`) inserts the table into a temporary
   table of the compute database the same way and copies it to Parquet.
4. A workbook that opens reads its stored results back into JavaScript (`readTable`, ordered by `__dashql_row`).
5. The grid reads its cells from the table (`DataCell`, `ArrowTableFormatter`); an ordering, a filter or a search is
   a table of all row numbers in display order that becomes an `Int32Array` of every visible row
   (`resolveVisibleRowIndices`), and a search a map of every matching row.
6. A chart turns every row into an object (`arrowTableToRows` of `vegalite_view.tsx`).

Remote connections (Trino, Hyper over HTTP, Data Cloud, client functions) end in the same table, so their results
pass through 2 to 6 as well.

## The model

- **The Parquet file is the truth of a result.** A result of a script is its file in `workbooks/<id>/results/`
  ([workbook_results.md](../design/workbook_results.md)), a result that is no result of a script a transient file.
- **The compute database stays scratch.** `__df_<id>` and the tables of the filters, orderings and searches are
  derived, and are computed again from the file when the database is gone, e.g. in a new window
  ([storage_layout.md](../design/storage_layout.md)). No table of the compute database is the only copy of a result.
- **JavaScript holds the rows that show.** The grid reads a window of rows, the window it renders and some rows
  around it, and nothing else. There is no cache of windows: a window replaces the previous one.
- **The protocols stay as they are.** A connector collects the Arrow chunks of a remote result as today; loading
  them into a file is a separate step after the result finished.

## Steps

### 1. The read of a window

The core plans the read of a window of a computation (`compute/tasks/`, `ComputeService`), like the preview of a
result does for its first rows today:

- Without an ordering, a filter or a search: the rows of `__df_<id>` whose row numbers are in the window.
- With one: the table of the filter, the ordering or the search numbers its rows in display order (a position
  column, `row_number()` over the order of the task), and the read joins a range of positions with `__df_<id>`.
  Which table applies (the ordering of a filtered and searched table covers both) is decided in the core, not in
  the grid.

Landed as `plan_row_window` (`compute/tasks/row_window.rs`) and `ComputeService::read_rows`, `readResultRows` of the
facade and `readRows` of the computation model. A window resolves with its rows (the fields of the result and its row
numbers, last) and the count of the rows that show: the state knows it, or a query counts the rows of a filter and a
data search that no ordering covers.

The grid has no other source of its rows, so a read must not fail where the table it replaced showed rows (`read` of
`compute/service.rs`):

- A read needs the import of the result and nothing after it: the data frame of the import has the row numbers
  (`row_number_field` of the computation). The statistics, the system columns and the summaries can fail, e.g. Hyper
  can't cast an `oid` for the system columns; the grid then has no summaries and no filters, but its rows.
- The import names the fields of a result uniquely and never empty (`data_frame_field_names`): a join that repeats
  `id` failed to import before, and its grid stayed empty.
- A read that fails after its computation changed (its lifetime or its revision) is planned again: a filter, a search
  or an ordering replaced a table that it joined, or the result ran again. The stop of an analysis, e.g. a cancel of its
  query, cancels the steps of the analysis, not the reads.
- A read that fails all the same is an error that the grid shows under its rows, a click reads again. The grid doesn't
  retry on its own: a read fails again on the same computation.

Not done yet: the tables of the tasks have no position column, a window reads `ORDER BY ... LIMIT ... OFFSET` over the
selection, only a result without a filter, a search and an ordering reads a range of row numbers. A read deep into an
ordered table of millions of rows sorts the selection again; positions come when a measurement asks for them.

### 2. The grid over windows

The data table renders from its window: the rows that react-window renders plus some rows above and below. When the
rows that show leave the window it reads the next one, a read that a newer read supersedes is dropped. Rows outside
the window render as placeholders. The detail of a cell reads the one row it needs. The `Int32Array` of visible rows
goes away; the map of matching rows goes later, once the window carries the matching columns of its rows.

Landed as `useDataTableWindow` (`components/data_table/data_table_window.ts`): 100 rows of margin above and below the
rendered rows, one window, kept while the rows that show change and dropped when the table changes. A cell formats its
value from the window, the detail of a cell outside of it reads its one row. The layout reads only the schema of the
result. Still in JavaScript: the map of the matching rows of a data search (the highlights of the cells and the count
of the toolbar, `getMatchingRowCount`), and the tables of the filters, orderings and searches that the host keeps by
handle, which the charts read.

### 3. Results of the embedded Hyper stream into the compute database

The result of a query on the embedded Hyper streams batch by batch, as today, but a batch doesn't stay in JavaScript:
it gets its row numbers (`__dashql_row`, Row order) and is appended to a table of the compute database. The stream is
the only part of Hyper that keeps the order of a query, numbering the rows there needs no change of the query. Rows
pass JavaScript one batch at a time, none stay. The handle of the result names that table instead of an Arrow table:
the stored result is a `COPY` of it to its file, the analysis creates `__df_<id>` from it, and the table goes when its
handle goes. A stored result that a workbook reads back is scanned into such a table as well, ordered by
`__dashql_row`.

Decided against: the core rewriting the query so that `COPY (<query>) TO` numbers its rows with
`row_number() OVER (ORDER BY <the keys of the query>)`. No row would reach JavaScript, but the rewrite has to resolve
aliases, ordinals and keys outside the output, and `DISTINCT` and `UNION` need a query around the query. It saves the
way through JavaScript, which a measurement has to show as slow first.

### 4. Remote results let go of their table

A remote result is collected into an Arrow table as today and written to its Parquet file as today. Once the file
exists the table is released, and the result is the file like in step 3. The peak of a remote result stays in the heap
while it loads, but it doesn't stay there.

### 5. The readers of a whole result read the compute database

Lands before step 3. The readers that take the Arrow table of a result by its handle (`useTable`, `QueryModel.result`,
`runtime.table`, the computation's `dataTable`) and read its rows:

| Reader | Where | Rows | Reads instead |
| --- | --- | --- | --- |
| Vega-Lite chart, the crossfilter | `vegalite_view.tsx` (`arrowTableToRows`) | all | the first 10 000 rows with their row numbers (`previewRows`), a warning triangle when capped |
| Chart PNG download | `chart_download_button.tsx` | all | as the chart |
| Chart of the agent | `agent_commands.ts` (`renderChart`) | all | as the chart, a ⚠ problem when capped |
| KPI card | `kpi_view.tsx` (`readKpi`) | all of two columns | the last 1000 rows (`previewRows`) |
| KPI check of the agent | `agent_commands.ts` (`readKpi`) | at most 1000 | the same bounded read |
| Markdown card | `markdown_view.tsx` | all | the first 100 rows (`previewRows`) |
| Plan tab of the shell | `shell_query_result_overlay.tsx` (`getPlanResultText`) | one cell | the first row (`previewRows`) |
| Rows of `run --rows N` of the agent | `agent_output.ts`, `workbook_run_report.ts` | at most 10 000 | a window of the data frame (`readResultRows`) |
| Parquet download | `query_result_download_button.tsx` | all | a `COPY` of the data frame to the file (`exportResultParquet`) |

Landed: the rows of `run --rows N` and of the KPI check of `vis`, the KPI card, the Markdown card and the charts. The
cards and the charts read rows of the result from an offset in its order (`previewResult` of the facade, `previewRows`
of the computation model, `useResultRows` of `components/visualization/result_rows.tsx`), the filters, searches and
ordering of the grid don't apply. A card shows the faint logo while it reads and the error of a read that failed
(`ResultRowsPlaceholder`). The plan tab of the shell reads the first row of a result of one row, no row of a longer
one. The status line of the shell (`executeQuery` of its environments) reads only the counts of the rows and the
columns of the table, it changes with step 6, when a query resolves without a table. A reported run
(`runWorkbookReported`) carries the schema and the first `rows` rows of a result, read with `previewResult` from the
data frame of its computation.

The Parquet download is a `COPY` of the data frame of the computation into a file of a folder that the platform mounts
for the download (`exportResultParquet` of the facade, `ComputeService::export_parquet`, `exportParquet` of
`hyperdb_parquet_export.ts`): Hyper writes the rows, they don't pass through JavaScript until the file is read for the
download. Hyper writes a `COPY` in the order of its query: a CSV of 3 000 000 rows sorted descending came out in order.
There is no Arrow download: hyperdb-wasm knows the formats `arrowstream` and `arrowfile` for `COPY ... TO` but fails
with "this operator is not supported in WebAssembly", and Parquet serves the download better.

A chart draws the first `CHART_ROWS` (10 000) rows of its result with their row numbers, for its cross filters; its PNG
download draws the same rows. Every view that caps the rows of a result shows a warning triangle with the rows that
show and the rows of the result (`CappedRows` of `components/visualization/capped_rows.tsx`): the chart and the KPI
card in a corner, the Markdown card below its rows. For the agent, every capped line starts with ⚠: a capped chart and
KPI card in the problems of `dashql vis`, the rows of `run --rows N`, and the guide tells it to aggregate the query.
Decided against for now: computing the aggregation of a Vega-Lite spec in the compute database. It translates the
transforms of Vega-Lite into SQL in the core, a large piece of work that a measurement has to ask for first.

The stored result write and the analysis import read the whole table too, step 3 replaces them. The grid, the shell
preview, the data search, the filters and the ordering read the data frame already. The size of a result in the header
(`getResultTableBytes`) sums the buffers of the batches; it becomes the size of the file or goes.

### 6. The table of a result goes

Once nothing reads the whole table, results are no Arrow tables of the handle table any more, `importTable`,
`readTable` and the Parquet copy from JavaScript are deleted, and
[dashql_runtime.md](../design/dashql_runtime.md#results-stay-in-javascript) says where results live instead.

## Open questions

- **Row order.** Checked in the Hyper of the Node tests: it keeps no order without being asked. It scans a table or a
  file of millions of rows in parallel, three scans of one file of 3 000 000 rows disagree at most positions;
  `row_number() OVER ()` numbers some rows out of order already at 10 000 rows, also in `CREATE TABLE ... AS`, and over
  an ordered query in no order at all. Only the top-level `ORDER BY` of a query that streams to JavaScript keeps an
  order. The order of a result is therefore a column of its file, `__dashql_row` (workbook_results.md, Storing
  Results): `writeTable` numbers the rows of the table it writes, `readTable` orders by the column, a scan reference
  leaves it out. Before, a stored result of millions of rows read back with rows out of place.
- **Results without a workbook.** The shell outside a workbook and the queries of agents need a folder for their
  transient files.
- **Latency of a window.** A read joins a range of positions with `__df_<id>`; measure it on a table of 500 MB before
  the grid depends on it. A slow read is fixed in its SQL, not with a cache.
- **A window behind a long task.** A filter or an analysis that runs holds a connection of the compute database; a
  read of a window may need a connection of its own so that scrolling doesn't wait for it.
