# DashQL Core Coverage Report

Date: 2026-11-01

Line coverage of the Rust core (`dashql-core`, `dashql-core-session`, `dashql-core-shell`, `dashql-core-view`, `dashql-parser`) from the `bazel coverage` run of the unit, snapshot and parser tests of these crates and `dashql-snapshots` (generated `tables.rs` and `keywords/table.rs` excluded).

**Overall: 95.2% (20,901 / 21,959 lines)**, the same rate as the previous report of 2026-10-21 (95.2%, 18,740 / 19,679 lines), which covered only `dashql-core` and `dashql-parser` before the session, shell and view crates were split off.

## Per-file coverage

| File | Lines | Coverage |
|---|---|---|
| dashql-core-session/src/visualize/markdown/tests.rs | 96/96 | 100.0% |
| dashql-core-session/src/visualize/tests.rs | 43/43 | 100.0% |
| dashql-core-session/src/visualize/vegalite_generator.rs | 11/11 | 100.0% |
| dashql-core-shell/src/unicode.rs | 27/27 | 100.0% |
| dashql-core-shell/src/vt100.rs | 10/10 | 100.0% |
| dashql-core/src/analyzer/parameters.rs | 27/27 | 100.0% |
| dashql-core/src/catalog/ids.rs | 83/83 | 100.0% |
| dashql-core/src/catalog/names.rs | 38/38 | 100.0% |
| dashql-core/src/error.rs | 47/47 | 100.0% |
| dashql-core/src/hash.rs | 33/33 | 100.0% |
| dashql-core/src/signature.rs | 58/58 | 100.0% |
| dashql-core/src/utils/rope.rs | 74/74 | 100.0% |
| dashql-core-view/src/tests.rs | 460/461 | 99.8% |
| dashql-core-shell/src/prompt_buffer.rs | 311/312 | 99.7% |
| dashql-core-view/src/dataflow_layout.rs | 422/424 | 99.5% |
| dashql-core-session/src/catalog_changes.rs | 153/154 | 99.4% |
| dashql-core/src/compact_json.rs | 88/89 | 98.9% |
| dashql-core-view/src/plan_layout.rs | 262/265 | 98.9% |
| dashql-core/src/catalog/changes.rs | 79/80 | 98.8% |
| dashql-parser/src/comment_blocks.rs | 385/390 | 98.7% |
| dashql-core/src/vis_text.rs | 213/216 | 98.6% |
| dashql-core/src/vis_highlight.rs | 237/241 | 98.3% |
| dashql-core/src/annotation.rs | 288/293 | 98.3% |
| dashql-core-shell/src/arrow_renderer.rs | 336/343 | 98.0% |
| dashql-core/src/catalog/descriptor.rs | 277/283 | 97.9% |
| dashql-core/src/vis_rewrite.rs | 137/140 | 97.9% |
| dashql-core-session/src/visualize/markdown/mod.rs | 225/230 | 97.8% |
| dashql-core/src/analyzer/name_resolution.rs | 1,301/1,330 | 97.8% |
| dashql-core/src/utils/mod.rs | 42/43 | 97.7% |
| dashql-core-view/src/plan_view_model.rs | 247/253 | 97.6% |
| dashql-parser/src/parser/actions.rs | 123/126 | 97.6% |
| dashql-core/src/analyzer/state.rs | 281/288 | 97.6% |
| dashql-core-view/src/hyper_plan_parser.rs | 336/345 | 97.4% |
| dashql-core/src/formatter/comments.rs | 388/399 | 97.2% |
| dashql-core/src/analyzer/constants.rs | 136/140 | 97.1% |
| dashql-core-session/src/planner.rs | 915/944 | 96.9% |
| dashql-parser/src/keywords.rs | 61/63 | 96.8% |
| dashql-core/src/catalog/mod.rs | 625/646 | 96.7% |
| dashql-core-session/src/dataflow.rs | 113/117 | 96.6% |
| dashql-core/src/formatter/pgq.rs | 223/231 | 96.5% |
| dashql-parser/src/parser/context.rs | 364/378 | 96.3% |
| dashql-core/src/formatter/program.rs | 519/539 | 96.3% |
| dashql-core/src/completion.rs | 1,185/1,236 | 95.9% |
| dashql-core/src/cursor.rs | 283/296 | 95.6% |
| dashql-core/src/formatter/create.rs | 172/180 | 95.6% |
| dashql-parser/src/names.rs | 86/90 | 95.6% |
| dashql-core/src/script_diff.rs | 479/502 | 95.4% |
| dashql-core-session/src/batch.rs | 103/108 | 95.4% |
| dashql-core-shell/src/session.rs | 1,434/1,508 | 95.1% |
| dashql-core/src/script.rs | 297/313 | 94.9% |
| dashql-core/src/utils/topk.rs | 55/58 | 94.8% |
| dashql-parser/src/scanner.rs | 412/435 | 94.7% |
| dashql-core/src/pack.rs | 674/713 | 94.5% |
| dashql-core/src/analyzer/vis_tags.rs | 336/356 | 94.4% |
| dashql-core/src/analyzer/function_calls.rs | 63/67 | 94.0% |
| dashql-core-shell/src/session_relations.rs | 31/33 | 93.9% |
| dashql-parser/src/parser/probe.rs | 200/213 | 93.9% |
| dashql-core-session/src/script_references.rs | 458/488 | 93.9% |
| dashql-core/src/script_results.rs | 103/110 | 93.6% |
| dashql-core/src/formatter/mod.rs | 2,097/2,280 | 92.0% |
| dashql-core-session/src/script_session.rs | 795/872 | 91.2% |
| dashql-core/src/formatter/delete.rs | 20/22 | 90.9% |
| dashql-core/src/formatter/explain.rs | 26/29 | 89.7% |
| dashql-parser/src/lib.rs | 43/48 | 89.6% |
| dashql-core/src/formatter/select.rs | 183/205 | 89.3% |
| dashql-parser/src/parser/driver.rs | 212/238 | 89.1% |
| dashql-parser/src/parser/enums.rs | 40/45 | 88.9% |
| dashql-core-session/src/compiler.rs | 163/184 | 88.6% |
| dashql-core/src/formatter/insert.rs | 44/50 | 88.0% |
| dashql-core/src/catalog/entry.rs | 203/231 | 87.9% |
| dashql-core-shell/src/lib.rs | 14/16 | 87.5% |
| dashql-core/src/completion_vis.rs | 232/268 | 86.6% |
| dashql-core/src/analyzer/mod.rs | 62/72 | 86.1% |
| dashql-core/src/analyzer/types.rs | 71/85 | 83.5% |
| dashql-core-session/src/visualize/mod.rs | 23/28 | 82.1% |
| dashql-parser/src/parser/mod.rs | 137/171 | 80.1% |
| dashql-parser/src/span.rs | 11/14 | 78.6% |
| dashql-parser/src/attributes.rs | 34/47 | 72.3% |
| dashql-parser/src/parser/value.rs | 26/38 | 68.4% |
| dashql-core-session/src/lib.rs | 0/0 | 0.0% |
| dashql-core-view/src/lib.rs | 0/0 | 0.0% |
| dashql-core-view/src/tests_tpch.rs | 0/0 | 0.0% |
| dashql-core/src/lib.rs | 0/0 | 0.0% |

