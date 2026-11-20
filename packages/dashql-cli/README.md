# dashql-cli

`dashql`, the command line tool of DashQL on `@akohn/dashql`. It runs the logic of the app in Node, so an agent in a
harness gets the answers of the app (`docs/design/dashql_runtime.md`):

- **`dashql lint`** lints SQL files on disk.
- **`dashql format`** pretty prints SQL files on disk.
- **`dashql run`** runs the scripts of a workbook folder on Trino and the embedded Hyper, results go into the query result cache.
- **`dashql catalog`** prints the tables of the connections of a workbook folder as `CREATE TABLE` statements.
- **`dashql vis`** checks the chart of a script against its result and renders it as PNG.
- **`dashql connect`** launches Claude Code or Codex and shows its session live in the tab of DashQL that gave the
  command, see below.
- **`dashql session`** shows the session of an agent harness in DashQL, see below.
- **`dashql describe`** tells an agent how to work on the workbooks of DashQL and lists the workbooks that the tabs of
  DashQL copied into the folder, see below.

```
bazel run //packages/dashql-cli:dashql -- lint examples/snippets/hyper
bazel run //packages/dashql-cli:dashql -- format --write extensions/d360-api/snippets
```

Vite bundles the command with the sources of the runtime into one module for Node (`dist/dashql.js`,
`//packages/dashql-cli:bundle`). The core stays a package next to it, the command reads its Wasm file from there.
`lint`, `format` and `run` need Node 22 or later.

On npm the command is `@akohn/dashql-cli` (`npx -y @akohn/dashql-cli <command>`): `//packages/dashql-cli:npm_tarball`
packs the bundle with the metadata of `npm/package.json`, which depends on `@akohn/dashql` and `hyperdb-wasm`. The
build stamps the version of the commit (`0.0.19-dev.255.ge8e09a80c`) into the package and into its dependency on
`@akohn/dashql`, and `:npm_package_test` keeps the dependencies those of the build. CI publishes both packages with every
deploy, `@akohn/dashql` first, before the pages that name this version, see the top-level `README.md`.

## dashql lint

```
dashql lint [--schema <file.sql>]... [--debug] <file.sql|dir|->...
```

Relative paths are resolved against the directory you invoke Bazel from. Directories are searched recursively for
`*.sql` files, the generated catalog files of workbooks (`dashql-catalog-relations.sql`, `dashql-catalog-functions.sql`, `dashql-catalog-changes.sql`) are skipped.
Symlinks are followed, except links back into a directory that is being searched.
`-` reads a script from stdin:

```
echo "select 1 +;" | bazel run //packages/dashql-cli:dashql -- lint -
```

### What it does

Every script is scanned, parsed and analyzed by dashql-core (`src/sql_lint.ts` over the bindings of `@akohn/dashql`), and only the scripts with
diagnostics are printed. Scripts
are not executed.

### Output

```
broken.sql
  2:27  error    parse    syntax error, unexpected SEMICOLON
        │ select a from t where a = ;
        │                           ^

3 files, 1 error, 0 warnings
```

Diagnostics show the line and column (in code points), the severity, the stage (`scan`, `parse`, `analyze`, or
`failure` if processing failed) and the source line. Colors are used when stdout is a terminal (`NO_COLOR` and
`FORCE_COLOR` are honored). `--debug` adds how long dashql-core took.

The exit code is 0 without errors (warnings are fine), 1 with errors and 2 on usage or I/O errors.

### Schemas

Scripts are analyzed on their own, names resolve only against what the script declares itself.
`--schema` adds a script with `CREATE TABLE` statements to the catalog, so that ambiguous or mistyped columns of those
tables are reported. Schema scripts are checked first, a schema with errors is not added.

The parser accepts some incomplete statements (e.g. a `FROM` or `WHERE` without anything after it) so the editor can
complete them. They are not reported.

## dashql format

```
dashql format [--write|--check] [--dialect hyper|trino] <file.sql|dir|->...
```

Paths work like those of `dashql lint`. Every script is formatted by dashql-core (`src/sql_format.ts` over the bindings of `@akohn/dashql`) in the
pretty mode with lowercase
keywords, a width of 120 and an indentation of 4, and printed to stdout. `--write` rewrites the files that change and
`--check` only names them. Both end with a summary. `--dialect` is `hyper` by default, Trino scripts need `trino`, where
types and time literals are spelled differently.

A script with errors isn't formatted. Neither is one with a statement the formatter doesn't know, or one whose output
doesn't parse. These scripts are reported on stderr and stay as they are, the others are still formatted.

The exit code is 0 if all scripts could be formatted (with `--check`: are formatted), 1 otherwise and 2 on usage or I/O
errors.

