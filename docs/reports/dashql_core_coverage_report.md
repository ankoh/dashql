# DashQL Core Coverage Report

Date: 2026-11-09

Line coverage of the Rust core (`dashql-core`, `dashql-core-session`, `dashql-core-shell`, `dashql-core-profile`, `dashql-dataflow`, `dashql-parser`) from the `bazel coverage` run of the unit, snapshot and parser tests of these crates and `dashql-snapshots` (generated `tables.rs` and `keywords/table.rs` excluded).

**Overall: 96.4% (25,594 / 26,555 lines)**, down from 96.5% in the report of 2026-11-05 (24,497 / 25,397 lines). The core grew by about 1,160 lines, and the new code is covered a little less than the rest.

Changes since the previous report:

- `dashql-core-shell`: the Arrow renderer is gone (`arrow_renderer.rs`, 336/343 lines), results of the shell only show in the overlay of the app. The crate is at 98.1% (1,734 / 1,767 lines).
- Client functions are new: `analyzer/clfn_calls.rs` 94.1%, `catalog/clfn.rs` and `completion_clfn.rs`. Part of their gaps are tested through the Wasm bindings, see below.
- `catalog/mod.rs` grew from 643 to 765 lines and went from 97.2% to 96.3%, `pack.rs` from 765 to 852 lines at 95.9%.
- `touched_relations.rs` replaces `catalog_changes.rs`, `catalog/changes.rs` and `session_relations.rs`.

This report only sees the Rust tests. Functions that only the Wasm bindings call, and the tests of `dashql-core-js` and the app reach, count as uncovered here: `starts_client_function_call`, `Catalog::absent_relations`, `Catalog::descriptor_bytes` and `Catalog::drop_client_functions`. They are not dead code.

Unreachable branches found on the way, kept for now:

- `cursor.rs` `read_cursor_name_path`: the `Star` and `Index` components. `t.*` is no column ref (the cursor recovers an `AliasDot` context), and `a[1]` puts no subscript into the name of a column ref.
- `formatter/select.rs`: `select distinct` without targets. `DISTINCT` needs a target list in the grammar, as in PostgreSQL.

## Per-file coverage

