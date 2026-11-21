# Hyper SQL acceptance gaps

Audit of Hyper SQL that DashQL rejected, excluding transaction control. The findings below describe
the original behavior. They are now covered by the syntax-only grammar in `grammar/hyper/`, parser
acceptance tests, and scanner fixes. Semantic analysis, formatting, and runtime support are separate
work. DashQL accepting additional dialects is outside the audit.

## Evidence

Compared the working DashQL parser with `../hyper-db/hyper/parser/sql/sql.ypp`,
`SQLKeywords.hpp`, `SQLLexer.cpp`, and Hyper's SQL tests. Source revisions:

- DashQL: `6fced9862c2d199f82199dc513af147ef1e2a364`, with the concurrent transaction changes.
- Execution checks: the repository's pinned native Hyper API `0.0.26479`
  (`bazel/external_tableauhyperapi.bzl`). This binary predates some features in the Hyper checkout.

A temporary Bazel Rust executable called `dashql_parser::scanner::scan` and
`dashql_parser::parser::parse` directly, then submitted the same SQL to Hyper through
`tests/hyper:hyper_ffi_rs`. The checks therefore distinguish parser errors from unresolved-name
warnings in the analyzer. Every example in the first section completed successfully in native Hyper
and produced a scanner/parser diagnostic in DashQL. Unless specified otherwise, the examples use:

```sql
CREATE TABLE t (x integer, y integer);
INSERT INTO t VALUES (1, 2), (2, 3);
```

Keyword probes covered 1,233 alias, column-name, and function-name cases. Hyper's successful SQL test
blocks were also screened for candidates; that screening is not a compatibility percentage, since
the tests include feature settings, test-runner substitutions, and SQL for other backends.

## Confirmed query gaps

### Names and scanning

| Gap | Hyper-valid example | DashQL cause |
| --- | --- | --- |
| Whitespace after a qualifying dot | `SELECT t. x FROM t`; `SELECT t. * FROM t`; `SELECT * FROM public. t`; `SELECT pg_catalog. abs(-1)` | The scanner emits `DOT_TRAILING` for a dot followed by whitespace. A complete name is diagnosed as having a trailing dot. Newlines after the dot also fail. |
| Keywords as aliases without `AS` | `SELECT 1 key`; `SELECT 1 action`; even `SELECT 1 select` | `sql_target_el` permits only `IDENT` in this position. Hyper has a separate `BareColLabel` classification. **391** Hyper-keyword aliases succeeded in Hyper and failed in DashQL. Another **23** words known only to DashQL, including `sample`, `parallel`, and `sql`, have the same problem. |
| Extra restrictions on identifiers | `CREATE TABLE anti(x int)`; similarly `semi` and `glob`; `SELECT descriptor FROM (SELECT 1 AS descriptor) s` | DashQL reserves `anti`/`semi`, classifies `glob` as a function/type keyword, and reserves `descriptor`. Hyper permits these names in column/table positions. |
| Dollar-quoted string expressions | `SELECT $$hello$$`; `SELECT $tag$hello$tag$` | The scanner recognizes dollar strings, but the expression grammar does not accept them. Their existing use in CALL values does not cover SQL expressions. |
| Unicode quoted identifiers | `SELECT 1 AS U&"d\0061t"` | No Unicode identifier-literal scanner state. |
| Newline-separated string continuation | `SELECT 'hello'` followed by a newline and `'world'` | Produces two string tokens rather than the single continued string accepted by Hyper. |
| Unicode whitespace and BOM | `SELECT 1<U+00A0>+<U+00A0>2`; `<U+FEFF>SELECT 1` | Hyper skips these characters. DashQL treats their UTF-8 bytes as identifier bytes. |

Main DashQL locations: `packages/dashql-parser/src/scanner.rs`,
`grammar/rules/sql_select.y:2750` (`sql_indirection_el`) and `:2800` (`sql_target_el`),
and `grammar/lists/*.list`. Hyper counterparts: `SQLLexer.cpp`, `BareColLabel`, and the keyword lists.

