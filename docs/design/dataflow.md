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
  `insert` and `select` of a table form a chain, also within one script. A drop neither produces nor reads data, it
  ends no edge and starts none. A statement that reads a relation only through the query of an inlined script reads
  it through that script: the edge into the statement is left out, the edge into the script stays. A statement that
  also reads or writes the relation itself keeps its edge.

- **Inputs**: a named scalar parameter `:min` is an input of the session (`session_inputs.md`), the inputs follow the
  scripts in the order of their first use. An `INPUT` edge starts at an input, its `from_script` is the index of the
  input, and ends at every statement that uses it.

Edges that only order statements (`WRITE_AFTER_READ`, `BARRIER`, `SEQUENCE`) and the edges of materializations,
which the scan references stand for, are no dataflow. A relation that a statement reads before another statement
creates it in session order has no edge, a run would read it before it is written.

The snapshots in `snapshots/dataflow/` have cases of their own, they describe a session like the planner snapshots
(`connections`, `catalog`, `scripts`, `stale-prepend`, and `collapsed` for the scripts whose boxes are collapsed,
`targets` and `materialized` are ignored) and
expect the statements of every script, the box of every script on the canvas (`box: [x, y, width, height]`, see
Layout), the inputs with their type, value and box, and the edges, an input edge from `":min"`
(`bazel run //snapshots/dataflow:update`).

## Layout

The position of a script on the canvas is its `@flow x=.. y=..` tag, see [vis_comments.md](vis_comments.md).
`dataflow_layout::compute_dataflow_layout` in `dashql-core-view` (core-js `computeDataflowLayout`) places the
others. The layout has two levels:

- **Inside a box** the statements are stacked in script order below a header. The box of an input is one row below
  its header, 200px wide, the other boxes have the width of the config. Every statement is a row of the same
  height, and the chart of a visualized statement follows its row. A collapsed box is its header. The script fixes
  the geometry of its box.
- **Between boxes**, without fixed boxes, every box is arranged in layers from left to right (Sugiyama): back edges
  of cycles are reversed, a box is one layer right of its rightmost producer, and a box without producers sits
  right before its leftmost consumer. Barycenter sweeps order the boxes of a layer, edges spanning layers pass
  through dummy nodes, and the order with the fewest crossings wins. Then alternating sweeps move every box to the
  median of the rows it is connected to in the layer before or after it, so edges between statement rows run straight
  where they can. The dummy nodes only order the layers, an edge across a layer may pass behind a box of a layer in
  between. Connected parts are stacked, boxes without edges go into rows of four below them.
- **With fixed boxes**, the others are placed one at a time in topological order: right of their placed producers,
  left of their placed consumers, or below everything at the left edge, at the median of their connected rows, then
  moved to the nearest free slot.

Boxes that are not fixed snap to an 8px grid. With the default sizes every row center is a multiple of the grid,
so edges between snapped boxes stay straight. The dataflow snapshots lay out their boxes like the first render of
the canvas: `@flow` tags fix boxes, a visualized terminal statement gets its chart.

## The canvas

The dataflow view is an experimental view of a session (`experimental_dataflow` in the app settings, `?view=dataflow`
in the URL), next to the feed and the dashboard in the view switch. `src/session/dataflow/` holds it:

- `dataflow_graph.ts` derives the graph of a session with `deriveSessionDataflow`, memoized on the names,
  connections and analyses of the scripts. A script whose analysis is behind its text keeps its last statements and
  the edges that start or end at it until it is analyzed again, so the canvas does not flicker while a script is
  edited.
- `dataflow_scene.ts` turns the graph and the layout into the scene: boxes, statement rows with their ports, charts,
  edge paths and badges. An edge between boxes runs from the output port on the right of its source row to the input
  port on the left of its target row, orthogonal with rounded corners like the edges of the plan view: with at most
  two turns to a target on the right, around the boxes to a target on the left or at the same x. Edges inside a box
  run along the left of its rows. Collapsed boxes merge their edges and leave out the edges inside them.
- `dataflow_canvas.tsx` renders the scene in SVG with the shared graph styles of the plan view
  (`src/ui/graph/graph.module.css`, `GraphPort`): boxes are fragments, statements are node frames, inline
  references and table edges are solid, scans and invalid references are dashed, the relation of a table edge is a
  badge, and a selection redraws its edges in the highlight layer and highlights their ports. Charts are
  `foreignObject`s below their statement. d3-zoom pans and zooms, below half the size every box is drawn collapsed.
- The box of an input shows the name and the type in its header and the value in its row, the card of the feed
  (`SessionInputCard`) in a `foreignObject`. Enter writes the value into the scripts and runs the scripts that the
  change affects (`session_inputs.md`). Input edges are solid. An input has no script that could hold its position,
  the canvas remembers where the layout or a drag placed it while the canvas is open, Arrange places it again.
- `dataflow_source.ts` writes the changes into the scripts: a dragged box writes its `@flow` tag, the `+` of a
  box creates `select * from :<script>` on its connection, New script creates a query, a double click on the canvas
  creates a query at that position, the trash button deletes the script, and Arrange removes every `@flow` tag
  and lays out every box again.

The layout always lays out full boxes, collapsing a box only changes how it is drawn. A box with a `@flow` tag is
fixed at its tag. The canvas remembers where the layout placed the other boxes and passes these positions to the
layout as fixed boxes, so a box keeps its position while the session changes and only new boxes are placed: a script
that reads a box goes right of it, in the nearest free slot. A remembered box that a neighbour grows over is placed
again, a script without statements is not remembered until it has some. Opening a box (its pencil, a double click or
Enter) shows the script in the script details next to the canvas, switching the view closes them.
