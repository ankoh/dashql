# Visualizations as comment tags

A query is visualized by a `@vis` tag in the comments directly before it, `@board` places it on the
dashboard and `@flow` places its script on the dataflow canvas. The script stays plain SQL: every engine and
tool runs it unmodified, and only DashQL reads the tags.

```sql
/**
 * Revenue per region.
 *
 * @vis vegalite
 * {
 *   "mark": "bar",
 *   "encoding": {
 *     "x": {"field": "region", "type": "nominal"},
 *     "y": {"field": "revenue", "aggregate": "sum"}
 *   }
 * }
 * @board width=6 height=3
 */
SELECT region, revenue FROM sales;
```

## Tags

The tags are comment tags (see `core_parser.md`): a line whose first text is `@vis`, `@board` or `@flow`
starts a tag that runs to the next tag line or the end of the comment, like the block tags of Javadoc, so one
comment can hold several tags. `@vis table`, `@board` and `@flow` with content on their line end at their line,
the lines after them are ordinary text.

| Tag | Content |
|---|---|
| `@vis vegalite` | A Vega-Lite spec as JSON object, on the same line or the next. The statement is the data, `data` is ignored with a warning. |
| `@vis markdown` | The row template as Markdown, from right after the kind to the end of the tag. Rendered once per result row, `{{field}}` placeholders take the values of the columns. |
| `@vis table` | Nothing, the result table is the visualization. |
| `@board` | The dashboard placement as `key=value` args: `row`, `column`, `width` and `height`, all integers. |
| `@flow` | The placement of the script on the dataflow canvas as `key=value` args: the position `x` and `y`, the width of the box `width` and the height of its chart `height`, all integers. |

Older scripts write `@vis board` (or `@vis card`) and `@vis flow`. They are read like `@board` and `@flow`, and
the rewrites and the formatter write them as `@board` and `@flow`.

```sql
/**
 * Revenue per region.
 *
 * @vis vegalite {"mark": "bar", "encoding": {"x": {"field": "region"}, "y": {"field": "revenue"}}}
 * @board row=0 column=6 width=6 height=4
 */
SELECT region, sum(revenue) AS revenue FROM sales GROUP BY region;

/**
 * @vis markdown
 * ### {{metric}}
 * **{{value}}** · {{status}}
 */
SELECT metric, value, status FROM metrics;
```

A statement has at most one renderer (`@vis vegalite`, `markdown` or `table`) and at most one `@board`.
The first one wins, the others are warnings. Only queries (`SELECT`) are visualized. `@board` and `@flow` tags may
annotate any statement and need no renderer; see Dashboard placement and Dataflow placement.

Like in Javadoc, the text before the first tag describes the statement, it is an ordinary comment, and so is
text after a tag that ends at its line. DashQL
writes the Javadoc-style form, but any block comment and runs of line comments work too. The last
tag of a run of line comments ends with the run; older scripts close it with `-- @end`, which is still
accepted:

```sql
-- @vis table
-- @board width=12
SELECT * FROM orders;
```

## Dashboard placement

The dashboard is a 12-column grid with zero-based coordinates. A row is as high as a collapsed card. `row` and
`column` are optional starting hints, `width` defaults to 6 columns and `height` to 6 rows. Invalid values are warnings
and normalized: coordinates must be non-negative, the width is clamped to 1 through 12, the height is at least 1, and a
card is moved left to fit the grid. The dashboard writes a moved or resized card back into the `@board`
tag of the statement it shows (see Rewriting tags).

Every script of the session is a card, placed by the `@board` tag of its last statement. A script whose last
statement has no renderer is a collapsed card: a header of one row, 4 columns wide by default, whose width can change,
but not its height. Its `@board` keeps the height of the card that it becomes with a renderer. The header offers the
renderers of a query as icons:

- **Table** writes `@vis table`.
- **Chart** opens the chart builder, which stages its `@vis vegalite` as a diff, like in the feed.
- **Markdown** writes a template from the columns of the latest result, the first column as heading and the others
  in a line below, and opens the editor to adjust it.

An edit button opens the script in an editor over the board. A script whose last statement is no query, e.g. one
that only creates a table, is a collapsed card without renderers. A `@board` tag alone does not make a query a
visualization.

## Dataflow placement

The [dataflow view](dataflow.md) draws every script as a box on a canvas. `@flow x=.. y=..` is the
position of the top left corner of the box in canvas pixels, negative coordinates are fine. `width=..` is the width
of the box and `height=..` the height of the chart below its visualized statement, both positive canvas pixels; a
resized box writes them. Each part is optional, but `x` and `y` come together: `@flow width=400` sizes a box that
is placed automatically. A script has one placement: the first `@flow` tag in statement order wins, later ones are
warnings. A coordinate without the other one or a size that is not positive is left out with a warning, a tag with
nothing valid left is ignored. Like `@board`, it needs no renderer and may annotate a statement that is no
query, so a script that only creates a table is placed too. A `@flow` tag alone does not make a query a
visualization. A script without a position is placed automatically, a box without a size has the default width and
chart height.