### SELECT clauses and grouping

| Gap | Hyper-valid example | Missing production or option |
| --- | --- | --- |
| Star exclusion | `SELECT * EXCLUDE y FROM t`; `SELECT t.* EXCLUDE (y) FROM t` | Hyper's `opt_star_exclude` on unqualified and qualified stars. |
| Implicit grouping columns | `SELECT x, sum(y) FROM t GROUP BY ALL` | `GROUP BY ALL` as its own alternative. |
| Grouping quantifier | `SELECT x, sum(y) FROM t GROUP BY ALL x`; `SELECT x, count(*) FROM t GROUP BY DISTINCT GROUPING SETS ((x), (x))` | Hyper's `opt_gb_distinct`. |
| Empty/nested grouping sets | `SELECT count(*) FROM t GROUP BY GROUPING SETS (())`; `SELECT x, count(*) FROM t GROUP BY GROUPING SETS (CUBE(x), ())` | DashQL takes `sql_expr_list` inside GROUPING SETS; Hyper takes `group_by_list`, which also includes empty, nested, CUBE, and ROLLUP grouping sets. |
| Ordering all result columns | `SELECT x, y FROM t ORDER BY ALL DESC NULLS LAST` | `ALL` alternative of `sortby`. |
| Fetch with ties | `SELECT x FROM t ORDER BY x FETCH FIRST 1 ROW WITH TIES` | DashQL accepts the `ONLY` ending, but lacks `WITH TIES`. |
| Aggregation policy query | See below. | `SELECT [WITH AGGREGATION_THRESHOLD] ...` before ALL/DISTINCT and the target list. |

Aggregation threshold requires a policy. This full example succeeded in Hyper:

```sql
WITH e(a, b) AS (VALUES (1, 1), (1, 2), (2, 1), (2, 2), (2, 3))
OPTIONS (privacy_policy '{"aggregation_policies":[{"threshold":3,"privacy_entity_key":["b"]}]}')
SELECT WITH AGGREGATION_THRESHOLD avg(a), a FROM e GROUP BY a;
```

Main DashQL locations: `sql_simple_select`, `sql_sortby`, `sql_limit_clause`, and
`sql_group_by_item` in `grammar/rules/sql_select.y`. Hyper counterparts:
`simple_select`, `sortby`, `limit_clause`, `group_clause`, and `group_by_item`.

### Types and expressions

