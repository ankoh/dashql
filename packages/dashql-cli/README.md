# dashql-cli

`dashql`, the command line tool of DashQL, one Rust binary built on the native dashql-core:

- **`dashql agent`** reaches the DashQL session that is open in the browser or the desktop app through the local agent
  server: `status`, `scripts`, `read`, `edit`, `catalog`, `lint`, `run`, `result` and `vis read`, `vis edit`,
  `vis image`. Agents learn these commands from the skill in `skill/dashql/SKILL.md`.
- **`dashql agent serve`** runs that agent server: DashQL clients connect over WebSocket, the agent commands call it
  over HTTP, and it runs harnesses (Claude Code, Codex, opencode) headless for questions asked in DashQL. See
  `docs/wip/agent_bridge.md`.
- **`dashql lint`** lints SQL files on disk without DashQL.

```
bazel run //packages/dashql-cli:dashql -- agent serve --dev
bazel run //packages/dashql-cli:dashql -- agent --dev status
bazel run //packages/dashql-cli:dashql -- lint examples/sessions/tpch
```

## Agent server

`dashql agent serve` listens on `127.0.0.1:47100` (`--dev`: 47101) and keeps its configuration and state in
`~/.dashql/agent` (`--dev`: `~/.dashql/agent-dev`); `DASHQL_AGENT_PORT` and `DASHQL_AGENT_HOME` override both.
`config.json` holds the port, the token of the agent commands, the default harness, and harnesses that override or
add to the built-in ones:

```json
{
    "port": 47100,
    "token": "…",
    "defaultHarness": "claude",
    "harnesses": {
        "mine": { "command": ["mine", "{resume}", "{prompt}"], "resumeArgs": ["--continue", "{harnessSession}"], "adapter": "text" }
    }
}
```

The agent commands exit with 0 when they succeed, 1 when the command failed and 2 when DashQL is not connected or the
call is malformed.

## dashql lint

```
dashql lint [--schema <file.sql>]... [--debug] <file.sql|dir|->...
```

Relative paths are resolved against the directory you invoke Bazel from. Directories are searched recursively for
`*.sql` files, the generated catalog files of sessions (`dashql-catalog-relations.sql`, `dashql-catalog-functions.sql`, `dashql-catalog-changes.sql`) are skipped.
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

## Tests

`bazel test //packages/dashql-cli:tests`
