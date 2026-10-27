# Visualizations as `@vis` comments

A query is visualized by `@vis` tags in the comments directly before it. The script stays plain SQL:
every engine and tool runs it unmodified, and only DashQL reads the tags.

```sql
/* @vis vegalite
   {
     "mark": "bar",
     "encoding": {
       "x": {"field": "region", "type": "nominal"},
       "y": {"field": "revenue", "aggregate": "sum"}
     }
   }
*/
/* @vis card width=6 height=3 */
SELECT region, revenue FROM sales;
```

## Tags

The tags are comment tags (see `core_parser.md`): a line whose first text is `@vis` starts a tag that
runs to the next tag line or the end of the comment, so one comment can hold several tags. A tag starts
with its kind, what follows depends on the kind:

| Kind | After the kind |
|---|---|
| `vegalite` | A Vega-Lite spec as JSON object, on the same line or the next. The statement is the data, `data` is ignored with a warning. |
| `markdown` | The row template as Markdown, from right after the kind to the end of the tag. Rendered once per result row, `{{field}}` placeholders take the values of the columns. |
| `table` | Nothing, the result table is the visualization. |
| `card` | The dashboard placement as `key=value` args: `row`, `column`, `width` and `height`, all integers. |

```sql
/* @description Revenue per region.
   @vis vegalite {"mark": "bar", "encoding": {"x": {"field": "region"}, "y": {"field": "revenue"}}}
   @vis card row=0 column=6 width=6 height=4 */
SELECT region, sum(revenue) AS revenue FROM sales GROUP BY region;

/* @vis markdown
   ### {{metric}}
   **{{value}}** · {{status}}
*/
SELECT metric, value, status FROM metrics;
```

A statement has at most one renderer tag (`vegalite`, `markdown` or `table`) and at most one `card`.
The first one wins, the others are warnings. Only queries (`SELECT`) are visualized.

The line comment form works too, the last tag of a run closes with `-- @end`:

```sql
-- @vis table
-- @vis card width=12
-- @end
SELECT * FROM orders;
```

## Dashboard placement

The dashboard is a 12-column grid with zero-based coordinates. `row` and `column` are optional starting
hints, `width` defaults to 6 columns and `height` to 3 rows. Invalid values are warnings and normalized:
coordinates must be non-negative, the width is clamped to 1 through 12, the height is at least 1, and a
card is moved left to fit the grid. The dashboard writes a moved or resized card back into the `card`
tag of the statement it shows (see Rewriting tags).

## Rewriting tags

`vis_rewrite.rs` sets, replaces or removes the tags of a statement, addressed by its statement id:
`Script::rewrite_vis_renderer` the renderer (`VisRenderer`: a Vega-Lite object, a Markdown template or
the table) and `Script::rewrite_vis_card` the card (`VisCard`). They return the new text, the app writes
it as an edit of the script (`rewriteVisRenderer` and `rewriteVisCard` of the script session). The
visualization of a script in the app carries the statement id, from the compiler for the terminal query
and from the planner for any visualized query, so a card moves also when a statement follows the query.

An edit touches only its tag. Other tags, prose and hand-written layout stay as written:

- A replaced tag keeps its place. Its continuation lines take the prefix of the tag line (`-- `, ` * ` or
  the indentation after `/* `), and a block comment that now ends after a tag of several lines closes
  with `*/` on a line of its own.
- A new renderer goes before the other `@vis` tags of the statement, a new card after its renderer, in the
  same comment. A statement without tags gets a new block comment in front of it. A card needs a renderer.
- Removing the only tag of a comment removes the comment. In a run of line comments, the `-- @end` line
  stays for the region before.

Tags are printed like the formatter prints them. `/*` would nest and `*/` would end a block comment:
in Vega-Lite JSON they can only be part of strings and are escaped as `/\u002a` and `*\/`, which keeps
the value. A Markdown template with `/*` or `*/` cannot go into a block comment and is an error there,
line comments take it as written.

## Analysis

`analyzer/vis_tags.rs` builds a `VisualizationSpec` per visualized query after the analysis passes,
with warnings (`INVALID_VIS_TAG`, `INVALID_DASHBOARD_LAYOUT`) whose spans point into the comment:

- an unknown kind, an unknown or non-integer `card` arg, args after `table`;
- a missing body of `vegalite` or `markdown`, malformed JSON, a spec that is no JSON object;
- a `field` that is no output column of the query. Names that the spec defines itself (`"as"`) are
  fine, a nested field (`date.month`) refers to its first part. The check is skipped if a `*` hides
  the columns of a relation with an unknown schema.

A renderer with an invalid body leaves the query a plain query.

## Compilation and rendering

The compiler (`dashql-core-session/src/compiler.rs`) compiles a terminal query with a visualization as
`VISUALIZE`, the planner attaches the visualization to the node of any visualized query. The executed
SQL is the statement, the tags are comments. In the shell, the tags are plain comments.

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

- `@` at the start of a comment line completes the tag names, `@vis ` the kinds, `@vis card ` the args
  that are not used yet.
- In the JSON of `vegalite`, a tolerant scanner finds the key path at the cursor and whether a key or a
  value follows, also in JSON that is still typed. Keys come from a table per path (spec, mark,
  encoding channels, field definition, scale, axis, legend; nested `layer` and `spec` specs are specs),
  values from the Vega-Lite enums (mark, field and scale types, aggregates, time units). `field` values
  are the output columns of the query. Keys and values are inserted as JSON strings.
- In a `markdown` template, `{{` completes the output columns.

Agents write charts with `dashql agent vis edit <script>`, which takes a Vega-Lite spec on stdin or from
`--file`. The app checks the spec before it touches the script: it must be a JSON object that Vega-Lite
compiles without errors or warnings (with empty data), and the analyzer must not warn about the new tag,
e.g. about a `field` that is no output column or about `data`. `Script::rewrite_vegalite` then replaces
the renderer tag of the terminal query (`vegalite`, `markdown` or `table`) or inserts a
`/* @vis vegalite ... */` comment; the spec is pretty-printed in block comments and stays on one line in
line comments and in block comments with a ` * ` gutter.

The editor highlights `@vis` tags like code (`vis_highlight.rs`): the syntax spans of such a comment are
split into the tag and kind (keywords), JSON keys and `card` keys (identifiers), JSON strings, numbers
and booleans (literals) and `{{field}}` placeholders (identifiers). Other editors show the tags as plain
comments.

## Formatting

The formatter prints every comment with a `@vis` tag as a canonical block comment
(`formatter/comments.rs`): `table` and `card` tags on one line, the JSON of `vegalite` pretty-printed
with 2-space indentation and the key order kept, Markdown verbatim. The lines after the first are
aligned after `/* `, and a run of line comments with a `@vis` tag becomes one block comment. Malformed
JSON stays as written, and a body that contains `/*` or `*/` keeps its original form, since it would
end or nest the block comment.

## Why comments

The previous `VISUALIZE USING <renderer> (...)` clause mirrored Vega-Lite's JSON with `=>` and
parentheses. It did not read like SQL, made every charted script invalid SQL for other engines and
tools, and had to be cut off before execution anyway. Comment annotations are established for tooling
(sqlc `-- name:`, HugSQL `-- :name`, Liquibase `--changeset`, sqlcommenter, optimizer hints `/*+ */`),
and Malloy's `# bar_chart` tags are the closest precedent for charts.