| Gap | Hyper-valid example | DashQL cause |
| --- | --- | --- |
| Qualified type names | `SELECT CAST(1 AS pg_catalog.int4)`; `CREATE TABLE q(x pg_catalog.int4)` | `sql_generic_type` has no qualified-name alternative. Qualified typed string literals take a different route and already parse. |
| Upper valid FLOAT precision | `SELECT CAST(1 AS FLOAT(53))` | `ParseContext::read_float_type` uses `< 53`, rejecting the valid upper endpoint. Its `< 24` boundary also assigns FLOAT(24) to FLOAT8, although that is a tree/type issue rather than a rejection. |
| Non-null array elements | `SELECT CAST(ARRAY[1, 2] AS ARRAY(integer NOT NULL))` | Missing inner `NOT NULL` in the array type. Plain `ARRAY(integer)` already parses. |
| Non-null row fields | `SELECT CAST(ROW(1, 2) AS ROW(x integer NOT NULL, y integer))` | `sql_table_func_element` lacks Hyper's `opt_not_null`. The same restriction affects DESCRIPTOR fields. |
| Empty row type | `SELECT CAST(ROW() AS ROW())` | DashQL requires at least one field in the ROW type. |
| Named row-constructor elements | `SELECT ROW(1 AS x, 2 AS y)`; `SELECT ROW(1 x, 2 y)`; `SELECT ROW(x => 1, y => 2)` | DashQL accepts an expression list rather than Hyper's `row_constructor_list`. |
| Null-on-cast-failure spelling | `SELECT CAST('bad' AS integer OR NULL)` | `TRY_CAST` already parses; the `CAST ... OR NULL` alternative does not. |
| Null propagation in extrema | `SELECT GREATEST(PRESERVE NULLS 1, NULL)`; likewise `LEAST` | Missing `PRESERVE NULLS` alternatives. |
| UNIQUE predicate | `SELECT UNIQUE (SELECT x FROM t)` | Missing `UNIQUE select_with_parens`. |
| CURRENT_DATE with parentheses | `SELECT CURRENT_DATE()` | Only the form without parentheses is accepted. |
| Lambda arguments | `SELECT array_filter(ARRAY[1, 2, 3], LAMBDA x: x > 1)`; `SELECT array_transform(ARRAY[1, 2], ARRAY[3, 4], LAMBDA x, y: x + y)` | Hyper accepts `LAMBDA [columnList] : a_expr` as a function argument. |
| SQL SUBSTRING pattern form | `SELECT SUBSTRING('abc' SIMILAR 'a#"b#"c' ESCAPE '#')` | DashQL tries to parse SIMILAR as the binary `SIMILAR TO` operator instead of the SUBSTRING-specific clause. |
| Additional EXTRACT/POSITION arguments | `SELECT EXTRACT(year FROM date '2020-01-01', 'iso')`; `SELECT POSITION('a' IN 'abc', start => 1)` | Missing `',' func_arg_list` alternatives after the standard argument forms. |

Parameter indirection is another confirmed grammar gap: DashQL rejects `SELECT $1[1]`,
`SELECT $1.x`, `SELECT ?[1]`, `SELECT :p[1]`, and `SELECT :p.x`. Hyper's `c_expr` attaches
`opt_indirection` directly to parameters. Native Hyper accepted both
`PREPARE p_index(integer[]) AS SELECT $1[1]` and
`PREPARE p_field(ROW(x integer)) AS SELECT $1.x`; the unbound SELECT forms reach parameter-binding
errors rather than syntax errors in Hyper.

Main DashQL locations: `sql_generic_type`, `sql_simple_typename`, `sql_table_func_element`,
`sql_explicit_row`, `sql_func_arg_expr`, `sql_func_expr_common_subexpr`, `sql_substr_list`,
`sql_extract_list`, `sql_position_list`, and the parameter productions of
`grammar/rules/sql_select.y`; `packages/dashql-parser/src/parser/context.rs:526` for FLOAT.

### Windows, table references, and JSON