## Top offenders (most uncovered lines)

| File | Uncovered | Notes |
|---|---|---|
| dashql-core/src/formatter/mod.rs | 183 | Mostly unreachable `format_unimplemented` fallbacks; reachable: `O::XOR`, `O::NOT_GLOB` |
| dashql-core-session/src/script_session.rs | 77 | Annotation and `@vis` rewrite entry points, rare selection and diff branches |
| dashql-core-shell/src/session.rs | 74 | Default messages of error status codes (`exception_message`) and rare effect paths |
| dashql-core/src/completion.rs | 51 | Columns of derived tables, merging of dot candidates into existing candidates |
| dashql-core/src/pack.rs | 39 | Packing of parameters and of column candidate objects |
| dashql-core/src/completion_vis.rs | 36 | Vega-Lite keys and values of `@vis` tags (scale, axis, legend) |
| dashql-parser/src/parser/mod.rs | 34 | Error recovery and expected-symbol corners |
| dashql-core-session/src/script_references.rs | 30 | Parenthesized queries with quotes and comments (`inside_parentheses`) |
| dashql-core-session/src/planner.rs | 29 | Planner error paths (failing visualizations, empty `EXPLAIN`) |
| dashql-core/src/analyzer/name_resolution.rs | 29 | Defensive branches |
| dashql-core/src/catalog/entry.rs | 28 | Equality checks of catalog entries (`same_function`) and id conversions |
| dashql-parser/src/parser/driver.rs | 26 | LR error recovery corners |

## Known issues

- Constant `AND`/`OR` gets `BinaryExpressionFunction::UNKNOWN` (`binary_function` in `dashql-core/src/analyzer/constants.rs`); `BinaryExpressionFunction` has no such value, so a fix changes the FlatBuffers schema (`proto/fb/dashql/algebra_expressions.fbs`).
- Completion inside `LATERAL (...)` resolves to the outer table reference (`OBJECT_SQL_TABLEREF`, strategy `DEFAULT`), so sibling visibility cannot be tested there.
- Comments between statements are not stable on a second formatting pass: the trailing comment of a statement moves behind the blank line, to the next statement.
- `exclude` in window frames has no grammar rule (`sql_opt_frame_clause` in `grammar/rules/sql_select.y`); `somefunc(default)` prints the placeholder `'<OBJECT_SQL_NARY_EXPRESSION>'`.
- Identical duplicate statements always diff as `MOVE` (intended ambiguity handling).

## Suggested actions

1. Cover `O::XOR` and `O::NOT_GLOB` with formatter snapshots.
2. Remove unreachable `format_unimplemented` fallbacks or turn them into `unreachable!`, so formatter coverage reflects reachable code.
3. Add session tests for the annotation and `@vis` rewrites of `script_session.rs` and for the error status messages of the shell session.
4. Add completion snapshots for derived-table columns and the scale, axis and legend keys of `@vis` tags, and packing tests for parameters.
5. Add error-recovery inputs for `parser/mod.rs`, `driver.rs` and `value.rs`.
