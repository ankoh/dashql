# dashql-cli

`dashql`, the command line tool of DashQL on `@ankoh/dashql-sdk`. It runs the logic of the app in Node, so an agent in a
harness gets the answers of the app (`docs/wip/dashql_sdk.md`):

- **`dashql lint`** lints SQL files on disk.
- **`dashql format`** pretty prints SQL files on disk.

```
bazel run //packages/dashql-cli:dashql -- lint examples/snippets/hyper
bazel run //packages/dashql-cli:dashql -- format --write extensions/d360-api/snippets
```

Vite bundles the command with the sources of the SDK into one module for Node (`dist/dashql.js`,
`//packages/dashql-cli:bundle`). The core stays a package next to it, the command reads its Wasm file from there.
`lint` and `format` need Node 22 or later.

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

Every script is scanned, parsed and analyzed by dashql-core (`sql/sql_lint.ts` of the SDK), and only the scripts with
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

Paths work like those of `dashql lint`. Every script is formatted by dashql-core (`sql/sql_format.ts` of the SDK) in the
pretty mode with lowercase
keywords, a width of 120 and an indentation of 4, and printed to stdout. `--write` rewrites the files that change and
`--check` only names them. Both end with a summary. `--dialect` is `hyper` by default, Trino scripts need `trino`, where
types and time literals are spelled differently.

A script with errors isn't formatted. Neither is one with a statement the formatter doesn't know, or one whose output
doesn't parse. These scripts are reported on stderr and stay as they are, the others are still formatted.

The exit code is 0 if all scripts could be formatted (with `--check`: are formatted), 1 otherwise and 2 on usage or I/O
errors.

## Tests

```
bazel test //packages/dashql-cli:all
```

`:test` runs the commands with the process of a test (vitest), `:binary_test` runs the bundle as the user calls it, and
`:example_snippets_formatted_test` checks that the snippets of the app are what `dashql format` prints.
`//tests/agents` runs `dashql lint` in the sandboxes of Claude Code and Codex.
