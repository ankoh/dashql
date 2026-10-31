# Visualizations as `@vis` comments

A query is visualized by `@vis` tags in the comments directly before it. The script stays plain SQL:
every engine and tool runs it unmodified, and only DashQL reads the tags.

```sql
/**
 * @description Revenue per region.
 * @vis vegalite
 * {
 *   "mark": "bar",
 *   "encoding": {
 *     "x": {"field": "region", "type": "nominal"},
 *     "y": {"field": "revenue", "aggregate": "sum"}
 *   }
 * }
 * @vis card width=6 height=3
 */
SELECT region, revenue FROM sales;
```

## Tags

The tags are comment tags (see `core_parser.md`): a line whose first text is `@vis` starts a tag that
runs to the next tag line or the end of the comment, like the block tags of Javadoc, so one comment can
hold several tags. A tag starts with its kind, what follows depends on the kind:

| Kind | After the kind |
|---|---|
| `vegalite` | A Vega-Lite spec as JSON object, on the same line or the next. The statement is the data, `data` is ignored with a warning. |
| `markdown` | The row template as Markdown, from right after the kind to the end of the tag. Rendered once per result row, `{{field}}` placeholders take the values of the columns. |
| `table` | Nothing, the result table is the visualization. |
| `card` | The dashboard placement as `key=value` args: `row`, `column`, `width` and `height`, all integers. |

```sql
/**
 * @description Revenue per region.
 * @vis vegalite {"mark": "bar", "encoding": {"x": {"field": "region"}, "y": {"field": "revenue"}}}
 * @vis card row=0 column=6 width=6 height=4
 */
SELECT region, sum(revenue) AS revenue FROM sales GROUP BY region;

/**
 * @vis markdown
 * ### {{metric}}
 * **{{value}}** · {{status}}
 */
SELECT metric, value, status FROM metrics;
```

A statement has at most one renderer tag (`vegalite`, `markdown` or `table`) and at most one `card`.
The first one wins, the others are warnings. Only queries (`SELECT`) are visualized.

DashQL writes the Javadoc-style form, but any block comment and runs of line comments work too. The last
tag of a run of line comments ends with the run; older scripts close it with `-- @end`, which is still
accepted:

```sql
-- @vis table
-- @vis card width=12
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

The tags are edited in the annotation of the statement (`annotation.rs`): its comment tags
(`@description`, `@metadata`, `@vis`) as one list, the `Annotation` with the text before the first tag
(`preamble`) and the tags, each a name and content lines whose first line is the text on the line of
the tag. `Script::read_annotation` reads it, `Script::rewrite_annotation` replaces it; the app and
core-js reach both as `readAnnotation` and `rewriteAnnotation` of a script or script session, with the
annotation as JSON (`{"preamble": [...], "tags": [{"name": ..., "lines": [...]}]}`). The `@vis` rewrites
are small edits of the annotation, any other tag, e.g. a description or metadata, is written the same
way. The annotation printer is shared with the formatter, so an edit and a formatting print the same
comment.

Writing an annotation consolidates it. The comments with tags in front of the statement become one
comment, in place of the first of them:

```sql
-- @description                          /**
-- Revenue per region.                    * @description
-- @end                           =>      * Revenue per region.
/* @vis vegalite {"mark": "bar"} */       * @vis vegalite
SELECT region, revenue FROM sales;        * {"mark": "bar"}
                                          * @vis card width=6 height=3
                                          */
                                         SELECT region, revenue FROM sales;
```

- The comment is printed like the formatter prints tagged comments (see Formatting), with the
  indentation of the comment it replaces.
- The edited tag is printed anew, the other tags keep their content as written. Text that followed a tag
  on its line stays there.
- Text before the first tag of a block comment goes in front of the tags, after a tag it would read as
  the content of the tag. Ordinary comments stay where they are. Blank lines between the comments of the
  annotation are removed.
- A new renderer goes before the other `@vis` tags, after a description or metadata. A new card goes
  after the renderer. A statement without tags gets a new comment on the line before it. A card needs a
  renderer.
- Removing the last tag removes the comment.
- An annotation that would not read back unchanged is an error: an unknown tag name, a line with a line
  break, a continuation line that starts with a tag.

`/*` would nest and `*/` would end the comment: in Vega-Lite JSON they can only be part of strings and
are escaped as `/\u002a` and `*\/`, which keeps the value. A Markdown template or a description with
`/*` or `*/` is an error.

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
alike: every tag (`@description`, `@metadata`, `@vis` and an `@end` of older scripts) is a keyword, the JSON of
`@metadata` and `vegalite` is split into keys (identifiers) and strings, numbers and booleans
(literals), the kind of a `@vis` tag is a keyword, `card` keys and `{{field}}` placeholders are
identifiers. The comment markers of every tagged region step back, the text of a `@description` keeps
the color of text. Other editors show the tags as plain comments.

Highlighting, completion and the spans of analyzer warnings read the JSON of `vegalite` tags with the same
scanner (`vis_text.rs`) over the content lines of the tag joined into one text. It never fails: unclosed
strings end with their line, and unbalanced brackets and missing commas are scanned as they come. Every
key, value and array element knows its slot and depth, so a warning points at the top-level `data` key or
at the `field` value, not at the same text elsewhere. `serde_json` builds the values.

## Formatting

The formatter prints comments with tags as one canonical comment (`formatter/comments.rs`), in the
style of Javadoc, JSDoc and Doxygen: a single line stays on the line of `/**` (`/** @vis table */`),
otherwise `/**` and `*/` are on lines of their own and every line has a ` * ` gutter. The gutter keeps
lines that start with `*`, e.g. Markdown emphasis or lists. Tagged comments that follow each other with
nothing but whitespace between them (block comments and tagged regions of line comments) are merged into
one, so the annotation of a statement reads as one block, the same comment that a rewrite prints.
Ordinary comments between them keep them apart.

`table` and `card` tags are printed on one line, the JSON of `vegalite` compactly with the key order kept
(`compact_json.rs`), descriptions, metadata and Markdown verbatim. A JSON value that fits in the rest of
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
