# DashQL Core Coverage Report

Date: 2026-11-04

Line coverage of the Rust core (`dashql-core`, `dashql-core-session`, `dashql-core-shell`, `dashql-core-profile`, `dashql-dataflow`, `dashql-parser`) from the `bazel coverage` run of the unit, snapshot and parser tests of these crates and `dashql-snapshots` (generated `tables.rs` and `keywords/table.rs` excluded).

**Overall: 96.2% (24,395 / 25,363 lines)**, up from 95.2% in the report of 2026-11-01 (20,901 / 21,959 lines). That report did not instrument `dashql-core-profile`: the instrumentation filter still named `dashql-core-view`, the crate's former name. This report adds it and `dashql-dataflow` (98.0%, 4,019 / 4,099 lines). Over the same crates, the tests before the new ones measured 94.9% (24,082 / 25,369 lines).

New tests since the previous report:

- `sql_types.rs` 76% → 93%: type names and their SQL text, packing of SQL types and parameters (`tests/sql_types_test.rs`).
- `pack.rs` 88% → 96%: parameters and their cast types.
- `script.rs` 91% → 99%, `script_session.rs` 91% → 95%: annotation, `@vis`, `@flow` and `@param` rewrites, flow positions, sessions with allocated entry ids.
- `dashql-core-shell/src/session.rs` 95% → 98%: the copy of the core status messages was removed (`Error::what`), tests of escaped completion hints and of Tab with a single candidate.
- `completion.rs` 96% → 97%: columns of CTEs and derived tables after a recovered `alias.`, a schema and a database of the same name after a dot (their merged candidate now keeps both name tags).
- `analyzer/vis_tags.rs` 93% → 98%: Vega-Lite tags without a spec or with a spec that is no object, unknown fields of many columns and of set operations, `as` arrays, `@flow` without args, negative board columns; the unused `vis_renderer_tag` was removed.
- `script_references.rs` 95% → 99%: parentheses around queries, in quotes and comments (`inside_parentheses`).
- `completion_vis.rs` 87% → 91%: completion snapshots of nested layer specs, mark definitions, aggregates, time units, scales, axes, legends, tooltip arrays and `groupby`.
- `sql_literal.rs` 93% → 99%, `table_parameters.rs` 89% → 99%, `catalog/entry.rs` 88% → 93% (republished function declarations).

## Per-file coverage