| Gap | Hyper-valid example | Scope |
| --- | --- | --- |
| Explicit null handling | `SELECT lag(x) RESPECT NULLS OVER (ORDER BY x) FROM t` | Hyper also implements `IGNORE NULLS` in some contexts: `last_value(x) IGNORE NULLS OVER (ORDER BY x ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)` and `first_value(y) IGNORE NULLS WITHIN GROUP (ORDER BY x)` both succeeded. Do not use LAG IGNORE NULLS as the execution test; Hyper rejects that later as unimplemented. |
| NTH_VALUE direction | `SELECT nth_value(x, 1) FROM LAST OVER (ORDER BY x) FROM t` | `FROM FIRST` also belongs to the grammar. |
| Window exclusion | `SELECT sum(y) OVER (ORDER BY x ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW EXCLUDE CURRENT ROW) FROM t` | Hyper also parses EXCLUDE GROUP, TIES, and NO OTHERS. |
| Nullable window boundary | `SELECT sum(y) OVER (ORDER BY x ROWS BETWEEN 1 PRECEDING OR NULL AND CURRENT ROW) FROM t` | `PRECEDING OR NULL` / `FOLLOWING OR NULL`. |
| TABLE wrapper around table functions | `SELECT * FROM TABLE(unnest(ARRAY[1, 2]))` | Hyper's `TABLE '(' func_table ')'` table-reference alternative. |
| Ordinality on subqueries | `SELECT * FROM (SELECT 1 AS x) WITH ORDINALITY` | DashQL attaches ordinality only through its table-function productions. |
| Explicit ordinality column name | `SELECT * FROM unnest(ARRAY[1, 2]) WITH ORDINALITY (n)` | Missing `opt_ordinality_name`. |
| Bounded sample cardinality | `SELECT * FROM t TABLESAMPLE system(20 PERCENT BETWEEN 1 ROWS AND 2 ROWS)` | Also supports UNBOUNDED on either side of the row-count bounds. |
| JSON object key/value syntax | `SELECT JSON_OBJECT('a': 1, 'b': true)` | Generic function-call syntax cannot accept the colon pairs. |
| JSON constructor options | `SELECT JSON_OBJECT('a': NULL::integer ABSENT ON NULL)`; `SELECT JSON_ARRAY(1, NULL::integer ABSENT ON NULL)`; `SELECT JSON_ARRAY('[1]' FORMAT JSON)`; `SELECT JSON('{"a":1}' WITHOUT UNIQUE KEYS)` | Missing SQL/JSON productions and options. Plain function-call-shaped forms can already parse. |
| Aggregate null handling | `SELECT JSON_ARRAYAGG(x NULL ON NULL) FROM t`; `SELECT JSON_ARRAYAGG(x ABSENT ON NULL) FROM t` | Hyper puts the option inside the parentheses, after the arguments and optional ORDER BY. It is not the same production as the outside-parentheses IGNORE/RESPECT NULLS modifier. ARRAY_AGG also has successful source tests for these options. |

Main DashQL locations: `sql_func_expr`, `sql_opt_frame_clause`, `sql_frame_bound`,
`sql_table_ref`, `sql_opt_ordinality`, `sql_tablesample_entry`, and `sql_func_application` in
`grammar/rules/sql_select.y`. Hyper counterparts: `func_expr`, `func_builtin_window`,
`opt_window_exclusion_clause`, `frame_bound`, `table_ref`, `opt_ordinality`, `sample_size`,
and the SQL/JSON productions.

## Statement gaps

These go beyond SELECT and also exclude transaction control.

