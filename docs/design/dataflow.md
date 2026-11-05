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
  connection. A reference with errors whose name finds a script is an `INVALID_REFERENCE` edge, the plan keeps the
  script of an invalid reference; the editor reports the errors.
- **Relations**: the planner edges `READ_AFTER_WRITE`, `WRITE_AFTER_WRITE` and `DDL` of a relation whose source wrote
  the relation are `TABLE` edges, labeled with the relation name. A write continues the flow, so the `create`,
  `insert` and `select` of a table form a chain, also within one script. A drop neither produces nor reads data, it
  ends no edge and starts none. A statement that reads a relation only through the query of an inlined script reads
  it through that script: the edge into the statement is left out, the edge into the script stays. A statement that
  also reads or writes the relation itself keeps its edge. The plan tells the reads of a statement from those it
  inherits from inlined queries.

- **Inputs**: a named scalar parameter `:min` is an input of the session (`session_inputs.md`), the inputs follow the
  scripts in the order of their first use. An `INPUT` edge starts at an input, its `from_script` is the index of the
  input, and ends at every statement that uses it.
- **Attachments**: a table parameter `:sales` that scans the attachment `sales.parquet` (`script_references.md`) flows
  from the attachment to the statement of the parameter, also when an inlined query reads it. The attachments of the
  session follow the inputs, an `ATTACHMENT` edge starts at an attachment, its `from_script` is the index of the
  attachment. The canvas of the app draws no attachments yet, it leaves these edges out.

Edges that only order statements (`WRITE_AFTER_READ`, `BARRIER`, `SEQUENCE`) and the edges of materializations,
which the scan references stand for, are no dataflow. A relation that a statement reads before another statement
creates it in session order has no edge, a run would read it before it is written.

The snapshots in `snapshots/dataflow/` have cases of their own, they describe a session like the planner snapshots
(`connections`, `catalog`, `scripts`, `stale-prepend`, `attachments`, and `collapsed` for the scripts whose boxes are
collapsed, `targets` and `materialized` are ignored) and
expect the statements of every script, the box of every script on the canvas (`box: [x, y, width, height]`, see
Layout), the inputs with their type, value and box, the attachments with their file and box, and the edges, an input
edge from `":min"`, an attachment edge from its file, an edge between boxes with its `route`
(`bazel run //snapshots/dataflow:update`).

## Layout

The position of a script on the canvas is its `@flow x=.. y=..` tag, the size of its box the `width=..` and
`height=..` of the tag, the width of the box and the height of its chart, see [vis_comments.md](vis_comments.md).
`layout::compute_dataflow_layout_with_routes` in `dashql-dataflow` (core-js
`DashQLDataflow.computeDataflowLayoutWithRoutes`) lays out the boxes with the layered layout of the Eclipse Layout
Kernel (elk-rs, `org-eclipse-elk-alg-layered`) and returns the routes of the edges between them. ELK makes the layout
a wasm module of its own (`dashql-dataflow-wasm`, `dashql_dataflow.wasm` of `@ankoh/dashql-core`), the core module
stays without it: the app loads the layout module when it opens the dataflow canvas and shows that it loads until
then (`dataflow_module.ts`).

The sizes of the canvas are set in one place, `DataflowLayoutConfig` in `dashql-dataflow/src/layout.rs`: the boxes,
the bounds of a resize, the gaps between columns, boxes and edges, and the grid that drags and resizes snap to. The
dataflow snapshots use them, the app reads them from the module (`DashQLDataflow.config`). The layout has two levels:

- **Inside a box** the statements are stacked in script order below a header. The box of an input is one row below
  its header, 200px wide, a box with a chart (a Vega-Lite chart, a table or markdown) is 480px wide, so that the
  chart is wider than high, the other boxes are 280px wide. Every statement is a row of the same height, and the
  chart of a visualized statement follows its row. A collapsed box is its header. The script fixes the geometry of
  its box.
- **Between boxes** every box is a node of ELK with a port per connected statement row, inputs on its left border and
  outputs on its right border at the centers of the rows, so the node placement lines up the rows at both ends of an
  edge where it can. Edges are routed orthogonally, edges out of one port share their first segments (merged edges).
  Columns are at least `layer_gap` (144) apart and wider where the edges between them need more rails, boxes of a
  column at least `box_gap` (48), parallel edges `edge_gap` (16) and edges and boxes `edge_box_gap` (24). ELK puts
  the vertical segments of the edges between two columns next to the left column, the layout moves them together
  into the middle of the gap, away from the boxes on both sides.
  The routes run from the right border of the source box to the left border of the target box.
- **Without positions** (`hint` of a layout box, a new session or Arrange) ELK arranges every connected box in layers
  from left to right, network simplex placement, in the order of the session. The consumers of a box, e.g. the
  charts of one base table, stack in one column below each other. The connected parts
  are packed by ELK with its defaults, boxes without edges go into rows of four below them. The layout depends on
  the graph only, not on the size of the window.
- **With positions** ELK lays out interactively, every connected part on its own: the columns follow the x of the
  boxes, the order in a column their y, and a box keeps its y where it does not overlap another. The columns are the
  runs of overlapping x ranges of the boxes, a box goes into the column of its center. A box without a position starts
  right of its producers or left of its consumers, with the row of the edge level with the row at its other end. A
  part is moved back by the offset that most of its boxes share,
  ELK moves a layout to the origin. Boxes without edges keep their positions, parts and boxes without any position go
  below everything.
- **A dropped box** (`dropped`) goes into the column under its center, or into a new column if its center lies in the
  gap between two columns, and keeps its y, unless a row of it is within `align_snap` (24) of lining up with a row
  it is connected to: then it lines up, and the edge runs straight instead of making a small hop. It does not place
  the layout, the boxes that stay do. A drop is laid out
  twice, the second time from where the first put every box, like a reload, so the canvas shows what a reload shows.

