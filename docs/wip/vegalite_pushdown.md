# Push visualization transforms down into SQL

## Context

DashQL is in a rare position: it owns *both* the SQL semantics and the visualization
spec semantics for a `VISUALIZE ... USING vegalite (...)` statement. Today those two
worlds are not wired together on the hot path.

**The inefficiency.** For a `VISUALIZE` cell, the frontend resolves the source to a bare
`SELECT * FROM ...` (or the inline select verbatim) in
`packages/dashql-app/src/connection/visualize_executor.ts:42`, executes it, then
`VegaLiteView` marshals the **entire** result table row-by-row into `data: { values: rows }`
(`packages/dashql-app/src/view/visualization/vegalite_view.tsx:13-31,47`). Any
`aggregate` / `bin` / `sort` / `top-N` declared in the spec is then executed by
**Vega-Lite in JavaScript** over the full, un-reduced dataset. For a bar chart that is
`sum(revenue) by month`, we ship every row to the browser and let JS collapse it.

This is exactly the problem Mosaic addresses by compiling declarative viz transforms to
SQL against DuckDB and pulling back only the small aggregates. DashQL is better positioned
than Mosaic here: the analyzer **already captures** `aggregate`, `bin`, and `time_unit`
per encoding channel (`VisEncodingChannel` in
`packages/dashql-core/include/dashql/analyzer/analyzer_types.h:688-709`) and already emits
them into the Vega-Lite JSON (`vegalite_generator.cc:571-618`). We just re-route those
directives from "JS transform" to "SQL GROUP BY".

The pushdown machinery also already exists — but only for the data-grid histograms/top-K,
via `SQLFrame` (`packages/dashql-app/src/sql/sqlframe_builder.ts`), which compiles binning,
GROUP BY aggregation, filters, ordering, and limit into DuckDB CTEs. The Vega-Lite path
simply doesn't use it.

**Intended outcome.** A `VISUALIZE` whose spec declares aggregation/binning/top-N executes
the reduction in the SQL engine (DuckDB/Hyper/Trino) and hands Vega-Lite a small,
pre-aggregated table. The declarative Vega-Lite authoring experience is unchanged; the
computation moves to where the data lives.

**Scope (agreed):** incremental pushdown compiler, lowering built in the **C++ core**
(`dashql-core`). No interactive cross-filtering / selection linking in this pass. No
adoption of Mosaic as a renderer.

## Design

### The lowering rule (Vega-Lite aggregate semantics)

Vega-Lite's aggregate transform groups by *every encoded field that is not itself
aggregated* and computes the aggregate fields per group. We mirror that:

- **Group keys** = encoding channels that have a `field` but **no** `aggregate`
  (these are the "dimensions": x for a bar chart, `color`, `column`, `detail`, etc.).
- **Binned key** = a channel with `bin` becomes a group key on a bin expression.
- **Measures** = channels with an `aggregate` (`sum`, `mean`/`avg`, `count`, `min`, `max`, …).
- If **no** channel has `aggregate` and **no** channel has `bin` → **no pushdown**; fall
  back to today's behavior (raw select + Vega-Lite spec with no transforms to run anyway).

### Coordinated output: SQL *and* a rewritten spec

The critical correctness constraint: if we pre-aggregate in SQL **and** leave
`aggregate`/`bin` in the Vega-Lite spec, Vega-Lite re-aggregates the already-aggregated
column (double counting; `mean` of `mean` is wrong). So the compiler must emit a
**coordinated pair**:

1. `pushdown_sql` — the GROUP BY query producing one column per channel.
2. A Vega-Lite spec whose channels reference the **output columns by alias** with the
   `aggregate` / `bin` directives **stripped**.

Both are generated together, lazily, in the core during `AnalyzedScript::Pack`.

