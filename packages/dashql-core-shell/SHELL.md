# DashQL Shell

The shell (`dashql_core_shell`) is the Rust/WebAssembly core of an embeddable SQL terminal. It owns the complete terminal state machine
and terminal rendering, including prompt redraws, syntax highlighting, cursor placement, inline completion hints, status and
error output, and the tables of the first rows of results. It deliberately does not own the xterm object, a database,
query results, or browser APIs.

Asynchronous shell workflows are explicit pending effects. An operation that needs the host returns a pending status
with an effect envelope (version, type, id, payload); JavaScript performs the Promise-based operation and resumes the
workflow through `Shell.completeEffect` or `Shell.cancelEffect`. This avoids Asyncify and JSPI while keeping workflow
ownership in Rust.

The wasm-bindgen API is the `Shell` class of the core module (`//packages/dashql-core-bindings:core_wasm`), and a shell runs on a
`Catalog` of that module. The app shell shares the catalog of its connection. Shell instances are independent.

The TypeScript binding lives in `packages/dashql-app/src/shell/terminal`. Its root entrypoint exports
`createDashQLShell({ core, catalog, environment, ... })`. The shell owns effect dispatch, cancellation, coroutine resumption,
input handling, and ANSI terminal rendering. The browser controller creates and disposes xterm, forwards terminal dimensions
and raw input events, executes requested host effects, and writes the bytes returned by Wasm. Terminal rendering logic must
not be implemented or duplicated in TypeScript.

By default results don't reach the terminal. `executeQuery()` of the environment keeps the result and reports it with
`onResult`, and the page shows it in the result overlay, the same view as everywhere in the app. The terminal only gets a
status line, `Query completed (N rows)`, or `No results` for a statement without columns. Closing the overlay keeps the
result: `.last` opens it again, until the next result replaces it.

`.output table` shows results as tables in the terminal instead, `.output overlay` goes back. The shell offers `.output`
only if its environment has `previewResult`. A table shows the first 100 rows, which the runtime reads from the data
frame of the computation of the result (`Runtime.previewResult`), in the order of the result and without the columns
that the computation added. The rows of a preview pass through the module, the result itself doesn't. The status line
below the table says how many rows there are; `.last` opens all of them in the overlay. A result whose preview fails
opens in the overlay, its status line says why.

The data of a query effect starts with a `QueryResultTag`: a status line, or the length of a status line (u32
little-endian), the status line and the rows as an Arrow IPC stream or file. `shell::arrow_renderer` draws the rows and
formats cell values with arrow-cast's `ArrayFormatter` (one formatter per column): floats with their shortest round-trip
digits, temporal values in ISO 8601, binaries in hex, nested values as `[1, null, 3]` or `{x: 1, y: a}`. Null cells are
empty, numbers and booleans are right-aligned. A table fits the width of the terminal: columns wrap at word boundaries,
a cell shows 20 lines at most, columns that don't fit are left out. Timestamps with a named time zone are shown in UTC
because chrono-tz is not linked, and a column of a type that arrow-cast cannot format shows its type name.

The completion list is the other thing the host paints, as DOM over the terminal, since terminal cells can't show what is
known about a candidate. The shell still decides everything about it: the candidates, the selection, the variants, the
keys and what a candidate replaces. `terminalCompletionList` says what to show after an input, with the terminal column
of the replaced text, and `terminalCompletionBuffer` holds the candidates as a packed `Completion`, in the order of the
prompt candidates. The list writes nothing to the terminal, so the rows below the prompt stay as they are. The inline
hint of the selected candidate is part of the prompt and stays in the terminal.

Build and test through Bazel:

```bash
bazel test //packages/dashql-core-shell:all
bazel build //packages/dashql-core-bindings:core_wasm
```

Prompt text uses a contiguous UTF-8 buffer with cached grapheme boundaries. Cursor movement and deletion operate on
extended grapheme clusters, while cursor positions remain UTF-8 byte offsets for parser and host interoperability.
Clusters come from `unicode-segmentation` and occupy the terminal columns of `unicode-width`; clusters that start with a
control character take no columns, and text that is not valid UTF-8 takes one column per byte (`shell::unicode`).

The Rust shell is the single source of truth for shell behavior and terminal rendering. New highlighting, inline hint,
cursor, redraw, history, and status behavior belongs in the Rust shell code, not in the TypeScript xterm host. The same
holds for how the completion list behaves, only its painting is in the host.
