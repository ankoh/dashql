# VISUALISE ↔ Vega-Lite mapping

Both dashql's `VISUALISE` and Vega-Lite implement Wilkinson's Grammar of
Graphics, so the concepts translate directionally. This document records the
mapping in both directions, identifies where translation is mechanical, where
it requires inference, and where it is impossible.

## Forward: VISUALISE → Vega-Lite

### Data source

The `VISUALISE` head carries an optional SQL input:

```sql
VISUALISE (SELECT region, revenue FROM sales WHERE fy = 2026)
VISUALISE TABLE warehouse.public.sales
```

Neither form has a direct Vega-Lite counterpart. Vega-Lite expects data to be
present in the spec as inline values, a URL, or a named dataset. The practical
approach for a query tool is to **execute the SQL and pass the result as inline
`data.values`**, or to assign a named dataset in the embedding environment and
reference it.

Where a `DRAW` clause carries its own `FROM (...)`, the same applies — execute
the subquery and attach the result to that layer's `data` field. When a layer
inherits the global source, it references the same dataset.

Joins, CTEs, and window functions inside the subquery are opaque from
Vega-Lite's perspective; they must be resolved by executing SQL before the
spec is built.

### DRAW → mark + encoding

Each `DRAW` clause becomes one entry in a `layer` array (or the top-level
`mark`/`encoding` pair when there is only one layer):

| VISUALISE geom | Vega-Lite `mark.type` |
|---|---|
| `point` | `"point"` |
| `line` | `"line"` |
| `bar` | `"bar"` |
| `area` | `"area"` |
| `text` | `"text"` |
| `label` | `"text"` |
| `rule` | `"rule"` |
| `segment` / `arrow` | `"rule"` (no direct arrow equivalent) |
| `tile` | `"rect"` |
| `polygon` | `"geoshape"` (approximate) |
| `ribbon` | `"area"` |
| `histogram` | `"bar"` + `transform: [{bin: true, …}]` |
| `density` | `"area"` + `transform: [{density: …}]` |
| `smooth` | `"line"` + `transform: [{loess: …}]` |
| `boxplot` | `"boxplot"` (composite mark) |
| `violin` | `"violin"` (Vega, not Vega-Lite; requires custom spec) |
| `errorbar` | `"errorbar"` (composite mark) |
| `path` | `"line"` with `order` encoding |

Column aliases in the `FROM (SELECT … AS aesthetic …)` subquery become the
`encoding` channel names. A column aliased as `x` maps to `encoding.x.field`,
`y` to `encoding.y.field`, `color` to `encoding.color.field`, etc.:

```sql
DRAW point FROM (SELECT date AS x, revenue AS y, region AS color)
```

```json
{
  "mark": "point",
  "encoding": {
    "x": { "field": "x" },
    "y": { "field": "y" },
    "color": { "field": "color" }
  }
}
```

**Aesthetic → encoding channel table:**

| VISUALISE aesthetic | Vega-Lite channel |
|---|---|
| `x`, `y` | `x`, `y` |
| `xmin`, `xmax`, `ymin`, `ymax` | `x2`, `y2` (paired with `x`/`y`) |
| `xend`, `yend` | `x2`, `y2` |
| `color` / `colour` | `color` |
| `fill` | `fill` |
| `stroke` | `stroke` |
| `opacity` | `opacity` |
| `size` | `size` |
| `shape` | `shape` |
| `label` | `text` |
| `angle` | `angle` |
| `theta` / `radius` (via `PROJECT TO polar`) | `theta`, `radius` |

**USING options → mark properties:**

Layer-level `USING (key => value, …)` options that represent constant
aesthetics (not data-driven) become properties on the `mark` object:

```sql
DRAW bar USING (opacity => 0.7, fill => '#4682b4')
```

```json
{ "mark": { "type": "bar", "opacity": 0.7, "fill": "#4682b4" } }
```

**PARTITION BY:**

`PARTITION BY col, …` declares grouping columns that have no dedicated
Vega-Lite slot. The right target depends on the geom:

- For `line` / `area` / `path`: emit as `encoding.detail.field` (draws a
  separate path per group without adding a visual channel).