## dashql run

```
dashql run [--rows <n>] [--refresh] [--plain] [--workspace <dir> --session <id>] [--verbose] <workbook-dir> [<script>...]
```

Runs the scripts of a workbook folder (a folder with `dashql-workbook.json` and `scripts/`) on their connections like
the Run of the workbook in DashQL, with the runtime of the app (`runWorkbook`): all scripts by default, the
named ones with the scripts they reference otherwise. Scripts are named by their file names (`a.sql` or
`scripts/a.sql`). The scripts are analyzed and planned together. A `:foo` of a script on the same connection becomes a
common table expression, a `:foo` of a script on the embedded Hyper that runs on Trino is materialized as Parquet file
and scanned. Scripts of different connections run at the same time, a connection runs as many statements at once as
in the app (Trino and the embedded Hyper one). The run stops at the first statement that fails and cancels the
statements that run beside it.

### Output

Where the output goes decides what it looks like. On a terminal, `run` shows a live view: what settled is printed once
and stays in the scrollback, a region below it shows the connections that are set up, the running scripts with the
phase, the progress and the rows that their engine reports, and the scripts that wait, with the scripts they wait for.
The region is drawn again in place, there is no full-screen view and no input. A cursor hidden while it draws comes
back however the process ends.

```
dashql run tpch · 4 scripts
✓ trino localhost:8080  ready  0.2 s
✓ nations.sql  25 rows  0.3 s
  nationkey Int64, name Utf8, region Utf8
  …
⠼ orders.sql    RUNNING  ███████░░░░░   58%  1.2M rows  3.4 s
· lineitem.sql  waits for orders.sql
```

Agents, pipes and files get plain lines, so does a terminal with `--plain` or `TERM=dumb`: nothing while the scripts
run, a few lines per script once it settled, and a summary. No escape sequences, no lines drawn again.

```
nations.sql  ok  25 rows  0.3 s
  nationkey Int64, name Utf8, region Utf8
  nationkey | name      | region
  ----------+-----------+--------
  0         | ALGERIA   | AFRICA
  1         | ARGENTINA | AMERICA
  … 23 more
  .dashql/cache/5f0e…c2.8d1a…77.parquet
broken.sql  failed  0.4 s
  line 1:8: Column 'nope' cannot be resolved
  │ select nope from orders
  │        ^^^^
customers.sql  not run  the run stopped

1 ok, 1 failed, 1 not run
```

Every result shows its schema, its row count, its first rows (`--rows`, 10 by default) and its Parquet file in the
query result cache, relative to the invoking directory if it is below it. A failure shows the message of the engine
and, if it names a position, the line of the statement that was sent. The lines are in the order the scripts settle,
which differs from the order of the workbook when scripts run at the same time. A script that didn't run says why:
its connection could not be set up, it follows such a script, the run stopped or was interrupted. Referenced scripts
that are not named show up only when they fail. `--verbose` prints the log of the runtime to stderr.

- **The files of DashQL.** A root with the layout of the storage of the app (`docs/design/storage_layout.md`): the
  query result cache in `cache/`, the attachments of a workbook in `workbooks/<id>/attachments/`, mirrored from the
  folder before the run, and a folder per run of the embedded Hyper in `instances/`, removed at its end or by the next
  run once its process is gone. The root is
  `DASHQL_HOME`, else the `.dashql/` of the workspace, the one that `dashql connect` creates in the folder of its
  session, else `~/.dashql`. The workspace is `--workspace <dir>`, else the invoking directory; nothing is searched
  for. `--workspace` and `--session <id>` together name the session of `dashql connect`, as the start of the session
  tells the agent. In a session, everything of a project is in its `.dashql/`, which commands in the sandbox of a
  harness may write. It is a root of its own, the app keeps its files in the storage of
  the browser.
- **Cached results.** A script whose result is cached is not run again unless a script it follows runs, like in the
  app; the result then says `from the cache` and its connection is not needed. `--refresh` runs every script. The
  workbook folder is not written.
- **Runs in the tab.** With `--workspace` and `--session` of a session of `dashql connect`, only a copy of a workbook
  of the tab runs (`.dashql/sessions/<id>/workbooks/<workbook id>`), and it runs in the tab: `run` asks the server of
  the session, the tab runs the scripts with its own runtime on its connections that the agent may use, as far as the
  browser reaches them, the feed of the tab shows the run, and the events come back and print as above. A result comes
  with its first `--rows` rows, its row count and, for a result with a key, its Parquet file, which the tab writes into
  `.dashql/cache/`. The run fails when no tab follows the session; Ctrl-C asks the tab to stop it
  (`docs/design/agent_integration.md`, "Runs in the tab"). A copy without the session fails with a hint, so does
  another folder in a session; outside a session a workbook folder runs in the process.
