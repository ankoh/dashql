# VISUALISE statement

`VISUALISE` is a dashql statement grafted onto the SQL grammar. It describes
a chart as a pipeline of clauses — VISUALISE → DRAW → SCALE → FACET → PROJECT
→ LABEL — following the model established by
[ggsql](https://github.com/thomasp85/ggsql). Only the parser accepts it today;
semantic analysis and rendering are out of scope for this doc.

## Shape

```
VISUALISE [(SELECT ...) | TABLE <qualified_name>]
  DRAW <geom> [FROM (<select>)]
              [PARTITION BY <ident>, ...]
              [REMAP (<target>, ...)]
              [USING (<opts>)]
  SCALE [<type>][(<opt>, ...)] <aesthetic>
        [FROM <bracket-array>] [TO <bracket-array>]
        [FORMAT (lambda <p>: <expr>)]
        [USING (<opts>)]
  FACET <rows> [BY <cols>] [USING (<opts>)]
  PROJECT [<aesthetics>] TO <type> [USING (<opts>)]
  LABEL USING (<opts>)
```

All clause-bearing expression bodies sit inside parens so the parser cannot
absorb the keyword that starts the next clause.

## Input

The optional opening accepts either a full subquery or a table shorthand:

```sql
VISUALISE (SELECT region, revenue FROM sales WHERE fy = 2026) ...
VISUALISE TABLE warehouse.public.sales ...
```

`TABLE <name>` mirrors standard SQL's `TABLE` shorthand for
`SELECT * FROM <name>` and accepts a qualified name. The input is optional;
individual `DRAW` clauses may carry their own `FROM (...)` instead, or mix
the two.

## DRAW

```sql
DRAW point FROM (SELECT date AS x, revenue AS y)
  PARTITION BY region, fiscal_year
  USING (size => 2)
```

- `<geom>` is an identifier resolved against the `VisGeom` enum
  (`point`, `line`, `bar`, `area`, …).
- `FROM (<select>)` is optional and carries a full `sql_select_stmt` (CTEs,
  joins, ORDER BY etc. all work). Omit it to inherit the global source
  supplied by `VISUALISE`.
- `PARTITION BY` is a ggsql layer-level concept (not part of SELECT). It
  takes a bare identifier list to stay LALR(1); no parens, no expressions.
- `REMAP (<target_list>)` uses the same `<expr> AS <name>` syntax as SELECT
  and renames columns added by the layer's statistical transformation.
- `USING (<opts>)` holds layer-level options (`size`, `fill`, …).

The earlier `PLACE` clause was removed: with `FROM` optional, a data-less
annotation layer is just `DRAW text USING (label => '...')`.

## SCALE

```sql
SCALE continuous(lambda v: log10(v), breaks => log10) x
  FROM [0, 100] TO [0, 1000]
  USING (labels => 'scientific')
  FORMAT (lambda v: v * 2)
```

- `<type>` is optional and resolves to `VisScaleType` (`continuous`,
  `discrete`, `binned`, `ordinal`, `identity`).
- The optional parenthesized list after the type carries **type-bound
  options**. Each entry is one of:
  - `<name> => <value>` — standard kwarg (vararg syntax).
  - `<name> => lambda <p>: <e>` — a named lambda
    (e.g. `value => lambda v: log10(v)`).
  - `lambda <p>: <e>` — a bare lambda, kept concise for the common case
    where the name is implied by position.
  A lambda entry (named or unnamed) serves as the value projection
  (replaces the old `TRANSFORM` clause).
- `LAMBDA` is a reserved keyword so an entry starting with it cannot be
  mistaken for a kwarg key.
- `<aesthetic>` is a plain identifier — keeping it an `IDENT` prevents
  clause-starter keywords (`FACET`, `PROJECT`, …) from being absorbed.
- `FROM` / `TO` take bracket-array literals reusing `vararg_array_brackets`,
  so value shapes match option values elsewhere.
- `FORMAT (lambda v: <expr>)` maps each break value to a rendered label.
  The body is a full `sql_a_expr`; parens keep it from swallowing the next
  clause's keyword.
- `USING (<opts>)` is a separate, non-type-bound option bag (e.g. shared
  plotting backend hints).

## FACET

```sql
FACET region BY fiscal_year USING (scales => 'free')
```

Rows and cols are bare identifier lists. `BY` is optional. `USING` is a
named-option bag.

## PROJECT

```sql
PROJECT x, y TO cartesian USING (center => 'Europe')
```

Projection type is an identifier resolved via `VisProjectType`
(`cartesian`, `polar`, `flip`, …). The optional aesthetics list appears
before `TO`.

## LABEL

```sql
LABEL USING (title => 'Sales by Region', subtitle => 'FY2026')
```

Single-clause form; everything lives inside `USING (...)`.

## Options syntax

Every `USING (...)` and the scale type-args list share the `vararg` form:

- `<key> => <value>` pairs separated by commas.
- Values can be literals, column references, function expressions, or
  bracket arrays. See `grammar/rules/ext_varargs.y`.
- Keys may be identifiers or any keyword flavor — no reservation clash.

## AST mapping

Top-level node: `OBJECT_VIS_VISUALISE` with attributes
`VIS_VISUALISE_SELECT` (nullable) and `VIS_VISUALISE_CLAUSES` (array).

Per-clause nodes:

| Clause  | Node type             | Notable attributes                                                                                           |
|---------|-----------------------|--------------------------------------------------------------------------------------------------------------|
| DRAW    | `OBJECT_VIS_LAYER`    | `VIS_LAYER_GEOM`, `VIS_LAYER_SELECT`, `VIS_LAYER_PARTITION_BY`, `VIS_LAYER_REMAP`, `VIS_LAYER_USING`          |
| SCALE   | `OBJECT_VIS_SCALE`    | `VIS_SCALE_TYPE`, `VIS_SCALE_OPTIONS`, `VIS_SCALE_AESTHETIC`, `VIS_SCALE_FROM`/`TO`/`FORMAT`/`USING`          |
| FACET   | `OBJECT_VIS_FACET`    | `VIS_FACET_ROWS`, `VIS_FACET_COLS`, `VIS_FACET_USING`                                                         |
| PROJECT | `OBJECT_VIS_PROJECT`  | `VIS_PROJECT_AESTHETICS`, `VIS_PROJECT_TYPE`, `VIS_PROJECT_USING`                                             |
| LABEL   | `OBJECT_VIS_LABEL`    | `VIS_LABEL_USING`                                                                                             |

Enums: `VisGeom`, `VisScaleType`, `VisProjectType` (see
`proto/fb/dashql/parsed_script_enums.fbs`).

## Feature flag

`VISUALISE` parsing is gated on `ParseContext::IsVisEnabled()`. When
disabled, the parser emits an error on the `VISUALISE` token so the
extension can be compiled out of strict-SQL contexts without a separate
grammar.

## Relationship to ggsql

ggsql is the inspiration and the reason this statement exists. The clause
pipeline, the keyword choices, and the overall shape of the chart
description all come straight from it — credit for the design belongs
there. dashql isn't trying to improve on ggsql; it's trying to fit the
same ideas into a different environment, and that environment forces a
handful of small syntactic differences. This section records them so
future readers understand which parts are dashql-specific choices and
which parts track ggsql directly.

The environment differences that drive most of the divergence:

1. **LALR(1) parsing alongside a full SQL grammar.** Every clause has to
   compose cleanly with `sql_select_stmt`. ggsql's parser is purpose-built
   for visualisation and can be more permissive with lookahead.
2. **Minimal keyword reservation.** dashql shares a keyword table with
   SQL, so every new reserved word risks breaking an existing query.
   ggsql has the whole keyword space to itself.
3. **Grammar reuse.** Where possible, dashql reuses productions that
   already exist for SQL (`sql_select_stmt`, `sql_a_expr`,
   `sql_target_list`, the vararg option form). This keeps the grammar
   small but sometimes means an existing SQL shape stands in for what
   ggsql expresses with a dedicated sub-clause.

Where a ggsql feature isn't listed below, it either maps 1:1 or isn't
implemented yet.

### VISUALISE head

| ggsql                                                            | dashql                                                              |
|------------------------------------------------------------------|---------------------------------------------------------------------|
| `VISUALISE <mapping>, ... FROM <data-source>`                    | `VISUALISE [(<select>) | TABLE <qualified_name>]`                   |
| Global mappings live on the head and are inherited by layers.    | No dedicated mapping syntax on the head; SELECT aliases play that role. |
| `FROM <data-source>` accepts an identifier or a filepath string. | Data source is a subquery or a `TABLE <name>` shorthand.            |
| Preceding CTEs / terminal `SELECT` feed the plot implicitly.     | Input is always stated explicitly on the head or per-layer.         |

In dashql, a mapping like `x => date` is expressed as `SELECT date AS x`
inside the input subquery. This isn't a claim that it's better — it just
avoids adding a second way to name columns in a grammar that already has
`AS`.

### DRAW

| ggsql                                            | dashql                                                                            |
|--------------------------------------------------|-----------------------------------------------------------------------------------|
| `MAPPING <m>, ... FROM <data-source>`            | `FROM (<select>)` — aliases in the subquery express the mapping.                  |
| `SETTING <p> => <v>, ...`                        | `USING (<opts>)`                                                                   |
| `FILTER <cond>`                                  | Expressed in the inner `SELECT`'s `WHERE` clause.                                 |
| `PARTITION BY <col>, ...`                        | Same keyword. Identifier list only (no expressions), no parens.                   |
| `ORDER BY <col>, ...`                            | Expressed in the inner `SELECT`'s `ORDER BY` clause.                              |
| `REMAPPING <m>, ...`                             | `REMAP (<target_list>)` with required parens; reuses SQL `sql_target_list`.       |
| `MAPPING <col> ... FROM <source>` per layer      | Per-layer data source lives inside `FROM (<select>)` as the FROM of that subquery. |
| `MAPPING *` wildcard auto-maps columns.          | Not implemented; aliases are explicit.                                            |
| `PLACE <geom>` for data-less layers.             | Subsumed: `DRAW <geom> USING (...)` with no `FROM` achieves the same thing.       |

The thread running through these differences is that dashql leans on the
embedded SQL `SELECT` for anything SELECT can already express — which
covers mapping, filtering, and ordering. This is mostly a practical
choice: reusing `sql_select_stmt` means the SQL parser handles the hard
work. It comes at the cost of requiring parens around the embedded query
so its keywords (`FROM`, `WHERE`, `ORDER BY`) don't collide with the
clauses that follow. `PARTITION BY` stays as its own clause because it's
layer-level grouping, not a SELECT concept.

### SCALE

This is the clause where syntactic taste shows the most, so it's worth
being explicit: none of the below is a judgement on the ggsql form —
both shapes express the same underlying ideas.

| ggsql                                                 | dashql                                                              |
|-------------------------------------------------------|---------------------------------------------------------------------|
| `SCALE <type> <aesth> FROM <in> TO <out> VIA <xform>` | `SCALE [<type>][(<opt>, ...)] <aesth> FROM [..] TO [..]`            |
| `SETTING <p> => <v>, ...` (type-level knobs)          | Merged into `(<opt>, ...)` bound to the type.                       |
| `VIA <transform>` names a projection transform.       | Projection is a lambda inside the type parens: `continuous(lambda v: log10(v))`. |
| `RENAMING <break> => <str>, ...` lookup table.        | `FORMAT (lambda v: <expr>)` — one function over the break value.    |

Notes on the dashql-side choices:

- Treating the projection as a lambda inside the type's options list lets
  us separate projection (a pure value mapping) from other type knobs
  like break count, without introducing a new keyword for each. This is
  a grammar simplification, not a claim that ggsql's `VIA` is wrong —
  `VIA` is concise and reads well.
- Folding `SETTING` into the same parens as the lambda is a consequence
  of LALR(1): a trailing option list after the type would be ambiguous
  against a bare options parens, so dashql groups both in one place.
  This is the one place we add a reserved word (`LAMBDA`), which we'd
  avoid if we could.
- `RENAMING` has a carefully designed string-format mini-language in
  ggsql (`{:num ...}`, `{:time ...}`). dashql hasn't reimplemented it;
  the current stand-in is a SQL lambda that can call whatever string /
  date functions the backend exposes. Equivalent expressive power is
  likely, but it's a different idiom and will feel more verbose for the
  common cases `RENAMING` handles elegantly.

### Options syntax

| ggsql                                                | dashql                                                        |
|------------------------------------------------------|---------------------------------------------------------------|
| `SETTING <key> => <value>, ...`                      | `USING (<key> => <value>, ...)` — always parenthesised.       |
| String-interpolation format mini-language in labels. | Full SQL expressions inside `FORMAT (lambda v: <expr>)`.      |
| Positional ranges without brackets.                  | `FROM [0, 100] TO [0, 1000]` — bracket arrays.                |

Parens and brackets show up more in dashql than in ggsql. They're not
there for style; they're there because bare key-value lists or
positional ranges would be swallowed by surrounding SQL productions in
an LALR(1) grammar. ggsql's hand-written parser doesn't have this
constraint and the ggsql syntax is the cleaner of the two as a result.

### Summary of dashql-specific compromises

- Aesthetic mapping moves into SELECT aliases instead of a dedicated
  `MAPPING` clause.
- `FILTER` and `ORDER BY` move into the embedded SELECT.
- `MAPPING *` wildcard is not implemented.
- `SETTING` merges into `USING (...)` and the scale type parens.
- `VIA <transform>` becomes an in-parens lambda.
- `RENAMING`'s lookup table and format mini-language are replaced by a
  single `FORMAT (lambda v: ...)` using SQL expressions.
- `PLACE` is expressed as a `DRAW` without `FROM`.
- Filepath data sources are not accepted; only SELECT/TABLE.
- Implicit carryover from a preceding `SELECT` is not supported.
- Expression bodies and option lists are parenthesised.

### dashql-side conveniences

- `VISUALISE TABLE <qualified.name>` shorthand borrowed from standard SQL.
- Full `sql_select_stmt` inside `DRAW ... FROM (...)` — joins, CTEs,
  nested queries — without any new grammar.
- `FORMAT` and scale projection lambdas run arbitrary SQL expressions
  (`CASE`, function calls, arithmetic) over break or data values.

## Source files

- Grammar: `grammar/rules/vis_visualise.y` and `.yh`
- Keywords: `grammar/lists/sql_reserved_keywords.list` (`LAMBDA`),
  `grammar/lists/sql_unreserved_keywords.list` (all other vis tokens)
- Flatbuffer schema: `proto/fb/dashql/parsed_script.fbs` and
  `parsed_script_enums.fbs`
- Snapshot template: `snapshots/parser/vis_visualise.tpl.yaml`
