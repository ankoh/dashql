# AGENTS

Repository guidance for coding agents lives in `docs/agents/`.

Please consult relevant docs in that directory before making changes.

- Build & Test (always read this document first)
    - `docs/agents/build_bazel_targets.md`

- Formatting
    - `docs/agents/core_sql_formatting.md`

- Build System Details
    - `docs/agents/build_rust_coverage.md`
    - `docs/agents/rust_analyzer.md` (rust-project.json for rust-analyzer)

- Rust core (parser design, parse-tree change rules, quirks inherited from the former C++ core)
    - `docs/design/core_parser.md`
    - `docs/design/core_quirks.md`

- Third-party notices
    - `NOTICE` lists vendored third-party code and assets with their licenses. Add an entry when you
      vendor something, and remove it when that code is deleted.
