# Workbook Results

Every workbook keeps the last result of each of its scripts as a Parquet file in its own folder,
`workbooks/<id>/results/`. A workbook shows these results when it opens, a run may reuse one instead of running its
script, and an exported or published workbook carries them. Results belong to their workbook: two workbooks never
share a result, also when they run the same script on the same connection. A new workbook runs its queries anew.

The results are a convenience: a failure to look up, read, write, rename or remove a file is logged and never makes a
query fail. A missing or broken file is a script without a stored result.

## Layout

```
workbooks/<workbook-id>/
├── .gitignore                         results/
└── results/
    ├── <script>.<key>.<gen>.parquet   the last result of a script
    └── <uuid>.transient.parquet       a materialized result that is no result of a script
```

- `<script>` is the name of the script without `.sql`, e.g. `revenue` of `revenue.sql`, as the workbook names it
  (`scripts/<script>.sql`). Every script ends in `.sql`, the name leaves it out like a reference `:revenue` does.
- `<key>` is the result key of the script when the result was written, 64 lowercase hex digits (Result Keys below).
- `<gen>` is 20 lowercase hex digits, new for every file: the time the run named the file in milliseconds since the
  epoch, 12 digits, and a sequence, 8 digits, that counts up within a millisecond and starts at a random number in a new
  one (`Generations`). The names of the files of a script sort by the time they were named, and the time is when the
  result was written. A path is never written twice: the compute database remembers the files that it opened below a
  mount and would read the old bytes of a reused path. Earlier versions wrote 8 random digits, these files still parse
  and sort before the others, by their modification times.
- A transient file, `<uuid>.transient.parquet`, is a materialized result that a run scans but that is no result of a
  script, e.g. a script that runs on request. It is garbage once nobody pins it.

The core parses and names the files (`workbook_format/results.rs` of `dashql-core-storage`): a name splits at its last
three dots, a script name may hold dots itself. A file whose name doesn't parse, or whose script is not a script of the
workbook any more, is garbage too. Script names compare like the names of scripts do, in NFC and without case.

A script has at most one result, its newest file. A run leaves the older files of its scripts until it ended: removing
them would make the next use of the mount refresh it while the queries of the run use the compute database, which
refuses that. Once the run ended and its writes are done it removes them (`vacuum` of `runs/stored_results.rs`), the
run resolves after that. A file that is read then stays, the next listing removes it.

The `.gitignore` of a workbook folder holds `results/`, together with the entries of native workbook folders
(`cache/`, `*.hyper`). The storage writer of the core decides it: with the first write of the workbook file of a
workbook it appends the missing entries (`gitignore_with_entries` of `workbook_format/layout.rs`), the lines of the user
stay. The storage of the platform only loads and saves the file (`loadGitignore`, `saveGitignore`). The results of a native workbook live in its folder of the
origin private file system, `workbooks/<id>/results/`, like the mirror of its attachments: the embedded Hyper mounts
only folders of the origin private file system. The `.gitignore` of the native folder holds `results/` all the same.

The compute database mounts the results of a workbook read-write at `/mnt/external/results/<workbook-id>`, like its
attachments at `/mnt/external/attachments/<workbook-id>` (`WorkbookResultMounts` of the platform). Hyper writes a
result with `COPY ... TO` into the mount and reads it with `external('<path>', format => 'parquet')`, fetching the
byte ranges it needs. A result is written as a transient file and moved to its name once it is complete, so readers
never see a partial file. After the files of a workbook were removed or renamed, the next use of its mount refreshes it
(`refreshExternalDirectory`), the database looks the paths up again and forgets the files that are gone. A refresh
doesn't wait for readers, queries that run keep reading the files they opened. The database refuses a refresh while
its queries run, the mount stays stale then and the next use tries again: a result never reuses a name.

