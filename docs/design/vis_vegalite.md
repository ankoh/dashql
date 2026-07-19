# VISUALIZE <-> Vega-Lite translation

dashql's `VISUALIZE` syntax mirrors Vega-Lite's JSON structure, making
bidirectional translation largely mechanical. This document records the mapping,
identifies where the translation is direct, and where information is lost.

## Forward: VISUALIZE -> Vega-Lite

The analyzer pass (`AnalyzeVisualizationPass`) walks the parsed AST and builds
a `VisualizationSpec` struct. The Vega-Lite generator
(`vegalite_generator.cc`) serializes that struct to JSON.

### Data source

```sql
VISUALIZE sales USING vegalite (mark => bar);
VISUALIZE (SELECT category, revenue FROM sales) USING vegalite (mark => bar);
```

For table references, the table name is emitted as `data.name`. For SELECT
subqueries, the SQL text is emitted under `data.$sql` (with wrapping
parentheses stripped):

```json
{ "data": { "name": "sales" } }
{ "data": { "$sql": "SELECT category, revenue FROM sales" } }
```

When the source is omitted, no `data` field is emitted. The embedding
environment is expected to resolve dataset names and execute any SQL queries
before rendering.

### Mark

The `VisMarkType` enum value is lowercased to produce the Vega-Lite mark
string:

| VISUALIZE | Vega-Lite |
|-----------|-----------|
| `bar` | `"bar"` |
| `line` | `"line"` |
| `point` | `"point"` |
| `area` | `"area"` |
| `arc` | `"arc"` |
| `rect` | `"rect"` |
| `rule` | `"rule"` |
| `tick` | `"tick"` |
| `text` | `"text"` |
| `circle` | `"circle"` |
| `square` | `"square"` |
| `geoshape` | `"geoshape"` |
| `image` | `"image"` |
| `trail` | `"trail"` |
| `boxplot` | `"boxplot"` |

### Encoding channels

Each `VisEncodingChannel` in the spec maps to a Vega-Lite encoding field:

| Attribute key | Vega-Lite channel |
|---------------|-------------------|
| `VIS_ENCODING_X` | `"x"` |
| `VIS_ENCODING_Y` | `"y"` |
| `VIS_ENCODING_X2` | `"x2"` |
| `VIS_ENCODING_Y2` | `"y2"` |
| `VIS_ENCODING_COLOR` | `"color"` |
| `VIS_ENCODING_FILL` | `"fill"` |
| `VIS_ENCODING_STROKE` | `"stroke"` |
| `VIS_ENCODING_FILL_OPACITY` | `"fillOpacity"` |
| `VIS_ENCODING_STROKE_OPACITY` | `"strokeOpacity"` |
| `VIS_ENCODING_STROKE_WIDTH` | `"strokeWidth"` |
| `VIS_ENCODING_STROKE_DASH` | `"strokeDash"` |
| `VIS_ENCODING_OPACITY` | `"opacity"` |
| `VIS_ENCODING_SIZE` | `"size"` |
| `VIS_ENCODING_SHAPE` | `"shape"` |
| `VIS_ENCODING_ANGLE` | `"angle"` |
| `VIS_ENCODING_THETA` | `"theta"` |
| `VIS_ENCODING_THETA2` | `"theta2"` |
| `VIS_ENCODING_RADIUS` | `"radius"` |
| `VIS_ENCODING_RADIUS2` | `"radius2"` |
| `VIS_ENCODING_DETAIL` | `"detail"` |
| `VIS_ENCODING_ORDER` | `"order"` |
| `VIS_ENCODING_TOOLTIP` | `"tooltip"` |
| `VIS_ENCODING_TEXT` | `"text"` |
| `VIS_ENCODING_ROW` | `"row"` |
| `VIS_ENCODING_COLUMN` | `"column"` |
| `VIS_ENCODING_FACET` | `"facet"` |
| `VIS_ENCODING_HREF` | `"href"` |
| `VIS_ENCODING_URL` | `"url"` |
| `VIS_ENCODING_KEY` | `"key"` |
| `VIS_ENCODING_LATITUDE` | `"latitude"` |
| `VIS_ENCODING_LONGITUDE` | `"longitude"` |
| `VIS_ENCODING_LATITUDE2` | `"latitude2"` |
| `VIS_ENCODING_LONGITUDE2` | `"longitude2"` |
| `VIS_ENCODING_X_OFFSET` | `"xOffset"` |
| `VIS_ENCODING_Y_OFFSET` | `"yOffset"` |

### Field definitions

Each channel's properties map directly:

| VISUALIZE property | Vega-Lite JSON key |
|--------------------|--------------------|
| `field => <col>` | `"field": "<col>"` |
| `type => quantitative` | `"type": "quantitative"` |
| `aggregate => sum` | `"aggregate": "sum"` |
| `bin => true` | `"bin": true` |
| `bin => (maxbins => 20)` | `"bin": { "maxbins": 20 }` |
| `time_unit => month` | `"timeUnit": "month"` |

### Scale

The `VisScale` struct serializes to a JSON object under the channel's `"scale"`
key. Scale type enum values are lowercased:

```sql
scale => (type => log, zero => false)
```

```json
"scale": { "type": "log", "zero": false }
```

Scale properties emitted: `type`, `domain`, `domainMin`, `domainMax`,
`domainMid`, `range`, `rangeMin`, `rangeMax`, `zero`, `nice`, `clamp`,
`reverse`, `round`, `scheme`, `interpolate`, `exponent`, `base`, `constant`,
`padding`, `paddingInner`, `paddingOuter`, `align`, `name`.

### Axis

