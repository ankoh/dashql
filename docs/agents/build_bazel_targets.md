# Building, Testing, and Verifying with Bazel

## Core Principle

**All building, testing, and verification MUST be done through Bazel targets.**

Do not invoke language-specific tools or package-manager scripts directly (`npx tsc`, `yarn build`, `yarn test`, `pnpm run build`, `pnpm test`, `npm run build`, `cargo build`, `cargo test`, etc.). These bypass the build system's dependency tracking, caching, and reproducibility guarantees — even when the underlying `package.json` script exists, the Bazel target is the source of truth.

## Why Bazel Only?

### Problems with Direct Tool Invocation

Running `npx tsc` or `cargo build` directly:
- **Breaks incremental builds** — Bazel doesn't know about changes made outside its sandbox
- **Misses dependencies** — Tool may succeed locally but fail in CI due to missing deps
- **Wastes time** — No shared cache, rebuilds everything
- **Creates inconsistency** — Different results between local dev and CI
- **Corrupts bazel-bin/** — Manual writes can invalidate Bazel's cache

### Bazel Benefits

- **Hermetic builds** — Same inputs always produce same outputs
- **Shared cache** — [bazel-cache.dashql.app](https://bazel-cache.dashql.app) speeds up builds for everyone
- **Correct dependencies** — Bazel enforces that all inputs are declared
- **Parallel execution** — Bazel automatically parallelizes independent actions
- **Cross-language support** — One tool for C++, Rust, TypeScript, and WebAssembly

## Building Targets

### General Pattern

```bash
# Build a specific target
bazel build //packages/dashql-core:dashql_core

# Build all targets in a package
bazel build //packages/dashql-app:all

# Build everything
bazel build //...
```

### Common Build Targets

| Target | Purpose |
|--------|---------|
| `//packages/dashql-app:pages` | Web app bundle for Cloudflare Pages |
| `//packages/dashql-app:reloc` | Web app bundle for native apps |
| `//packages/dashql-org:pages_deploy` | Website and blog (dashql.org, Astro) for Cloudflare Pages |
| `//packages/dashql:source_package` | `@akohn/dashql`, linked as `//:node_modules/@akohn/dashql`: the bindings of the core module (`src/core`), the `Runtime` facade over the runtime of the core module with its store and the adapters of its platform (`src/runtime`), and the platforms, storage, connector clients and channels, OAuth and the support of the command line tool (`src/platform`), shared by the app and the command line tool, a source package with nothing compiled and the generated Wasm, see `docs/design/dashql_runtime.md` |
| `//packages/dashql:dep_wasm`, `:dep_flatbuffers` | The generated packages of the core module that the bindings import by path, `@akohn/dashql-wasm` (the wasm-bindgen glue and the Wasm of the core and of the dataflow layout) and `@akohn/dashql-flatbuffers`, in `bazel-bin/packages/dashql/dependencies/` |
| `//packages/dashql-native:mac_package_arm64` | arm64 macOS Electron app, DMG, ZIP, and blockmaps |
| `//packages/dashql-native:mac_package_x86_64` | x86_64 macOS Electron app, DMG, ZIP, and blockmaps |
| `//tools/pack:pack` | Publish architecture-specific Electron artifacts and update manifests to R2 |
| `//tools/pack:vacuum` | Remove complete expired release versions, including old updater blockmaps |
| `//packages/dashql-core-bindings:core_wasm` | Core Wasm module (Rust, wasm-bindgen) with the core and the shell, shipped by `@akohn/dashql`. It needs no database, hyperdb-wasm stays optional |
| `//packages/dashql-dataflow:dataflow_wasm` | Dataflow Wasm module of the dataflow canvas (ELK), shipped by `@akohn/dashql`, loaded when the canvas opens |
| `//packages/dashql-core:dashql_core` | Core library (Rust), the language: scripts, catalog, analyzer, cursor, completion, formatter, script diff, and the scripts on it: editor sessions, compilation, batch, the relations that statements touch, visualizations |
| `//packages/dashql-core-runtime:dashql_core_runtime` | The state of DashQL in Rust on the core and its scripts: the workbook, the planner across its scripts, connections, queries, computations and the services on a host, see `docs/design/dashql_core.md` |
| `//packages/dashql-core-storage:dashql_core_storage` | The storage of DashQL on the runtime: the storage writer, the restore, the workbook format and the saves of the connections, wired in by the bindings, see `docs/design/dashql_core.md` |
| `//packages/dashql-core-shell:dashql_core_shell` | The shell: prompt, VT100 renderer, tables of the first rows of results, effect protocol |
| `//packages/dashql-core-profile:dashql_core_profile` | The query profile: Hyper plans, Trino stages, layout and progress rollups |
| `//packages/dashql-dataflow:dashql_dataflow` | The layout of the dataflow canvas: ELK (elk-rs) places the boxes and routes the edges |
| `//packages/dashql-parser:dashql_parser` | Parser crate: scanner, parser tables and actions, keywords |
| `//packages/dashql-react:npm_package` | `@akohn/dashql-react`, linked as `//:node_modules/@akohn/dashql-react`: the hooks of the runtime, the models that components show, the components, and the tokens, fonts and brand code shared with the website; a source package on `@akohn/dashql` with nothing compiled, see `docs/design/dashql_runtime.md` |
| `//packages/dashql:bundle` | `dist/` of `@akohn/dashql` on npm: the modules as JavaScript (Vite, preserved modules) with their declarations, the generated packages inlined, see `packages/dashql/npm/build.mjs` |
| `//packages/dashql:npm_package` | The npm package directory of `@akohn/dashql` (`npm/package.json`) |
| `//packages/dashql:npm_tarball` | The npm archive of `@akohn/dashql` at `bazel-bin/packages/dashql/dashql.tgz` |
| `//packages/dashql-cli:npm_tarball` | CLI npm archive at `bazel-bin/packages/dashql-cli/dashql-cli.tgz`, `npx -y @akohn/dashql-cli` |
| `//packages/dashql-cli:dashql` | The `dashql` command line tool on `@akohn/dashql`, bundled for Node with Vite from its sources: `lint` and `format` for SQL files, `run` for the scripts of a workbook folder on Trino and the embedded Hyper, `catalog` and `vis` (the tables of a workbook, its charts checked here and rendered as PNG by the tab), `connect` and `session serve` for the live view of an agent session |

`mac_package_arm64`, `mac_package_x86_64`, `pack` and `vacuum` produce their outputs when they run, not when they are
built: use `bazel run`. The macOS packages land in `dist/electron/<arch>/`.

### Build Configs

```bash
# Fast development builds (default)
bazel build //packages/dashql-app:all

# Optimized release builds
bazel build --config=release //packages/dashql-app:pages

# Debug builds with symbols
bazel build --config=debug //packages/dashql-core:dashql_core
```

Use `--config=release` for production artifacts. The default `fastbuild` config is sufficient for development.

## Running Tests

### General Pattern

```bash
# Run a specific test
bazel test //packages/dashql-core:dashql_core_unit_tests

# Run all tests in a package
bazel test //packages/dashql-core:all

# Run all tests in the repo
bazel test //...
```

### Common Test Targets

| Target | Purpose |
|--------|---------|
| `//packages/dashql-parser:all` | Scanner and parser unit tests, bison skeleton test, Clippy with the safety lints |
| `//packages/dashql-core:all` | Core unit tests with the script session, compiler, batch and touched relation tests, the analyzer, completion, formatter, diff and visualize snapshot tests, the Hyper validation, Clippy with the safety lints |
| `//packages/dashql-core-runtime:all` | Runtime tests without the storage, the planner and dataflow snapshot tests, the Hyper validation of the planner, and Clippy with the safety lints (`clippy_test`, see "Clippy") |
| `//packages/dashql-core-storage:all` | The storage writer, the restore, the workbook format and the migrations of the storage on fake hosts, Clippy with the safety lints |
| `//packages/dashql-core-bindings:all` | The bindings of the core module on the host: the unit tests of the parts that call no JS (the marks of the changes of the runtime) and Clippy with the safety lints, see "Clippy" |
| `//packages/dashql-core-shell:all` | Shell tests, Clippy with the safety lints |
| `//packages/dashql-core-profile:all` | Query profile unit tests, and the plan and progress snapshot tests, Clippy with the safety lints |
| `//packages/dashql-dataflow:all` | Dataflow layout and routing unit tests |
| `//<package>:rustfmt_test` | `rustfmt --check` of the Rust files of a package with Rust code, part of its `:all`, see "rustfmt" |
| `//packages/dashql-core:dashql_core_unit_tests` | Core unit tests |
| `//tests/snapshots:parser_snapshot_test` | Parser snapshot tests |
| `//packages/dashql-core:analyzer_snapshot_test` | Analyzer snapshot tests |
| `//packages/dashql-core:formatter_snapshot_test` | Formatter snapshot tests |
| `//packages/dashql-core:formatter_validation_hyper_test` | Execute the formatted SQL of the formatter snapshots in Hyper |
| `//packages/dashql-core-runtime:planner_validation_hyper_test` | Execute the planned SQL of the planner snapshots with script references in Hyper |
| `//extensions/d360-api:all` | The Data 360 extension: `clfn/spec/*.yaml` generates `spec.json` and the documents, and the core reads the spec, see `extensions/d360-api/clfn/docs/overview.md`. `bazel run //extensions/d360-api:update` regenerates the documents |
| `//packages/dashql:all` | The tests of `@akohn/dashql` in Node, its type checks, the boundary test of its folders, and the package on npm: tarball consumer and Node smoke tests |
| `//packages/dashql/test/browser:all` | The tests of the bindings in Chromium and Firefox, and the bindings of the package on npm with a browser worker |
| `//tests/hyper:smoke_test` | Native Tableau Hyper API integration test |
| `//packages/dashql-native:test` | Electron host unit tests |
| `//packages/dashql-cli:test` | `dashql` tests in Node: the commands with the process of a test, arguments, files, stdin, output and exit codes, `run` and `vis` against a fake Trino and the embedded Hyper, `catalog`, the session server and its journal |
| `//packages/dashql-cli:tsc_typecheck_test` | Type check of the command line tool and its tests, with the types of Node |
| `//packages/dashql-cli:example_snippets_formatted_test` | The example snippets of the app are what `dashql format` prints, in the dialect of their engine |
| `//packages/dashql-cli:binary_test` | `dashql` as the user calls it: the bundle, its exit codes, stdin and the invoking directory |
| `//packages/dashql-cli:npm_package_test` | The package on npm (`npm/package.json`) depends on `@akohn/dashql` and hyperdb-wasm of the build, the bundle runs as its command |
| `//packages/dashql-react:all` | Type check of `@akohn/dashql-react` against the sources of `@akohn/dashql`, and the boundary test of its imports (React, apache-arrow, `@akohn/dashql`, the libraries of the components, vitest in tests and `src/testing/`; components reach neither the hooks nor the runtime). Its tests run in the browser tests of the app |
| `//packages/dashql:tsc_typecheck_test` | Type check of `@akohn/dashql` against the WebWorker lib, without the DOM and without the types of Node |
| `//packages/dashql:tsc_typecheck_tests_test` | Type check of the tests and test helpers of the runtime and of the platform (`src/*/testing/`), with the globals of vitest |
| `//packages/dashql:tsc_typecheck_node_test` | Type check of the modules of Node in `src/runtime/node` and `src/platform/node` and their tests, with the types of Node |
| `//packages/dashql:test_core_node` | The tests of the bindings in Node (vitest) |
| `//packages/dashql:test_runtime_node` | The tests of the runtime in Node (vitest), without `*.browser.test.ts`. The browser tests of the app run all but `*.node.test.ts` |
| `//packages/dashql:test_platform_node` | The tests of the platform in Node (vitest), without `*.browser.test.ts`. The browser tests of the app run all but `*.node.test.ts` |
| `//packages/dashql:node_smoke_test` | The package on npm in Node: the bindings with their Wasm, and a runtime over the platform of Node |
| `//packages/dashql:tarball_consumer_test` | The archive of the package on npm as a consumer installs it: reproducible, its files and metadata, the exports of the bindings in Node and their declarations for `NodeNext` |
| `//packages/hyperdb-edge:test` | The tests of hyperdb-edge in Node (vitest): the library against the embedded Hyper, every SQL example of the `describe` topics, and the compiled command run as separate processes, see `docs/wip/hyperdb_edge.md` |
| `//packages/hyperdb-edge:tsc_typecheck_test` | Type check of the library of hyperdb-edge without its Node part, against the WebWorker lib |
| `//packages/hyperdb-edge:tsc_typecheck_node_test` | Type check of every module and test of hyperdb-edge with the types of Node |
| `//packages/hyperdb-edge:stores_typecheck_test` | Type check of the stores of agent libraries in `packages/hyperdb-edge/stores/` and their tests, against the libraries, see `docs/wip/hyperdb_edge_stores.md` |
| `//packages/hyperdb-edge:stores_test` | The stores of the Claude Agent SDK, the OpenAI Agents SDK and LangGraph on hyperdb-wasm: each against the reference of its library, the conformance suite of LangGraph for checkpointers, and the agent loops of the OpenAI Agents SDK and LangGraph with a fake model |
| `//packages/hyperdb-edge:stores_claude_code_test` | The session store under `query()` of the Claude Agent SDK with the pinned Claude Code and a fake model, outside the sandbox: mirroring, resuming from the store alone, sessions at once |
| `//packages/dashql:boundary_test` | The folders of `@akohn/dashql` keep their rules: `src/core` imports neither `src/runtime` nor `src/platform`, `src/platform` doesn't import `src/runtime`, the package imports itself relatively, nothing reaches code of the app, React, an editor or a `.tsx` module, and only the known seams of a browser or a bundler |
| `//packages/dashql:editor_config_test` | Editors resolve every import of `@akohn/dashql`: its `tsconfig.json` extends the root one, every imported package is a path of the root `tsconfig.json` or a dependency of the root `package.json`. Bazel checks with `tsconfig.bazel.json` |
| `//packages/<package>:eslint_test` | ESLint of the TypeScript and JavaScript of the package with the root `eslint.config.mjs`, every finding fails, see "ESLint" |
| `//packages/dashql-app:test_chromium` | Web app tests in Chromium |
| `//packages/dashql-app:test_firefox` | Web app tests in Firefox |
| `//packages/dashql-app:coverage_chromium` | Line coverage of the app sources in the Chromium tests (manual), published at [coverage.dashql.app](https://coverage.dashql.app) |
| `//packages/dashql-slack:all` | The Slack app (a Cloudflare Worker): type check against the WebWorker lib, and the events against a fake Slack API in Node. Deployed with `wrangler deploy --env <channel>`, see `packages/dashql-slack/README.md` |
| `//packages/dashql-mcp:all` | The MCP server (a Cloudflare Worker with an MCP App that frames `/embed`): type check against the WebWorker lib, and the Worker in Node with the client of the MCP SDK. Deployed with `wrangler deploy --env <channel>`, see `packages/dashql-mcp/README.md` |
| `//packages/dashql-org:check` | `astro check` of the website |
| `//tests/trino:trino_assumptions_test` | Checks the Trino API assumptions of the query progress model against a live Trino (manual, local only) |
| `//tests/agents:claude_code_sandbox_test` | Claude Code with a fake model: what a command in its sandbox and its hooks can reach, the ways out of the sandbox, a session server of hooks, `dashql lint` in the sandbox, `dashql connect` with the guide in the system prompt and the tools it allows, see `docs/design/agent_integration_tests.md`. Downloads the binary of Claude Code; on Linux it needs bubblewrap and socat |
| `//tests/agents:hyperdb_edge_claude_code_test` | hyperdb-edge in Claude Code with a fake model: `describe` and `run` in the sandbox, a database and files in the workspace, errors, rules by prefix, the skill, see `docs/wip/hyperdb_edge.md`. Needs what `claude_code_sandbox_test` needs |
| `//tests/agents:hyperdb_edge_codex_test` | hyperdb-edge in Codex with a fake model: `describe` and `run` in `workspace-write` without network, `describe` in `read-only`, the skill, see `docs/wip/hyperdb_edge.md` |
| `//tests/agents:hyperdb_edge_tool_runner_test` | The tools of hyperdb-edge in the Tool Runner of the Anthropic SDK with a fake model: their schemas, the calls of one turn in order, errors, `max_rows`, see `docs/wip/hyperdb_edge.md` |
| `//tests/agents:hyperdb_edge_agent_sdk_test` | The tools of hyperdb-edge in the Claude Agent SDK with a fake model and the pinned Claude Code: their schemas without built-in tools, the calls of one turn in order, errors, `allowedTools`, see `docs/wip/hyperdb_edge.md` |
| `//tests/agents:codex_sandbox_test` | Codex with a fake model: its sandbox modes, its hooks, an `allow` rule and a request to escalate, a session server of hooks, `dashql lint` in the sandbox, see `docs/design/agent_integration_tests.md`. Downloads the binary of Codex |

### Trino (manual, local only)

`//tests/trino` starts a single-node Trino 484 with only the tpch catalog. On first use Bazel
downloads the server, the tpch plugin and a Java 25 runtime, about 370 MB (`//bazel:external_trino.bzl`).
Every target there is `manual`, so `bazel build //...`, `bazel test //...` and CI never fetch or start
Trino. The regular tests read the checked-in recordings instead.

```bash
# Check the assumptions of the query progress model against Trino
bazel test //tests/trino:trino_assumptions_test

# Refresh tests/snapshots/profiles/trino/recordings/ (statement polls, the QueryInfos the app fetches, EXPLAIN plans)
bazel run //tests/trino:trino_recorder

# Serve Trino for the app at http://127.0.0.1:8080 (tpch catalog, behind a CORS proxy), Enter stops it
bazel run //:trino [-- --port 8080]
```

### Browser Tests

`test_chromium` and `test_firefox` split the test files over several browser pages that run at the same time, one page
per four cores and at most four. Every page has its own browser context and Hyper. `coverage_chromium` stays on one page.
`getBrowserTestShard` in `packages/dashql-app/src/tests/test_modules.ts` picks the files of a page, so a test can run
after any other test file: tests have to clean up the globals they set. A suite claims four cores (the `cpu:4` tag of
`browser_test`): on a CI runner with four cores it runs alone, the two suites side by side timed tests out.

```bash
# Choose the number of pages
bazel test //packages/dashql-app:test_chromium --test_env=DASHQL_BROWSER_TEST_SHARDS=1
```

`tests.html` on the dev server runs all files on one page.

After the test files, the driver runs `packages/dashql-app/test/browser_page_tests.mjs`: Playwright boots the real pages of
the bundle (`index.html`, `shell.html`, `demos.html`, `oauth.html`) in browser contexts of their own, with the headers and
the Content-Security-Policy of the deployment and without WebGL, and walks through them. Their entry points can't be
imported by a test, and nothing else renders the real composition of the providers. A page test fails if the page logs a
console error, or if it sends a request to another origin that the test does not stub. On a failure the driver writes
`page_<name>.png` to the test outputs. A run of a single test file leaves them out.

```bash
# Only the page tests
bazel test //packages/dashql-app:test_chromium --test_env=DASHQL_BROWSER_PAGE_TESTS_ONLY=1
```

### Test Output

By default, Bazel only shows output for failed tests (configured in `.bazelrc`):

```bash
# See all test output
bazel test --test_output=all //packages/dashql-core:dashql_core_unit_tests

# See output for failed tests only (default)
bazel test --test_output=errors //packages/dashql-core:dashql_core_unit_tests
```

### Snapshot Tests

Many tests use snapshot fixtures in `tests/snapshots/<category>/`. To update snapshots after intentional changes:

```bash
bazel run //tests/snapshots/parser:update
bazel run //tests/snapshots/analyzer:update
bazel run //tests/snapshots/formatter:update
bazel run //tests/snapshots/completion:update
bazel run //tests/snapshots/planner:update
bazel run //tests/snapshots/dataflow:update
bazel run //tests/snapshots/visualize:update
bazel run //tests/snapshots/diff:update
bazel run //tests/snapshots/profiles/hyper/tests:update
bazel run //tests/snapshots/profiles/progress:update
bazel run //tests/snapshots/profiles/trino/progress:update
bazel run //tests/snapshots/profiles/trino/plans:update
# All categories at once
bazel run //tests/snapshots:update
```

These targets regenerate `tests/snapshots/<category>/<name>.yaml` from the templates `<name>.tpl.yaml` next to them with the Rust core
(`//tests/snapshots:snapshotter`, flags `--source_dir=<repository> [--filter=<category>]`).

- The snapshot tests compare YAML trees structurally, including the key order of every map; numbers
  compare by value.
- The encoders in `dashql_snapshots::encode` build styled trees (`dashql_snapshots::ryml::Node`) and
  `ryml::emit` ports the rapidyaml 0.12.1 emitter, quirks included (flow sequences without spaces like
  `[0,2]`, `|2` for block literals with leading spaces). Regenerating unchanged snapshots gives
  byte-identical files.
- Analyzer, completion, planner, dataflow and visualize write their templates back with the results appended, so
  `ryml::parse` keeps the template styles (scalar styles, flow and multi-line flow containers).
- The Hyper plans in `tests/snapshots/profiles/hyper/tests/*.tpl.yaml` come from a real Hyper: after changing the
  queries in `tests/snapshots/profiles/hyper/queries/` or the setup in `setup/setup.sql`, run
  `python3 scripts/update_hyper_plans.py` with the `tableauhyperapi` package installed. It writes each folder of
  queries to `tests/<folder>.tpl.yaml` with the `EXPLAIN (FORMAT JSON)` plan of every query, outside Bazel since it
  needs the Hyper API; then run `//tests/snapshots/profiles/hyper/tests:update`.

### Benchmarks

```bash
bazel run -c opt //packages/dashql-core:bench_pipeline
bazel run -c opt //packages/dashql-core:bench_pipeline_ctes [-- <filter>]
bazel run -c opt //packages/dashql-core:bench_session
bazel run //packages/dashql-app:bench_hyperdb_wasm_backend [-- --rows=100000 --repeat=2 --filter=<case>]
bazel run --config=release //packages/dashql:bench_typing [-- --passes=3]
```

`bench_pipeline` scans, parses, formats, analyzes and completes TPC-DS q1 against the TPC-DS schema.
`bench_pipeline_ctes` runs `with cte_0 as (<TPC-H q1>), ... select 1` with a growing number of CTEs and
catches non-linear scaling.
`bench_session` applies cursor moves and typed characters to an editor session and packs the updates like
the wasm module.
`bench_typing` types a script of 40 lines next to two and next to 19 other scripts on the runtime of the module, the way
the editor does, and prints the 10th percentile and the median of the steps per keystroke, see "The typing benchmark" in
`docs/design/dashql_runtime.md`.
`bench_hyperdb_wasm_backend` runs the same queries on the experimental wasm backend of hyperdb-wasm
(`experimental_wasm_backend`) and on its default backend, checks that the results are equal and prints the
slowdown of every case. A hyperdb-wasm without the backend only reports that.

## Type Checking

### TypeScript

The app is checked by the `typecheck` output group of its `ts_project`, the other packages by `tsc_typecheck_test`
targets:

```bash
# The app, a plain build of :tsc skips the check
bazel build //packages/dashql-app:tsc --output_groups=typecheck

# @akohn/dashql
bazel test //packages/dashql:tsc_typecheck_test //packages/dashql:tsc_typecheck_tests_test //packages/dashql:tsc_typecheck_node_test
```

**Never run `npx tsc` directly.** The check of the app uses `packages/dashql-app/tsconfig.bazel.json` in Bazel's sandbox and resolves `@akohn/dashql-react` through its package exports. The editor and the type checker of the dev server use the root `tsconfig.json`, so a mapping that is missing there does not fail the check.

### ESLint

Every package with TypeScript or JavaScript has an `:eslint_test` (`eslint_test` of `bazel/eslint.bzl`): ESLint with
the rules of the root `eslint.config.mjs` over every `.ts`, `.tsx`, `.mts`, `.js`, `.mjs` and `.cjs` file of the package,
part of `//packages/...` and `//tests/agents/...`. Every finding fails the test, warnings and unused
`eslint-disable` comments included. The rules need no type information, the type checks check the types:

- `@eslint/js` and `typescript-eslint` recommended, unused variables unless they start with `_`
- no default import of `immutable` (`no-restricted-syntax`), its ESM build has none
- in `.ts` and `.tsx`, a relative import names its file with `.js`: `./foo.js`, not `./foo` or `./foo.ts`
  (`no-restricted-imports` for `import` and `export … from`, `no-restricted-syntax` for `import()`); hyperdb-edge and
  the desktop app run the output of tsc in Node, and the declarations of `@akohn/dashql` resolve under `NodeNext`.
  Assets keep their extension (`.css`, `.sql?raw`, `?url`)
- `react-hooks/rules-of-hooks` in the app, `@akohn/dashql-react` and the website: a function that calls hooks is
  named `use…`

Off, with the reason in the config: `@typescript-eslint/no-explicit-any`, `no-control-regex`,
`@typescript-eslint/no-namespace` and `react-hooks/exhaustive-deps` (166 findings when it was measured, most of them
effects that run on mount by intent; a dependency added changes when an effect runs, so each hook needs a review before
the rule can be on).

```bash
# One package
bazel test //packages/dashql-app:eslint_test

# Write the fixes of the rules that have one into the workspace, all of packages/ and tests/agents/ or the paths given
bazel run //bazel:eslint_fix
bazel run //bazel:eslint_fix -- packages/dashql-react
```

A new package with TypeScript loads `eslint_test` from `//bazel:eslint.bzl` and calls `eslint_test()` in its
`BUILD.bazel`.

### Rust

Rust type checking happens automatically during `bazel build` and `bazel test`. The Rust compiler is part of the build graph, so type errors will fail the build.

```bash
# This type-checks as part of building
bazel build //packages/dashql-native/proxy:addon
```

### Clippy

Every crate linked into the core module (`dashql-parser`, `dashql-core`, `dashql-core-shell`, `dashql-core-profile`,
`dashql-core-runtime` and the bindings `dashql-core-bindings`) runs Clippy with the safety lints of
`//bazel:rust_safety_lints` (`lint_config` of the crate): `unwrap_used`, `expect_used`, `panic`, `unreachable`, `todo`,
`unimplemented`, `indexing_slicing`, `string_slice` and `await_holding_refcell_ref` are denied outside of tests, a panic
traps the whole module. The other lints of Clippy stay warnings, but `dashql-core-runtime` and `dashql-core-bindings` deny
every warning under Clippy (`lib.rs`). See "The rules" in [dashql_core.md](../design/dashql_core.md). `rust_safety_test` of `bazel/rust_safety.bzl` makes it a test
(`:clippy_test` of each crate), part of `//packages/...`; the bindings are checked as a host build of the same sources
(`//packages/dashql-core-bindings:dashql_core_bindings_lint`), they compile on the host.

```bash
# Clippy with the safety lints, a breach fails the build of the test
bazel test //packages/dashql-core-runtime:clippy_test //packages/dashql-core-bindings:clippy_test //packages/dashql-core:clippy_test

# The findings, warnings included
bazel build //packages/dashql-core-runtime:clippy_test_clippy //packages/dashql-core-bindings:clippy_test_clippy
```

A new crate of the module takes the lints with `lint_config = "//bazel:rust_safety_lints"` and a `rust_safety_test`.

### rustfmt

The Rust code is formatted with rustfmt and the `rustfmt.toml` of the repo (120 columns, `use_small_heuristics =
"Max"`). Every Bazel package with Rust files has a `:rustfmt_test` (`rustfmt_test` of `bazel/rustfmt.bzl`) that runs
`rustfmt --check` on the files of the package (`glob(["**/*.rs"])`), so CI fails on unformatted code. Generated Rust
(the parser tables of `//grammar`, the FlatBuffers of `//proto/fb`, the protos of the native proxy) is not in the tree
and is not checked. The test and the formatter run the rustfmt of the Rust toolchain of rules_rust, a nightly, with
`skip_children` so that rustfmt doesn't follow a module into a generated file. `bazel run @rules_rust//:rustfmt` and
the `rustfmt_test` of rules_rust don't work here: their transition registers the host platform a second time and
crashes Bazel 9.

```bash
# Format the Rust files of the repo that git knows (tracked or new), or those under paths relative to the repo root
bazel run //bazel:rustfmt
bazel run //bazel:rustfmt -- packages/dashql-core-runtime

# Check the formatting of a package
bazel test //packages/dashql-core-runtime:rustfmt_test
```

A new package with Rust files adds a `rustfmt_test(name = "rustfmt_test", srcs = glob(["**/*.rs"]))`.

### C++

The only C++ code is the Hyper API binding in `tests/hyper`. It is type-checked when it is compiled.

## Querying Targets

Use `bazel query` to find targets:

```bash
# List all targets in a package
bazel query //packages/dashql-core:all

# Find all test targets
bazel query 'kind(".*_test", //...)'

# Find all Rust targets
bazel query 'kind("rust_.*", //packages/dashql-native/proxy:all)'

# Show dependencies of a target
bazel query 'deps(//packages/dashql-app:pages)'

# Show reverse dependencies (what depends on this?)
bazel query 'rdeps(//..., //packages/dashql-core:dashql_core)'
```

## Development Servers

For local development with hot module reloading:

```bash
# Start browser dev server with HMR
bazel run //packages/dashql-app:dev

# Start the Vite server in Electron mode with renderer HMR
bazel run //packages/dashql-app:dev -- --mode electron

# Start the native app (connects to the Electron-mode Vite server)
bazel run //packages/dashql-native:dev
```

Run the last two commands in separate terminals for Electron development.

The dev servers of the app and the website read `packages/dashql-react` from its sources, the dev server of the app reads
`packages/dashql` from its sources too; an edit reaches the page without a build or a restart. The generated packages
of the core module come from `bazel-bin/packages/dashql/dependencies`, which `bazel run //packages/dashql-app:dev`
builds; the page reloads when a build replaces the Wasm.

The website runs its own Astro dev server on port 9003. It uses the `node_modules` of `pnpm install`,
Bazel builds the SVG symbols it reads from `bazel-bin`:

```bash
bazel run //packages/dashql-org:dev
```

Without a terminal, for example when an agent starts it, Astro runs the dev server in the background. Stop it with
`node_modules/.bin/astro dev stop` in `packages/dashql-org`.

Code and styles used by both the app and the website live in `packages/dashql-react` and are imported as
`@akohn/dashql-react/...`. Move code there instead of copying it between the two.

`//packages/dashql-native:dev` defaults to `http://localhost:9002`; set
`DASHQL_ELECTRON_RENDERER_URL` to use another loopback HTTP origin.

## Anti-Patterns

### Never Do This

```bash
# ❌ Direct TypeScript compilation
npx tsc
npx tsc --noEmit

# ❌ Direct Cargo commands
cargo build
cargo test
cargo check

# ❌ Direct yarn / pnpm / npm scripts for building or testing
yarn build
yarn test
yarn typecheck
pnpm run build
pnpm test
npm run build

# ❌ Manual file operations in bazel-bin/
cp something.wasm bazel-bin/packages/foo/
rm -rf bazel-bin/packages/bar/
```

### Always Do This

```bash
# ✅ Bazel type checking
bazel build //packages/dashql-app:tsc --output_groups=typecheck

# ✅ Bazel building
bazel build //packages/dashql-native/proxy:addon

# ✅ Bazel testing
bazel test //packages/dashql-native:test

# ✅ Bazel target for code generation
bazel run //tests/snapshots/parser:update
```

## Common Workflows

### After Changing TypeScript Code

```bash
# Lint, type check and run tests
bazel test //packages/dashql-app:eslint_test //packages/dashql-react:eslint_test //packages/dashql:eslint_test
bazel build //packages/dashql-app:tsc --output_groups=typecheck
bazel test //packages/dashql-app:test_chromium //packages/dashql-app:test_firefox
# The package @akohn/dashql in Node and its bindings in the browsers
bazel test //packages/dashql:all //packages/dashql/test/browser:all
```

### After Changing Rust Code

```bash
# Format, the :rustfmt_test of each package checks it
bazel run //bazel:rustfmt

# Build and test (type checking happens automatically)
bazel test //packages/dashql-native/proxy:test //tools/pack:test

# The core
bazel test //packages/dashql-parser:all //packages/dashql-core:all //packages/dashql-core-runtime:all \
    //packages/dashql-core-shell:all //packages/dashql-core-profile:all \
    //packages/dashql-dataflow:all //tests/snapshots:all
```

### The npm Package of DashQL

```bash
# Bundle the modules with their declarations into dist/
bazel build //packages/dashql:bundle

# Assemble the npm directory
bazel build //packages/dashql:npm_package

# Run the tests in Node, the tarball consumer, and the browser tests
bazel test //packages/dashql:all //packages/dashql/test/browser:all

# Build the release archive without building the app or native packages
bazel build --config=release //packages/dashql:npm_tarball
```

`@akohn/dashql` is a source package, only the package on npm is built. `:dep_wasm` takes
`//packages/dashql-core-bindings:core_wasm`, `//packages/dashql-dataflow:dataflow_wasm` and their wasm-bindgen glue
(`:dashql_core_bindgen`, `:dashql_dataflow_bindgen`), `:bundle` builds the JavaScript and the declarations around them.
The release archive is `bazel-bin/packages/dashql/dashql.tgz`. Trusted CI waits for the release
Wasm build and requires that artifact to be available in the remote cache before
packaging, so it does not rebuild the same Wasm action. It uploads the archive as
`dashql_npm`; it does not publish to npm. Trusted fastbuild/release and
untrusted fastbuild CI run both test target sets of the package.

### After Changing Parser Grammar

`grammar/rules/*.y` hold the rules with their Rust actions. `//grammar:grammar_y` assembles them into
`dashql.y`, and `//grammar:parser_tables_rs` compiles it into the tables and actions of `dashql_parser`.

```bash
# Rebuild the parser and update the snapshots
bazel run //tests/snapshots/parser:update
bazel test //packages/dashql-parser:all //tests/snapshots:parser_snapshot_test

# Verify snapshot changes
git diff tests/snapshots/parser/
```

### Checking SQL Scripts

`dashql lint` (`//packages/dashql-cli:dashql`) scans, parses and analyzes SQL scripts with dashql-core and prints
their errors and warnings. Use it to check scripts you write, see `packages/dashql-cli/README.md`.

```bash
bazel run //packages/dashql-cli:dashql -- lint path/to/script.sql path/to/dir
echo "select 1 +;" | bazel run //packages/dashql-cli:dashql -- lint -
# Resolve names against CREATE TABLE statements
bazel run //packages/dashql-cli:dashql -- lint --schema schema.sql query.sql
```

`dashql format` pretty prints them with the same core, to stdout or with `--write` in place. `--check` only names the
files that aren't formatted, and `--dialect trino` formats Trino scripts.

```bash
bazel run //packages/dashql-cli:dashql -- format --write extensions/d360-api/snippets
```

### Before Committing

```bash
# Run all tests
bazel test //...

# Or run tests for changed areas only
bazel test //packages/dashql-app:all
bazel test //packages/dashql-core:all
```

## Dependency Management

### Updating Rust Dependencies

There are no Cargo manifests. Crate versions and features are declared with `crate.spec` in one file per
crate universe, and each universe keeps its `Cargo.lock` under `bazel/crates/<universe>/`:

| Universe | Specs | Used by |
|---|---|---|
| `@crates` | `bazel/crates/native.MODULE.bazel` | `dashql-native/proxy`, `tools/pack`, `tools/datasets` |
| `@core_crates` | `bazel/crates/core.MODULE.bazel` | `dashql-parser`, `dashql-core`, `dashql-core-runtime`, `dashql-core-shell`, `dashql-core-profile`, `dashql-dataflow`, `dashql-core-bindings`, `tests/snapshots` |

To add or change a dependency, edit the spec, reference the crate from the BUILD file as
`@<universe>//:<crate>`, and build. Bazel re-resolves the lockfile on the next build. To upgrade crates
beyond what the lockfile pins:

```bash
# Upgrade every crate to the newest version the specs allow
bazel run //scripts:repin_crates -- full
# Upgrade a single crate
bazel run //scripts:repin_crates -- tokio@1.53.0
```

`wasm-bindgen` is pinned to the `wasm-bindgen-cli` bundled with `rules_rust_wasm_bindgen` and has to move
together with that module.

### Updating Node Dependencies

Node dependencies are managed via `pnpm` and exposed to Bazel via `aspect_rules_js`. After updating `package.json`:

```bash
# Update lockfile (outside Bazel)
pnpm install

# Bazel will automatically pick up changes on next build
bazel build //packages/dashql-app:pages
```

## Summary

When working as an agent:

1. **Query first** — Use `bazel query` to discover targets
2. **Build through Bazel** — Never invoke `tsc`, `cargo`, `npm run`, etc.
3. **Test through Bazel** — All tests are Bazel targets
4. **Verify through Bazel** — Type checking is a test target
5. **Trust the cache** — Bazel's incrementality is correct; avoid `clean`

If you find yourself typing `yarn`, `pnpm`, `npm`, `npx`, or `cargo`, stop and find the Bazel target instead.
