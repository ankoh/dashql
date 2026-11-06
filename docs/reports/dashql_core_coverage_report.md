# DashQL Core Coverage Report

Date: 2026-11-05

Line coverage of the Rust core (`dashql-core`, `dashql-core-session`, `dashql-core-shell`, `dashql-core-profile`, `dashql-dataflow`, `dashql-parser`) from the `bazel coverage` run of the unit, snapshot and parser tests of these crates and `dashql-snapshots` (generated `tables.rs` and `keywords/table.rs` excluded).

**Overall: 96.5% (24,497 / 25,397 lines)**, up from 96.2% in the report of 2026-11-04 (24,395 / 25,363 lines). A fresh run before the new tests measured 96.20% (24,399 / 25,364 lines). The line count grew because the inline test modules of `progress/trino.rs` and `planner.rs` count as `src/` lines, and it shrank by the 29 lines of the removed dead helpers.

Changes since the previous report:

- Parser: `LIMIT n FOR UPDATE` (the locking clause after the limit) wrapped the locking clauses in a second array, and the formatter printed the placeholder `'<ARRAY>'` for it. `sql_opt_for_locking_clause` now passes the clauses through, as PostgreSQL's `opt_for_locking_clause` does. The tree equals the one of `FOR UPDATE LIMIT n` (parser case `select_row_locking_8`, formatter cases `row_locking_after_limit` and `select_set_operation_limit_all_locking`).
- `progress/trino.rs` 95% → 99%: Trino durations in minutes, hours and days, data sizes in GB, TB and PB, unknown units, canceled and aborted stages.
- `session_inputs.rs` 92% → 98%: an input cast to two types gets a warning, positional parameters are no inputs. The dataflow snapshot encodes the warnings of an input (`InputCastToTwoTypes`).
- `visualize/mod.rs` 82% → 100%: packing Markdown visualizations (`pack_test.rs`).
- `compiler.rs` 89% → 90%: edits within obfuscated literals are dropped, visualizations without a renderer, with an unknown renderer, and Markdown without a row template.
- `planner.rs` 97% → 98%: duplicate scripts and attachments, analyses of an older catalog revision (rejected, a tolerant plan takes them).
- `script_session.rs` 94.6% → 95.1%: a cursor on `alias.*` is a column reference without an expression.
- `dashql-core-shell/src/session.rs`: function completions insert `()`.
- Removed dead code: `OrderedMap::{get, contains, len, is_empty}` (`analyzer/types.rs` 84% → 97%), `CatalogObjectRef::object_type`, `From<CatalogTableId> for TableLoc` (`catalog/entry.rs` 93% → 99%), `SchemaDeclaration::database_id`.

Unreachable branches found on the way, kept for now:

- `cursor.rs` `read_cursor_name_path`: the `Star` and `Index` components. `t.*` is no column ref (the cursor recovers an `AliasDot` context), and `a[1]` puts no subscript into the name of a column ref.
- `formatter/select.rs`: `select distinct` without targets. `DISTINCT` needs a target list in the grammar, as in PostgreSQL.

## Per-file coverage

