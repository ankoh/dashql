# VISUALIZE statement

`VISUALIZE` is a dashql statement grafted onto the SQL grammar. It describes a
chart as a structured spec — a nested key-value tree that mirrors Vega-Lite's
JSON shape — prefixed by an optional SQL data source.

## Shape

```
VISUALIZE [(<select>) | <table-ref>] AS (
    mark => <mark-type>,
    encoding => (
        <channel> => (<field-def-key> => <value>, ...),
        ...
    ),
    width => <number>,
    height => <number>,
    title => <string>,
    ...
)
```

The grammar is organized into four nested levels, each with its own object type
and key rule so that bison reports level-appropriate expected symbols for
autocompletion:

| Level | Node type | Contains |
|-------|-----------|----------|
| 1 | `OBJECT_VIS_SPEC` | Top-level spec properties: mark, encoding, width, height, title, layer, etc. |
| 2 | `OBJECT_VIS_ENCODING` | Encoding channel definitions keyed by channel name |
| 3 | `OBJECT_VIS_FIELD_DEF` | Field definition properties: field, type, aggregate, bin, scale, axis, legend |
| 4 | `OBJECT_VIS_SCALE` / `OBJECT_VIS_AXIS` / `OBJECT_VIS_LEGEND` | Scale/axis/legend configuration |

## Data source

The optional opening position accepts either a full subquery or a table
reference:

```sql
VISUALIZE sales AS (mark => bar);
VISUALIZE schema.sales AS (mark => bar);
VISUALIZE (SELECT category, revenue FROM sales WHERE fy = 2026) AS (mark => bar);
```

The source is optional — omit it when data is bound externally:

```sql
VISUALIZE AS (mark => line, encoding => (x => (field => date, type => temporal)));
```

## Mark types

The `mark` key accepts one of the following keywords, resolved against the
`VisMarkType` enum:

`arc`, `area`, `bar`, `boxplot`, `circle`, `geoshape`, `image`, `line`,
`point`, `rect`, `rule`, `square`, `text`, `tick`, `trail`

The mark value can also be a nested spec object for mark configuration:

```sql
VISUALIZE sales AS (
    mark => (type => bar, opacity => 0.7)
);
```

## Encoding channels

The `encoding` key introduces a level-2 list of channel definitions. Each
channel is keyed by one of 34 channel keywords:

**Positional:** `x`, `y`, `x2`, `y2`, `xoffset`, `yoffset`

**Color:** `color`, `fill`, `stroke`, `fillopacity`, `strokeopacity`,
`strokewidth`, `strokedash`, `opacity`

**Mark properties:** `size`, `shape`, `angle`

**Polar/radial:** `theta`, `theta2`, `radius`, `radius2`

**Geographic:** `latitude`, `longitude`, `latitude2`, `longitude2`

**Faceting:** `row`, `column`, `facet`

**Other:** `detail`, `order`, `tooltip`, `text`, `href`, `url`, `key`

### Shorthand encoding

A channel can take a bare column reference instead of a full field-def object.
This maps to `field => <column>`:

```sql
VISUALIZE sales AS (
    mark => line,
    encoding => (x => date, y => revenue)
);
```

### Full field definitions

Each channel's value can be a parenthesized list of field-def properties:

```sql
encoding => (
    x => (field => category, type => nominal),
    y => (field => revenue, type => quantitative, aggregate => sum)
)
```

**Field-def keys:** `field`, `type`, `bin`, `aggregate`, `timeunit`, `sort`,
`stack`, `impute`, `condition`, `title`, `bandposition`, `datum`, `value`,
`format`, `formattype`, `scale`, `axis`, `legend`

### Field types

The `type` key accepts a `VisFieldType` enum keyword:

`nominal`, `ordinal`, `quantitative`, `temporal`, `geojson`

## Scale configuration

The `scale` key inside a field definition introduces a level-4 nested object:

```sql
x => (field => revenue, type => quantitative, scale => (type => log, zero => false))
```

**Scale types** (keywords for the `type` key within a scale):

`linear`, `log`, `pow`, `sqrt`, `symlog`, `identity`, `sequential`, `time`,
`utc`, `quantile`, `quantize`, `threshold`, `ordinal`, `band`, `point`

**Scale keys:** `type`, `domain`, `domainmin`, `domainmax`, `domainmid`,
`range`, `rangemin`, `rangemax`, `scheme`, `interpolate`, `nice`, `zero`,
`clamp`, `padding`, `paddinginner`, `paddingouter`, `reverse`, `round`,
`exponent`, `bins`, `name`

## Axis configuration

The `axis` key inside a field definition introduces a level-4 nested object:

```sql
x => (field => category, type => nominal, axis => (labelangle => -45, grid => false))
```