| File | Lines | Coverage |
|---|---|---|
| dashql-core-profile/src/tests_progress.rs | 240/240 | 100.0% |
| dashql-core-profile/src/tests_trino.rs | 140/140 | 100.0% |
| dashql-core-session/src/visualize/markdown/tests.rs | 96/96 | 100.0% |
| dashql-core/src/catalog/ids.rs | 83/83 | 100.0% |
| dashql-core/src/utils/rope.rs | 74/74 | 100.0% |
| dashql-core/src/signature.rs | 58/58 | 100.0% |
| dashql-core/src/param_rewrite.rs | 48/48 | 100.0% |
| dashql-core/src/error.rs | 47/47 | 100.0% |
| dashql-core-session/src/visualize/tests.rs | 43/43 | 100.0% |
| dashql-core/src/analyzer/parameters.rs | 39/39 | 100.0% |
| dashql-core/src/catalog/names.rs | 38/38 | 100.0% |
| dashql-dataflow/src/routing.rs | 38/38 | 100.0% |
| dashql-core/src/hash.rs | 33/33 | 100.0% |
| dashql-core-session/src/visualize/mod.rs | 28/28 | 100.0% |
| dashql-core-shell/src/unicode.rs | 27/27 | 100.0% |
| dashql-core-session/src/visualize/vegalite_generator.rs | 11/11 | 100.0% |
| dashql-core-shell/src/vt100.rs | 10/10 | 100.0% |
| dashql-core/src/analyzer/manual_tag.rs | 7/7 | 100.0% |
| dashql-core-profile/src/tests.rs | 575/576 | 99.8% |
| dashql-core-shell/src/prompt_buffer.rs | 311/312 | 99.7% |
| dashql-core/src/catalog/clfn.rs | 392/394 | 99.5% |
| dashql-core/src/table_parameters.rs | 151/152 | 99.3% |
| dashql-core-profile/src/progress/trino.rs | 262/264 | 99.2% |
| dashql-core/src/script.rs | 330/333 | 99.1% |
| dashql-core/src/catalog/entry.rs | 216/218 | 99.1% |
| dashql-core-profile/src/profile_layout.rs | 305/308 | 99.0% |
| dashql-core/src/compact_json.rs | 88/89 | 98.9% |
| dashql-core-session/src/script_references.rs | 597/604 | 98.8% |
| dashql-parser/src/comment_blocks.rs | 448/454 | 98.7% |
| dashql-core/src/vis_text.rs | 213/216 | 98.6% |
| dashql-core/src/sql_literal.rs | 267/271 | 98.5% |
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
| dashql-core/src/vis_highlight.rs | 237/242 | 97.9% |
| dashql-core/src/catalog/descriptor.rs | 278/284 | 97.9% |
| dashql-dataflow/src/layout.rs | 509/520 | 97.9% |
| dashql-core-shell/src/session.rs | 1372/1402 | 97.9% |
| dashql-core/src/analyzer/name_resolution.rs | 1450/1482 | 97.8% |
| dashql-core-session/src/visualize/markdown/mod.rs | 225/230 | 97.8% |
| dashql-core-session/src/session_inputs.rs | 90/92 | 97.8% |
| dashql-parser/src/parser/actions.rs | 123/126 | 97.6% |
| dashql-core/src/analyzer/state.rs | 285/292 | 97.6% |
| dashql-dataflow/src/ortho_router/tests.rs | 237/243 | 97.5% |
| dashql-core/src/formatter/comments.rs | 433/444 | 97.5% |
| dashql-core-session/src/planner.rs | 921/945 | 97.5% |
| dashql-core/src/analyzer/types.rs | 71/73 | 97.3% |
| dashql-core-profile/src/trino_plan_parser.rs | 173/178 | 97.2% |
| dashql-core/src/analyzer/constants.rs | 136/140 | 97.1% |
| dashql-core/src/completion.rs | 1277/1316 | 97.0% |
| dashql-parser/src/keywords.rs | 61/63 | 96.8% |
| dashql-core/src/formatter/pgq.rs | 223/231 | 96.5% |
| dashql-core/src/analyzer/param_tags.rs | 81/84 | 96.4% |
| dashql-parser/src/parser/context.rs | 370/384 | 96.4% |
| dashql-core/src/catalog/mod.rs | 737/765 | 96.3% |
| dashql-core/src/formatter/create.rs | 221/230 | 96.1% |
| dashql-dataflow/src/ortho_router/mod.rs | 146/152 | 96.1% |
| dashql-core/src/formatter/program.rs | 546/569 | 96.0% |
| dashql-core/src/cursor.rs | 284/296 | 95.9% |
| dashql-core/src/pack.rs | 817/852 | 95.9% |
| dashql-parser/src/names.rs | 86/90 | 95.6% |
| dashql-core/src/script_diff.rs | 479/502 | 95.4% |
| dashql-core-session/src/batch.rs | 103/108 | 95.4% |
| dashql-core-session/src/script_session.rs | 835/878 | 95.1% |
| dashql-core/src/utils/topk.rs | 55/58 | 94.8% |
| dashql-parser/src/scanner.rs | 419/442 | 94.8% |
| dashql-core-session/src/touched_relations.rs | 90/95 | 94.7% |
| dashql-core/src/completion_clfn.rs | 312/330 | 94.5% |
| dashql-core/src/analyzer/clfn_calls.rs | 401/426 | 94.1% |
| dashql-core/src/analyzer/function_calls.rs | 63/67 | 94.0% |
| dashql-parser/src/parser/probe.rs | 200/213 | 93.9% |
| dashql-core/src/analyzer/sql_types.rs | 174/186 | 93.5% |
| dashql-core/src/formatter/mod.rs | 2129/2308 | 92.2% |
| dashql-core/src/formatter/select.rs | 188/205 | 91.7% |
| dashql-core/src/formatter/delete.rs | 20/22 | 90.9% |
| dashql-core/src/completion_vis.rs | 248/273 | 90.8% |
| dashql-core-session/src/compiler.rs | 165/184 | 89.7% |
| dashql-parser/src/lib.rs | 43/48 | 89.6% |
| dashql-parser/src/parser/driver.rs | 212/238 | 89.1% |
| dashql-parser/src/parser/enums.rs | 40/45 | 88.9% |
| dashql-core/src/formatter/explain.rs | 39/44 | 88.6% |
| dashql-core/src/formatter/insert.rs | 44/50 | 88.0% |
| dashql-core-shell/src/lib.rs | 14/16 | 87.5% |
| dashql-core/src/analyzer/mod.rs | 65/75 | 86.7% |
| dashql-dataflow/src/ortho_router/geom.rs | 59/71 | 83.1% |
| dashql-parser/src/parser/mod.rs | 148/182 | 81.3% |
| dashql-parser/src/span.rs | 11/14 | 78.6% |
| dashql-parser/src/attributes.rs | 34/47 | 72.3% |
| dashql-parser/src/parser/value.rs | 26/38 | 68.4% |

