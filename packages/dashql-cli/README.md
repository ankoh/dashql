# dashql-cli

`dashql`, the command line tool of DashQL on `@ankoh/dashql-runtime`. It runs the logic of the app in Node, so an agent in a
harness gets the answers of the app (`docs/wip/dashql_runtime.md`):

- **`dashql lint`** lints SQL files on disk.
- **`dashql format`** pretty prints SQL files on disk.
- **`dashql run`** runs the scripts of a workbook folder on Trino and the embedded Hyper, results go into the query result cache.
- **`dashql session`** shows the session of an agent harness in DashQL, see below.

```
bazel run //packages/dashql-cli:dashql -- lint examples/snippets/hyper
bazel run //packages/dashql-cli:dashql -- format --write extensions/d360-api/snippets
```

Vite bundles the command with the sources of the runtime into one module for Node (`dist/dashql.js`,
`//packages/dashql-cli:bundle`). The core stays a package next to it, the command reads its Wasm file from there.
`lint`, `format` and `run` need Node 22 or later.

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
dashql run [--rows <n>] [--refresh] [--verbose] <workbook-dir> [<script>...]
```

Runs scripts of a workbook folder (a folder with `dashql-workbook.json` and `scripts/`) on their connections, in the
order of the workbook, all of them by default. Scripts are named by their file names (`a.sql` or `scripts/a.sql`).
Each script runs like the Run of the script in DashQL, with the runtime of the app: it is analyzed and planned with
the scripts it references. A `:foo` of a script on the same connection becomes a common table expression, a `:foo` of
a script on the embedded Hyper that runs on Trino is materialized as Parquet file and scanned. The run stops at the
first script that fails.

```
nations.sql  ok  25 rows  0.3 s
  nationkey Int64, name Utf8, region Utf8
  nationkey | name      | region
  ----------+-----------+--------
  0         | ALGERIA   | AFRICA
  1         | ARGENTINA | AMERICA
  … 23 more
  /home/me/.dashql/cache/5f0e…c2.8d1a…77.parquet
broken.sql  failed
  line 1:8: Column 'nope' cannot be resolved
```

Every result shows its schema, its row count, its first rows (`--rows`, 10 by default) and its Parquet file in the
query result cache. `--verbose` prints the log of the runtime to stderr.

- **The files of DashQL.** A root with the layout of the storage of the app (`docs/design/storage_layout.md`): the
  query result cache in `cache/`, the attachments of a workbook in `workbooks/<id>/attachments/`, mirrored from the
  folder before the run, and a folder per run of the embedded Hyper in `instances/`, removed at its end. The root is
  `DASHQL_HOME`, else the `.dashql/` of the workspace, the one that `dashql session serve` creates in the folder of its
  session, else `~/.dashql`. The workspace is the folder that the harness works in: the invoking directory, or
  `--workspace <dir>`; nothing is searched for. In a session, everything of a project is in its `.dashql/`, which
  commands in the sandbox of a harness may write. It is a root of its own, the app keeps its files in the storage of
  the browser.
- **Cached results.** A script whose result is cached is not run again unless a script it follows runs, like in the
  app; the result then says `from the cache`. `--refresh` runs every script. The workbook folder is not written.
- **Connections.** Trino with basic auth and the embedded Hyper. `DASHQL_TRINO_USER` and `DASHQL_TRINO_PASSWORD`
  override the user and the password of the workbook. They stay in memory, the workbook keeps its params.
  Connections with OAuth, Salesforce and remote Hyper servers are refused before their first statement. A connection
  is set up and checked with `select 1` when a plan first runs statements on it.
- **The embedded Hyper** is the build of `hyperdb-wasm` for Node, loaded only by `run`. It needs Node 24.15 or later,
  older versions of Node 24 get the flag for exnref from the command itself. Without it the scripts on Trino still run
  and nothing is written. Its worker prints a line to the descriptor 1 of its process, which no code in the process
  can filter, so `run` runs in a child process whose descriptor 1 goes nowhere and writes its output to the stdout of
  the parent.
- **Not yet.** The catalog of a connection is not described.
- **Sessions.** In the folder of a session (`dashql session`), `run` appends the files of the workbook folder and every
  result to the journal of the session.
- **Network.** `run` reaches the connections, so a harness approves it by prefix (`dashql run`).

The exit code is 0 if all scripts ran, 1 if a script or a connection failed and 2 on usage errors or a folder without a
workbook.

## dashql session

```
dashql session hook <event> --harness <name>
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