Readers pin the files they read with a shared Web Lock named `dashql-workbook-results/<workbook-id>/<name>`, which spans
the windows of the app. A write pins its new file and its temporary file. A removal or rename only touches a file if it
gets the exclusive lock at once (`ifAvailable`), pinned files stay and the next listing removes them once they are
free. The release of a pin resolves once the lock is released.

## The Platform and the Core

The platform only lists, reads, writes, moves and removes files (`WorkbookResultFiles`,
`packages/dashql/src/platform/workbook/workbook_result_files.ts`, over the origin private file system or the root of
Node). The core decides everything else (`runs/results.rs` of the bindings over `workbook_format/results.rs`): the
names of new files, which file is the result of a script, which files are garbage, when a file is read, written, renamed
or removed.

| Call of the platform | What it does |
| --- | --- |
| `files(workbookId)` | The Parquet files of the results folder with their sizes and modification times |
| `mount(database, workbookId)` | Mount the folder, refresh a stale mount |
| `pin(workbookId, name)` | Keep a file while it is read or written, resolves with the release |
| `writeTable(database, workbookId, table, name)` | Write a table as a file, moved in place once complete |
| `readTable(database, workbookId, name)` | Read a pinned file into an Arrow table |
| `readFile(workbookId, name)` | The bytes of a file, e.g. for an export |
| `importFile(workbookId, name, data, crc32)` | Stream bytes into a new file, checked against the CRC-32 |
| `move(workbookId, from, to)` | Rename a file that nobody reads, false if it is pinned |
| `remove(workbookId, name)` | Remove a file that nobody reads, false if it is pinned |

## Result Keys

Each result is named after a lowercase SHA-256 digest:

```
SHA-256("dashql-query-cache-v3" + framed(stableJson(connectionParamsSignature), scriptAstSignature))
```

The runtime derives the key in Rust (`executor::cache_key` of `dashql-core-runtime`, `Connections::result_key` of the
bindings): `connection_cache_signature` produces the connector-specific signature from the setup params of the
connection and excludes transient connection state, `result_key_input` sorts the object keys recursively and frames
both signatures by their lengths in UTF-16 code units. The platform computes the digest (`crypto.sha256`). DashQL core
derives the script signature from the parser output: statement order, identifiers, literals, operators, and AST
structure participate, while whitespace, comments, source offsets, and parser allocation IDs do not. All statements
contribute, including commands preceding the terminal result statement.

The plan of a script records its AST signature and whether it is cacheable (`ExecutionGraphScript.signature` and
`cacheable`). A script that references other scripts with table parameters (`:foo`, see `script_references.md`)
appends the key of each referenced script and the name of its file to its AST signature, `<key> <file>` per line, or
the key alone for a script without a file. The name of a file is new for every result, so a new result of `foo.sql`
is a new key of `bar.sql`, which references it, and of every script downstream of `bar.sql`: a refresh of `foo.sql`
outdates them, and the next run computes them anew. A run settles the scripts in the order of their references and
names the file of a script before the keys of the scripts downstream of it: the stored file that it reuses, the new
file that it writes, named when the run plans, or, for a script that the run doesn't run, e.g. one that another script
inlines, its stored file. The lookup of the stored results takes the files of the listing. The AST signature of a script that binds
inputs is followed by their literals, `:min=10` per line (`workbook_inputs.md`), a new value is a new key. A script
that reads attachments is followed by their stamps, `attachment sales.parquet=<stamp>` per line, a changed file is a
new key. Every planned script has a result key (`result_keys` in `workbook_run/plan.rs` of the core runtime). For a
terminal query with `@vis` tags the signature excludes the tags, they are comments: result analysis and visualization
projection run after the result was read, so visualization-only edits reuse the same raw result.

A script whose connection has no key, e.g. a Salesforce connection whose account is still unknown, stores no result;
a result that it materializes for another script is a transient file.

