# dashql-cli

`dashql`, the command line tool of DashQL, one Rust binary built on the native dashql-core:

- **`dashql agent`** reaches the DashQL session that is open in the browser or the desktop app through the local agent
  server: `status`, `guide`, `scripts`, `read`, `edit`, `catalog`, `lint`, `run`, `result` and `vis read`,
  `vis edit`, `vis image`. The skill in `skill/dashql/SKILL.md` sends agents to `dashql agent guide`, which prints
  these commands and how DashQL works.
- **`dashql agent serve`** runs that agent server: DashQL clients connect over WebSocket, the agent commands call it
  over HTTP, and it runs harnesses (Claude Code, Codex, opencode) headless for questions asked in DashQL. See
  `docs/design/agent_bridge.md`.
- **`dashql lint`** lints SQL files on disk without DashQL.
- **`dashql format`** pretty prints SQL files on disk without DashQL.

```
bazel run //packages/dashql-cli:dashql -- agent serve
bazel run //packages/dashql-cli:dashql -- agent status
bazel run //packages/dashql-cli:dashql -- lint examples/snippets/hyper
bazel run //packages/dashql-cli:dashql -- format --write extensions/d360/snippets
```

## Agent server

`dashql agent serve` listens on `127.0.0.1:47100` and keeps its configuration and state in `~/.dashql/agent`;
`DASHQL_AGENT_PORT` and `DASHQL_AGENT_HOME` override both. Only one server runs at a time: to try a server built from
the checkout, quit DashQL.app or stop the installed server first. The server accepts pages from `https://dashql.app`,
desktop windows and the dev server of the web app on `http://localhost:9002`.
`config.json` holds the port, the token of the agent commands, the default harness, harnesses that override or add to
the built-in ones, and further page origins to accept (`origins`):

```json
{
    "port": 47100,
    "token": "…",
    "defaultHarness": "claude",
    "harnesses": {
        "mine": {
            "command": ["mine", "{model}", "{effort}", "{resume}", "{prompt}"],
            "resumeArgs": ["--continue", "{harnessSession}"],
            "models": ["large", "small"],
            "modelArgs": ["--model", "{model}"],
            "efforts": ["low", "high"],
            "effortArgs": ["--effort", "{effort}"],
            "adapter": "text"
        }
    }
}
```

The app picks the model and the effort of requests among `models` and `efforts`, `{model}` and `{effort}` are dropped
while it picks the harness's default. A harness in `harnesses` replaces the built-in one of its name as a whole, so
listing models of Codex or opencode means copying their built-in template and adding `models`.

The agent commands exit with 0 when they succeed, 1 when the command failed and 2 when DashQL is not connected or the
call is malformed.

## dashql lint

```
dashql lint [--schema <file.sql>]... [--debug] <file.sql|dir|->...
```

Relative paths are resolved against the directory you invoke Bazel from. Directories are searched recursively for
`*.sql` files, the generated catalog files of sessions (`dashql-catalog-relations.sql`, `dashql-catalog-functions.sql`, `dashql-catalog-changes.sql`) are skipped.
Symlinks are followed, except links back into a directory that is being searched.
`-` reads a script from stdin:

```
echo "select 1 +;" | bazel run //packages/dashql-cli:dashql -- lint -
```

### What it does

Every script is scanned, parsed and analyzed by dashql-core, and only the scripts with diagnostics are printed. Scripts
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

Paths work like those of `dashql lint`. Every script is formatted by dashql-core in the pretty mode with lowercase
keywords, a width of 120 and an indentation of 4, and printed to stdout. `--write` rewrites the files that change and
`--check` only names them. Both end with a summary. `--dialect` is `hyper` by default, Trino scripts need `trino`, where
types and time literals are spelled differently.

A script with errors isn't formatted. Neither is one with a statement the formatter doesn't know, or one whose output
doesn't parse. These scripts are reported on stderr and stay as they are, the others are still formatted.

The exit code is 0 if all scripts could be formatted (with `--check`: are formatted), 1 otherwise and 2 on usage or I/O
errors.

## Tests

`bazel test //packages/dashql-cli:tests`
