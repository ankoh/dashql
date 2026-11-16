# AGENTS

Repository guidance for coding agents lives in `docs/agents/`.

Please consult relevant docs in that directory before making changes.

- Build & Test (always read this document first)
    - `docs/agents/build_bazel_targets.md`

- Formatting
    - `docs/agents/core_sql_formatting.md`

- SQL scripts (snippets, demos, example workbooks: reentrant `create table if not exists` etc.)
    - `docs/agents/sql_scripts.md`

- Build System Details
    - `docs/agents/build_rust_coverage.md`
    - `docs/agents/rust_analyzer.md` (rust-project.json for rust-analyzer)

- Rust core (parser design, parse-tree change rules, core quirks kept on purpose)
    - `docs/design/core_parser.md`
    - `docs/design/core_quirks.md`
    - `docs/design/trino_plan.md` (Trino plan fragments to one operator tree, tree layout, stage contours)

- Catalog (how the catalog of a connection follows the connection: lookups after statements, relations on disk, when a full refresh runs)
    - `docs/design/catalog_updates.md`
    - `docs/design/core_analysis_catalog.md` (catalog types, snapshots, name resolution)

- Extensions (an extension is a folder in `extensions/` with client functions and snippets, bundled with the app)
    - `docs/design/extensions.md` (the layout of a folder, bundling, snippets, adding an extension)

- DashQL in TypeScript (`packages/dashql`, `@ankoh/dashql`: one source package, shared by the app and the Node
  `dashql`, with three folders of `src/`: `core/`, the bindings of the core module (`@ankoh/dashql`, `/buffers`,
  `/browser-worker`); `platform/` (`@ankoh/dashql/platform/<path>`), the platforms of the runtime, the browser, the
  desktop app and Node with a root folder in the layout of OPFS and the embedded Hyper of Node, storage backends, the
  query result cache, archives, OAuth, the connector clients and channels, the UI helpers that more than the app uses,
  the SQL and session support of the CLI; `runtime/` (`@ankoh/dashql/runtime/<path>`), `createRuntime(platform)` with
  the one `Runtime` facade over the runtime of the core module, the store of its views, the view projections and the
  adapters that build the platform of the core from the objects of the platform. `core/` imports neither `runtime/` nor
  `platform/`, `platform/` never imports `runtime/`, `//packages/dashql:boundary_test` checks it. Consumers read the
  TypeScript sources, the generated parts (the Wasm with its glue, the FlatBuffers, protobuf, jsonschema) are folders of
  Bazel wired by path; `:npm_tarball` bundles it for npm. The hooks of the app over the runtime are `useView`,
  `useDispatch`, `useTable` and their aliases in `packages/dashql-app/src/runtime/runtime_hooks.tsx`; where tests go:
  `*.node.test.ts`, `*.browser.test.ts`, the rest runs in Node and the browsers, a test that creates a runtime goes in
  `runtime/`)
    - `docs/wip/dashql_runtime.md` (The package, what goes where)

- The core runtime (`packages/dashql-core-runtime`, crate `dashql_core_runtime`: the state and the services of DashQL in
  Rust, linked into the core module; the app runs its workbook scripts, connections, queries with their descriptions and
  the keys of the query result cache, computations, catalog loader, connection setups, workbook runs, restore, storage
  writes, imports and exports and workbook format on it; services are async on a `Host` the platform implements;
  `dashql-core-script` is the per-script session of the core)
    - `docs/wip/core_runtime.md`

- The command line tool (`packages/dashql-cli`: the Node `dashql` with `lint`, `format`, `run` on Trino and the
  embedded Hyper, and `session`)
    - `packages/dashql-cli/README.md`

- Storage layout (the origin private file system of the app, the root of Node, native workbook folders, migrations)
    - `docs/design/storage_layout.md`

- Agent sessions (built: the hooks of Claude Code and Codex send the events of a session to `dashql session serve`,
  `dashql run` appends its log to the journal `.dashql/journal.jsonl` of the session, the page follows through a link)
    - `docs/wip/agent_session.md`
    - `docs/wip/agent_integration_tests.md` (Claude Code and Codex with fake models in their sandboxes, `//tests/agents`)