The connection signature keys results per login: a result is the result of the user who ran the query, row-level
security or the sharing rules of Salesforce may show another user other rows of the same tables. A Trino connection
with basic auth is keyed by its user; one with OAuth by the account of its token, the `sub` of the token response or
of its OpenID Connect id token. A Salesforce or Database.com connection is keyed by the account that the user info of
its login named, a login hint that the user typed never keys a result. The credentials stay out, a new token of the
same login reuses the results. A Hyper connection is keyed by its endpoint, its attached databases and its session
settings; the Hyper of a link (`V3_HTTP_LINK`) adds the fingerprint of the token of its link (FNV-1a), so another
Hyper that listens on the same port later never serves the results of an earlier one.

The key is a check, not an address: the file of a script is found by the script name, the key in its name tells
whether the result still fits the script. Keys may change between versions of DashQL, a result of another version is
shown all the same and runs again once the user runs it.

## Reuse

A key is reusable if the script is cacheable and the keys of the scripts it references are reusable. Only scripts whose statements are all `SELECT` or `EXPLAIN` are cacheable: a reuse skips the complete
script, so a script with commands before its terminal query, such as `CREATE TABLE t AS ...; SELECT * FROM t`, always
executes. A referenced call of a client function is never cacheable.

Every connection reuses results the same way, there is no choice per connection: **Run**, **Execute All** and a
change of inputs reuse a stored result whose key fits, only **Refresh** computes a result anew. A refresh outdates the
results downstream of the script, the next run computes them anew (Result Keys above). The app manifest of earlier
versions kept a choice per connection, `cacheQueryResults` of a connection entry: it is read and dropped.

A run reuses the result of a script if the key in the name of its file equals the reusable key of the script. A run of
a script executes a plan of the script like a run of the workbook executes the plan of every script
(`packages/dashql-core-runtime/src/workbook_run/`): it derives the result keys from the plan and, for a script whose
key is reusable and stored and that follows no script that runs, runs only the terminal query of the script with the
result option `only`: the executor reads the file and never runs the query on the backend, since the query holds only
after the statements before it. If the file is gone meanwhile, the executor fails with a miss and the script runs.
A refresh (`refresh` of `runScript`) reuses no result. Shell queries never reuse or store results: the workbook shell
and the standalone shell run their statements with `execute` of the runtime, so do internal catalog, setup and
health-check queries.

**Execute All** also runs while connections of the workbook aren't connected (`can_run` of the host of the run, the
connections that are online when the run starts). A script whose connection can't run doesn't run, so it doesn't keep
the scripts after it from reusing their results: the script can't change what they read during the run. The scripts
of such a connection reuse their results if their keys match, the others are skipped with every statement that
follows them. A script runs completely or not at all. The run counts the skipped scripts
(`WorkbookRunState.skippedScripts`, `skippedFiles`), the status shows `3/5 completed · 2 need a connection`, its
tooltip names the scripts, and the connections of the workbook pulse in the bar once a run of the open page settles. A
skipped script keeps showing its stored result. The log of a run that skipped scripts names each one with the reason,
the key it looked for and the key of the stored file.

## Storing Results

Every run of a script stores its result: the terminal query of a script runs with the result option `store` and the
name of the script, and after the query succeeded, or after only the analysis of its result failed, the compute
database writes the table as a new file of the script (`<script>.<key>.<gen>.parquet`, named by the run when it
planned). The older files of the script go when the run ended. A script that ran to its end without a result, e.g. one
whose last statement is a `CREATE TABLE`, has its files removed: they describe an earlier text. A failed, cancelled or skipped run leaves the files alone. The
caller is not blocked on the write. A failed write only produces a log message.

The query is in the history of its connection before the runtime describes it. On a read, the executor reads the file
through the mount while it is pinned, and the history records it like the result of a streamed query, with empty
metadata and zeroed stream metrics; then the shared analysis and success path runs. The query records whether it was
read from the file (`servedFromCache`), for the UI.

Cancellation during a lookup is treated like any other cancellation, the query ends at once. A read runs to its end,
the run of the query owns the table that it read, then the query ends as cancelled.

## Opening a Workbook

