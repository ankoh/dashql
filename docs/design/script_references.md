# Script References

The scripts of a session reference each other by name. `bar.sql` can read the result of `foo.sql` with the
table parameter `:foo`:

```sql
select region, count(*) from :foo group by region;
```

A script that is referenced is a single SELECT, its result is the result of the query. A reference reads the query
like a view: it never runs commands, neither in a run of the session nor in a run of the consumer. A script with
commands, e.g. `create table t as ...; select * from t`, is split into a script with the commands and one with the
query; the planner orders the query after the commands by the relations it reads (`planner_dependencies.md`).

## Connections

Every script runs on a connection, the connection of its entry in the script list of `dashql-session.json`.
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

A scan reference scans a Parquet file of the query result cache, which the host names and mounts:

```sql
with foo as (select * from external('/mnt/external/cache/<key>.<uuid>.parquet', format => 'parquet'))
select count(*) from foo
```

The host writes the result of foo.sql through hyperdb-wasm for every connection type, into the folder of the query
result cache that is mounted read-write at `/mnt/external/cache`, not as a path below `/mnt/fs`.

## Planning

The planner (`planner.md`, Script References) resolves the references, splices the common table expressions
into the SQL of the nodes and orders the statements across connections. A run of the whole session plans every
script. A run of one script plans the script and the queries of the scripts it materializes, unless the host
already has their results; the queries it inlines are part of its statements.

## Running a Session

A run of the session (`runSessionExecution`) analyzes every script, publishes the declarations into the catalogs of
their connections and plans all scripts at once. `runExecutionGraph` starts a node once its predecessors are done,
at most `maxConcurrentQueries` nodes of a connection run at once, and nodes of different connections run side by
side. The files of a run (`ExecutionMounts`, `createExecutionMounts`) are files of the query result cache of the app
(`query_cache.md`), the mount prefix of the plan is the mount of the cache. The host names the file of every
materialized script (`materializationFile`): a result that a run materializes is a new file of the result key of its
script, `<key>.<uuid>.parquet`, if the key is reusable, a transient file otherwise. The terminal node of a
materialized script runs on its own connection, the host loads its result into the compute Hyper and writes it with
`COPY ... TO '<prefix>/<file>'` before the nodes that scan it start (`ExecutionMounts.writeTable`). A scan reads the
byte ranges it needs from disk, nothing of a file is held in memory. The run pins every file it
writes or reads, so eviction and other windows leave them alone. The files of keys stay in the cache when it ends,
the transient files are removed. The terminal query of a script with a reusable key writes its result as the newest
file of its key, the run reads no cached results.

## Running a Script

A run of one script (`runSessionScript`, `runPlannedScript` in `script_run.ts`) analyzes every script, publishes the
declarations and plans the script as the target: the plan holds the statements of the script, with the queries it
inlines spliced in, and the queries of the scripts it materializes. The scripts that write the relations these queries
read are no part of the plan, the run reads the relations as the backend has them. A script that references no
script is a plan of its own statements. The statements run in their order and keep their SQL whatever their kind,
the last output of the script is its result and a query with `@vis` tags runs as written. An invalid plan fails the
run with its errors, e.g. an unknown script, and so does a script without statements. The script records them as a
failed query (`ScriptPlanError`, `QueryExecutionArgs.failure`), so they show where its result would be, like the
error of a failed statement. The session execution provider registers the services of the runs for its core
(`registerScriptRunServices`): which connection is the embedded Hyper, the mounts of the compute database and the
query result cache. Without the provider, a run mounts no results of other connections and caches nothing.

The result key of a script covers the keys of the scripts it references (`computeScriptResultKeys`, see
`query_cache.md`). When the key is reusable, i.e. the connections of the script and of the scripts it references
cache results, a cached result of the script is served without running the scripts it references, and a materialized
script with a reusable cached key is scanned from the cache instead of running (`materialized` of the plan): the
plan scans the newest file of its key. Every other materialized script runs and writes its result as a new file of
its key if the key is reusable, as a transient file otherwise (`ExecutionMounts.fileName`). A refresh of a script
(`ScriptRunOptions.refresh`) reads no cached results: the script and every script of its plan run, their results
with reusable keys become the newest files of their keys. A run of the session runs every script anew too.

## Editing

The editor checks, completes and renames script references while the scripts change, with the rules of the planner.

### Checking

`check_script_references` (`script_references.rs`, `DashQL.checkScriptReferences`) checks the references of every
script whose analysis is current with its text, like a plan of the session would: the name lookup, the connections,
a referenced script that is no single SELECT, a reference outside of a query, the common table expressions of a
inlined query, a view that reads a materialized result and cycles. Other scripts may be broken or stale meanwhile, a
referenced script without a current analysis is read as a single SELECT. It reports every table parameter with what
it reads, `INLINE`, `SCAN` or `INVALID`, the referenced script and the messages of the planner, the text
spans in the offset unit of the session of the script (`ScriptReferenceCheck` in `execution_graph.fbs`). The
planner snapshots list the check under `checked-references`.

The app checks the session whenever a name, a connection or an analysis of a script changes
(`checkSessionScriptReferences`). The editor underlines the errors, shows them at the cursor and in the diagnostics
of the script (`dashql_script_references.ts`). A table parameter that reads a script with a result is a table
reference of the analysis that resolves to the result: the cursor on it, on its alias or on a column of it highlights
the reference and the columns like those of a table. The planner and the check of the script references skip these
table references, they read the script through the script reference.

### Results and Completion

`ScriptResults` (`dashql-core/src/script_results.rs`) holds the output columns of every script of a session that is
a single SELECT, as table declarations of the reserved catalog entry `SCRIPT_RESULTS_ENTRY_ID`. Scripts on a cycle
of references have no result. Every script session of the session holds the same results
(`DashQLScriptResults.publish`): the analyzer resolves a named table parameter that reads a script with a result
as a FROM source with the columns of the result, named by its alias or the parameter name. The source yields its
name to the other FROM items, like the planner renames its common table expression. A table parameter that is the
target of a write, positional or names no script with a result resolves nothing. An analysis that reads table
parameters is current only with the results it was analyzed with: the app publishes the results after every change
of the scripts and analyzes the scripts again whose analysis they outdate. The results of a script follow the
results of the scripts it reads, they converge along the references.

Completion offers the names of the scripts with a result after the `:` of a table parameter in table position,
where the parser takes a join after the parameter: `from :|` and `from :fo|`, not `where x = :|`. The columns of a
result complete like the columns of a table, `from :foo f where f.|`. The prompt of the composer reads the results
too. In natural language, the prompt hints the rest of the name of a script after `:`.

### Mentions and Renames

A click on the `:name` tag of a script inserts the reference at the cursor of the editor that had the focus last,
another script or the prompt of the composer (`useLastFocusedEditor`). SQL reads `:name` quoted if it has to be,
`:"foo-2"` (`DashQL.quoteIdentifier`). A question in natural language reads `:foo-2`.

A rename of a script rewrites the references to it in the other scripts of the session: the references of the check
that read the script, with the names before the rename. A mounted editor applies the rewrite as changes, it keeps its
cursor and undoes the rewrite as one step (`ScriptData.externalChanges`). Once the rename is applied, the feed asks the
composer to rename the references in its draft. The SQL draft follows the rename through its own analysis: the table parameters that find the script among the names before the rename
(`DashQLScriptSession.findScriptReferences`), never the text of string literals or comments. A question in natural
language has no syntax tree, its `:foo` mentions follow by name.