| Family | Findings and evidence |
| --- | --- |
| UPDATE | No top-level production in DashQL. `UPDATE u SET x = 1 WHERE y = 2 RETURNING x` succeeded in Hyper with an ordinary two-column table. Hyper also supports WITH, FROM, aliases, and multi-column assignments. |
| INSERT BULK | `INSERT BULK INTO u VALUES (1, 2)` succeeded in Hyper and is rejected before INTO in DashQL. |
| TRUNCATE | `TRUNCATE t` succeeded in Hyper. Missing entirely in DashQL, including its EXPLAIN use. |
| COPY | `COPY t TO NULL WITH (FORMAT csv)` succeeded in Hyper. FROM/TO, query sources, external descriptors, and both option syntaxes are absent from DashQL. |
| Prepared statements | `PREPARE p(integer) AS SELECT $1 + 1`, `EXECUTE p(1)`, and `DEALLOCATE p` all succeeded in Hyper. PREPARE TRANSACTION support does not cover these statements. |
| SET / SHOW / RESET | Hyper accepted `SET search_path TO public`, `SET SESSION timezone = 'UTC'`, `SET timezone = DEFAULT`, `SET search_path = public, pg_catalog`, `SET TIME ZONE 'UTC'`, `SET SCHEMA 'public'`, `SHOW timezone`, and `RESET timezone`. DashQL's SET grammar only takes its own `SET key = vararg_value` form. The source grammar additionally permits ON as a boolean value, LOCAL scope, and further settings forms. |
| Database lifecycle | CREATE DATABASE, DROP DATABASE, and DETACH DATABASE succeeded in the execution checks. ATTACH itself already parses. Hyper's source also has ALTER DATABASE, IMPORT/EXPORT DATABASE, UNLOAD DATABASE / RELEASE, and VALIDATE DATABASE, with no DashQL statement productions. |
| CREATE / ALTER constraints | `CREATE TABLE assumed_parent(x int ASSUMED PRIMARY KEY)` and a child with `x int ASSUMED REFERENCES assumed_parent(x)` succeeded. So did `CREATE TABLE assumed_b(x int, ASSUMED UNIQUE(x))`. `ALTER TABLE alter_pk_base ADD ASSUMED PRIMARY KEY(x)` succeeded after creating `alter_pk_base(x int NOT NULL)`. DashQL lacks ASSUMED forms and column-level REFERENCES; ordinary table-level FOREIGN KEY already parses. |
| ALTER relation modifiers | `ALTER TABLE ONLY t ADD COLUMN z int` succeeded in Hyper; DashQL takes a qualified name rather than `relation_expr` in ALTER TABLE. |
| DROP variants | `DROP TABLE a, b`, `DROP TABLE u CASCADE`, `DROP TABLE u RESTRICT`, `DROP VIEW IF EXISTS v CASCADE`, and `DROP SCHEMA IF EXISTS s1, s2` succeeded with the relevant setup. DashQL lacks multiple targets and TABLE/VIEW drop behavior. `DROP EXTERNAL TABLE IF EXISTS e`, `DROP EXTERNAL STREAM IF EXISTS e`, and `DROP FUNCTION IF EXISTS f(integer)` also succeeded and lack DashQL dispatch. |
| ANALYZE / COMMENT | `ANALYZE t` and `COMMENT ON COLUMN t.x IS 'hello'` succeeded in Hyper. Both statement families are absent in DashQL. Hyper does not accept COMMENT ON TABLE. |
| Cursors | Hyper accepted DECLARE. Its grammar also defines FETCH, MOVE, and CLOSE, all absent in DashQL. FETCH/CLOSE require cursor lifetime setup; a cursor without WITH HOLD is closed by autocommit. |
| CALL | `CALL f('hello', 1)` reaches procedure lookup in Hyper and fails in DashQL parsing. Hyper accepts ordinary expression arguments and table arguments; DashQL's client-function CALL value grammar does not cover them. The source tests use calls such as `CALL iceberg_rewrite_data_files("table" => TABLE(ins_rw), ...)`. |

The dispatch comparison is `Stmt` in Hyper's `sql.ypp:689` against `sql_query_statement` in
`grammar/rules/ext_statement.y`. Related DashQL files are `ext_set.y`, `ext_call.y`, `sql_insert.y`,
`sql_create.y`, `sql_alter.y`, and `sql_drop_attach.y`.

## Further source-backed gaps and runtime limits

These also need grammar coverage if compatibility means accepting Hyper's grammar, but should not be
presented as ordinary successful queries on the pinned Hyper API without the appropriate settings or
feature support:

- **MERGE**: a full `MergeStmt` exists and DashQL has none. The default native table used in the
  probe rejects MERGE during semantic analysis. Successful source tests exist for external-table DML.
- **Real function and aggregate definitions**: DashQL's function declaration stops at RETURNS.
  Hyper supports bodies, LANGUAGE/options, OR REPLACE, TEMP, unnamed/default/mode-qualified arguments,
  return nullability, table returns, and aggregate definitions. See Hyper's
  `hyper/sql/functional/features/udf/` and `features/aggregation/filter.test`.
- **External tables/streams**: CREATE EXTERNAL TABLE/STREAM, reading `FROM EXTERNAL STREAM`,
  CLOSE EXTERNAL STREAM, and external-table options have successful Hyper source tests. Persisted
  external tables are disabled by default in the pinned binary. See
  `hyper/sql/functional/features/external/`.
