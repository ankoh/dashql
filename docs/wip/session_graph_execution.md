# Session Graph Execution in the Core

## Status

Considered, not planned. This records why the scheduler of a planned session run could move
into the core, and why we decided against it for now.

| Area | State |
|---|---|
| Catalog changes of DDL in planned runs | Done: `ExecutionGraphNode.catalog_changes` |
| Plan-shape guarantees in the planner | Possible small step, not started |
| Graph executor in `dashql-core-session` | Deferred |

## Background

Two execution paths run SQL from a session:

- **Single script.** `ScriptExecution` in `packages/dashql-core-session/src/script_execution.rs`
  is a core state machine. The host calls `start`, executes each statement, passes the result
  to `resume` and gets the next step back. `cancel` ends the run. The core owns the order and the
  catalog changes.
- **Planned session run.** The planner (`packages/dashql-core-session/src/planner.rs`) turns the
  scripts of one connection into an `ExecutionGraph`. Each node is a statement with the relations
  it reads, writes or defines. Edges order conflicting accesses. The app's
  `packages/dashql-app/src/app/session/scripts/session_execution.ts` (`runSessionExecution`)
  executes that graph in TypeScript.

The second path re-implements scheduling outside the core. That is how DDL in planned runs
stopped updating the catalog: the single-script path derived catalog changes in Rust, the graph
path never did. The fix (commit 83b603ab6) derives them in the planner and stores them on each
node, and the app applies them after the query succeeds.

## The proposal

Add a graph execution state machine to `dashql-core-session`, next to `planner.rs` and
`script_execution.rs` (for example `graph_execution.rs`), exported through the core wasm with the
same protocol as `ScriptExecution`:

- `start` returns the nodes that are ready to run.
- `complete(node)` and `fail(node, error)` return the newly ready nodes, the node's catalog
  changes and the run state.
- `cancel` ends the run.

The app would keep the async loop around these calls.

### Arguments for it

- **One execution protocol.** Both paths would get order and catalog changes from the core, so
  the class of bug above cannot come back on one path only.
- **The graph's invariants live with the graph.** `session_execution.ts` checks that nodes come
  in committed statement order, that edges point forward and that edge targets are in range. It
  also deduplicates edges, because the planner emits one edge per conflicting entity and reason.
  These are properties of the planner's output and belong in the planner and its tests.
- **Rust tests for the scheduling rules.** Predecessor counting, ready order and "a failure stops
  new launches" would be tested next to the planner.

### Arguments against it

- **Little would move.** The pure scheduling part is predecessor counting and the ready queue,
  about 30 lines. Most of `runSessionExecution` is async work or app state and stays in the app:
  - issuing queries against the connection, and cancelling the running ones on failure or abort
  - the concurrency limit per connection (`maxConcurrentQueries`)
  - releasing successors on `onResultsReady`, before result post-processing finishes
  - re-analyzing scripts between connection blocks and applying `APPLY_PLANNER_ANALYSIS`
  - checking that the session and script versions did not change mid-run
  - decoding the captured visualizations before the first backend call
  - query registration, result registration, visualizations, progress state and replacing the
    previous output (`REGISTER_QUERY`, `REGISTER_SCRIPT_RESULT`, ...)
- **The app keeps its loop either way.** It would call into wasm on every completion to learn
  what is ready, and still run its own async loop around those calls.
- **The motivating bug is fixed.** Nodes already carry their catalog changes.
- **Risk.** `session_execution.test.ts`, `session_execution_integration.test.ts` and
  `session_commands_execution.test.tsx` cover concurrency, readiness, cancellation and output
  cleanup densely. A rewrite would have to rebuild that coverage against the new split.

## Decision

Leave the scheduler in the app for now. Revisit if one of these happens:

- a second consumer of planned runs appears (the shell, a CLI or the agent bridge)
- the scheduler grows features such as retries, partial reruns or resuming a failed run
- planned and single-script execution diverge again in what they apply to the catalog

## Possible small step

Move the plan-shape guarantees into the planner without moving execution:

- `planner.rs` guarantees, and tests, that nodes are in committed statement order, that every
  edge has `from < to` and `to < nodes.len()`, and that `(from, to)` pairs are unique (or the
  graph exposes a deduplicated successor list).
- `session_execution.ts` drops its `Execution plan is not in committed statement order` check
  and the edge deduplication.

This is a small, independent change.

## Files

- `packages/dashql-core-session/src/planner.rs`
- `packages/dashql-core-session/src/script_execution.rs`
- `packages/dashql-app/src/app/session/scripts/session_execution.ts`
- `proto/fb/dashql/execution_graph.fbs`
- `docs/design/core_analysis_catalog.md` (catalog changes in planned execution)