```sql
/** @flow x=-40 y=120 */
CREATE TABLE trips AS SELECT * FROM external('trips.parquet');

/**
 * @vis table
 * @flow x=360 y=120 width=480 height=320
 */
SELECT * FROM trips;
```

## Rewriting tags

`vis_rewrite.rs` sets, replaces or removes the tags of a statement, addressed by its statement id:
`Script::rewrite_vis_renderer` the renderer (`VisRenderer`: a Vega-Lite object, a Markdown template or
the table) and `Script::rewrite_vis_board` the board placement (`VisBoard`), which replaces the `@vis board`
or `@vis card` of an older script by `@board`. They return the new text, the app writes it as an edit of the script (`rewriteVisRenderer`
and `rewriteVisBoard` of the script session). The visualization of a script in the app carries the
statement id, from the compiler for the terminal query and from the planner for any visualized query, so
a card moves also when a statement follows the query.

`Script::rewrite_vis_flow` sets or removes the position of a script (`VisFlow`), addressed by the script
instead of a statement: it replaces the first `@flow` tag where it is and removes the others, a new one goes after
the `@vis` and `@board` tags of the terminal statement, and removing the position removes every `@flow` tag
(`rewriteVisFlow` and `removeVisFlow` of the script session).

The tags are edited in the annotation of the statement (`annotation.rs`): its comment tags
(`@vis`, `@board`, `@flow`, `@param`) as one list, the `Annotation` with the description (`preamble`: the text of the
ordinary comments in front of the statement and the text before the first tag of a block comment) and the tags, each a
name and content lines whose first line is the text on the line of the tag. `Script::read_annotation` reads it, `Script::rewrite_annotation` replaces it; the app and
core-js reach both as `readAnnotation` and `rewriteAnnotation` of a script or script session, with the
annotation as JSON (`{"preamble": [...], "tags": [{"name": ..., "lines": [...]}]}`). The `@vis` rewrites
are small edits of the annotation, the description and any other tag are written the same way. The annotation printer is shared with the formatter, so an edit and a formatting print the same
comment.

Writing an annotation consolidates it. The comments in front of the statement become one comment, in place of the
first of them, with the description on top:

```sql
-- @param :year = 2024                    /**
-- @end                           =>      * @param :year = 2024
/* @vis vegalite {"mark": "bar"} */       * @vis vegalite
SELECT region, revenue FROM sales         * {"mark": "bar"}
WHERE year = :year;                       * @board width=6 height=3
                                          */
                                         SELECT region, revenue FROM sales
                                         WHERE year = :year;
```

- The comment is printed like the formatter prints tagged comments (see Formatting), with the
  indentation of the comment it replaces.
- The edited tag is printed anew, the other tags keep their content as written. Text that followed a tag
  on its line stays there.
- The description goes in front of the tags: the ordinary comments in their order, wherever they were, and the text
  before the first tag of a block comment, separated from the tags by an empty line. After a tag it would read as
  the content of the tag. Other blank lines between the comments of the annotation are removed.
- A new renderer goes before the other `@vis`, `@board` and `@flow` tags, after the parameters. A new board placement
  goes after the renderer, or where a renderer would go. A statement without comments gets a new comment on the line
  before it. A renderer needs a query, a board placement any statement.
- Removing the last tag leaves the description as the comment, without a description it removes the comment.
- An annotation that would not read back unchanged is an error: an unknown tag name, a line with a line
  break, a continuation line that starts with a tag.

`/*` would nest and `*/` would end the comment: in Vega-Lite JSON they can only be part of strings and
are escaped as `/\u002a` and `*\/`, which keeps the value. A Markdown template or a description with
`/*` or `*/` is an error.

## Analysis

`analyzer/vis_tags.rs` builds a `VisualizationSpec` per visualized query after the analysis passes,
with warnings (`INVALID_VIS_TAG`, `INVALID_DASHBOARD_LAYOUT`) whose spans point into the comment:

- an unknown kind, an unknown or non-integer `board` or `flow` arg, a `flow` without `x` or `y`, a second
  `flow` of the script, args after `table`;
- a missing body of `vegalite` or `markdown`, malformed JSON, a spec that is no JSON object;
- a `field` that is no output column of the query. Names that the spec defines itself (`"as"`) are
  fine, a nested field (`date.month`) refers to its first part. The check is skipped if a `*` hides
  the columns of a relation with an unknown schema.

A renderer with an invalid body leaves the query a plain query.

The position of the script is `AnalyzedScript::flow`, the editor session passes it to the app as
`flow_position` of the script annotations. The dashboard placement of the script is `AnalyzedScript::board`, the
`@board` of the last statement with or without a renderer, passed as `board_position`.

## Compilation and rendering

The compiler (`dashql-core-session/src/compiler.rs`) describes a terminal query with a visualization as
`VISUALIZE` for the editor, the planner attaches the visualization to the node of any visualized query, and
runs execute the plan. The executed SQL is the statement as written, the tags are comments. In the shell,
the tags are plain comments.