Loading a workbook doesn't read its results. Showing it does: the feed page tells the runtime that it shows a
workbook (`showWorkbook(workbookId)`), and the first time a workbook is shown, the runtime reads the stored
result of every script that has no result yet, one after the other once the compute database is set up. The read is a
run of the workbook that runs nothing (`stored` of the run options) and goes the way of every run: it plans the
workbook and settles the results of the scripts in the order of their references, like a run whose connections can't
run, except that it takes the stored file of a script whatever its key. Its plan is tolerant (`PlanScope::Tolerant`,
`planner.md`), so a script that can't be planned, e.g. one without a current analysis, is left out and leaves the
others alone. A script whose plan has an error, e.g. an unknown reference, shows its stored result too. Each read is a
query of the connection of the script that only reads the file: the card shows the result like the result of a run,
marked as stored. A script whose key differs from the key in the name of its file is marked as outdated; running it
computes a new result. A script whose visualization doesn't decode reads nothing.

The read is a run of the workbook for the app as well: it holds the workbook (`held` of the run slice is `open`) and
reports its state like Execute All (`state` of the run slice), counting the scripts that it looks at. The bar shows its
progress and its Stop, and the status logs its end like the end of every run of the workbook. The read is no reuse by
a run and skips no script. A workbook that a run holds when it is shown reads its results once the run ended.

A script whose result was read stays as it is when the workbook is shown again. The view of a script carries its stored
result (`storedResult`: the name of the file, its key, when it was written, whether the key is the key of the script
as it is now), which the runtime looks up (`runs/stored_results.rs` of the bindings) from the listing of the folder. A
workbook is looked up once its changes paused: a change of the workbook (a move of the cursor is none), of a
connection of its scripts, a result that a query of it recorded and the end of a run. A lookup plans the keys and lists
the folder once, a workbook whose analyses are outdated waits for them. A script that can't be planned, e.g. one with
an unknown reference or an input without a value, leaves the keys of the other scripts alone.

## Renames and Deletes

A script has at most one result, so a change of the scripts touches at most one file each:

- Renaming a script renames its file, `<old>.<key>.<gen>.parquet` to `<new>.<key>.<gen2>.parquet` with a new
  generation. A file that is read right now stays where it is and is garbage once the read ends: the script runs
  again.
- Deleting a script leaves files of no script, the next lookup removes them once nobody reads them.
- Deleting a workbook unmounts its results and removes its folder with them.

Only the lookup and the end of a run remove garbage, also the older files of a renamed script and the files that an
import replaced. A script that ran to its end without a result removes its files at once (Storing Results).

The lookup of a workbook removes the files that nobody pins and that are garbage: files of no script of the workbook,
transient files, names that don't parse, older files of a script. While a run holds the workbook the lookup removes
nothing, the run removes the garbage once it ended (`vacuum`). A rename that lost a race against a read leaves a file
of the old name, the next lookup removes it.

## Script References

A script that references a script of another connection reads the result of that script as a Parquet file of the
results of the workbook (`script_references.md`). The planner takes the file names from the host
(`materializationFile`) and scans `/mnt/external/results/<workbook-id>/<name>`:

- A run scans the stored file of a script whose key is reusable and matches, the producer doesn't run unless it
  follows a script of the plan that runs (`script_references.md`). The run pins the file from the lookup on until it
  ends.
- Otherwise the producer runs. Its terminal node writes its result as the new file of the script, the older files go
  when the run ended. A materialized result that is no result of a script is a transient file.
- A refresh runs every producer anew and writes its result the same way.

The run pins every file it writes or reads until it settled, then it removes its transient files. The runtime keeps
the pins of a run by their ids and releases them through `results.release` (`workbook_run/engine.rs`), the platform
only maps an id to the release of its pin (`query/cache_pins.ts`) and releases the pins that are left when the runtime
is destroyed. Transient files that a closed window left behind are nobody's pins any more, the next listing in any
window removes them.

## Exported and Published Results

