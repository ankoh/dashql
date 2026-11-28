# Script References

The scripts of a workbook reference each other by name. `bar.sql` can read the result of `foo.sql` with the
table parameter `:foo`:

```sql
select region, count(*) from :foo group by region;
```

A script that is referenced is a single SELECT, its result is the result of the query. A reference reads the query
like a view: it never runs commands, neither in a run of the workbook nor in a run of the consumer. A SELECT with a
data-modifying WITH (`with g as (delete from t returning a) select * from g`) writes whenever it runs, a reference to
it is an error ("gone.sql writes with a data-modifying WITH, bar.sql can only read a query that writes nothing"). A script that is a
single call of a client function that reads is referenced too, but only scanned, see [Client Function Calls](#client-function-calls). A script with
commands, e.g. `create table t as ...; select * from t`, is split into a script with the commands and one with the
query; the planner orders the query after the commands by the relations it reads (`planner_dependencies.md`).

## Connections

Every script runs on a connection, the connection of its entry in the script list of `dashql-workbook.json`.
The planner gets the connection of every script and its kind from the host: LOCAL is the embedded Hyper
(hyperdb-wasm), every other connection (Trino, Salesforce Data Cloud, a remote Hyper) is REMOTE.

| bar.sql runs on | foo.sql runs on | `:foo` in bar.sql |
|---|---|---|
| the connection of foo.sql | | **inline**: the query of foo.sql becomes a common table expression of the statement |
| LOCAL | another connection | **scan**: the query of foo.sql runs first, its result is written as Parquet file and scanned |
| REMOTE | another connection | an error, a remote database cannot read the results of other connections |

An inline reference runs as one query:

```sql
-- foo.sql: select id, amount from orders where amount > 10
-- bar.sql: select count(*) from :foo
with foo as (
select id, amount from orders where amount > 10
)
select count(*) from foo
```

A scan reference scans a Parquet file of the stored results of the workbook, which the host names and mounts. The
scan leaves out the column of the order of the rows that the host writes into the file, `__dashql_row`
(`workbook_results.md`): `* EXCLUDE` fails on a file of an earlier version without it, the natural left join with an
empty relation of the column adds it to such a file and leaves the rows of a file with it as they are.

```sql
with foo as (select * exclude (__dashql_row) from (select * from external('/mnt/external/results/<workbook>/<script>.<key>.<gen>.parquet', format => 'parquet')
  natural left join (select null::bigint as __dashql_row where false) as "__dashql_no_rows") as "__dashql_rows")
select count(*) from foo
```

The host writes the result of foo.sql through hyperdb-wasm for every connection type, into the results folder of the
workbook that is mounted read-write at `/mnt/external/results/<workbook>`, not as a path below `/mnt/fs`.

## Client Function Calls

A script that is a single `CALL` of a client function that reads (`client_functions.md`, Running calls) has a result like
a query: the columns of the function followed by the standard columns, `_status`, `_poll` if the function can
answer before it finishes, `_meta` and `_raw`. The call runs in the host and not in a database, no query can
inline it, so only a **scan** reads it:

| bar.sql runs on | foo.sql is a call that reads, on | `:foo` in bar.sql |
|---|---|---|
| LOCAL | another connection | **scan**: the call runs first, its result is written as Parquet file and scanned |
| the connection of foo.sql | | an error, the call cannot be inlined |
| REMOTE | another connection | an error, as for a query |

A call of a function that writes, of an unknown function or an `EXPLAIN CALL` is an error for every reference
("deleted.sql calls tickets.ticket_delete, which writes, consumer.sql can only read a call that reads"). A script
with a call isn't cacheable, so its file is transient and a script that reads it has no reusable key.

## Scripts That Run on Request

A script that calls a client function that writes runs only on request too, without a tag (`client_functions.md`, Writes).

A script whose query is too expensive without a filter is a building block. A `@manual` tag in a comment of any of
its statements says so; the text after the tag is free, e.g. the reason:

```sql
-- orders_all.sql
/* All orders, expensive without a filter.
   @manual */
select id, region, amount from orders;

-- west.sql
select sum(amount) from :orders_all where region = 'west';
```

A run of the whole workbook and the run of an input change leave the script out, a run of the script itself runs it.
The scripts of its connection inline it with their own filters, so a run of the workbook runs `west.sql` with the query of
`orders_all.sql` inlined. Scripts of other connections cannot reference it: a scan would run it in full, the reference
is an error ("orders_all.sql runs only on request (@manual), the scripts of the connection trino inline it but west.sql
of the connection local cannot read it"). The analyzer sets `AnalyzedScript.manual`, the editor update carries it as
`EditorScriptAnnotations.manual` (`ScriptAnnotations.manual` in the app) and the dataflow as `DataflowScript.manual`.
The feed marks the script as manual.

## Attachments

A table parameter also reads the attachments of a workbook, which are Parquet files only: `sales.parquet` is `:sales`. Scripts and
attachments share one namespace, a name that a script and an attachment share is ambiguous: every table parameter
with the name is an error ("the table parameter :sales matches sales.sql and sales.parquet") and the check lists
the names that collide (`table_parameter_collisions`). The card of an attachment
flags one that a script shares (`collidingAttachments` of the derived view, `Workbook::attachments_named_like_scripts`).

| bar.sql runs on | `:sales` in bar.sql |
|---|---|
| LOCAL | **attachment**: the statement scans the file below the attachment prefix |
| REMOTE | an error, only the embedded Hyper reads attachments |

```sql
with sales as (select * from external('/mnt/external/attachments/<workbook>/sales.parquet', format => 'parquet'))
select region, sum(amount) from sales group by region
```

The runtime lists the attachments of a workbook when it loads the workbook, after the feed adds or removes one
(`attachFiles`, `detachFile`, `refreshAttachments`), and when a native folder changed (`WorkbookScripts.attachments`). The stamp of an attachment is the
size and the modification time of its file. The runtime reads the columns of a new or changed Parquet attachment with the
embedded Hyper (`mounts.attachmentColumns` of the platform over `AttachmentMounts.readColumns`, then `SetAttachmentColumns` of
the workbook). Until then completion doesn't offer it and its
columns stay unresolved, a plan scans it all the same.
The plan requests of a workbook hold its Parquet attachments and the mount of its attachments as prefix
(`/mnt/external/attachments/<workbook>`, `storage_layout.md`), a run mounts them before a statement scans one.

An attachment is a file, not a query: it is no single SELECT and no part of a cycle, and a view may read it since the
file outlives the statement. An inlined query that reads an attachment brings its common table expression along,
before the ones of the scripts. The signature of a script covers the stamps of the attachments it reads
(`workbook_results.md`).

## Planning

The planner (`planner.md`, Script References) resolves the references, splices the common table expressions
into the SQL of the nodes and orders the statements across connections. A run of the whole workbook plans every
script whose stored result is not reused, except the scripts that run on request. A run of one script plans the script and the queries of the scripts it materializes, unless the host
already has their results; the queries it inlines are part of its statements.

## Running a Workbook

A run of the workbook (`runWorkbook`) and a run of a script (`runScript`) run a plan the same way (`workbook_run` of the core runtime): they
analyze every script, publish the declarations into the catalogs of their connections and plan every script, or the
target with what it needs. The plan checks the scripts and gives the result keys. A script whose stored result has
its reusable key doesn't run unless it follows a script that runs: a script whose nodes follow a node of a script that
runs, by an edge of the plan, runs too, whether its result is stored or not. Otherwise its stored result is reused and
the run plans the other scripts again with the reused scripts as `materialized`: a plan of the workbook leaves them
out, a plan of targets drops the reused targets. A script that inlines a reused script still runs its query, a script
that scans it reads the stored file. The stored result of a script whose connection can't run counts as reused
whatever its key (`workbook_results.md`, Reuse): a script on the embedded Hyper that references a Trino script scans
its stored file while Trino is out of reach. A refresh (`refresh` of `runWorkbook` and `runScript`)
reuses no stored results and runs every script of the plan. The run (`run_graph`) starts a node once its predecessors are done,
at most `RunHost::max_concurrent_queries` nodes of a connection run at once (four for a Hyper server, one otherwise), and nodes of different connections run side by
side. The files of a run are the stored results of the workbook (`results` of the platform, `workbook_results.md`),
the mount prefix of the plan is the mount of the results of the workbook, `/mnt/external/results/<workbook>`. The host
names the file of every materialized script (`materializationFile`): a result that a run materializes is the new file
of its script, `<script>.<key>.<gen>.parquet`, a transient file without a key. The terminal node of a materialized
script runs on its own connection, the host loads its result into the compute Hyper and writes it with
`COPY ... TO '<prefix>/<file>'` before the nodes that scan it start (`mount_pin`, `mount_write` of the run host). A
scan reads the byte ranges it needs from disk, nothing of a file is held in memory. The run pins every file it writes
or reads, so other windows leave them alone, and keeps the pins itself. Once it settled, a failed run after its running
statements ended, it releases them; the files of scripts stay with the workbook, the transient files are removed
(`results.remove`). The terminal query of a script that runs stores its result as the new file of the script.

## Running a Script

A run of one script (`runScript` of the runtime) analyzes every script, publishes the
declarations and plans the script as the target: the plan holds the statements of the script, with the queries it
inlines spliced in, and the queries of the scripts it materializes. The scripts that write the relations these queries
read are no part of the plan, the run reads the relations as the backend has them. A script that references no
script is a plan of its own statements. The statements run in their order and keep their SQL whatever their kind,
the last output of the script is its result and a query with `@vis` tags runs as written. An invalid plan fails the
run with its errors, e.g. an unknown script, and so does a script without statements. The script records them as a
failed query in the history of its connection, so they show where its result would be, like the error of a failed
statement. The files of the runs are the stored results of the workbook over the compute database (`results` of the
platform). Without them, a run mounts no results of other connections and stores nothing. A script connection knows whether it is the embedded
Hyper (`ScriptConnection.local`).

A script of another connection than the target, one that the target scans, stands in with its stored file whatever its
key (`stands_in` of `workbook_run/engine.rs`): the run of `bar.sql` scans the stored result of `foo.sql` of Trino, also
an imported one, instead of running the query of `foo.sql` again. Only a refresh runs it. Without a stored file the
script runs.

The result key of a script covers the keys of the scripts it references and the names of their files (`result_keys` in
`workbook_run/result_key.rs` of the core runtime, see `workbook_results.md`): a new result of a script outdates the scripts
downstream of it. When the key is reusable, i.e. the script and the scripts it references are cacheable, a
materialized script whose stored result has its key is reused instead of running (`materialized` of
the plan): the plan scans the file of the script. The stored result of the script is reused when nothing it follows
runs. Every other materialized script runs and writes its result as the new file of the script, named when the run
planned, as a transient file without a key (`mount_file_name` of the run host). A refresh of a script reuses no stored results: the script and
every script of its plan run, their results replace the stored ones.

## Editing

The editor checks, completes and renames script references while the scripts change, with the rules of the planner.

### Checking

`check_script_references` (`script_references.rs`, the references of the `workbookDerived` view) checks the references of every
script whose analysis is current with its text, like a plan of the workbook would: the name lookup, the connections,
a referenced script that is no single SELECT or writes, a reference outside of a query, the common table expressions of a
inlined query, a view that reads a materialized result and cycles. Other scripts may be broken or stale meanwhile, a
referenced script without a current analysis is read as a single SELECT. It reports every table parameter with what
it reads, `INLINE`, `SCAN`, `ATTACHMENT` or `INVALID`, the referenced script or attachment and the messages of the planner, the text
spans in the offset unit of the session of the script (`ScriptReferenceCheck` in `execution_graph.fbs`). The
planner snapshots list the check under `checked-references`.

The runtime checks the workbook whenever a name, a connection or an analysis of a script changes: the checked
references are a buffer of the `workbookDerived` view (`Workbook::with_planner`, see
[dashql_core.md](dashql_core.md#workbooks-and-scripts)). The editor underlines the errors, shows them at the cursor and in the diagnostics
of the script (`dashql_script_references.ts`). A table parameter that reads a script with a result is a table
reference of the analysis that resolves to the result: the cursor on it, on its alias or on a column of it highlights
the reference and the columns like those of a table. The planner and the check of the script references skip these
table references, they read the script through the script reference.

### Table Parameters and Completion

`TableParameters` (`dashql-core/src/table_parameters.rs`) holds the tables that table parameters read: the output
columns of every script of a workbook that is a single SELECT, in workbook order, then the columns of the attachments
of the workbook, as table declarations of the reserved catalog entry `TABLE_PARAMETERS_ENTRY_ID`.
Scripts on a cycle of references have no result, an attachment whose columns the host didn't read has no table.
Every script session of the workbook holds the same table parameters (`Workbook::publish_table_parameters` in
`workbook.rs` of the core runtime; a session outside the workbook takes them with `attachTableParameters`): the analyzer
resolves a named table parameter that finds a table as a FROM source with its columns, named by its alias or the
parameter name. The source yields its name to the other FROM items, like the planner renames its common table
expression. A table parameter that is the target of a write, positional, ambiguous or names nothing with a table
resolves nothing. An analysis that reads table parameters is current only with the table parameters it was analyzed
with: the workbook publishes them after every change of the scripts and the attachments and analyzes the scripts again
whose analysis they outdate. The results of a script follow the results of the scripts it reads, they converge
along the references.

Scripts and attachments share one namespace (`find_table_parameter`): a name finds the only exact name, or the only
name that differs in ASCII case. Several matches are ambiguous, e.g. the script `sales.sql` and the attachment
`sales.parquet`.

Completion offers the names of the scripts with a result and of the attachments with columns after the `:` of a
table parameter in table position, where the parser takes a join after the parameter: `from :|` and `from :fo|`, not
`where x = :|`. A candidate says whether it reads a script or an attachment (`CompletionCandidateObject.table_parameter`).
The columns of a table parameter complete like the columns of a table, `from :foo f where f.|`. The prompt of the
composer reads the table parameters too.

### Mentions and Renames

A click on the `:name` tag of a script inserts the reference at the cursor of the editor that had the focus last,
another script or the prompt of the composer (`useLastFocusedEditor`). The card of a Parquet attachment in the attachments drawer
of the feed inserts its table parameter the same way, it shows the name and warns when a script has the name too. SQL reads `:name` quoted if it has to be,
`:"foo-2"` (`DashQL.quoteIdentifier`).

A rename of a script rewrites the references to it in the other scripts of the workbook: the references of the check
that read the script, with the names before the rename. A mounted editor applies the rewrite as changes, it keeps its
cursor and undoes the rewrite as one step (`ScriptData.externalChanges`). Once the rename is applied, the feed asks the
composer to rename the references in its draft. The SQL draft follows the rename through its own analysis: the table parameters that find the script among the names before the rename
(`DashQLScriptSession.findScriptReferences`), never the text of string literals or comments.

An attachment renames the same way (`renameAttachment` of the runtime, `RenameAttachment` of the workbook): the tag of
its card turns into the input of the name, the runtime names the attachment, the scripts whose table parameters read it
read the new name, the storage writer renames the file (`RenameDataFile`), and then the draft reads the new name. A
refused rename, e.g. of a cloud preview or one whose rewrite fails, changes neither the scripts nor the file. The new
name takes no name of a script or another attachment, `sales` becomes `sales-2` then, and the file keeps its
extension. The rewrite of the references is the one of a script rename, matched on the attachment instead of the
script.
