# dashql-cli

`dashql`, the command line tool of DashQL on `@ankoh/dashql`. It runs the logic of the app in Node, so an agent in a
harness gets the answers of the app (`docs/wip/dashql_runtime.md`):

- **`dashql lint`** lints SQL files on disk.
- **`dashql format`** pretty prints SQL files on disk.
- **`dashql run`** runs the scripts of a workbook folder on Trino and the embedded Hyper, results go into the query result cache.
- **`dashql connect`** launches Claude Code or Codex and shows its session live in the tab of DashQL that gave the
  command, see below.
- **`dashql session`** shows the session of an agent harness in DashQL, see below.

```
bazel run //packages/dashql-cli:dashql -- lint examples/snippets/hyper
bazel run //packages/dashql-cli:dashql -- format --write extensions/d360-api/snippets
```

Vite bundles the command with the sources of the runtime into one module for Node (`dist/dashql.js`,
`//packages/dashql-cli:bundle`). The core stays a package next to it, the command reads its Wasm file from there.
`lint`, `format` and `run` need Node 22 or later.

On npm the command is `@ankoh/dashql-cli` (`npx -y @ankoh/dashql-cli <command>`): `//packages/dashql-cli:npm_tarball`
packs the bundle with the metadata of `npm/package.json`, which depends on `@ankoh/dashql` and `hyperdb-wasm`.
`:npm_package_test` keeps their versions those of the build, so `@ankoh/dashql` is published first. CI uploads the tarball
next to the one of `@ankoh/dashql` (`dashql_cli_npm`), publishing is by hand.

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

Every script is scanned, parsed and analyzed by dashql-core (`sql/sql_lint.ts` of the runtime), and only the scripts with
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

Paths work like those of `dashql lint`. Every script is formatted by dashql-core (`sql/sql_format.ts` of the runtime) in the
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
dashql run [--rows <n>] [--refresh] [--plain] [--workspace <dir>] [--verbose] <workbook-dir> [<script>...]
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
  `DASHQL_HOME`, else the `.dashql/` of the workspace, the one that `dashql session serve` creates in the folder of its
  session, else `~/.dashql`. The workspace is the folder that the harness works in: the invoking directory, or
  `--workspace <dir>`; nothing is searched for. In a session, everything of a project is in its `.dashql/`, which
  commands in the sandbox of a harness may write. It is a root of its own, the app keeps its files in the storage of
  the browser.
- **Cached results.** A script whose result is cached is not run again unless a script it follows runs, like in the
  app; the result then says `from the cache` and its connection is not needed. `--refresh` runs every script. The
  workbook folder is not written.
- **Connections.** Trino with basic auth and the embedded Hyper. `DASHQL_TRINO_USER` and `DASHQL_TRINO_PASSWORD`
  override the user and the password of the workbook. They stay in memory, the workbook keeps its params.
  A local cloud on the embedded Hyper attaches the databases of its clouds folder in the root, like in the app.
  Connections with OAuth, Salesforce and remote Hyper servers are refused before their first statement. The
  connections that statements run on are set up and checked with `select 1` before the first statement, all at once.
  The scripts of a connection that can't be set up don't run, nor do the scripts that follow them; the others do.
- **The embedded Hyper** is the build of `hyperdb-wasm` for Node, loaded only by `run`. It runs on Node 24: Node 24.15
  and later have every WebAssembly feature it needs, earlier versions of Node 24 get the flag for exnref from the
  command itself. Without it the scripts on Trino still run and nothing is written.
- **Interrupts.** The first Ctrl-C cancels the running queries, reports the scripts as cancelled or not run and
  removes the folder of the instance, the second one ends the process.
- **Not yet.** The catalog of a connection is not described.
- **Sessions.** In the folder of a session (`dashql session`), `run` appends the files of the workbook folder, the
  start, the progress and the result of every script to the journal of the session, also a script that was
  cancelled or didn't run.
- **Network.** `run` reaches the connections, so a harness approves it by prefix (`dashql run`).

The exit code is 0 if all scripts ran, 1 if a script failed or didn't run, 2 on usage errors or a folder without a
workbook and 130 when interrupted.

