# Logic goes into the core

Logic that fits semantically into the DashQL core is Rust in the core module, which ships as Wasm. It is not
TypeScript. TypeScript binds the module, supplies its I/O and renders what the module returns. The rule holds
everywhere TypeScript meets DashQL: the app, `@akohn/dashql` (`core/`, `runtime/`, `platform/`), the command line tool,
the shell, the embeds and the workers of Slack and MCP.

Read this before you write or extend a function in TypeScript that does more than call an API, move bytes or draw.
The map of the Rust side is [dashql_core.md](../design/dashql_core.md), the seam from the TypeScript side is
[dashql_runtime.md](../design/dashql_runtime.md).

## Why

- **One semantics.** The app, `dashql run`, the shell and every embed get the same answer from the same code. A rule
  in TypeScript is a second copy that drifts from the first, and the command line tool or an embed won't have it.
- **Tests.** The core has snapshot tests and tests of every service on fake hosts. A rule in a React component or an
  adapter is tested late or not at all.
- **The module is the product.** Integrations use the core on its own (`DashQL`, the FlatBuffers of `proto/fb`). What
  only TypeScript knows doesn't exist for them.

## What belongs in the core

- **The SQL language.** Tokens, statements, names and their quoting, comments and comment tags, dialects, formatting,
  completion, signatures, positions and ranges in a script.
- **What a script means.** References, dependencies, the planner, the dataflow, inputs and parameters, the specs of
  `VISUALIZE` and `@vis`, client function calls and their checks. Derived graphs come from the analyzer and the
  planner, never from a matcher of their own.
- **The catalog.** Names, resolution, what a connection reported, see
  [core_analysis_catalog.md](../design/core_analysis_catalog.md) and [catalog_updates.md](../design/catalog_updates.md).
- **The state of the runtime and its rules.** Workbooks, connections, queries, runs, the storage writer, the restore,
  imports, exports and migrations. Also every decision in them: an order, a default of an option, a filter, a
  validation, a comparison of ids, the NFC of names, a retry, a timeout, an error, which objects are held and when they
  go.
- **Query profiles.** Hyper plans, Trino stages, the progress of a query.
- **Anything that two callers need.** When the app and the command line tool, or the editor and the shell, would both
  need it, it is the core.

## What stays in TypeScript

The list is in [What stays in TypeScript](../design/dashql_core.md#what-stays-in-typescript) and
[Commands](../design/dashql_runtime.md#commands):

- The DOM, I/O and what crosses per value: fetch, OPFS, Web Locks, the embedded Hyper, ZIP archives (zip.js), the
  compilation of chart specs (vega-lite), the formatting of cells (`Intl`), React and CodeMirror.
- The JavaScript side of a call: an object by the id that Rust names it with, the errors of JavaScript that a failure
  becomes, the identity of the objects that React holds.
- The state of the user interface: the selection, focus, drafts of forms, view modes, layout and drawing.

These are exceptions, not a second home for logic. The facade and the adapters of the platform decide nothing.

## The test

Ask before you write a function in TypeScript:

1. Does it read or produce something the core already knows: a parsed or analyzed script, the catalog, a plan, a view
   of the runtime? Then it is the core.
2. Would a second caller need the same answer: the command line tool, the shell, the package in Node, an embed? Then
   it is the core.
3. Does it decide something: a rule, an order, a default, a validation, a name, a lifetime? Then it is the core.
4. Does it only call an API of the browser or of Node, move bytes, or draw? Then it is TypeScript.
5. Would a port to Rust cross the seam per value, per cell, row or frame? Then it stays in TypeScript, or the loop
   moves into Rust with it.

When unsure, it is the core. When it can't go into the core (a dependency that doesn't build for `wasm32`, the size of
the module, the budget of the main thread), say why in your reply and in the design doc of the area. Don't write it in
TypeScript without saying so.

## Signs of logic on the wrong side

- TypeScript reads the text of a script with a regex, splits SQL at `;`, matches keywords or scans comments.
- TypeScript derives again what the analyzer or the planner computed: names, dependencies, references, tables.
- TypeScript walks a FlatBuffer of the core to compute a new fact instead of showing its fields.
- The facade or an adapter decides an order, a default, a filter, a retry, a lifetime or how ids and names compare.
- The app and the command line tool carry the same rule, or a test in TypeScript checks a rule that no test in Rust
  checks.
- A view is reshaped in TypeScript before every reader uses it: the view of the module should have that shape.

## How to put it into the core

- **Pick the crate by its layer** (the table in [dashql_core.md](../design/dashql_core.md#the-crates)): the language in
  `dashql-core`, scripts, editor sessions and `VISUALIZE` in `dashql-core-script`, profiles in `dashql-core-profile`,
  the shell in `dashql-core-shell`, state and services in `dashql-core-runtime`. `dashql-core-bindings` binds and
  converts, it holds no logic.
- **Cross the seam per operation, never per value.** The classes of the core through `src/core/api.ts`. For the
  runtime a view kind, an action or a command, and a host call for new I/O; each has its steps in
  [dashql_runtime.md](../design/dashql_runtime.md) and [dashql_core.md](../design/dashql_core.md#the-host). Results
  cross as FlatBuffers or as views with generated types.
- **Keep the rules of the module.** No panics (the safety lints of every crate), no borrow across an await or a call
  into JavaScript, see [The rules](../design/dashql_core.md#the-rules). Name the unit of every offset: the editor
  APIs count UTF-16 code units, the core UTF-8 bytes.
- **Test it in Rust.** A new output of the core gets a snapshot category, a service a test on fake hosts in
  `packages/dashql-core-runtime/tests/`. The test in TypeScript checks the binding, not the rule.
- **Update the docs** of the area, so they say which side owns it.

## Logic you find on the wrong side

- Don't extend it. If your change touches logic in TypeScript that belongs in the core, move it when the change has
  room for it, otherwise leave it no larger and tell the user what you found.
- A move deletes the TypeScript version in the same change. Don't keep both, and don't keep a fallback in TypeScript.
  Examples: the files of a run moved from the mounts of the platform into the run of the runtime (6dc05ee3f), and the
  handover of the storage writer moved into Rust while the facade stopped reshaping its statistics (e38e2bfae).
- Don't port what the exceptions above name. A port that would cross per value or block the main thread is worse than
  the TypeScript it replaces.

## Before you finish

For each function in TypeScript that your change adds or grows, you can name why it can't be in the core: it is I/O,
it is the JavaScript side of a call, it is the user interface, or it crosses per value. If you can't, move it.
