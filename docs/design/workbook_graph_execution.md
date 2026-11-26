# Workbook Graph Execution in the Core

The runs of workbooks are a service of the core runtime (`packages/dashql-core-runtime/src/workbook_run/`): the
preparation of the scripts, the plan, the stored results, the schedule of the plan across its connections and the
writes of a run.

| Area | Where |
|---|---|
| The graph executor | `workbook_run/engine.rs` |
| The plan as a run reads it (statements, keys, skipped nodes) | `workbook_run/plan.rs` |
| Plan-shape guarantees | The run counts every pair of nodes once and fails a plan with a cycle |

## Background

Every run of a workbook executes a plan. The planner (`packages/dashql-core-runtime/src/planner/mod.rs`)
turns the scripts of a workbook, or one target script and the scripts it references, into an
`ExecutionGraph`. Each node is a statement with the relations it reads, writes or defines. Edges
order conflicting accesses. The run (`workbook_run`) executes that graph for a run of the workbook
(`runWorkbook` of the runtime) and for a run of one script (`runScript`), the service of the runs of the runtime
(`packages/dashql-core-bindings/src/runtime/runs.rs`) on its executor.

## The run

A run is an async task on a `RunHost`. It analyzes the scripts on the workbook, plans them, serves the stored results of the
workbook, plans again with their files and runs the nodes: a node starts when its predecessors released
it, at most a number of statements of a connection run at once, a failed statement fails its script and blocks the
nodes that follow it while the other scripts run on. A statement is done once its result is there, the analysis of
the result (the computation of the data table, the column summaries and the cross filters) runs on after it and holds
up neither the run nor its other statements; a Stop of the run stops the analyses that still run. The run
registers the queries, the results and the visualizations of the scripts on the workbook. See
`docs/design/dashql_core.md`, Runs of workbooks.

The platform keeps what is a JavaScript value: the result tables, the files of the stored results and the mounts of
the embedded Hyper. The holds of workbooks, the cancellation of the queries and the `run` views are Rust.

## Why the core runs it

- **One execution protocol.** The order of the statements and the scheduling come from the core, next to the planner
  whose invariants they rely on.
- **Rust tests for the scheduling rules.** Predecessor counting, ready order, concurrency per connection, skipped
  connections and "a failure blocks what follows it" are tested next to the planner (`tests/workbook_run_test.rs`).
- **No round trip per completion.** The run awaits the statements itself, the app doesn't call into wasm to learn what
  is ready.
- **The analyses of a run belong to the workbook.** The run analyzes the scripts on the workbook.

## Files

- `packages/dashql-core-runtime/src/planner/mod.rs`
- `packages/dashql-core-runtime/src/workbook_run/mod.rs`, `engine.rs`, `plan.rs`
- `packages/dashql-core-bindings/src/runtime/runs.rs` (the service of the runs, the holds of workbooks, the host of a run)
- `packages/dashql/src/runtime/run_mounts.ts` (the files of the runs on the platform)
- `proto/fb/dashql/execution_graph.fbs`
- `docs/design/core_analysis_catalog.md` (catalog changes in planned execution)
