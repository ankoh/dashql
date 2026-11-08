# Session Graph Execution in the Core

## Status

Considered, not planned. This records why the scheduler of a planned session run could move
into the core, and why we decided against it for now.

| Area | State |
|---|---|
| Plan-shape guarantees in the planner | Possible small step, not started |
| Graph executor in `dashql-core-session` | Deferred |

## Background

Every run of a session executes a plan. The planner (`packages/dashql-core-session/src/planner.rs`)
turns the scripts of a session, or one target script and the scripts it references, into an
`ExecutionGraph`. Each node is a statement with the relations it reads, writes or defines. Edges
order conflicting accesses. The app's
`packages/dashql-app/src/session/scripts/session_execution.ts` (`runExecutionGraph`) executes
that graph in TypeScript, for a run of the session (`runSessionExecution`) and for a run of one
script (`runPlannedScript` in `script_run.ts`).

The scheduling lives outside the core, the core owns the order (the edges).

## The proposal

Add a graph execution state machine to `dashql-core-session`, next to `planner.rs` (for example
`graph_execution.rs`), exported through the core wasm with a protocol of steps:

- `start` returns the nodes that are ready to run.
- `complete(node)` and `fail(node, error)` return the newly ready nodes, the node's catalog
  changes and the run state.
- `cancel` ends the run.

The app would keep the async loop around these calls.

### Arguments for it

- **One execution protocol.** The order of the statements would come from the core together with
  the scheduling.
- **The graph's invariants live with the graph.** The planner snapshot test checks that nodes come
  in committed statement order and that edges point forward. `session_execution.ts` deduplicates
  edges, because the planner emits one edge per conflicting entity and reason.
- **Rust tests for the scheduling rules.** Predecessor counting, ready order and "a failure stops
  new launches" would be tested next to the planner.

### Arguments against it

- **Little would move.** The pure scheduling part is predecessor counting and the ready queue,
  about 30 lines. Most of `runExecutionGraph` is async work or app state and stays in the app:
  - issuing queries against the connection, and cancelling the running ones on failure or abort
  - the concurrency limit per connection (`maxConcurrentQueries`)
  - releasing successors on `onResultsReady`, before result post-processing finishes
  - writing and mounting the materialized results of scripts of other connections
  - applying `APPLY_PLANNER_ANALYSIS` once the plan was checked
  - checking that the session and script versions did not change mid-run
  - decoding the captured visualizations before the first backend call
  - query registration, result registration, visualizations, progress state and replacing the
    previous output (`REGISTER_QUERY`, `REGISTER_SCRIPT_RESULT`, ...)
- **The app keeps its loop either way.** It would call into wasm on every completion to learn
  what is ready, and still run its own async loop around those calls.
- **Risk.** `session_execution.test.ts`, `session_execution_integration.test.ts` and
  `session_commands_execution.test.tsx` cover concurrency, readiness, cancellation and output
  cleanup densely. A rewrite would have to rebuild that coverage against the new split.

## Decision

Leave the scheduler in the app for now. Revisit if one of these happens:

- a second consumer of planned runs appears outside the app's TypeScript (the shell or a CLI). The agent bridge
  does not count: its `run` command already goes through `runPlannedScript`
  (`packages/dashql-app/src/agent/agent_commands.ts` → `runSessionScriptForResult` in
  `packages/dashql-app/src/session/scripts/rerun_query.ts`), so it shares the app's scheduler.
- the scheduler grows features such as retries, partial reruns or resuming a failed run

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
- `packages/dashql-app/src/session/scripts/script_run.ts`
- `packages/dashql-app/src/session/scripts/session_execution.ts`
- `proto/fb/dashql/execution_graph.fbs`
- `docs/design/core_analysis_catalog.md` (catalog changes in planned execution)
