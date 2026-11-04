# Trino plans

A Trino plan arrives as one plan tree per fragment. DashQL joins the fragments into one operator tree, lays the
tree out in the Rust core, and draws edges and stage contours in the app. The pipeline is:

1. `parse_trino_plan` reads the JSON into a `QueryProfile` (`packages/dashql-core-profile/src/trino_plan_parser.rs`).
2. `flatten_operators` stores the tree as a flat operator array (`query_profile.rs`).
3. `compute_layout` positions every operator (`profile_layout.rs`).
4. `materializeProfileScene` builds edge paths and fragment contours
   (`packages/dashql-app/src/views/query_profile/profile_scene.ts`).

`loadTrinoPlan` in `packages/dashql-core-wasm/src/lib.rs` runs steps 1 to 3 and hands the profile to JS as a
FlatBuffer.

## Input formats (`read_fragments`)

Both formats become a map from fragment id to the root node of the fragment's plan:

- `EXPLAIN (TYPE DISTRIBUTED, FORMAT JSON)` is already that map: `{ "0": { "name": ..., "children": [...] }, ... }`.
- A QueryInfo (`/v1/query/{id}`) carries the plan of every stage as a JSON string in
  `stages.stages[].plan.jsonRepresentation`. The fragment id is the last component of the stage id
  `<queryId>.<fragmentId>`.

Any other document is a parser error.

## Joining fragments into one tree (`TrinoPlanReader`)

A `RemoteSource` or `RemoteMerge` node reads the output of the fragments in `descriptor.sourceFragmentIds`
(a string like `"[1, 2]"`). The reader hangs the roots of those fragments below that node:

- The root fragments are the fragments that no node references, usually fragment `0`. Every root fragment
  becomes a root of the operator tree.
- `read_node` reads the `children` of a node first, then the source fragments. The root of a source fragment
  becomes an additional child, with the parent path `fragment <id>`.
- A fragment is read once. A second reference to the same fragment is ignored, so a fragment read by two
  nodes hangs below the first one only.
- Every fragment becomes a `Fragment` with its fragment id as engine id and the reading fragment as
  `parent_fragment`. The root fragment is a stage like the others and draws a contour.

Per node the reader keeps:

| Operator field   | Trino JSON                                          |
| ---------------- | --------------------------------------------------- |
| `engine_id`      | `id` (the plan node id)                             |
| `operator_type`  | `name`                                              |
| `kind`           | `name`, mapped by `trino_operator_kind`             |
| `operator_label` | `descriptor.table`, last `:` component (`lineitem`) |
| `estimated_rows` | `estimates[0].outputRowCount`                       |
| `attributes`     | every other member, serialized as JSON              |

An exchange gets its kind from where it sends rows. A `RemoteSource` or `RemoteMerge` is a remote exchange. A
`LocalExchange` gathers (`partitioning` `SINGLE`, `COORDINATOR_ONLY`), broadcasts (`BROADCAST`), stays a plain
exchange (`UNKNOWN`, no partitioning), or else repartitions (`HASH`, `ROUND_ROBIN`, a connector partitioning).

Fragment ids and plan node ids are the engine ids, so the stage progress of a running query
(`progress/trino.rs`) finds its fragments and operators.

## Flattening (`flatten_operators`)

A post-order DFS writes the parsed tree into `QueryProfile::operators`. The children of an operator are stored
next to each other (`children_begin`, `children_count`), so operator ids grow from the leaves towards the
roots. The roots come last, in reverse plan order (see `core_quirks.md`).

After flattening, `parse_trino_plan` assigns every operator to its fragment, picks the root operator of each
fragment (the operator whose parent lies in another fragment), and derives the parent-child edges with port
indexes (`identify_operator_edges`).

## Layout (`profile_layout.rs`)

The layout is Walker's tree layout with the linear-time fix of Buchheim, Jünger and Leipert, for nodes of
different widths. The layout config comes from the app (`configure`).

- Node width: `node_padding_left + icon_width + icon_margin_right + content + node_padding_right`, at least
  `node_min_width`. The content is `label_chars * width_per_label_char` for the operator label or else the type,
  capped at `max_label_chars`. An operator without a label of its own and with a kind other than `OTHER` shows the
  symbol of its kind, its content is `symbol_width` if that is set.
- Separation of two neighbors, center to center: `left.width / 2 + node_margin_horizontal + right.width / 2`.
- `first_walk`, bottom-up: a leaf sits right of its left sibling, an inner node is centered over its first and
  last child. `apportion` walks the facing contours of neighboring subtrees level by level and moves the right
  subtree when they overlap. `shift` and `change` spread the move over the subtrees in between, threads
  continue a short contour at the next level.
- `second_walk`, top-down: `x` is `prelim` plus the modifiers of all ancestors, `y` is
  `level * level_height`. The root is level 0.
- `resolve_level_overlaps` sweeps every level left to right and moves a node with its subtree right if it
  still overlaps its left neighbor.
- Several roots are laid out one by one and packed left to right with one margin between their bounds.

`compute_layout` then shifts all positions to be positive. Every operator gets a `layout_rect` whose `x` and
`y` are the node center, the plan gets a `layout_rect` with the total width and height.

## Edges and fragment contours (`materializeProfileScene`)

The app reads the FlatBuffer into a `ProfileScene`:

- An operator is drawn at its layout width, which reserves an annotation slot left of the label. The annotation
  control picks what the slot shows: Status (the status icon, only with progress, the default then), Plain (nothing),
  Rows (the row count of the edge to the parent, as a pill colored by the row count) or Estimates (the estimate
  symbol). The label or symbol is centered in the rest of the operator right of what the slot shows, in all of the
  operator in Plain. The gaps between the operators only hold edges and contours.
- An edge is an SVG path from the child to the parent (`buildEdgePathBetweenRectangles`).
- A fragment contour encloses only the operators of the fragment, a nested fragment draws its own. `buildFragmentPath`
  pads every operator rectangle by 8px and adds a corridor (down, across, down) for every edge inside the
  set. An operator directly below its parent (or directly right of it in a left-to-right plan) instead fills the
  gap as wide as the narrower padded operator, so the two share one straight envelope.
  `traceFragmentRectangles` fills a grid built from the rectangle bounds, collects the boundary segments of the
  filled cells, and chains them into closed paths with rounded corners. Hidden fragments get no contour.
- The metrics of a stage (processed rows and bytes, CPU time, and the splits until it succeeded) are only part of the
  accessible label of its contour for now, they have no card on the plan.

## Tests

- `packages/dashql-core-profile/src/tests_trino.rs`: parser unit tests.
- `packages/dashql-snapshots/src/encode/query_profile.rs`: snapshot encoding of parsed and laid-out plans.
- `packages/dashql-app/src/views/query_profile/profile_scene.test.ts`: scene and contour building.
