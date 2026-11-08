# DashQL Shell

The shell (`dashql_core_shell`) is the Rust/WebAssembly core of an embeddable SQL terminal. It owns the complete terminal state machine
and terminal rendering, including prompt redraws, syntax highlighting, cursor placement, inline completion hints, status and
error output, and width-constrained UTF-8 tables. It deliberately does not own the xterm object, a database, or browser
APIs.

The current boundary is:

```text
shell environment -> Arrow IPC -> dashql-core Wasm -> terminal text -> xterm host
```

Asynchronous shell workflows are explicit pending effects. An operation that needs the host returns a pending status
with an effect envelope (version, type, id, payload); JavaScript performs the Promise-based operation and resumes the
workflow through `Shell.completeEffect` or `Shell.cancelEffect`. This avoids Asyncify and JSPI while keeping workflow
ownership in Rust.

The wasm-bindgen API is the `Shell` class of the core module (`//packages/dashql-core-wasm:core_wasm`), and a shell runs on a
`Catalog` of that module. The app shell shares the catalog of its connection. Shell instances are independent and results are
owned by JavaScript. Arrow rendering is
internal to the query workflow; consumers execute queries through the database effect interface rather than passing
result buffers to a public rendering function.

Result tables are drawn by `shell::arrow_renderer`, which formats cell values with arrow-cast's `ArrayFormatter`
(one formatter per column): floats with their shortest round-trip digits, temporal values in ISO 8601, binaries in
hex, nested values as `[1, null, 3]` or `{x: 1, y: a}`. Null cells are empty, numbers and booleans are
right-aligned. Timestamps with a named time zone are shown in UTC because chrono-tz is not linked, and a column of a
type that arrow-cast cannot format shows its type name. Values do not print like the former C++ shell (Arrow C++
`Scalar::ToString`), see `docs/design/core_quirks.md`.

The TypeScript binding lives in `packages/dashql-app/src/shell`. Its root entrypoint exports
`createDashQLShell({ core, catalog, environment, ... })` and `createDuckDBShellEnvironment(connection)`. The environment returns Arrow IPC
file bytes from `executeQuery()`, while the shell owns effect dispatch, cancellation, coroutine resumption, input handling,
and ANSI terminal rendering. The browser controller creates and disposes xterm, forwards terminal dimensions and raw
input events, executes requested host effects, and writes the bytes returned by Wasm. Terminal rendering logic must not be
implemented or duplicated in TypeScript.

The completion list is the one thing the host paints, as DOM over the terminal, since terminal cells can't show what is
known about a candidate. The shell still decides everything about it: the candidates, the selection, the variants, the
keys and what a candidate replaces. `terminalCompletionList` says what to show after an input, with the terminal column
of the replaced text, and `terminalCompletionBuffer` holds the candidates as a packed `Completion`, in the order of the
prompt candidates. The list writes nothing to the terminal, so the rows below the prompt stay as they are. The inline
hint of the selected candidate is part of the prompt and stays in the terminal.

Build and test through Bazel:

```bash
bazel test //packages/dashql-core-shell:all
bazel build //packages/dashql-core-wasm:core_wasm
```

Prompt text uses a contiguous UTF-8 buffer with cached grapheme boundaries. Cursor movement and deletion operate on
extended grapheme clusters, while cursor positions remain UTF-8 byte offsets for parser and host interoperability.
Clusters come from `unicode-segmentation` and occupy the terminal columns of `unicode-width`; clusters that start with a
control character take no columns, and text that is not valid UTF-8 takes one column per byte (`shell::unicode`).

The Rust shell is the single source of truth for shell behavior and terminal rendering. New highlighting, inline hint,
cursor, redraw, history, and status behavior belongs in the Rust shell code, not in the TypeScript xterm host. The same
holds for how the completion list behaves, only its painting is in the host.