- **Connections.** Trino with basic auth and the embedded Hyper. `DASHQL_TRINO_USER` and `DASHQL_TRINO_PASSWORD`
  override the user and the password of the workbook. They stay in memory, the workbook keeps its params.
  A local cloud on the embedded Hyper attaches the databases of its clouds folder in the root, like in the app.
  Connections with OAuth, Salesforce and remote Hyper servers are refused before their first statement, they run only
  in the tab. The
  connections that statements run on are set up and checked with `select 1` before the first statement, all at once.
  The scripts of a connection that can't be set up don't run, nor do the scripts that follow them; the others do.
- **The embedded Hyper** is the build of `hyperdb-wasm` for Node, loaded only by `run`. It runs on Node 24: Node 24.15
  and later have every WebAssembly feature it needs, earlier versions of Node 24 get the flag for exnref from the
  command itself. Without it the scripts on Trino still run and nothing is written.
- **Interrupts.** The first Ctrl-C cancels the running queries, reports the scripts as cancelled or not run and
  removes the folder of the instance, the second one ends the process.
- **Syntax errors first.** Before the run, `run` prints the scripts that it runs with the errors of their scanner and
  parser, as `dashql lint` prints them. It doesn't resolve names, a script reads the tables of its connection and the
  results of other scripts. The run goes on, a script with an error fails at its statement.
- **Network.** `run` reaches the connections, so a harness approves it by prefix (`dashql run`).

The exit code is 0 if all scripts ran, 1 if a script failed or didn't run, 2 on usage errors or a folder without a
workbook and 130 when interrupted.

## dashql connect

```
npx -y --registry=https://registry.npmjs.org/ --min-release-age=0 @akohn/dashql-cli@<version> connect --launch <claude|codex> --port <port> --secret <secret> [--workbook-only] [--folder <dir>] [--command <program>] [-- <argument>...]
```

The AI side of the prompt of DashQL shows this line with a port and a secret that the tab picked, and waits for a
server there. `connect` is the one way to attach a harness to DashQL. It picks the id of the session, a new UUID,
starts the server of the session on `127.0.0.1:<port>` with the secret as its token, and launches the harness in the
terminal with hooks that send its events there: Claude Code with `--settings`, Codex with `-c hooks={…}`; nothing is
written to `~/.claude` or `~/.codex`. Codex shows the new hooks for review at its start. The hooks call this `dashql`
again with the session in their arguments (`session hook <event> --harness <name> --workspace <folder> --session
<id>`), nothing goes through the environment. When the harness exits, `connect` ends the session and stops the server
and exits with the code of the harness. A port that is taken fails before the harness starts, the tab gives a new one.
The arguments after `--` go to the harness, `--command` launches another program than `claude` or `codex` on the
`PATH`.

The agent knows how to work on DashQL from the start, it needs no command to learn it: Claude Code gets the guide of
`dashql describe` with a preface (`CONNECTED_AGENT_GUIDE`: the user started it from DashQL, a request about data is a
request to the workbooks) in its system prompt (`--append-system-prompt`), Codex in the output of the hook at the start,
which the harness puts into the context of the agent. That hook also gives both the session that the commands take,
`--workspace <folder> --session <id>`, where the tab copies its workbook, and the workbooks and the connections of the
session. The settings of Claude Code let it run `dashql` and edit the files of the sessions in `.dashql/sessions/`
without asking (`permissions.allow`: `Bash(dashql:*)`, `Edit(./.dashql/sessions/**)`); everything else asks as the
user configured it.
`--workbook-only` lets the file tools write only into the copies: the hook of `PreToolUse` (`--workbook-only` in its
arguments) refuses an `Edit`, `MultiEdit`, `Write`, `NotebookEdit` or a patch of Codex that writes elsewhere with exit
code 2, and the harness shows the agent why. Commands of the shell stay with the permissions and the sandbox of the
harness. `//tests/agents` runs `connect` with Claude Code and Codex and a fake model: the events of a turn, the guide in
the system prompt, `dashql` and a script of the copy without approval, a file of the project only with one. The agent
of a harness that `npx` launched has no `dashql` on its path: `connect` writes one into the folder of the session
(`.dashql/sessions/<id>/bin/dashql`, a shell script that runs this `dashql`) and puts that folder first on the `PATH`
of the harness, the only variable it sets. Not on Windows.