| File | Lines | Coverage |
|---|---|---|
| dashql-core-profile/src/tests_progress.rs | 240/240 | 100.0% |
| dashql-core-profile/src/tests_trino.rs | 140/140 | 100.0% |
| dashql-core-session/src/visualize/markdown/tests.rs | 96/96 | 100.0% |
| dashql-core-session/src/visualize/tests.rs | 43/43 | 100.0% |
| dashql-core-session/src/visualize/vegalite_generator.rs | 11/11 | 100.0% |
| dashql-core-shell/src/unicode.rs | 27/27 | 100.0% |
| dashql-core-shell/src/vt100.rs | 10/10 | 100.0% |
| dashql-core/src/analyzer/manual_tag.rs | 7/7 | 100.0% |
| dashql-core/src/analyzer/parameters.rs | 39/39 | 100.0% |
| dashql-core/src/catalog/ids.rs | 83/83 | 100.0% |
| dashql-core/src/catalog/names.rs | 38/38 | 100.0% |
| dashql-core/src/error.rs | 47/47 | 100.0% |
| dashql-core/src/hash.rs | 33/33 | 100.0% |
| dashql-core/src/param_rewrite.rs | 48/48 | 100.0% |
| dashql-core/src/signature.rs | 58/58 | 100.0% |
| dashql-core/src/utils/rope.rs | 74/74 | 100.0% |
| dashql-dataflow/src/routing.rs | 38/38 | 100.0% |
| dashql-core-profile/src/tests.rs | 575/576 | 99.8% |
| dashql-core-shell/src/prompt_buffer.rs | 311/312 | 99.7% |
| dashql-core-session/src/catalog_changes.rs | 149/150 | 99.3% |
| dashql-core/src/table_parameters.rs | 148/149 | 99.3% |
| dashql-core/src/script.rs | 330/333 | 99.1% |
| dashql-core-profile/src/profile_layout.rs | 305/308 | 99.0% |
| dashql-core-session/src/script_references.rs | 580/586 | 99.0% |
| dashql-core/src/compact_json.rs | 88/89 | 98.9% |
| dashql-core/src/sql_literal.rs | 261/264 | 98.9% |
| dashql-core/src/catalog/changes.rs | 79/80 | 98.8% |
| dashql-parser/src/comment_blocks.rs | 448/454 | 98.7% |
| dashql-core/src/vis_text.rs | 213/216 | 98.6% |
| dashql-dataflow/src/ortho_router/nudge.rs | 131/133 | 98.5% |
| dashql-core/src/annotation.rs | 327/332 | 98.5% |
| dashql-core/src/vis_rewrite.rs | 127/129 | 98.4% |
| dashql-dataflow/src/ortho_router/grid.rs | 189/192 | 98.4% |
| dashql-core/src/analyzer/vis_tags.rs | 367/373 | 98.4% |
| dashql-core-profile/src/progress/mod.rs | 244/248 | 98.4% |
| dashql-core-profile/src/progress/rollup.rs | 119/121 | 98.3% |
| dashql-core/src/utils/mod.rs | 58/59 | 98.3% |
| dashql-core-session/src/dataflow.rs | 115/117 | 98.3% |
| dashql-core-profile/src/hyper_plan_parser.rs | 379/386 | 98.2% |
| dashql-core-profile/src/query_profile.rs | 318/324 | 98.1% |
| dashql-core-shell/src/arrow_renderer.rs | 336/343 | 98.0% |
| dashql-core/src/vis_highlight.rs | 237/242 | 97.9% |
| dashql-dataflow/src/layout.rs | 509/520 | 97.9% |
| dashql-core/src/catalog/descriptor.rs | 277/283 | 97.9% |
| dashql-core-session/src/visualize/markdown/mod.rs | 225/230 | 97.8% |
| dashql-core/src/analyzer/name_resolution.rs | 1,301/1,330 | 97.8% |
| dashql-core-shell/src/session.rs | 1,446/1,481 | 97.6% |
| dashql-parser/src/parser/actions.rs | 123/126 | 97.6% |
| dashql-core/src/analyzer/state.rs | 284/291 | 97.6% |
| dashql-dataflow/src/ortho_router/tests.rs | 237/243 | 97.5% |
| dashql-core/src/formatter/comments.rs | 430/441 | 97.5% |
| dashql-core-session/src/planner.rs | 898/923 | 97.3% |
| dashql-core-profile/src/trino_plan_parser.rs | 173/178 | 97.2% |
| dashql-core/src/completion.rs | 1,205/1,240 | 97.2% |
| dashql-core/src/analyzer/constants.rs | 136/140 | 97.1% |
| dashql-parser/src/keywords.rs | 61/63 | 96.8% |
| dashql-core/src/catalog/mod.rs | 625/646 | 96.7% |
| dashql-core/src/formatter/pgq.rs | 223/231 | 96.5% |
| dashql-core/src/analyzer/param_tags.rs | 81/84 | 96.4% |
| dashql-parser/src/parser/context.rs | 364/378 | 96.3% |
| dashql-core/src/formatter/program.rs | 519/539 | 96.3% |
| dashql-dataflow/src/ortho_router/mod.rs | 146/152 | 96.1% |
| dashql-core/src/pack.rs | 733/765 | 95.8% |
| dashql-core/src/cursor.rs | 283/296 | 95.6% |
| dashql-core/src/formatter/create.rs | 172/180 | 95.6% |
| dashql-parser/src/names.rs | 86/90 | 95.6% |
| dashql-core/src/script_diff.rs | 479/502 | 95.4% |
| dashql-core-session/src/batch.rs | 103/108 | 95.4% |
| dashql-core/src/utils/topk.rs | 55/58 | 94.8% |
| dashql-core-profile/src/progress/trino.rs | 217/229 | 94.8% |
| dashql-parser/src/scanner.rs | 412/435 | 94.7% |
| dashql-core-session/src/script_session.rs | 831/878 | 94.6% |
| dashql-core/src/analyzer/function_calls.rs | 63/67 | 94.0% |
| dashql-core-shell/src/session_relations.rs | 31/33 | 93.9% |
| dashql-parser/src/parser/probe.rs | 200/213 | 93.9% |
| dashql-core/src/catalog/entry.rs | 215/231 | 93.1% |
| dashql-core/src/analyzer/sql_types.rs | 173/186 | 93.0% |
| dashql-core/src/formatter/mod.rs | 2,108/2,293 | 91.9% |
| dashql-core-session/src/session_inputs.rs | 76/83 | 91.6% |
| dashql-core/src/formatter/delete.rs | 20/22 | 90.9% |
| dashql-core/src/completion_vis.rs | 248/273 | 90.8% |
| dashql-core/src/formatter/explain.rs | 26/29 | 89.7% |
| dashql-parser/src/lib.rs | 43/48 | 89.6% |
| dashql-core/src/formatter/select.rs | 183/205 | 89.3% |
| dashql-parser/src/parser/driver.rs | 212/238 | 89.1% |
| dashql-parser/src/parser/enums.rs | 40/45 | 88.9% |
| dashql-core-session/src/compiler.rs | 163/184 | 88.6% |
| dashql-core/src/formatter/insert.rs | 44/50 | 88.0% |
| dashql-core-shell/src/lib.rs | 14/16 | 87.5% |
| dashql-core/src/analyzer/mod.rs | 64/74 | 86.5% |
| dashql-core/src/analyzer/types.rs | 71/85 | 83.5% |
| dashql-dataflow/src/ortho_router/geom.rs | 59/71 | 83.1% |
| dashql-core-session/src/visualize/mod.rs | 23/28 | 82.1% |
| dashql-parser/src/parser/mod.rs | 148/182 | 81.3% |
| dashql-parser/src/span.rs | 11/14 | 78.6% |
| dashql-parser/src/attributes.rs | 34/47 | 72.3% |
| dashql-parser/src/parser/value.rs | 26/38 | 68.4% |
| dashql-core-profile/src/lib.rs | 0/0 | 0.0% |
| dashql-core-profile/src/tests_tpch.rs | 0/0 | 0.0% |
| dashql-core-session/src/lib.rs | 0/0 | 0.0% |
| dashql-core/src/lib.rs | 0/0 | 0.0% |
| dashql-dataflow/src/lib.rs | 0/0 | 0.0% |