**Aliasing convention** (follow Vega-Lite's own defaults so titles/tooltips stay sensible):
- Group-key channel on field `F` → output column `F` (spec keeps `field: F`).
- Aggregate `A` on field `F` → output column `A_F` (e.g. `sum_revenue`); spec sets
  `field: "A_F"`, drops `aggregate`. Cosmetic note: Vega-Lite auto-title becomes
  `"sum_revenue"` instead of `"Sum of revenue"`; acceptable, and recoverable later by
  emitting an axis/legend `title`.
- `count` with no field → output column `__count` (Vega-Lite's own convention).

### Source substitution (handles the script-reference gap)

The core has the source text for `TABLE_REFERENCE` (construct `SELECT * FROM name`) and
`INLINE_SELECT` (the parenthesized select is in the same script input), but **not** for
`SCRIPT_REFERENCE` — that SQL lives in another notebook cell whose text only the frontend
resolves (`visualize_executor.ts` already does this for all three kinds).

To keep the generation in the core while respecting that gap, the core emits the pushdown
SQL as a **wrapper over a sentinel source**:

```sql
WITH __vis_source AS ( {{SOURCE}} )
SELECT "month", SUM("revenue") AS "sum_revenue"
FROM __vis_source
GROUP BY 1
ORDER BY ...
LIMIT ...
```

The frontend substitutes `{{SOURCE}}` with the base SQL it already resolves today
(`resolveVisualizeQuery`), uniformly for all three source kinds. (A quoted-identifier
sentinel or a documented placeholder token — pick one and document it in both the emitter
and the substitution site so they can't drift.)

### Phasing

- **Phase 1 — aggregation + top-N (highest value, lowest risk).** GROUP BY over dimensions,
  aggregate measures, optional `ORDER BY` + `LIMIT` when the spec implies a top-N. This
  directly reuses the shape `SQLFrame` already proves out.
- **Phase 2 — binning.** Deferred within this effort: SQL binning produces lower/upper
  bounds, which for Vega-Lite means rewriting a binned `x` channel into `x` + `x2` (bin
  bounds) and setting `bin: { binned: true }`. More spec surgery; land after Phase 1.
- **Optional — scale-domain extents.** Low priority: post-aggregation data is already small,
  so computing `domainMin/Max` in SQL saves little. Skip unless a concrete need appears.

## Files to modify

**C++ core (`packages/dashql-core`):**
- `include/dashql/analyzer/analyzer_types.h` — add `std::string pushdown_sql;` to
  `VisualizationSpec` (near `vegalite_json`, ~line 785).
- `src/visualize/` — add a new `vegalite_pushdown.cc` (+ header in
  `include/dashql/visualize/`) implementing the lowering rule: inspect
  `spec.encoding_channels` for group keys vs. measures, build the sentinel-wrapped GROUP BY
  SQL. Mirror the SQL-building idioms in `sqlframe_builder.ts` (quoting, agg formatting).
- `src/visualize/vegalite_generator.cc` — make `GenerateVegaLiteSpec` pushdown-aware: when
  aggregation is lowered, emit channel `field` as the output alias and **omit**
  `aggregate` (and later `bin`). Keep current behavior when no pushdown applies.
- `src/script.cc:850-906` — in the `Pack` block, when `is_vegalite`, also generate & cache
  `spec.pushdown_sql`, and `sb.add_pushdown_sql(...)`.

**FlatBuffer schema:**
- `proto/fb/dashql/analyzed_script.fbs:281-303` — add `pushdown_sql: string;` to the
  `VisualizationSpec` table (append after `umap_spec` to preserve field ordering).
  Regenerate bindings via the normal Bazel codegen.

**Frontend (`packages/dashql-app`):**
- `src/connection/visualize_executor.ts:116-127` — in the `vegalite` branch, read
  `spec.pushdownSql()`; if present, substitute `{{SOURCE}}` with the already-resolved base
  `sql` and return that as the executable SQL. `VegaLiteView` needs **no change** — it just
  receives fewer rows and a transform-free spec.

## Verification

- **C++ snapshot tests** — the natural home. Add cases to
  `snapshots/visualize/basic.yaml` (driven by
  `packages/dashql-core/test/visualize_snapshot_test_suite.cc`) with a new `pushdown_sql`
  expectation alongside the existing `vegalite` / `roundtrip` fields. Cover: (a) bar chart
  `sum(y) by x` → GROUP BY + stripped aggregate in spec; (b) multi-dimension group
  (`x` + `color`); (c) `count` with no field → `__count`; (d) no-aggregate spec → **no**
  pushdown emitted (regression guard); (e) top-N with sort+limit. Run via the Bazel test
  target (per project convention — not `npx`/raw ctest directly).
- **TS transcode test** — extend
  `packages/dashql-app/src/notebook/vegalite_transcode.test.ts` to assert the `{{SOURCE}}`
  substitution produces valid SQL for each of the three source kinds
  (table / inline / script reference).
- **End-to-end in the app** — run a notebook with a `VISUALIZE ... USING vegalite` bar
  chart over an aggregating spec; confirm the executed query is the GROUP BY (small result)
  rather than `SELECT *`, and the chart renders identically to the pre-change JS-aggregated
  version. Compare against the current behavior on the same spec.
- **Guardrail** — verify that specs with no aggregate/bin are byte-identical to today
  (spec unchanged, no `pushdown_sql`), so existing snapshots don't churn.

## Notes / open risks

- **Double-aggregation** is the correctness trap; the coordinated spec-rewrite (stripping
  `aggregate`/`bin`) is what prevents it. Any code path that emits `pushdown_sql` must also
  go through the pushdown-aware spec generation — keep them in one function so they can't
  diverge.
- **Sentinel drift** — the placeholder token is a contract between `vegalite_pushdown.cc`
  and `visualize_executor.ts`. Define it once, document at both sites.
- **Auto-title cosmetics** — aggregated axis titles degrade from "Sum of revenue" to
  "sum_revenue"; note as a known follow-up (emit explicit axis/legend titles).