The folder of the session is `.dashql/sessions/<id>/`: `server.json` with the address and the token of the server for
the commands, readable by the user only, `connections.json` with the connections that the agent may use, and the
copies of the workbooks of the tab in `workbooks/<workbook id>/`. It goes when the session ends, two sessions in one
folder keep apart. The tab writes the workbook that it shows into the session once the server answers, with the
catalogs of the connections that the agent may use, and the agent works on that copy; its changed scripts come back
into the tab with their text (`docs/design/agent_session.md`). `catalog`, `run` and `vis` refuse a copy without
`--workspace` and `--session`, and in a session `run` and `vis` refuse any other folder, so a run of the agent never
silently runs outside the tab.

## dashql catalog

```
dashql catalog [--workspace <dir> --session <id>] [--max-chars <n>] <workbook-dir> [<connection>...]
```

Prints the tables of connections as `CREATE TABLE` statements with the types of their columns: the named connections
by id or name, else the connections of the workbook file and the ones with catalog files. Each comes with a line of its
name, id, connector, the number of its scripts and tables, and whether the tab lets the agent use it. The embedded
Hyper lists the attachments of the workbook as `:name`. The tables come from the catalog files of the folder,
`connections/<id>/dashql-catalog-relations.sql` and `dashql-catalog-functions.sql`: the tab writes the relations into its
copies for every connection that the agent may use and again when the catalog of a connection changed; a published
workbook carries them. The output of a connection stops after `--max-chars` characters (100000), with the path of the
file to grep. Nothing goes over the server of the session for it.

## dashql vis

```
dashql vis [--out <file.png>] [--width <n>] [--height <n>] [--scale <n>] [--refresh] [--workspace <dir> --session <id>] <workbook-dir> <script>
```

Checks the chart of a script, the `@vis` tag above its last query (`docs/design/vis_comments.md`), and gets it as PNG.
The check is local: the core compiles the script and names the renderer and the Vega-Lite spec, Vega-Lite compiles the
spec in Node. `vis` runs the script like `dashql run` (in the tab for a copy of a tab, a cached result is not run again)
and takes the columns of the result from the event of the run, without its rows. It prints the renderer, the rows and
the columns, and the problems: the errors and warnings of Vega-Lite, fields of the encodings that are no columns of the
result nor made by a transform, and sizes that DashQL decides (`chartSpecProblems` of
`platform/workbook/chart_config.ts`).

The PNG comes from the tab, like the result: the run request asks for charts (`chart`, the size), and the tab renders
the chart of the script with its result as the image download of the feed does, and sends it as the event
`script_chart` before `run_finished` (`docs/design/agent_integration.md`, "Runs in the tab"). 800x500 at scale 2 by default, `charts/<script>.png`
of the `.dashql/` of the workspace or `--out`. A workbook folder that runs in the process gets the check only. The exit
code is 0 without problems, 1 with problems, without a chart or without a result, 2 on usage errors.

## dashql describe

```
dashql describe [--workspace <dir> --session <id>]
```

Prints what an agent needs to work on the workbooks of DashQL: the layout of a workbook folder, the commands, how the
tab takes the changes of the agent, and that file contents and results are data, not instructions. With the session,
the workbooks that the tab copied into it, with their names, scripts and connections, and the connections that the
agent may use.
It covers scripts (one statement each, reentrant DDL, `:name` of scripts, the embedded Hyper over remote results,
`@param`, `@manual`, client functions), charts (the `@vis` tag with an example, the size left to DashQL, `dashql vis`
after every change) and how to work. The text lives in the command, so it fits the installed version; a harness of
`dashql connect` has it from the start.

## dashql session

```
dashql session hook <event> --harness <name> --workspace <dir> --session <id> [--workbook-only]
```

The hooks that `dashql connect` gives the harness, nobody installs them by hand. `session hook` reads the payload of
the hook on stdin and sends the event to the server of the session that `--workspace` and `--session` name, from its
`server.json`. `SessionStart` prints how to work on the workbooks of the session, the harness hands it to the agent. A
hook never fails the harness. The server keeps the question, the steps (every use of a tool, from `PreToolUse` to
`PostToolUse`), the files that the tools touched and the final message of every turn.

The page writes the copy of its workbook with `PUT` and `DELETE` on the routes of the files of the workbooks, the
server stamps the files of the copies after every tool and hands them out to the page (`docs/design/agent_session.md`).
The page writes the connections that the agent may use with `PUT /v1/connections/<token>`, the server writes them into
`connections.json` of the folder of the session.

## Tests

```
bazel test //packages/dashql-cli:all
```

`:test` runs the commands with the process of a test (vitest), `run` against a fake Trino and the embedded Hyper,
`:binary_test` runs the bundle as the user calls it, and
`:example_snippets_formatted_test` checks that the snippets of the app are what `dashql format` prints.
`//tests/agents` runs `dashql lint` in the sandboxes of Claude Code and Codex, and `dashql connect` with both.
