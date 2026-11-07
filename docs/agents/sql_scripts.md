# Writing SQL Scripts

SQL that users run in DashQL (snippets in `examples/snippets/`, demo scripts, example workbooks) should be
reentrant: running a script a second time against the same database must succeed and leave the same state.

- Create objects with `if not exists`: `create table if not exists`, `create schema if not exists`.
- Drop objects with `if exists`: `drop table if exists`.
- Load seed data together with the table, `create table if not exists t as select ...`, so a rerun does not
  insert the rows twice (see `examples/snippets/hyper/datasets/tpch_0_01.sql`).

This does not apply to parser, analyzer, planner or formatter snapshot inputs, where the exact statement
shape is what the test covers. It also doesn't apply to the workflows in `overlay/*/snippets/`: an API has no
`if not exists`, and their steps build on each other.
