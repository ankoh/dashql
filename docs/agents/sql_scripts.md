# Writing SQL Scripts

SQL that users run in DashQL (snippets in `examples/snippets/`, demo scripts, example workbooks) should be
reentrant: running a script a second time against the same database must succeed and leave the same state.

- Create objects with `if not exists`: `create table if not exists`, `create schema if not exists`.
- Drop objects with `if exists`: `drop table if exists`.
- Load seed data together with the table, `create table if not exists t as select ...`, so a rerun does not
  insert the rows twice (see `examples/snippets/hyper/datasets/tpch_0_01.sql`).

This does not apply to parser, analyzer, planner or formatter snapshot inputs, where the exact statement
shape is what the test covers. It also doesn't apply to the workflows in `extensions/*/snippets/`: an API has no
`if not exists`, and their steps build on each other.

The snippets are what `dashql format` prints, `//extensions/d360-api:snippets_formatted_test` and
`//packages/dashql-cli:example_snippets_formatted_test` check that. After writing one, format its folder, with the dialect
of its engine:

```bash
bazel run //packages/dashql-cli:dashql -- format --write extensions/d360-api/snippets
bazel run //packages/dashql-cli:dashql -- format --write examples/snippets/hyper examples/snippets/d360
bazel run //packages/dashql-cli:dashql -- format --write --dialect trino examples/snippets/trino
```