The **Query Results** toggle of the export of a `.dashql` file, off by default, adds the stored results of the scripts
to the archive, e.g. to hand a slow dashboard with its data to someone without access to its connections. Every result
is a table of its own, `workbook_result_<id>.parquet`, and a row of `workbook_results` names its script, the key of its
file and its table (`script_name`, `cache_key`, `table_name`, see `workbook_tables.md`). The export takes the file of
every script, also an outdated one: it is what the card shows. It retains the files until the archive holds them.

An import doesn't trust the keys. It adds every result whose script name names a script of the imported workbook as the
file of that script, with the key of the row in its name (`importFile`), and the cards show the results when the
workbook opens. A run reuses an imported result only if its key happens to match, e.g. the same version of DashQL on a
connection of the same account; otherwise the first run computes it anew. The import checks the CRC-32 that the
archive stores for each stored result while it streams it, a result that differs leaves no file. Each result succeeds
or fails on its own, the log names each one.

Archives of earlier versions name only the key of a result (`workbook_results` without `script_name`, or
`results/<key>.parquet` of a folder archive). The import plans the imported workbook once its connections are resolved
and adds each result whose key is the key of a script as the file of that script; the other results are left out
and counted.

A published workbook carries its results the same way, `workbook_results` of the cloud holds the script name too
(`cloud.md`). A preview of a published version imports them into the results of the preview workbook, and they go
with it.

- The results hold query data, the toggle says so. The credentials of the connections stay out of the file, the data
  doesn't.
- An imported result is shown and may be reused if its key matches: an archive from someone else can put results in
  front of the backend of a connection of the app until Refresh replaces them. Import files only from people you trust.
- Links never carry results, an import of a link drops them.

## Upgrading

Earlier versions kept one query result cache for the whole app, `cache/` in the root of the origin private file system,
and before that `workbooks/<id>/cache/`. The storage migration to version 10 removes `cache/` with its files and
access markers, the results of the scripts are computed again when they run. The cleanup of the internals still lists
leftover `workbooks/<id>/cache/` folders.

## User Experience

For a succeeded result, the query result header shows its execution age. A result read from its file shows the age of
the file.

The **Refresh** action runs the script again without reusing results (`runScript` with `{ refresh: true }`): the
script and every script of its plan run on their backends. Their results replace the stored ones. A refresh that fails
leaves the stored results as they were.

## Limits and Correctness

- The key covers the connection signature and the AST signature, not a TTL, a backend data version or a catalog
  version. A reused result may be stale after a backend changed: Refresh replaces it.
- The key of a script covers the stored files of the scripts it references, not the tables that it reads otherwise. A
  script that reads a table that a script before it creates, without a reference, runs after it in a run of both: the
  creating script is no query, it always runs, and the scripts that follow a script that runs don't reuse their
  results. A run of the creating script alone outdates none of them: they reuse their results until they are
  refreshed.
- Corrupt files are not removed automatically. They fail to read and stay until the next run of the script replaces
  them.
- Results preserve raw tables only. Analyses and projections run again after a read.

## Implementation References

- Names, selection and garbage: `packages/dashql-core-storage/src/workbook_format/results.rs`
- Key derivation: `packages/dashql-core-runtime/src/executor/cache_key.rs`, the signatures of the connectors in
  `hyper/descriptor.rs`, `trino/descriptor.rs` and `salesforce/mod.rs`
- Platform contract: `packages/dashql/src/platform/workbook/workbook_result_files.ts`
- Executor integration: `packages/dashql-core-bindings/src/runtime/queries.rs` and
  `packages/dashql/src/runtime/query/query_channels.ts`
- Runs, stored results of the views, renames and deletes: `packages/dashql-core-bindings/src/runtime/runs/results.rs`
- Files of runs: `createRunMounts` in `packages/dashql/src/runtime/run_mounts.ts`
- Exported and imported results: `packages/dashql-core-bindings/src/runtime/exports.rs` and `imports.rs`