- Client functions (core and runtime implemented, Salesforce connections get checks and completion, calls run, a script with a call that writes runs only on request: `CALL` is generic, declarative client functions shadow a namespace on a connection and reach a REST API, any other call goes to the backend)
    - `docs/design/client_functions.md` (the statement, spec format, connector binding, checks, completion, paging, pending results, results, security, the core, the runtime)
    - `docs/design/extensions/api_survey.md` (the format measured against Snowflake, GitHub and Stripe, similar formats)

- CDP SQL (the first extension, `CALL cdp.*` over the Salesforce Data 360 API: the spec and the calls that read are
  built, calls that write fail before anything is sent, not tested against an org)
    - `extensions/d360-api/clfn/docs/overview.md` (the Salesforce binding, how Data 360 fits the format, naming, where attributes come from)
    - `extensions/d360-api/clfn/docs/functions.md` (the function reference and result schema, with one document per family in the same directory, generated from `extensions/d360-api/clfn/spec/*.yaml`, the source of the spec as well)
    - `extensions/d360-api/clfn/docs/api_notes.md` (API quirks, usage order, source conflicts, checks to run on an org)

- hyperdb-edge (`packages/hyperdb-edge`: a command line tool and library for the embedded Hyper of hyperdb-wasm, derived from it, not part of it; `run` and `describe` only, no app logic; the same two as in-process tools for the Tool Runner and the Claude Agent SDK on a session with a warm engine; every SQL example of `describe` runs in the tests; harness and SDK tests in `tests/agents/`)
    - `docs/wip/hyperdb_edge.md`
    - `docs/wip/hyperdb_edge_stores.md` (the stores of the Claude Agent SDK, the OpenAI Agents SDK and LangGraph on a hot embedded Hyper with the redo log, SQL over the state of agents, the libraries as dev dependencies of hyperdb-edge only, their tests in Bazel)

- Workbook tables (`.dashql` files and links: the tables of one workbook, Parquet entries of a ZIP, `?zip=` links, archives of older versions)
    - `docs/design/workbook_tables.md`

- Clouds (connections that keep published workbooks, several and equal: the workbook tables of every version merged in a `dashql` database, keyed by workbook and version, a table per attachment and result; nested folders and soft deletes; built for very many workbooks: paged keyset listings, search and counts in SQL, nothing reads all workbooks; Clouds in the sidebar, the overview of a cloud in place of the feed; the cloud setup before the workbench: login, installer, cleanup; migrations under a lock; what is done and what is planned)
    - `docs/design/cloud.md`

- Web app security (Content-Security-Policy of pages and workers, no evaluated code, Wasm compilation)
    - `docs/design/app_csp.md`
    - `docs/design/document_isolation_policy.md` (COOP, COEP and Document-Isolation-Policy: the engine in a page that
      another site frames, Slack and MCP Apps embeds)
    - `docs/wip/embeds.md` (`/embed`, one entry for data files, workbooks and Hyper scripts, as Slack Work Objects;
      built: a probe that runs one query in the core and Hyper workers; URL contract, fallback, headers)
    - `docs/design/slack_app.md` (the Slack app, `packages/dashql-slack`: a Cloudflare Worker per channel on
      `slack.dashql.app` that turns embed links into Work Objects; the flow of events, the entities, the Slack
      settings and secrets, the order of the setup, what to look at when nothing shows)
    - `packages/dashql-mcp/README.md` (the MCP server, a Cloudflare Worker per channel on `mcp.dashql.app` with one
      MCP App that frames `/embed`, to test the engine in ChatGPT and other MCP Apps hosts)

- Web app theme (colors only from the theme tokens, light-dark(), the color scheme toggle, dark chrome)
    - `docs/design/app_theme.md`

- Third-party notices
    - `NOTICE` lists vendored third-party code and assets with their licenses. Add an entry when you
      vendor something, and remove it when that code is deleted.
