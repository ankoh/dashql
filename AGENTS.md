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

- Call API (proposed, not implemented: declarative function specs for `CALL <namespace>.*` over any REST API)
    - `docs/design/call_api.md` (the statement, spec format, connector binding, checks, completion, paging, pending results, security)
    - `docs/design/call/api_survey.md` (the format measured against Snowflake, GitHub and Stripe, similar formats)

- CDP SQL (proposed, not implemented: the first function spec, `CALL cdp.*` over the Salesforce Data 360 API)
    - `docs/design/call/cdp/overview.md` (the Salesforce binding, how Data 360 fits the format, naming, where attributes come from)
    - `docs/design/call/cdp/functions.md` (the function reference and result schema, with one document per family in the same directory)
    - `docs/design/call/cdp/api_notes.md` (API quirks, usage order, source conflicts, checks to run on an org)

- Web app security (Content-Security-Policy of pages and workers, no evaluated code, Wasm compilation)
    - `docs/design/app_csp.md`

- Web app theme (colors only from the theme tokens, light-dark(), the color scheme toggle, dark chrome)
    - `docs/design/app_theme.md`

- Third-party notices
    - `NOTICE` lists vendored third-party code and assets with their licenses. Add an entry when you
      vendor something, and remove it when that code is deleted.