| File | Lines | Coverage |
|---|---|---|
| dashql-core-profile/src/tests_progress.rs | 240/240 | 100.0% |
| dashql-core-profile/src/tests_trino.rs | 140/140 | 100.0% |
| dashql-core-session/src/visualize/markdown/tests.rs | 96/96 | 100.0% |
| dashql-core-session/src/visualize/mod.rs | 28/28 | 100.0% |
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
| dashql-core-profile/src/progress/trino.rs | 262/264 | 99.2% |
| dashql-core/src/script.rs | 330/333 | 99.1% |
| dashql-core/src/catalog/entry.rs | 215/217 | 99.1% |
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
| dashql-core-session/src/planner.rs | 929/950 | 97.8% |
| dashql-core-shell/src/session.rs | 1,447/1,481 | 97.7% |
| dashql-parser/src/parser/actions.rs | 123/126 | 97.6% |
| dashql-core/src/analyzer/state.rs | 284/291 | 97.6% |
| dashql-core-session/src/session_inputs.rs | 81/83 | 97.6% |
| dashql-dataflow/src/ortho_router/tests.rs | 237/243 | 97.5% |
| dashql-core/src/formatter/comments.rs | 430/441 | 97.5% |
| dashql-core/src/analyzer/types.rs | 71/73 | 97.3% |
| dashql-core/src/catalog/mod.rs | 625/643 | 97.2% |
| dashql-core-profile/src/trino_plan_parser.rs | 173/178 | 97.2% |
| dashql-core/src/completion.rs | 1,205/1,240 | 97.2% |
| dashql-core/src/analyzer/constants.rs | 136/140 | 97.1% |
| dashql-parser/src/keywords.rs | 61/63 | 96.8% |
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
| dashql-core-session/src/script_session.rs | 835/878 | 95.1% |
| dashql-core/src/utils/topk.rs | 55/58 | 94.8% |
| dashql-parser/src/scanner.rs | 413/436 | 94.7% |
| dashql-core/src/analyzer/function_calls.rs | 63/67 | 94.0% |
| dashql-core-shell/src/session_relations.rs | 31/33 | 93.9% |
| dashql-parser/src/parser/probe.rs | 200/213 | 93.9% |
| dashql-core/src/analyzer/sql_types.rs | 173/186 | 93.0% |
| dashql-core/src/formatter/mod.rs | 2,111/2,293 | 92.1% |
| dashql-core/src/formatter/select.rs | 188/205 | 91.7% |
| dashql-core/src/formatter/delete.rs | 20/22 | 90.9% |
| dashql-core/src/completion_vis.rs | 248/273 | 90.8% |
| dashql-core-session/src/compiler.rs | 165/184 | 89.7% |
| dashql-core/src/formatter/explain.rs | 26/29 | 89.7% |
| dashql-parser/src/lib.rs | 43/48 | 89.6% |
| dashql-parser/src/parser/driver.rs | 212/238 | 89.1% |
| dashql-parser/src/parser/enums.rs | 40/45 | 88.9% |
| dashql-core/src/formatter/insert.rs | 44/50 | 88.0% |
| dashql-core-shell/src/lib.rs | 14/16 | 87.5% |
| dashql-core/src/analyzer/mod.rs | 64/74 | 86.5% |
| dashql-dataflow/src/ortho_router/geom.rs | 59/71 | 83.1% |
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
| dashql-core/src/formatter/mod.rs | 182 | Mostly unreachable `format_unimplemented` fallbacks |
| dashql-core-session/src/script_session.rs | 43 | Analysis failures of a session, non-boundary cursors, diagnostics without spans |
| dashql-core/src/completion.rs | 35 | Dot candidates of the same object, cursor positions at the begin of a dot, unresolved derived columns |
| dashql-core-shell/src/session.rs | 34 | Overlay scrolling past the window, failed completion applications |
| dashql-parser/src/parser/mod.rs | 34 | Error recovery and expected-symbol corners |
| dashql-core/src/pack.rs | 32 | Cursor contexts without a scanner symbol, column candidate objects |
| dashql-core/src/analyzer/name_resolution.rs | 29 | Defensive branches |
| dashql-parser/src/parser/driver.rs | 26 | LR error recovery corners |
| dashql-core/src/completion_vis.rs | 25 | Whitespace and word ends while scanning tag args and Vega-Lite tokens, cursor positions without a token |
| dashql-core/src/script_diff.rs | 23 | Spans past the end of the text (EOF errors), coalescing of overlapping changes, enum value changes |
| dashql-parser/src/scanner.rs | 23 | `special_character` entries no operator run can be trimmed to (`,`, brackets, `;`), so unreachable |
| dashql-core-session/src/planner.rs | 21 | Barriers the analyzer never triggers (table refs without a relation, incompatible view kinds), visualization errors |

## Rust tools

Line coverage of the unit tests of the command line tool and the native tools, not counted in the overall number above.
The numbers count production code only, without test files and `#[cfg(test)]` modules, which would otherwise count as
covered. The end-to-end tests of `dashql-cli` run the binary in a subprocess and add nothing here, so its number is a lower
bound.

| Package | Lines | Coverage |
|---|---|---|
| dashql-cli | 2,002/2,344 | 85.4%, up from 82.8% |
| dashql-native-proxy | 1,064/1,132 | 94.0%, up from 18.4% |
| dashql-pack | 581/621 | 93.6%, up from about 20% |

