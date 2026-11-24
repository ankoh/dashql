# SQL Formatter Coverage

Every error-free script accepted by the DashQL grammar formats without source-text fallbacks or
`format_unimplemented` placeholders, and formatting preserves parse meaning in inline, compact, and pretty
modes. Three test gates enforce this; `docs/agents/core_sql_formatting.md` describes the workflow for extending
the formatter.

## Gates

1. **Parser-corpus round trip** (`//packages/dashql-core:formatter_roundtrip_test`,
   `packages/dashql-core/tests/formatter_roundtrip.rs`). Formats every error-free script of `tests/snapshots/parser`
   and every Hyper case of the parser (`packages/dashql-parser/src/parser/hyper_cases.rs`, the positive cases of
   its grammar tests, which the test compiles as a module of its own) in all three modes. Each run must be fully formatted (`Formatter::is_fully_formatted`), its output must scan
   and parse without errors to a tree with the same node types and attribute keys at the same depths, and it must format to the same
   text a second time, also with comments between all of its symbols, each printed once. The tree check catches a
   clause that the formatter drops without a placeholder and a node that ends up under another parent, like a join on
   the right of a CROSS JOIN without its parentheses; `RESPELLED` lists the scripts whose output spells a
   construct with another tree of the same meaning (`array(t)` and `t array` as `t[]`). The test reports the unformattable node types of
   every failure. `UNFORMATTABLE` lists the scripts the formatter rejects on purpose and reports as not fully formatted:
   `DEFAULT` outside of the values of `INSERT` and `MERGE` and of assignments, also in `values (default)`.

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