## dashql connect

```
npx -y @ankoh/dashql-cli connect --launch <claude|codex> --port <port> --secret <secret> [--folder <dir>] [--command <program>] [-- <argument>...]
```

The AI side of the prompt of DashQL shows this line with a port and a secret that the tab picked, and waits for a
server there. `connect` starts the server of the session (the server of `session serve`, in the process of `connect`) on `127.0.0.1:<port>`
with the secret as its token, and launches the harness in the terminal with hooks that send its events there: Claude
Code with `--settings`, Codex with `-c hooks={…}`; nothing is written to `~/.claude` or `~/.codex`. Codex shows the
new hooks for review once at its start. The hooks call this `dashql` again (`session hook … --connected`) and find the
server in `DASHQL_SESSION_ENDPOINT` and `DASHQL_SESSION_TOKEN`; hooks of `dashql session` in the settings of the harness
stay quiet then. When the harness exits, `connect` ends the session and stops the server and exits with the code of
the harness. A port that is taken fails before the harness starts, the tab gives a new one. The arguments after `--`
go to the harness, `--command` launches another program than `claude` or `codex` on the `PATH`.

## dashql session

```
dashql session hook <event> --harness <name> [--connected]
dashql session serve --session <id> --harness <name> [--folder <dir>] [--port <port>]
dashql session link [--session <id>]
```

The hooks of a harness send its events to the server of the session, DashQL follows the session through a link
(`docs/wip/agent_session.md`). `session hook` reads the payload of the hook on stdin, starts the server of the session
(`session serve`, detached, on `127.0.0.1` with a token) if it has none, and sends the event to it. `SessionStart`
prints the link, the harness hands it to the agent. A hook never fails the harness. The server keeps the question,
the status lines, the files that the tools touched and the final message of every turn, and stops when the harness
ends the session. `DASHQL_SERVERS` is the folder of the running servers (`~/.dashql/servers`), one file per server with its
port and token; `DASHQL_APP_URL`
the page of the links (`https://dashql.app`).

The server also creates the journal of the session, `.dashql/journal.jsonl` in its folder. `dashql run` appends the
files of a workbook folder below it and every result, the server folds them into its state and hands out the files of
the workbook folders and the results of its `.dashql/cache` to the page (`docs/wip/agent_session.md`).

Claude Code, in its settings (`.claude/settings.json`):

```json
{
    "hooks": {
        "SessionStart": [{ "hooks": [{ "type": "command", "command": "dashql session hook SessionStart --harness claude" }] }],
        "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "dashql session hook UserPromptSubmit --harness claude" }] }],
        "PostToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "dashql session hook PostToolUse --harness claude" }] }],
        "Stop": [{ "hooks": [{ "type": "command", "command": "dashql session hook Stop --harness claude" }] }],
        "SessionEnd": [{ "hooks": [{ "type": "command", "command": "dashql session hook SessionEnd --harness claude" }] }]
    }
}
```

Codex, in `hooks.json` of its home (`~/.codex`); Codex runs user hooks once the user trusted them in `/hooks`:

```json
{
    "hooks": {
        "SessionStart": [{ "hooks": [{ "type": "command", "command": "dashql session hook SessionStart --harness codex" }] }],
        "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "dashql session hook UserPromptSubmit --harness codex" }] }],
        "PostToolUse": [{ "hooks": [{ "type": "command", "command": "dashql session hook PostToolUse --harness codex" }] }],
        "Stop": [{ "hooks": [{ "type": "command", "command": "dashql session hook Stop --harness codex" }] }]
    }
}
```

## Tests

```
bazel test //packages/dashql-cli:all
```

`:test` runs the commands with the process of a test (vitest), `run` against a fake Trino and the embedded Hyper,
`:binary_test` runs the bundle as the user calls it, and
`:example_snippets_formatted_test` checks that the snippets of the app are what `dashql format` prints.
`//tests/agents` runs `dashql lint` in the sandboxes of Claude Code and Codex, and their hooks with
`dashql session hook`.
