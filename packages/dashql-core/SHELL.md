# DashQL Shell

The shell library is the C++/WebAssembly core of an embeddable SQL terminal. It owns the complete terminal state machine
and terminal rendering, including prompt redraws, syntax highlighting, cursor placement, completion lists, status and
error output, and width-constrained UTF-8 tables. It deliberately does not own the xterm object, a database, or browser
APIs.

The current boundary is:

```text
shell environment -> Arrow IPC -> dashql-shell Wasm -> terminal text -> xterm host
```

Asynchronous shell workflows use C++20 coroutines with explicit host effects. A coroutine suspends after returning an
effect envelope through the synchronous C ABI; JavaScript performs the Promise-based operation and resumes the coroutine
through `dashql_shell_complete_effect`. This avoids Asyncify and JSPI while keeping workflow ownership in C++.

The C ABI is declared in `include/dashql/shell/api.h`. Shell instances are independent, input buffers are borrowed
for each call, and returned buffers are owned until `dashql_shell_result_destroy` is called. Arrow rendering is internal
to the query coroutine; consumers execute queries through the database effect interface rather than passing result
buffers to a public rendering function.

The TypeScript binding lives in `packages/dashql-app/src/shell`. Its root entrypoint exports
`createDashQLShell({ environment, ... })` and `createDuckDBShellEnvironment(connection)`. The environment returns Arrow IPC
file bytes from `executeQuery()`, while the shell owns effect dispatch, cancellation, coroutine resumption, input handling,
and ANSI terminal rendering. The browser controller only creates and disposes xterm, forwards terminal dimensions and raw
input events, executes requested host effects, and writes the bytes returned by Wasm. Terminal rendering logic must not be
implemented or duplicated in TypeScript.

Build and test through Bazel:

```bash
bazel test //packages/dashql-core:shell_unit_tests
bazel build //packages/dashql-core:shell_wasm
```

Prompt text uses a contiguous UTF-8 buffer with cached grapheme boundaries. Cursor movement and deletion operate on
extended grapheme clusters, while cursor positions remain UTF-8 byte offsets for parser and host interoperability.

The C++ shell is the single source of truth for shell behavior and rendering. New highlighting, completion presentation,
cursor, redraw, history, and status behavior belongs in the C++ shell code, not in the TypeScript xterm host.