**Axis keys:** `orient`, `format`, `formattype`, `grid`, `ticks`, `tickcount`,
`ticksize`, `labelangle`, `labelfontsize`, `labeloverlap`, `direction`,
`offset`, `values`, `zindex`, `title`, `domain`, `name`

## Legend configuration

The `legend` key inside a field definition introduces a level-4 nested object:

```sql
color => (field => category, type => nominal, legend => (orient => right, title => 'Category'))
```

**Legend keys:** `type`, `orient`, `format`, `formattype`, `direction`,
`title`, `values`, `padding`, `offset`, `zindex`, `name`

## Top-level spec keys

Beyond `mark` and `encoding`, the level-1 spec accepts:

`layer`, `data`, `transform`, `params`, `projection`, `autosize`, `resolve`,
`datasets`, `view`, `name`, `title`, `width`, `height`, `padding`,
`background`, `filter`, `describe`, `type`

Unknown identifiers (`IDENT`) are accepted at every level with `Key::NONE` so
the grammar does not reject future Vega-Lite properties it doesn't yet have
dedicated handling for.

## Values

At levels 1, 3, and 4, values can be:

- Nested spec objects: `(key => value, ...)`
- Bracket arrays: `[1, 2, 3]` or `['a', 'b']`
- SQL function expressions: `count(*)`, `date_trunc('month', date)`
- Column references: `category`, `sales.revenue`
- Constants: numbers, strings, `true`, `false`, `null`
- Signed constants: `-45`, `+100`

At level 2 (encoding channel values), nested spec objects use the field-def
production instead; all other value forms are supported for the shorthand
encoding path.

## AST mapping

Top-level node: `OBJECT_VIS_VISUALISE` with attributes:
- `VIS_VISUALISE_SELECT` — nullable; the data source node
- `VIS_VISUALISE_SPEC` — the `OBJECT_VIS_SPEC` node

Per-level nodes:

| Level | Node type | Example attributes |
|-------|-----------|--------------------|
| 1 | `OBJECT_VIS_SPEC` | `VIS_SPEC_MARK`, `VIS_SPEC_ENCODING`, `VIS_SPEC_WIDTH`, ... |
| 2 | `OBJECT_VIS_ENCODING` | `VIS_ENCODING_X`, `VIS_ENCODING_Y`, `VIS_ENCODING_COLOR`, ... |
| 3 | `OBJECT_VIS_FIELD_DEF` | `VIS_FIELD_DEF_FIELD`, `VIS_FIELD_DEF_TYPE`, `VIS_FIELD_DEF_SCALE`, ... |
| 4 | `OBJECT_VIS_SCALE` | `VIS_SCALE_TYPE`, `VIS_SCALE_DOMAIN`, `VIS_SCALE_ZERO`, ... |
| 4 | `OBJECT_VIS_AXIS` | `VIS_AXIS_ORIENT`, `VIS_AXIS_GRID`, `VIS_AXIS_LABEL_ANGLE`, ... |
| 4 | `OBJECT_VIS_LEGEND` | `VIS_LEGEND_TYPE`, `VIS_LEGEND_ORIENT`, ... |

Enums: `VisMarkType`, `VisFieldType`, `VisScaleType` (see
`proto/fb/dashql/parsed_script_enums.fbs`).

## Feature flag

`VISUALIZE` parsing is gated on `ParseContext::IsVisEnabled()`. When disabled,
the parser emits an error on the `VISUALIZE` token.

## Design rationale

The grammar deliberately mirrors Vega-Lite's JSON structure rather than
inventing a novel clause-based syntax. This has several advantages:

1. **Predictable mapping.** Every Vega-Lite spec has a mechanical translation
   to/from VISUALIZE syntax. No inference or restructuring is needed.
2. **Autocompletion.** Each level has its own key rule, so the parser can
   report exactly which keys are valid at the cursor position.
3. **Extensibility.** New Vega-Lite properties can be supported by adding a
   keyword and attribute key — no grammar restructuring required. Unknown
   identifiers are already accepted gracefully.
4. **SQL integration.** The data source slot accepts full `sql_select_stmt`
   subqueries, and values can be SQL expressions, so the visualization
   grammar composes cleanly with the rest of the SQL parser.

## Source files

- Grammar: `grammar/rules/ext_visualize.y` and `.yh`
- Flatbuffer schema: `proto/fb/dashql/parsed_script.fbs` and
  `parsed_script_enums.fbs`
- Analyzer: `packages/dashql-core/src/analyzer/analyze_visualization_pass.cc`
- Vega-Lite generator: `packages/dashql-core/src/visualize/vegalite_generator.cc`
- Vega-Lite parser: `packages/dashql-core/src/visualize/vegalite_parser.cc`
- Test snapshots: `snapshots/visualize/basic.yaml`
