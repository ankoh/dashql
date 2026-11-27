# DashQL Shell

The shell (`dashql_core_shell`) is the Rust/WebAssembly core of an embeddable SQL shell. It decides what a prompt does:
whether Enter submits it, the history of the prompts, the dot commands and the completion of their names, the execution
protocol of queries and commands, and the records of their output with the tables of the first rows of results. It
doesn't edit the prompt and doesn't draw anything, and it owns no database, query results or browser APIs.

The host shows the shell as a feed and a prompt (`ShellView` of `packages/dashql-app/src/shell/view`): the statements
and the records of their output start at the top like in a terminal, the prompt follows the last of them and is a
CodeMirror editor. The prompt is native text, so paste, selection and the cursor gestures of touch screens work, and it
has the SQL assistance of the editors of the app: a script session on the catalog of the shell highlights it and
completes it with the completion list of the editor (see `docs/design/core_completion.md`). A dot command gets no SQL
assistance. The shell is told the text of the prompt when it decides:

- `promptInfo(text)`: is the prompt a dot command, and does Enter submit it? A dot command is complete on one line, SQL
  when it is a single statement that ends with a semicolon. SQL that the local parser rejects but ends with a semicolon
  is complete as well, the remote grammar may accept it. Otherwise Enter adds a line.
- `historyPrevious(text)` and `historyNext(text)`: Up on the first line and Down on the last line of the prompt step
  through the submitted prompts, after the newest one comes the draft that the prompt held before. A prompt that differs
  from the entry it showed was edited, browsing starts again from the newest entry with it as the draft.
- `completeCommand(text)`: Tab completes the name of a dot command, a single match with a space after it, several to
  their common prefix; the host lists them.
- `submit(text)`: the history remembers the prompt, a dot command or a query leaves as an effect.

Asynchronous shell workflows are explicit pending effects. An operation that needs the host returns a pending status
with an effect (type, id, payload), one at a time; JavaScript performs the Promise-based operation and resumes the
workflow through `Shell.completeEffect` or `Shell.cancelEffect`. This avoids Asyncify and JSPI while keeping workflow
ownership in Rust. A finished operation has records: text (the output of a command), status lines, a table, an error,
or a clear that drops the records before it (`.clear`). Their texts end their lines with `\n` and have no trailing line
break.

The wasm-bindgen API is the `Shell` class of the core module (`//packages/dashql-core-bindings:core_wasm`), and a shell runs on a
`Catalog` of that module. The app shell shares the catalog of its connection. Shell instances are independent.

The TypeScript binding lives in `packages/dashql-app/src/shell/terminal/api.ts` (`DashQLShell`). It executes the effects
on the environment of the page and runs the dot commands that the page registers.

By default results don't reach the feed. `executeQuery()` of the environment keeps the result and reports it with
`onResult`, and the page shows it in the result overlay, the same view as everywhere in the app. The feed only gets a
status line, `Query completed (N rows)`, or `No results` for a statement without columns. Closing the overlay keeps the
result: `.last` opens it again, until the next result replaces it.

`.output table` shows results as tables in the feed instead, `.output overlay` goes back. The shell offers `.output`
only if its environment has `previewResult`. A table shows the first 100 rows, which the runtime reads from the data
frame of the computation of the result (`Runtime.previewResult`), in the order of the result and without the columns
that the computation added. The rows of a preview pass through the module, the result itself doesn't. The status line
below the table says how many rows there are; `.last` opens all of them in the overlay. A result whose preview fails
opens in the overlay, its status line says why.

The data of a query effect starts with a `QueryResultTag`: a status line, or the length of a status line (u32
little-endian), the status line and the rows as an Arrow IPC stream or file. `shell::arrow_renderer` draws the rows and
formats cell values with arrow-cast's `ArrayFormatter` (one formatter per column): floats with their shortest round-trip
digits, temporal values in ISO 8601, binaries in hex, nested values as `[1, null, 3]` or `{x: 1, y: a}`. Null cells are
empty, numbers and booleans are right-aligned. A table fits the width that the host gives the shell (`resize`) in
characters of its monospace font: columns wrap at word boundaries, a cell shows 20 lines at most, columns that don't fit
are left out. The feed gives it at least 80 characters and scrolls a wider table sideways. Clusters take the columns of
`unicode-width` (`shell::unicode`). Timestamps with a named time zone are shown in UTC because chrono-tz is not linked,
and a column of a type that arrow-cast cannot format shows its type name.

Build and test through Bazel:

```bash
bazel test //packages/dashql-core-shell:all
bazel build //packages/dashql-core-bindings:core_wasm
```

What a prompt does, the history and the records of the output belong in the Rust shell. The host edits the prompt and
draws the feed, it decides nothing about them.
