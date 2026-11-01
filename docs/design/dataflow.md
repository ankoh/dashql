# Dataflow

The dataflow view of a session draws every script as a box of its statements on a canvas and the flow of data
between the statements as edges, in the style of data pipeline tools.

## The dataflow of a session

`dataflow::derive_session_dataflow` (core-js `deriveSessionDataflow`) takes a session plan request and returns
the statements of every script and the edges between statements. It is a projection of a tolerant plan of the
session (`PlanScope::Tolerant`, see [planner.md](planner.md)), so relations and script references resolve like
in a run, from the analysis of every script:

- **Statements**: the nodes of the plan of a script, with the statement type, the relation that a statement creates,
  writes or drops (the entity of its write or DDL access), and the text of the statement. A script without a current
  analysis is not planned (`analyzed` is false), the app keeps what it knew about it.
- **Script references**: a table parameter `:foo` flows from the terminal query of `foo.sql` to the statement of the
  parameter, `INLINE_REFERENCE` within a connection, `SCAN_REFERENCE` from the materialized result on the LOCAL
  connection. A reference with errors whose name finds a script is an `INVALID_REFERENCE` edge, from the
  reference check of the planner (`check_script_references`); the editor reports the errors.
- **Relations**: the planner edges `READ_AFTER_WRITE`, `WRITE_AFTER_WRITE` and `DDL` of a relation whose source wrote
  the relation are `TABLE` edges, labeled with the relation name. A write continues the flow, so the `create`,
  `insert` and `select` of a table form a chain, also within one script. A drop reads no data. A statement that
  reads a relation only through the query of an inlined script reads it through that script: the edge into the
  statement is left out, the edge into the script stays.

Edges that only order statements (`WRITE_AFTER_READ`, `BARRIER`, `SEQUENCE`) and the edges of materializations,
which the scan references stand for, are no dataflow. A relation that a statement reads before another statement
creates it in session order has no edge, a run would read it before it is written.

The snapshots in `snapshots/dataflow/` use the fixtures of the planner snapshots (`bazel run //snapshots/dataflow:update`).

## Positions

The position of a script on the canvas is its `@vis flow x=.. y=..` tag, see [vis_comments.md](vis_comments.md).
Scripts without a position are placed automatically.