The `VisAxis` struct serializes under `"axis"`:

```sql
axis => (label_angle => -45, grid => false)
```

```json
"axis": { "labelAngle": -45.0, "grid": false }
```

Axis properties emitted: `orient`, `title`, `format`, `formatType`, `grid`,
`ticks`, `domain`, `tickCount`, `tickSize`, `labelAngle`, `labelFontSize`,
`labelOverlap`, `direction`, `offset`, `zIndex`, `name`.

### Legend

The `VisLegend` struct serializes under `"legend"`:

```sql
legend => (orient => right, title => 'Category')
```

```json
"legend": { "orient": "right", "title": "Category" }
```

Legend properties emitted: `type`, `orient`, `title`, `format`, `formatType`,
`direction`, `padding`, `offset`, `zIndex`, `name`.

### Top-level properties

| VISUALIZE key | Vega-Lite JSON |
|---------------|----------------|
| `title => 'Sales'` | `"title": "Sales"` |
| `width => 800` | `"width": 800` |
| `height => 400` | `"height": 400` |

The `$schema` key is always emitted pointing to Vega-Lite v5.

---

## Reverse: Vega-Lite -> VISUALIZE

The reverse parser (`vegalite_parser.cc`) reads a Vega-Lite JSON string and
produces a VISUALIZE statement string.

### Data source

| Vega-Lite `data` form | VISUALIZE output |
|-----------------------|------------------|
| `"data": { "name": "sales" }` | `VISUALIZE sales USING vegalite (...)` |
| `"data": { "$sql": "SELECT ..." }` | `VISUALIZE (SELECT ...) USING vegalite (...)` |
| No data field | `VISUALIZE USING vegalite (...)` |
| `"data": { "url": "..." }` | Not handled (source omitted) |
| `"data": { "values": [...] }` | Not handled (source omitted) |

### Mark

The mark string is emitted directly as a keyword:

```json
{ "mark": "bar" }
```

```sql
VISUALIZE USING vegalite (mark => bar);
```

Object-form marks (`{ "mark": { "type": "bar", "opacity": 0.7 } }`) are not
yet handled by the reverse parser.

### Encoding channels

Channel names are mapped from camelCase JSON keys to lowercase VISUALIZE
keywords (e.g., `fillOpacity` -> `fill_opacity`, `xOffset` -> `x_offset`).

Each channel with an object value produces a field-def list:

```json
"x": { "field": "date", "type": "temporal", "scale": { "type": "log" } }
```

```sql
x => (field => date, type => temporal, scale => (type => log))
```

Properties handled in reverse: `field`, `type`, `aggregate`, `bin`,
`timeUnit`, `scale`, `axis`, `legend`.

### Sub-objects (scale, axis, legend)

The reverse parser iterates object members, lowercases camelCase keys (by
stripping uppercase without inserting separators), and emits `key => value`
pairs.

### Top-level properties

`title`, `width`, and `height` are round-tripped when present.

---

## Roundtrip fidelity

The snapshot tests (`snapshots/visualize/basic.yaml`) verify roundtrip
correctness: parse VISUALIZE -> analyze -> generate Vega-Lite -> parse back to
VISUALIZE. The roundtrip is tested for:

- Basic mark-only specs
- Field type annotations
- Multi-channel encoding
- Scale configuration (type, zero, nice, etc.)
- Axis configuration (labelAngle, grid, etc.)
- Color encoding
- Shorthand encoding (bare column reference)
- Subquery data sources
- No-source specs
- Aggregate functions
- Bin configuration

### Shorthand normalization

The shorthand `x => date` normalizes to `x => (field => date)` on roundtrip.
This is correct — the shorthand is syntactic sugar that the analyzer resolves.

---

## Current limitations

### Not yet supported in Vega-Lite generation

| Feature | Status |
|---------|--------|
| `layer` (multi-layer specs) | Parsed but not emitted |
| `transform` | Parsed but not emitted |
| `params` / selections | Parsed but not emitted |
| `projection` | Parsed but not emitted |
| `resolve` | Parsed but not emitted |
| Object-form mark | Grammar supports it; generator emits string only |
| `condition` on encoding | Parsed but not emitted |

### Not yet supported in reverse parsing

| Feature | Status |
|---------|--------|
| `"data": { "url" }` / `"values"` | Dropped |
| Object-form mark | Not handled |
| `layer` array | Not handled |
| `hconcat` / `vconcat` / `concat` | Not handled |
| `repeat` | Not handled |
| `selection` / `params` | Not handled |
| `config` | Not handled |
| `transform` array | Not handled |

### Key naming convention

VISUALIZE keywords use snake_case (`label_angle`, `fill_opacity`,
`stroke_width`). Vega-Lite uses camelCase (`labelAngle`, `fillOpacity`,
`strokeWidth`). The forward mapping is defined explicitly in lookup tables. The
reverse mapping converts camelCase to snake_case by inserting an underscore
before each uppercase letter and lowercasing it.

---

## Implementation

### Forward pipeline

```
SQL text
  -> Parser (ext_visualize.y)
  -> AST (OBJECT_VIS_VISUALISE tree)
  -> Analyzer (AnalyzeVisualizationPass)
  -> VisualizationSpec struct
  -> Generator (vegalite_generator.cc)
  -> Vega-Lite JSON string
```

### Reverse pipeline

```
Vega-Lite JSON string
  -> Parser (vegalite_parser.cc, RapidJSON)
  -> VISUALIZE SQL string
```

The reverse path is a direct JSON-to-text translation. It does not go through
the AST or analyzer — it produces a SQL string that can be re-parsed by the
forward pipeline.