A layout that starts from where an earlier one put every box reproduces it, positions and routes. The dataflow
snapshots lay out their boxes like the first render of the canvas: `@flow` tags are the positions and sizes, a
visualized terminal statement gets its chart.

`routing::route_edges` (core-js `DashQLDataflow.routeDataflowEdges`) routes edges around boxes at any position with
the vendored ortho-router (`ortho_router`): orthogonal routes with few bends, `edge_box_gap` to the boxes, routes that
share a channel spread `edge_gap` apart. The canvas uses it while a box is dragged or resized.

## The canvas

The dataflow view is a view of a session (`?view=dataflow` in the URL), next to the feed and the dashboard in the view
switch. `src/session/dataflow/` holds it:

- `dataflow_graph.ts` derives the graph of a session with `deriveSessionDataflow`, memoized on the names,
  connections and analyses of the scripts. A script whose analysis is behind its text keeps its last statements and
  the edges that start or end at it until it is analyzed again, so the canvas does not flicker while a script is
  edited.
- `dataflow_scene.ts` turns the graph and the layout into the scene: boxes, statement rows with their ports, charts,
  edge paths and badges. An edge between boxes runs from the output port on the right of its source row to the input
  port on the left of its target row, along the route of the layout with rounded corners. A step of 24 or less
  between two horizontal segments is one smooth bend, two tight corners would read as a hop. The route of the layout
  stays while both of its boxes are where the layout put them and no other box lies on it, else the edge is routed
  around the boxes (`DataflowRouting`), e.g. the edges of a dragged box. The badge of a table edge sits on the middle
  of its longest horizontal segment, the edges of a port with the same relation are a bus with one badge on its first
  segment. Without a route an edge falls back to a cubic curve that leaves and enters its ports horizontally, or a
  loop around the boxes to a target on the left. Edges inside a box run along the left of its rows with rounded
  corners. Collapsed boxes merge their edges and leave out the edges inside them.
- `dataflow_canvas.tsx` renders the scene in SVG with the shared graph styles of the plan view
  (`src/ui/graph/graph.module.css`, `GraphPort`): boxes are neutral outlines with a faint fill, the statements inside
  them are node frames, inline references and table edges are solid, scans and invalid references are dashed, the
  relation of a table edge is a badge. Edges between boxes and their badges run on the outlines up to their
  ports, the layout routes them around the boxes, the edges between the rows of one box run inside its outline. Every
  edge passes below the statements. Selecting a box, a statement or an input, or hovering a box, redraws its
  edges and their badges in the highlight layer on top of the boxes and highlights their ports, a drag drops the
  hover. The ports are a layer of their own on top of the highlight layer, so a highlighted edge ends under its port.
  Charts are `foreignObject`s below their statement, in a white frame with a 1px border like the statements. A
  Vega-Lite chart is a `VegaLitePreview`: the chart config of the app with smaller text and marks, four ticks,
  horizontal x labels and no legends, fitted into the frame with an 8px inset. The scene takes the height of a chart
  from the layout of its box. A script box has a resize handle in its bottom right corner, like the cards of the
  board: dragging it changes the width of the box and the height of its chart on the 8px grid, a box without a chart
  only changes its width, the arrow keys change them by 16px. The box follows the pointer, the other boxes make room
  on release. The statement labels are truncated to the width of the box. d3-zoom pans and zooms.
- The header of a script box is the header of the feed entry of the script (`FeedEntryHeader`, connected to the
  session by `ScriptEntryHeader`) in a `foreignObject`: run, connection, diagnostics, the `:<script>` tag, chart
  builder, edit, the script menu and delete. The feed order controls and the snippets are left out, the editor dialog
  shows the snippets, edit opens it. A narrow box hides the debug statistics and delete first, then the chart builder,
  the script menu offers them too. A drag on the free space of the header moves the box, the controls keep the pointer.
- The box of an input shows the name and the type in its header and the value in its row, the card of the feed
  (`SessionInputCard`) in a `foreignObject`. Enter writes the value into the scripts and runs the scripts that the
  change affects (`session_inputs.md`). Input edges are solid. An input has no script that could hold its position,
  the canvas remembers where the layout or a drag placed it while the canvas is open, Arrange places it again.
- `dataflow_source.ts` writes the changes into the scripts: the placements of the boxes into their `@flow` tags, the
  `+` of a box creates `select * from :<script>` on its connection, New script creates a
  query, a double click on the canvas creates a query at that position, the delete button of the header deletes the
  script, and Arrange removes the positions of the `@flow` tags, keeps the sizes and lays out every box again.

The layout always lays out full boxes, the canvas draws every box with its statements. Every layout starts from where
the boxes were: where the last layout put them while the canvas is open, else their `@flow` tags. So a box keeps its
column, its order and its y while the session changes, and a new script starts next to the boxes it reads. A drop or
a resize lays out from the dropped box and the new size, then writes the position and the size of every script box
into its `@flow` tag, tags that hold them already stay, so a reload shows the same layout. A script without
statements is not remembered until it has some. Opening a box (the edit button of its header, a double click on its header or
a statement, or Enter) selects the script and shows it in the editor dialog (`ScriptEditorDialog`), an overlay of
960×600px that shrinks to the window: the same entry header, then expand and close, the editor with accept and reject
of a staged rewrite, and the status of the last run. Expand fills the window. A narrow dialog hides the debug statistics
and delete of the header first, then the chart builder and the snippets, expand and close always show. Escape
closes an open completion first, then the dialog, a click outside keeps it open. Switching the view or the session
closes it.
