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
| the connection of foo.sql | | **fused**: the query of foo.sql becomes a common table expression of the statement |
| LOCAL | another connection | **materialized**: the query of foo.sql runs first, its result is written as Parquet file and scanned |
| REMOTE | another connection | an error, a remote database cannot read the results of other connections |

A fused reference runs as one query:

```sql
-- foo.sql: select id, amount from orders where amount > 10
-- bar.sql: select count(*) from :foo
with foo as (
select id, amount from orders where amount > 10
)
select count(*) from foo
```

A materialized reference scans a Parquet file of the query result cache, which the host names and mounts:

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
already has their results; the queries it fuses are part of its statements.

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
fuses spliced in, and the queries of the scripts it materializes. The scripts that write the relations these queries
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