## Top offenders (most uncovered lines)

| File | Uncovered | Notes |
|---|---|---|
| dashql-core/src/formatter/mod.rs | 185 | Mostly unreachable `format_unimplemented` fallbacks; `O::NOT_GLOB` cannot be parsed (no `NOT GLOB` rule) |
| dashql-core-session/src/script_session.rs | 47 | Rare selection, diagnostic and cursor-context branches (`AliasDot`, non-boundary cursors) |
| dashql-core-shell/src/session.rs | 35 | Overlay scrolling past the window, failed completion applications |
| dashql-core/src/completion.rs | 35 | Dot candidates of the same object, cursor positions at the begin of a dot, unresolved derived columns |
| dashql-parser/src/parser/mod.rs | 34 | Error recovery and expected-symbol corners |
| dashql-core/src/pack.rs | 32 | Cursor contexts without a scanner symbol, column candidate objects |
| dashql-core/src/analyzer/name_resolution.rs | 29 | Defensive branches |
| dashql-parser/src/parser/driver.rs | 26 | LR error recovery corners |
| dashql-core-session/src/planner.rs | 25 | Planner error paths (failing visualizations, empty `EXPLAIN`) |
| dashql-core/src/completion_vis.rs | 25 | Whitespace and word ends while scanning tag args and Vega-Lite tokens, cursor positions without a token |
| dashql-core/src/script_diff.rs | 23 | Spans past the end of the text (EOF errors), coalescing of overlapping changes, enum value changes |
| dashql-parser/src/scanner.rs | 23 | `special_character` entries no operator run can be trimmed to (`,`, brackets, `;`), so unreachable |

## Known issues

- `PRIMARY KEY USING INDEX` builds a `UNIQUE` constraint (`TableConstraint::UNIQUE` in `sql_table_constraint_elem`, `grammar/rules/sql_create.y`), so it formats as `unique using index`. The fix changes the parse tree (see `docs/design/core_parser.md`).
- `^` is the exponentiation of Hyper and PostgreSQL, but its parse tree operator is `XOR` (`ExpressionOperator::XOR`, `BinaryExpressionFunction::XOR`). The formatter prints it as `^` again; the name is wrong in the FlatBuffers schema.
- `a NOT GLOB b` does not parse: the scanner makes no `NOT_LA` before `GLOB`, so `ExpressionOperator::NOT_GLOB` is never produced.
- Constant `AND`/`OR` gets `BinaryExpressionFunction::UNKNOWN` (`binary_function` in `dashql-core/src/analyzer/constants.rs`); `BinaryExpressionFunction` has no such value, so a fix changes the FlatBuffers schema (`proto/fb/dashql/algebra_expressions.fbs`).
- Completion inside `LATERAL (...)` resolves to the outer table reference (`OBJECT_SQL_TABLEREF`, strategy `DEFAULT`), so sibling visibility cannot be tested there.
- Comments between statements are not stable on a second formatting pass: the trailing comment of a statement moves behind the blank line, to the next statement.
- `exclude` in window frames has no grammar rule (`sql_opt_frame_clause` in `grammar/rules/sql_select.y`); `somefunc(default)` prints the placeholder `'<OBJECT_SQL_NARY_EXPRESSION>'`.
- Identical duplicate statements always diff as `MOVE` (intended ambiguity handling).

## Suggested actions

1. Remove unreachable `format_unimplemented` fallbacks or turn them into `unreachable!`, so formatter coverage reflects reachable code.
2. Decide the parse tree fix of `PRIMARY KEY USING INDEX`, and whether `NOT GLOB` should parse.
3. Add error-recovery inputs for `parser/mod.rs`, `driver.rs` and `value.rs`.
