# Result Windows

Status: steps 1 and 2 landed, the others are planned and land one by one. This document fixes how DashQL stops holding whole results in the
JavaScript heap: the grid reads the rows it shows, the embedded Hyper writes its results to Parquet without passing
them through JavaScript, and a result in JavaScript is let go once its file exists.

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
4. A workbook that opens reads its stored results back into JavaScript (`readTable`, `SELECT * FROM external(...)`).
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
  `visible_rows.ts`.

Landed as `plan_row_window` (`compute/tasks/row_window.rs`) and `ComputeService::read_rows`, `readResultRows` of the
facade and `readRows` of the computation model. A window resolves with its rows (the fields of the result and its row
numbers) and the count of the rows that show: the state knows it, or a query counts the rows of a filter and a data
search that no ordering covers. The rule of which rows show moved there from `visible_rows.ts`.

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

### 3. Results of the embedded Hyper go to Parquet directly

A script on the embedded Hyper runs as `COPY (<query>) TO '<results mount>/<transient>' WITH (format => 'parquet')`
and the file is moved to its name, as the stored results are today. No row reaches JavaScript: the write of the stored
result is the query itself, and a stored result is not read into JavaScript any more but used as its file. The
analysis creates `__df_<id>` from the file (`CREATE TABLE ... AS SELECT ..., row_number() OVER () FROM external(...)`).

### 4. Remote results let go of their table

A remote result is collected into an Arrow table as today and written to its Parquet file as today. Once the file
exists the table is released, and the result is the file like in step 3. The peak of a remote result stays in the heap
while it loads, but it doesn't stay there.

### 5. Charts read what they draw

A chart doesn't take every row of a result: a spec that aggregates runs its aggregation in the compute database, a
spec of raw marks reads a bounded number of rows. Until this step lands the Arrow table of a result can't go away for
results that a chart shows.

### 6. The table of a result goes

Once nothing reads the whole table, results are no Arrow tables of the handle table any more, `importTable`,
`readTable` and the Parquet copy from JavaScript are deleted, and
[dashql_runtime.md](../design/dashql_runtime.md#results-stay-in-javascript) says where results live instead.

## Open questions

- **Row order.** `row_number() OVER ()` has to keep the order of a query with `ORDER BY`, in the `COPY` and in the
  table created from the file. To be checked in Hyper before step 3.
- **Results without a workbook.** The shell outside a workbook and the queries of agents need a folder for their
  transient files.
- **Latency of a window.** A read joins a range of positions with `__df_<id>`; measure it on a table of 500 MB before
  the grid depends on it. A slow read is fixed in its SQL, not with a cache.
- **A window behind a long task.** A filter or an analysis that runs holds a connection of the compute database; a
  read of a window may need a connection of its own so that scrolling doesn't wait for it.