The tests of `dashql-pack` drive `vacuum` and `publish` against an S3 server in memory (`src/test_s3.rs`). The tests of
`dashql-native-proxy` go through `route_proxy_request`, against the gRPC mock and an HTTP server they answer by hand.

Largest gaps:

| File | Uncovered | Coverage |
|---|---|---|
| dashql-cli/src/agent/server.rs | 115 | 87.6% |
| dashql-cli/src/main.rs | 110 | 0.0% |
| dashql-cli/src/agent/harness.rs | 39 | 88.0% |
| dashql-cli/src/agent/client.rs | 23 | 89.9% |
| dashql-native-proxy/src/http_stream_manager.rs | 22 | 88.0% |
| dashql-pack/src/main.rs | 17 | 22.7% |
| dashql-native-proxy/src/grpc_proxy.rs | 15 | 93.0% |

TLS connections of `dashql-native-proxy` are only tested up to their failures, a successful handshake needs a certificate
that the tests don't have.

Bugs found by these tests in `dashql-native-proxy`:

- Deleting a stream did not stop the request. The reader task held both ends of the queue of the stream, so it kept the
  call open until the remote ended it or, for HTTP, until the read timeout. With a full queue it waited forever. The server
  was not told to stop, deleting the stream now cancels the call.
- A gRPC error message with a line break or a non-ASCII character panicked while the error response was built
  (`dashql-grpc-message`), so the request failed without its error. The message is now percent-encoded like the
  `grpc-message` trailer, the app decodes it.
- A remote could replace the `dashql-` headers of the proxy with its response headers or trailers, e.g.
  `dashql-batch-event: StreamFinished` ended a read early.
- A read timeout after the headers of a response and before its body lost the status and the headers for good.
- Only the last value of a repeated response header arrived, e.g. of `Set-Cookie`.
- Binary initial metadata of a gRPC call was forwarded raw instead of base64-encoded like binary trailers, and dropped when
  it held control characters.

Bug found by these tests in `dashql-cli`:

- `dashql lint <dir>` followed symlinks without a guard. A link back to a parent directory repeated the scripts on every
  level, until the kernel gave up after 40 links, and two such links in a directory never finished. Links back into a
  directory that is being searched are now skipped.

## Known issues

- `^` is the exponentiation of Hyper and PostgreSQL, but its parse tree operator is `XOR` (`ExpressionOperator::XOR`, `BinaryExpressionFunction::XOR`). The formatter prints it as `^` again; the name is wrong in the FlatBuffers schema.
- Constant `AND`/`OR` gets `BinaryExpressionFunction::UNKNOWN` (`binary_function` in `dashql-core/src/analyzer/constants.rs`); `BinaryExpressionFunction` has no such value, so a fix changes the FlatBuffers schema (`proto/fb/dashql/algebra_expressions.fbs`).
- Completion inside `LATERAL (...)` resolves to the outer table reference (`OBJECT_SQL_TABLEREF`, strategy `DEFAULT`), so sibling visibility cannot be tested there.
- Comments between statements are not stable on a second formatting pass: the trailing comment of a statement moves behind the blank line, to the next statement.
- `exclude` in window frames has no grammar rule (`sql_opt_frame_clause` in `grammar/rules/sql_select.y`); `somefunc(default)` prints the placeholder `'<OBJECT_SQL_NARY_EXPRESSION>'`.
- Identical duplicate statements always diff as `MOVE` (intended ambiguity handling).
- Generic type names have no qualified form (`sql_generic_type` in `grammar/rules/sql_select.y` takes one `sql_type_function_name`), so `cast(x as pg_catalog.int4)` is a syntax error. PostgreSQL's `GenericType` takes `type_function_name attrs`. `type_name` in `analyzer/sql_types.rs` already reads a name path, but the grammar never builds one. Adding it accepts new SQL and needs the write-up of `docs/design/core_parser.md` first.

## Suggested actions

1. Remove unreachable `format_unimplemented` fallbacks or turn them into `unreachable!`, so formatter coverage reflects reachable code. Error-recovered parse trees reach some of them, check those first.
2. Add error-recovery inputs for `parser/mod.rs`, `driver.rs` and `value.rs`.
3. Decide on qualified generic type names in the grammar (see known issues).
4. Remove the unreachable `Star` and `Index` name components of `read_cursor_name_path` and the `select distinct` branch without targets, or document why they stay.