- `vegalite`: the Vega-Lite spec of the tag is passed through, with `$schema` and the statement as
  `data.$sql` (`visualize/vegalite_generator.rs`). Every Vega-Lite property works, DashQL does not need
  to know it.
- `markdown`: the template is parsed once with pulldown-cmark (CommonMark) and encoded as a safe
  FlatBuffer AST (`visualize/markdown`). `{{field}}` placeholders become `FIELD` leaves, raw HTML is
  discarded, and unsafe or dynamic link destinations are not emitted as links. The app renders the AST
  once per result row and substitutes the formatted Arrow values as React text.
- `table`: the app renders the result table.

## Authoring

Completion works inside comments (`completion_vis.rs`), although the rest of the completion skips them:

- `@` at the start of a comment line completes the tag names, `@vis ` the kinds, `@board ` and `@flow ` the
  args that are not used yet.
- In the JSON of `vegalite`, a tolerant scanner (`vis_text.rs`) finds the key path at the cursor and whether
  a key or a value follows, also in JSON that is still typed. Keys come from a table per path (spec, mark,
  encoding channels, field definition, scale, axis, legend; nested `layer` and `spec` specs are specs),
  values from the Vega-Lite enums (mark, field and scale types, aggregates, time units). `field` values
  are the output columns of the query. Keys and values are inserted as JSON strings.
- In a `markdown` template, `{{` completes the output columns.

Agents write charts with `dashql agent vis edit <script>`, which takes a Vega-Lite spec on stdin or from
`--file`. The app checks the spec before it touches the script: it must be a JSON object that Vega-Lite
compiles without errors or warnings (with empty data), and the analyzer must not warn about the new tag,
e.g. about a `field` that is no output column or about `data`. `Script::rewrite_vegalite` then replaces
the renderer tag of the terminal query (`vegalite`, `markdown` or `table`) or adds one, and consolidates
the annotation like the other rewrites (see Rewriting tags); the spec is printed compactly (see Formatting).

The editor highlights comment tags like code (`vis_highlight.rs`), so the tags of an annotation read
alike: every tag (`@vis`, `@board`, `@flow`, `@param` and an `@end` of older scripts) is a
keyword, the JSON of `vegalite` is split into keys (identifiers) and strings, numbers and booleans (literals),
the kind of a `@vis` tag is a keyword, the keys of the args of `@board` and `@flow` and `{{field}}` placeholders
are identifiers. The comment markers of every tagged region step back. Other editors show the tags as plain
comments.

Highlighting, completion and the spans of analyzer warnings read the JSON of `vegalite` tags with the same
scanner (`vis_text.rs`) over the content lines of the tag joined into one text. It never fails: unclosed
strings end with their line, and unbalanced brackets and missing commas are scanned as they come. Every
key, value and array element knows its slot and depth, so a warning points at the top-level `data` key or
at the `field` value, not at the same text elsewhere. `serde_json` builds the values.

## Formatting

The formatter prints comments with tags as one canonical comment (`formatter/comments.rs`), in the
style of Javadoc, JSDoc and Doxygen: a single line stays on the line of `/**` (`/** @vis table */`),
otherwise `/**` and `*/` are on lines of their own and every line has a ` * ` gutter. The gutter keeps
lines that start with `*`, e.g. Markdown emphasis or lists. The comments in front of a statement with a tag among
them are its annotation and are printed as one comment, the same comment that a rewrite prints: the ordinary
comments are the description on top, printed as written, and an empty line separates it from the tags. Elsewhere,
tagged comments that follow each other with nothing but whitespace between them (block comments and tagged regions
of line comments) are merged into one, and ordinary comments between them keep them apart.

`@vis table`, `@board` and `@flow` tags are printed on one line, the `@vis board` and `@vis flow` of older scripts
as `@board` and `@flow`, the JSON of `vegalite` compactly with the key order kept (`compact_json.rs`),
Markdown and the values of `@param` verbatim. A JSON value that fits in the rest of
its line stays on one line, objects and arrays that don't fit put each entry on a line of its own with
2-space indentation, so a spec reads like the Vega editor prints it instead of one key per line. The
JSON fills the formatting width behind the gutter; rewrites, which have no formatting width, use 80
columns. Malformed JSON stays as written, and comments whose content contains `/*` or `*/` keep their
original form, since it would end or nest the comment.

## Why comments

The previous `VISUALIZE USING <renderer> (...)` clause mirrored Vega-Lite's JSON with `=>` and
parentheses. It did not read like SQL, made every charted script invalid SQL for other engines and
tools, and had to be cut off before execution anyway. Comment annotations are established for tooling
(sqlc `-- name:`, HugSQL `-- :name`, Liquibase `--changeset`, sqlcommenter, optimizer hints `/*+ */`),
and Malloy's `# bar_chart` tags are the closest precedent for charts.
