# SQL Formatter Coverage Plan

## Goal

Every error-free script accepted by the DashQL grammar should format without source-text fallbacks or
`FormatUnimplemented` placeholders. Formatting must preserve parse meaning in inline, compact, and pretty modes.

## Coverage Model

Track support at three levels:

1. **Grammar inventory**: map every AST node and enum emitted by `grammar/rules/*.y` to a formatter handler or an
   explicitly transparent structural node.
2. **Parser-corpus ratchet**: format every error-free case in `snapshots/parser` and report unformattable node type and
   attribute pairs. New grammar fixtures must not increase the unsupported set.
3. **Behavior snapshots**: add focused formatter fixtures for each supported syntax family. Require every fixture to be
   fully formatted, parse the formatted result again, and use DuckDB execution validation where the syntax is portable.

The parser corpus is the breadth gate; formatter snapshots define layout quality. Neither replaces the other.

## Execution Order

1. **Top-level statements**: `CREATE TABLE AS`, `CREATE VIEW`, `CREATE FUNCTION`, `CREATE AGGREGATE`, `SET`, and all
   modifiers on existing `CREATE TABLE` support.
2. **SELECT clauses**: `ALL`, `INTO`, named windows, row locking, query sampling, table sampling, and limit/fetch forms.
3. **Expressions and types**: bit types, type tests, quantified subqueries, indirection, array subscripts, and lambdas.
4. **FROM variants**: `ROWS FROM` items, aliases with column definitions, ordinality, and nested table-reference forms.
5. **Dialect corpus**: run TPCH, TPCDS, SSB, Trino, and regression parser fixtures through all formatting modes.
6. **Grammar-change gate**: make an emitted AST node without a formatter classification fail CI with the node and
   attribute names needed to add support.

## Definition Of Done Per Family

- The grammar alternatives have focused formatter inputs, including optional modifiers and narrow-width wrapping.
- Formatting reports no unformattable nodes for those inputs.
- Formatted SQL reparses without scanner or parser errors.
- Meaning-sensitive constructs have execution validation or AST-equivalence coverage.
- The grammar inventory and unsupported baseline shrink in the same change.

## Initial Milestone

The first implementation covers top-level statement families already present in the parser corpus: `CREATE TABLE AS`,
`CREATE VIEW`, `CREATE FUNCTION`, `CREATE AGGREGATE`, and nested `SET` varargs. It also formats temporary/unlogged and
`ON COMMIT` modifiers instead of rejecting otherwise supported `CREATE TABLE` statements.

The second implementation covers SELECT-level `ALL`, `INTO`, named windows, every row-locking strength and blocking
behavior, query/table sampling forms, `LIMIT ALL`, and count-less `FETCH FIRST ROW ONLY` normalization.
