# SQL Formatter Coverage

Every error-free script accepted by the DashQL grammar formats without source-text fallbacks or
`format_unimplemented` placeholders, and formatting preserves parse meaning in inline, compact, and pretty
modes. Three test gates enforce this; `docs/agents/core_sql_formatting.md` describes the workflow for extending
the formatter.

## Gates

1. **Parser-corpus round trip** (`//packages/dashql-core:formatter_roundtrip_test`,
   `packages/dashql-core/tests/formatter_roundtrip.rs`). Formats every error-free script of `snapshots/parser`
   in all three modes. Each run must be fully formatted (`Formatter::is_fully_formatted`), its output must scan
   and parse without errors, and scripts without comments must format to the same text a second time. The test
   reports the unformattable node types of every failure. `UNFORMATTABLE` lists the scripts the formatter
   rejects on purpose (currently only `DEFAULT` outside of `INSERT` values).

   This is the breadth gate and the grammar-change gate in one: a new parser fixture that uses syntax without a
   formatter handler fails CI.

2. **Behavior snapshots** (`//packages/dashql-core:formatter_snapshot_test`). Formatter snapshots define layout
   quality per syntax family. Cases named `coverage_*` must additionally be fully formatted and reparse without
   errors.

3. **Hyper validation** (`//packages/dashql-core:formatter_validation_hyper_test`). Snapshot cases with a
   `dialects.hyper.validation` block execute the formatted SQL in Hyper, which covers meaning-sensitive
   constructs where the syntax is portable.

The parser corpus is the breadth gate; formatter snapshots define layout quality. Neither replaces the other.

## Adding Syntax

A grammar change that emits new AST nodes or attributes needs:

- a formatter handler in `packages/dashql-core/src/formatter/`,
- focused formatter snapshot inputs, including optional modifiers and narrow-width wrapping,
- Hyper validation or AST-equivalence coverage for meaning-sensitive constructs.

The parser fixture for the new syntax then passes the round-trip gate without extending `UNFORMATTABLE`.