## Top offenders (most uncovered lines)

| File | Uncovered | Notes |
|---|---|---|
| dashql-core/src/formatter/mod.rs | 179 | Mostly unreachable `format_unimplemented` fallbacks |
| dashql-core-session/src/script_session.rs | 43 | Analysis failures of a session, non-boundary cursors, diagnostics without spans |
| dashql-core/src/completion.rs | 39 | Dot candidates of the same object, cursor positions at the begin of a dot, unresolved derived columns |
| dashql-core/src/pack.rs | 35 | Cursor contexts without a scanner symbol, column candidate objects |
| dashql-parser/src/parser/mod.rs | 34 | Error recovery and expected-symbol corners |
| dashql-core/src/analyzer/name_resolution.rs | 32 | Defensive branches |
| dashql-core-shell/src/session.rs | 30 | Single lines: failed status paths, comment highlighting, completion corners |
| dashql-core/src/catalog/mod.rs | 28 | Id mismatch and collision errors, accessors that only the Wasm bindings call |
| dashql-parser/src/parser/driver.rs | 26 | LR error recovery corners |
| dashql-core/src/analyzer/clfn_calls.rs | 25 | `starts_client_function_call` (15 lines, tested through the Wasm bindings), duplicate and conflicting options |
| dashql-core/src/completion_vis.rs | 25 | Whitespace and word ends while scanning tag args and Vega-Lite tokens, cursor positions without a token |
| dashql-core-session/src/planner.rs | 24 | Barriers the analyzer never triggers (table refs without a relation, incompatible view kinds), visualization errors |
| dashql-core/src/formatter/program.rs | 23 | Unknown formatting modes and dialects, `formatting_dialect_to_string`, empty ops |

## Rust tools

Line coverage of the unit tests of the command line tool and the native tools, not counted in the overall number above.
The numbers count production code only, without test files and `#[cfg(test)]` modules, which would otherwise count as
covered. The end-to-end tests of `dashql-cli` run the binary in a subprocess and add nothing here, so its number is a lower
bound.

| Package | Lines | Coverage | Previous report |
|---|---|---|---|
| dashql-cli | 2,105/2,460 | 85.6% | 85.4% (2,002/2,344) |
| dashql-native-proxy | 1,169/1,245 | 93.9% | 94.0% (1,064/1,132) |
| dashql-pack | 622/664 | 93.7% | 93.6% (581/621) |

The line counts come from a new count of this run and are not fully comparable with the previous ones: the percentages are about the same, read those.

The tests of `dashql-pack` drive `vacuum` and `publish` against an S3 server in memory (`src/test_s3.rs`). The tests of
`dashql-native-proxy` go through `route_proxy_request`, against the gRPC mock and an HTTP server they answer by hand.

Largest gaps:

| File | Uncovered | Coverage |
|---|---|---|
| dashql-cli/src/agent/server.rs | 113 | 87.7% |
| dashql-cli/src/main.rs | 111 | 0.0% |
| dashql-cli/src/agent/harness.rs | 39 | 88.0% |
| dashql-cli/src/agent/client.rs | 23 | 89.9% |
| dashql-native-proxy/src/http_stream_manager.rs | 22 | 88.0% |
| dashql-pack/src/main.rs | 18 | 21.7% |
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