- For marks where grouping should be visible (color-coded groups), the column
  should be aliased to `color` in the SELECT instead.
- When there are multiple partition columns, use `encoding.detail` with a
  combined expression (`calculate` transform) or emit multiple `detail`
  entries (Vega-Lite accepts an array).

**REMAP:**

`REMAP (stat_col AS aesthetic, …)` renames columns produced by a statistical
transform. These become `calculate` transforms that derive new fields:

```sql
DRAW histogram FROM (SELECT age) REMAP (count AS y)
```

```json
{
  "transform": [
    { "bin": true, "field": "age", "as": "age_binned" },
    { "aggregate": [{ "op": "count", "as": "count" }], "groupby": ["age_binned"] },
    { "calculate": "datum.count", "as": "y" }
  ]
}
```

### SCALE → encoding scale / axis

A `SCALE` clause targets one aesthetic and controls how data values map to
visual values.

**Scale type mapping:**

| VISUALISE `SCALE` type | Vega-Lite `scale.type` |
|---|---|
| `continuous` | `"linear"` (default; implicit) |
| `discrete` | `"ordinal"` |
| `binned` | `"bin-ordinal"` |
| `ordinal` | `"ordinal"` |
| `identity` | `"identity"` |

**FROM / TO → domain / range:**

```sql
SCALE x FROM [0, 100] TO [0, 500]
```

```json
{ "encoding": { "x": { "scale": { "domain": [0, 100], "range": [0, 500] } } } }
```

**Lambda projections — the hard case:**

```sql
SCALE continuous(lambda v: log10(v)) x
SCALE continuous(lambda v: sqrt(v)) y
SCALE continuous(lambda v: pow(v, 2)) size
```

Vega-Lite has no lambda slots. The strategy is:

1. **Pattern-match known transforms** to a named `scale.type`:
   - `log10(v)` → `"scale": { "type": "log", "base": 10 }`
   - `log(v)` / `ln(v)` → `"scale": { "type": "log", "base": 2.718… }`
   - `sqrt(v)` → `"scale": { "type": "sqrt" }`
   - `pow(v, e)` → `"scale": { "type": "pow", "exponent": e }`
2. **Arbitrary lambdas** that don't match: emit a `calculate` transform that
   applies the expression to the source field, producing a new derived field,
   then encode that derived field. The field name in `encoding` changes; the
   original name is lost.

**FORMAT lambda → axis.labelExpr:**

```sql
SCALE x FORMAT (lambda v: v * 1000)
```

Vega-Lite's `axis.labelExpr` accepts Vega expression syntax (not SQL). Simple
arithmetic is expressible; SQL-specific functions (`DATE_TRUNC`, `CAST`, etc.)
are not. The translator can emit `labelExpr` for numeric arithmetic and signal
a gap for anything else.

**USING on SCALE → axis / legend properties:**

```sql
SCALE x USING (labels => 'scientific')
```

These map to `axis.format` / `legend.format` / `axis.grid` etc. The mapping
is key-by-key and requires a defined vocabulary.

### FACET → facet encoding

```sql
FACET region BY fiscal_year USING (scales => 'free')
```

```json
{
  "facet": {
    "row": { "field": "region" },
    "column": { "field": "fiscal_year" }
  },
  "resolve": { "scale": { "x": "independent", "y": "independent" } }
}
```

A 1D `FACET region` (no `BY`) wraps the spec in a `facet` with only a `row`
(or `column`, depending on desired layout). The `scales => 'free'` option maps
to `resolve.scale.x/y: "independent"`.

### PROJECT → coordinate system

| VISUALISE `PROJECT TO` type | Vega-Lite equivalent |
|---|---|
| `cartesian` | Default; no action needed |
| `flip` | Swap `x` and `y` encoding channels |
| `polar` | Change geom to `arc`, remap `x → theta`, `y → radius` |
| Geographic projections (`mercator`, etc.) | `"projection": { "type": "…" }` on a `geoshape` spec |