- **Query-time WITH OPTIONS**: missing after table references. Successful source examples include
  `SELECT * FROM with_options_iceberg WITH OPTIONS (identifier_fields_are_unique => true)` in
  `hyper/sql/functional/features/external/with_options.test`. This is different from CTE OPTIONS,
  which DashQL already supports.
- **Nested ARRAY bracket constructors**: DashQL rejects `ARRAY[[1, 2], [3, 4]]`. Hyper's source
  accepts this; multidimensional arrays require feature support in the pinned binary. See
  `hyper/sql/functional/types/array/array_constructor.test`.
- **CREATE TABLE storage options**: missing trailing `WITH (...)`. Hyper source tests include
  `WITH (COUNTNULLS=1)`; the pinned binary disables storage options by default.
- **Column REFERENCES and ASSUMED constraints**: ordinary REFERENCES has source tests but requires
  index support in the pinned runtime. ASSUMED references were verified successfully above.
- **Descriptors / table arguments**: Hyper accepts bare and empty descriptors (`DESCRIPTOR(x)`,
  `DESCRIPTOR()`), query-valued table arguments (`TABLE(SELECT ...)`), table-argument correlation,
  partitioning, and ordering. DashQL only accepts a narrower subset. Calling an unknown `f` with these
  forms reaches function lookup in Hyper. `f(TABLE(t) ORDER BY (x))` already parses in DashQL, although
  the grammar can interpret that ORDER BY as aggregate ordering rather than table-argument ordering.
- **User-defined types/domains, sequences, indexes, authorization**: CREATE/ALTER/DROP variants and
  GRANT/REVOKE are substantially absent in DashQL. They have Hyper source grammar and successful
  feature-enabled tests; the pinned binary disables these facilities by default.
- **Accepted by Hyper's parser but unimplemented later**: recursive views, view WITH/CHECK options,
  CREATE SCHEMA AUTHORIZATION, CREATE TABLE LIKE, ALTER TABLE DROP CONSTRAINT, DELETE WHERE CURRENT
  OF, and some window/table ordinality contexts. DashQL rejects their syntax too.
- **SQL/JSON query clauses**: JSON_QUERY/JSON_VALUE/JSON_EXISTS option syntax is absent, even though
  their simple function-call forms can parse in DashQL. Hyper's source tests explicitly mark these
  functions as unimplemented. The pinned binary also has a parser inconsistency for ARRAY WRAPPER;
  the source grammar explicitly accepts it.
- **Semantic-view calls**: the newer source grammar accepts DIMENSIONS/MEASURES/FACTS/WHERE inside
  a function call, unlike DashQL. Hyper's `features/parser/semantic_view.test` expects a later
  unsupported-feature error; the pinned runtime predates the syntax.

## Suggested implementation order

1. Correct rejections of ordinary SQL: dot whitespace, FLOAT(53), qualified types, keyword aliases,
   identifier categories, and empty/nested grouping sets.
2. Add common query syntax: star exclusion, GROUP/ORDER BY ALL, DISTINCT grouping, FETCH WITH TIES,
   window modifiers, typed/named rows, lambdas, and JSON constructors/aggregate options.
3. Add missing operational SQL: UPDATE, COPY, TRUNCATE, prepared statements, session settings,
   database lifecycle, constraints, DROP variants, and column comments.
4. Cover feature-enabled and parser-only Hyper syntax, tracking runtime support separately.

Do not treat every generic Postgres feature as a Hyper gap. Both parsers reject, for example,
`EXPLAIN ANALYZE SELECT 1`, `EXPLAIN VERBOSE SELECT 1`, `ALTER TABLE t ALTER COLUMN x SET DEFAULT 1`,
and `COMMENT ON TABLE t IS 'text'`. Also, `E'...'`, `N'...'`, and `U&'...'` produced no DashQL parser
diagnostic in the probes, so they are not included as rejection findings; that says nothing about
whether DashQL builds the right tree or decodes their values correctly.
