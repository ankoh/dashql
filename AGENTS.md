# AGENTS

Guidance for coding agents. Read the docs of an area before changing it. Paths are relative to `docs/` unless they
start with `packages/` or `extensions/`.

## Read first

- `agents/build_bazel_targets.md`: always, before building or testing; every build and test is a Bazel target,
  the lints too (ESLint of the TypeScript, Clippy and rustfmt of the Rust).
- `agents/core_first.md`: before writing TypeScript; logic that fits the core is Rust in the core module.
- `agents/writing_components.md`: before writing a React component; components show models, hooks bind the runtime.

## Index

- Build and release: `agents/build_rust_coverage.md` (coverage), `agents/rust_analyzer.md` (rust-project.json),
  `misc/build_bazel_cache.md` (remote cache), `misc/build_signing.md` (macOS signing),
  `misc/deploy_cloudflare_pages.md` (deploying dashql.app), `design/test_data.md` (datasets of data.dashql.app)
- SQL: `agents/sql_scripts.md` (reentrant scripts), `agents/core_sql_formatting.md` (extending the formatter),
  `design/sql_formatter_coverage.md` (its test gates), `design/sql_grammar.md` (deviations from PostgreSQL)
- Parser and analysis: `design/core_parser.md`, `design/core_quirks.md` (kept on purpose),
  `design/core_analysis_catalog.md` (catalog types, name resolution), `design/core_completion.md`,
  `design/core_completion_ranking.md`
- Catalog: `design/catalog_updates.md` (following the connection), `design/catalog_batching.md` (SQL to descriptors)
- Planner and runs: `design/planner.md`, `design/planner_dependencies.md`, `design/script_references.md` (`:foo`),
  `design/workbook_graph_execution.md`, `design/workbook_results.md` (stored results of the scripts),
  `wip/result_windows.md` (results out of the JavaScript heap, the grid reads windows)
- Core and runtime: `design/dashql_core.md` (the Rust crates, the core module, the host, the rules),
  `design/dashql_runtime.md` (`@akohn/dashql`, views, dispatch, where tests go, perf marks)
- Workbooks: `design/workbook_inputs.md` (`@param`), `design/vis_comments.md` (`@vis`, `@board`, `@flow`),
  `design/workbook_tables.md` (`.dashql` files, links), `design/workbook_publishing.md` (static hosts),
  `design/cloud.md` (published workbooks in a connection), `design/storage_layout.md` (OPFS, Node, migrations),
  `design/native_file_sync.md` (native folders)
- Views: `design/dataflow.md`, `design/trino_plan.md` (query profiles), `design/vegalite_crossfilter.md`,
  `design/examples.md` (demos), `design/ui_icons.md` (the SVG symbol atlas), `design/app_theme.md` (colors)
- Connections: `design/oauth_salesforce.md`, `misc/setup_data_cloud.md`, `misc/salesforce_v3_http.md`,
  `design/hyper_links.md`, `misc/setup_hyperd.md`
- Client functions: `design/client_functions.md`, `design/extensions.md`, `design/extensions/api_survey.md`, the Data
  360 extension in `extensions/d360-api/clfn/docs/` (`overview.md`, `functions.md`, `api_notes.md`)
- Agents: `design/agent_integration.md` (start here: the desktop app runs a harness per question, the agent calls the
  page with `dashql`), `design/agent_integration_tests.md`, `packages/dashql-cli/README.md` (the `dashql` commands)
- hyperdb-edge: `wip/hyperdb_edge.md`, `wip/hyperdb_edge_stores.md`
- Website: `agents/architecture_diagrams.md` (the style of the architecture diagrams of dashql.org, for new ones)
- Hosts and embeds: `design/electron.md` (desktop app), `design/app_csp.md`, `design/document_isolation_policy.md`,
  `wip/embeds.md`, `design/slack_app.md`, `packages/dashql-mcp/README.md`, `design/tools.md` (pages of their own at
  `tools.html#/<id>`, e.g. unpacker)

## Third-party notices

`NOTICE` lists vendored third-party code and assets with their licenses. Add an entry when you vendor something, and
remove it when that code is deleted.