`flip` and `polar` require restructuring the encoding, not just adding a
property. Geographic project types that happen to match Vega-Lite's built-in
projection names can be emitted directly; others are unrepresentable.

### LABEL → title / axis titles

```sql
LABEL USING (title => 'Sales by Region', subtitle => 'FY2026', x => 'Date', y => 'Revenue ($)')
```

```json
{
  "title": { "text": "Sales by Region", "subtitle": "FY2026" },
  "encoding": {
    "x": { "title": "Date" },
    "y": { "title": "Revenue ($)" }
  }
}
```

Aesthetic-keyed entries in `LABEL USING` become `encoding.<channel>.title`.

---

## Reverse: Vega-Lite → VISUALISE

### Data source

Vega-Lite data sources have no SQL equivalent in dashql:

| Vega-Lite `data` form | VISUALISE mapping |
|---|---|
| `data.url: "file.csv"` | Not representable; drop or stub as `TABLE <name>` |
| `data.values: [{…}, …]` | Not representable; must be loaded into a table first |
| Named dataset (`data.name`) | Map to `TABLE <name>` if the name corresponds to a known relation |
| Generator (sequence, graticule) | Not representable |

The importer must document what it drops.

### mark → DRAW geom

Reverse of the forward table. Composite marks (`boxplot`, `errorbar`,
`violin`) round-trip cleanly. Marks with no `VISUALISE` geom (`geoshape`,
`image`) are unrepresentable.

### encoding → SELECT aliases + SCALE

Each channel with a `field` entry becomes a `SELECT field AS channel` alias:

```json
{
  "encoding": {
    "x": { "field": "date", "type": "temporal" },
    "y": { "field": "revenue", "type": "quantitative" }
  }
}
```

```sql
DRAW line FROM (SELECT date AS x, revenue AS y)
```

The Vega-Lite `type` annotation maps to a `SCALE` clause:

| Vega-Lite `type` | VISUALISE `SCALE` type |
|---|---|
| `"quantitative"` | `continuous` (or omit — it's the default) |
| `"ordinal"` | `ordinal` |
| `"nominal"` | `discrete` |
| `"temporal"` | `continuous` (no dedicated temporal scale type in dashql yet) |

When `encoding.x.scale.type` is set explicitly, that overrides the type
inference above.

**Constant channel values** (`"value": …` rather than `"field": …`) become
`USING (aesthetic => value)` on the `DRAW` clause.

### transform → SQL or lost

Vega-Lite transforms that can be expressed in SQL are pushed into the `FROM
(SELECT …)` subquery:

| Vega-Lite transform | SQL equivalent |
|---|---|
| `{ "filter": "datum.x > 0" }` | `WHERE x > 0` |
| `{ "calculate": "datum.a + datum.b", "as": "c" }` | `SELECT a + b AS c` |
| `{ "aggregate": [{ "op": "sum", "field": "v", "as": "total" }], "groupby": ["g"] }` | `SELECT g, SUM(v) AS total GROUP BY g` |
| `{ "bin": true, "field": "x" }` | `WIDTH_BUCKET(x, …)` or equivalent |
| `{ "timeUnit": "year", "field": "date", "as": "year" }` | `DATE_TRUNC('year', date) AS year` |
| `{ "sample": n }` | `LIMIT n` (approximate; sample semantics differ) |

Transforms without SQL equivalents — `{ "fold" }`, `{ "flatten" }`,
`{ "pivot" }`, `{ "impute" }`, `{ "density" }`, `{ "loess" }`,
`{ "regression" }`, `{ "quantile" }`, `{ "stack" }`, `{ "window" }` — are
either unrepresentable or require non-standard SQL extensions. The importer
should warn and retain these as comments or drop them.

### facet → FACET

```json
{
  "facet": {
    "row": { "field": "region" },
    "column": { "field": "fiscal_year" }
  }
}
```

```sql
FACET region BY fiscal_year
```

`row`-only facets become `FACET col`. `column`-only facets also become
`FACET col` (dashql's single-identifier form; directionality is a rendering
hint). `resolve.scale.x/y: "independent"` becomes `USING (scales => 'free')`.

### Structural Vega-Lite forms with no VISUALISE equivalent

| Vega-Lite form | Status |
|---|---|
| `hconcat` / `vconcat` / `concat` | Layout operators; no dashql equivalent |
| `repeat` | No dashql equivalent |
| `selection` / `params` (interactions) | No dashql concept |
| `config` (global theme) | No dashql equivalent |
| `resolve` (cross-layer scale sharing) | Partially: `USING (scales => …)` on `FACET` only |
| `encoding.tooltip` | No dashql aesthetic |
| `encoding.href` | No dashql aesthetic |
| `encoding.key` | No dashql aesthetic |
| `encoding.order` (for stacking/path order) | Partially: `ORDER BY` in the inner SELECT |
| `projection` on `geoshape` | No dashql `PROJECT` equivalent for geographic types |

---

## Lossy cases summary

### Forward (VISUALISE → Vega-Lite), information lost or approximated

| Situation | What happens |
|---|---|
| Arbitrary lambda projection | Pattern-match to named scale type; fallback to `calculate` transform |
| `FORMAT (lambda v: sql_expr)` | Translated to `axis.labelExpr` for simple arithmetic; dropped otherwise |
| `PARTITION BY` | Emitted as `encoding.detail`; grouping intent may not match |
| `REMAP` | Becomes a `calculate` transform; aesthetics rename via derived field |
| `PROJECT TO polar` | Mark restructured to `arc`; channel mapping changes |
| SQL-heavy FROM clauses | Executed before spec generation; result passed as inline data |
| `VISUALISE TABLE name` | Table is treated as external data; must be available in embedding env |

### Reverse (Vega-Lite → VISUALISE), information lost or dropped

| Situation | What happens |
|---|---|
| `data.url` / `data.values` / generator | Dropped; must be loaded into SQL table manually |
| `selection` / `params` | Dropped; no dashql interaction model |
| `config` | Dropped; no dashql styling |
| `hconcat` / `vconcat` / `repeat` | Not translatable; importer should error or warn |
| `transform: [fold, flatten, pivot, impute, …]` | Dropped with warning |
| `encoding.tooltip` / `.href` / `.key` | Dropped |
| `type: "temporal"` | Mapped to `continuous`; temporal semantics lost |
| `resolve` across layers | Dropped (only `FACET USING (scales => …)` is representable) |

---

## Implementation sketch

### VISUALISE → Vega-Lite

A translator would walk the parsed AST (`OBJECT_VIS_VISUALISE` and its
children) and build a Vega-Lite spec object:

1. **Execute SQL** — run the `VIS_VISUALISE_SELECT` query (and each
   `VIS_LAYER_SELECT`) and attach results as named inline datasets.
2. **Emit layers** — for each `OBJECT_VIS_LAYER`, emit a `mark`/`encoding`
   pair; collect into `layer[]` if there are multiple.
3. **Emit scales** — for each `OBJECT_VIS_SCALE`, locate the matching
   encoding channel and add `scale`, `axis`, or `legend` properties.
4. **Emit facet** — if an `OBJECT_VIS_FACET` is present, wrap the spec in a
   `facet` object.
5. **Emit title** — map `VIS_LABEL_USING` entries to `title` and per-channel
   `title` fields.
6. **Handle lambdas** — pattern-match projection lambdas; emit `calculate`
   transforms for unrecognized forms.

### Vega-Lite → VISUALISE

A reverse translator would:

1. **Identify layers** — a top-level `mark`/`encoding` becomes a single
   `DRAW`; a `layer` array becomes multiple `DRAW` clauses; `facet` wraps
   the whole statement.
2. **Build SELECT aliases** — for each `field`-type channel, add
   `field AS channel` to the subquery's select list.
3. **Emit SCALE clauses** — from `type`, `scale.type`, `scale.domain`,
   `scale.range`.
4. **Map transforms** — SQL-expressible transforms go into the subquery;
   the rest are dropped with a warning.
5. **Emit LABEL** — from `title`, `subtitle`, and per-channel `title` fields.
6. **Report dropped features** — collect everything that could not be
   represented and surface it to the user.
