# Porting TypeScript Logic to Rust

Which TypeScript logic can and should move to Rust, given that more Rust improves project quality but the DOM and the
wasm boundary are tricky.

**Conclusion: only about 1k of the 100k non-test TS lines is a clear win today, and up to about 2.5k more is
conditional.** The hard logic has already moved: parser, analyzer, planner, completion, diff, profile parsing and
layout, dataflow layout. What remains is mostly React views, reducers that hold live wasm handles, browser I/O, and
thin glue over core results. The session reducers don't hide logic either: `analyzeScriptData`, `computePendingDiff`
and `rewriteRenamedReferences` orchestrate core calls and contain little decision logic.

Evidence: code reading, plus a few type-parser checks through the `dashql lint` CLI. No performance numbers were
measured, and the bugs listed at the end were not reproduced in a running app.

Paths without a package are under `packages/dashql-app/src/`.

| Area | State |
|---|---|
| Hyper progress adapter | Proposed, not started |
| Query profile geometry | Proposed, not started |
| Conditional candidates | Waiting for their triggers |
| Headless CLI sessions | Open decision |

## Ranking

### Port now

| Candidate | TS removed | Why it wins |
|---|---|---|
| **Query profile geometry**: paths in `views/query_profile/profile_scene.ts`, all of `ui/graph/graph_edges.ts` | ~950 lines | Continues `profile_layout.rs`, input is already a flatbuffer, runs per rendered profile, gains snapshot coverage. It is the most intricate pure code in the app. |
| **Hyper progress adapter**: `hyperQueryEvents` in `query/query_progress_model.ts:27` | ~17 lines | Trino's adapter is already in `packages/dashql-core-profile/src/progress/trino.rs` with a snapshot harness. Small, and removes an asymmetry. |

### Conditional: port only if the trigger happens

| Candidate | Lines | Trigger |
|---|---|---|
| Trino rows to Arrow (`connections/trino/arrow_conversion.ts`) | 489 | A benchmark on a 32 MB page shows real gain. No Rust core module links the Arrow crates (the shell dropped them because of their size, about 23% of the core Wasm in brotli), so this needs a module decision and hands results to arrow-js as IPC. |
| Dataflow edge geometry (`orthogonalPath`, `crossesBox`, `routeBadgeAt`, `routeEdge` in `session/dataflow/dataflow_scene.ts`) | ~160 | Visual tuning settles: 12 commits touched this file, against 5 for `profile_scene.ts`. It runs per drag update, lives in a separate wasm module from the profile code, and every tweak would need a wasm rebuild. |
| Natural-language identifier matching (`agent/catalog_name_index.ts`, `agent/script_references.ts`) | 255 | A Rust consumer appears, or the JS index becomes slow on large catalogs. It rebuilds an index from a catalog snapshot, but offsets must be UTF-16 and it would cross per keystroke. |
| Focus span join (`session/editor/dashql_decorations.ts:126,155`) | ~20 | `spans.find` in a loop shows up in a profile. Then have core send resolved spans. |
| SQL builders (`compute/sql/sqlframe_builder.ts`, `compute/sql/query_result_search_sql.ts`) | 562 | The CLI or shell needs the same summaries. Pure and well tested, but no second consumer today. |
| Session format (`storage/session_bundle.ts`, `storage/session_files.ts`, `storage/session_validation.ts`, `session/persistence/session_export.ts`) | ~980 | The CLI must read sessions, see the open decision. |

### Keep in TS

- **Reducers and schedulers** (`session/scripts/session_scripts.ts`, `compute/computation_state.ts`,
  `query/query_execution_state.ts`, `connections/connection_state.ts`): they hold wasm handles, free them while
  reducing, and rely on object identity. A port needs handle tables and a crossing per state read.
- **Graph scheduler** (`session/scripts/session_execution.ts`): already decided in
  [session_graph_execution.md](../design/session_graph_execution.md).
- **Cell formatting** (`compute/arrow_formatter.ts`): depends on `Intl` and would cross per visible cell.
- **Catalog DDL generation** (`connections/catalog/catalog_sql_generator.ts`): structured input gains nothing, because
  scan, parse and analyze already run in the worker and the catalog must still persist as script text. Fix the type
  bug in place.
- **Browser I/O**: fetch, gRPC, OAuth, OPFS, migrations, CodeMirror integration, Vega specs, React scene assembly.
- **One-line SQL quoting**: not worth a crossing, and `platform/hyperdb` runs without a core instance.

## Open decision

**Should the CLI ever run sessions headlessly?** This is the one answer that changes the ranking. If yes, the session
format, session inputs, the scheduler and eventually connectors flip to "port", which also meets the revisit trigger in
[session_graph_execution.md](../design/session_graph_execution.md). It would be a separate, much larger project. This
document assumes no.

## Boundary rules for any port

1. **Cross per operation, never per value.** No per-cell or per-frame calls; send whole batches.
2. **Rust computes values, TS keeps identity.** React memoization, `mergeDataflowGraph` and handle ownership stay in TS.
3. **Never panic on engine input.** A panic makes the module unusable until reload
   (`packages/dashql-core-js/src/api.ts:100`), where a TS throw is merely caught. Use `.get()`, `total_cmp` and
   `try_reserve`, and guard non-finite values.
4. **Name the offset unit.** The editor APIs use UTF-16, the core uses UTF-8 bytes internally.
5. **Stay on the main-thread budget.** Core calls block the UI, and a new worker needs its own module instance.
6. **Use existing modules.** Core is 10.6 MB in `bazel-bin` (build mode unchecked), and code needed before core loads
   stays in TS.

## Implementation

Each step is one commit and can stop there. Hyper goes first because it is the small proof of the recipe.

### Step 1: Hyper progress adapter

1. Add `packages/dashql-core-profile/src/progress/hyper.rs`, reading `serde_json::Value` like `trino.rs`. Don't use
   `deny_unknown_fields`, because the payload is a full `QueryStatus`.
2. Add an inline `statuses` case to `snapshots/profiles/progress/progress.tpl.yaml` (no sidecar), with the encoder and
   the snapshotter entry.
3. Add the wasm binding in `packages/dashql-core-wasm/src/lib.rs` and the wrapper in
   `packages/dashql-core-js/src/api.ts`, following `applyTrinoStatementStats`.
4. Switch `query/query_progress_model.ts` to it and delete `hyperQueryEvents`.

### Step 2: Query profile geometry

Paths don't go into the `QueryProfile` buffer. Its dictionary stores each string twice, and Trino registers pipelines
after layout, so paths computed in `compute_layout` would miss them.

1. Add a root table `ProfileGeometry` to `proto/fb/dashql/query_profile.fbs` with `[string]` vectors index-aligned to
   edges, cross edges, fragments and pipelines. Hidden fragments get empty strings.
2. Add `packages/dashql-core-profile/src/profile_geometry.rs`, a stateless function from a profile to its geometry.
   - Include only the 12 of 20 edge types the view can reach.
   - Merge the path builders and port the Rust-side tests from `views/query_profile/profile_scene.test.ts:57-238` and
     `ui/graph/graph_edges.test.ts`.
   - Formatting traps: JS and Rust differ on `-0`, exponents and `Infinity`, and `Math.sign(0)` is 0 where
     `signum(0.0)` is 1. Write a small coordinate formatter and a sign helper.
   - The fragment grid can reach about 64 MB at 1,000 operators, so allocate with `try_reserve` and return an empty
     path on failure.
3. Add `computeProfileGeometry(bytes)` to the wasm layer and to `api.ts`.
4. Snapshots: leave `encode_query_profile` alone and add `encode_profile_geometry`, called from the Hyper and Trino
   encoders. Add `geometry` to `STRUCTURE` in `query_profile_snapshots.rs`, or the test ignores it. Estimated growth:
   9-28% per file.
5. Add a transitional parity test in the app: TS and Rust paths compared token by token, for both orientations,
   snapshot and app configs, and each replay step. Add cases for the corpus gaps: Hyper snapshots have no pipelines,
   and all TPC-H fragments are hidden.
6. Switch `materializeProfileScene` to read the geometry once. It stays in TS as a thin reader for labels, JSON
   properties, ports and rects, and is called from the existing `useMemo` at
   `views/query_profile/query_profile_view.tsx:312`.
7. Delete the TS geometry, `ui/graph/graph_edges.ts`, its test and the parity test. Update
   [trino_plan.md](../design/trino_plan.md) (intro and step 4).

### Verification

```bash
bazel test //packages/dashql-core-profile:dashql_core_profile_unit_tests
bazel test //packages/dashql-core-profile:query_profile_snapshot_test
bazel run //snapshots/profiles/progress:update          # Step 1
bazel run //snapshots/profiles/hyper/tests:update       # Step 2
bazel run //snapshots/profiles/trino/plans:update       # Step 2
bazel test //packages/dashql-app:tsc_typecheck_test
bazel test //packages/dashql-app:test_chromium //packages/dashql-app:test_firefox
```

Review the snapshot diffs: existing fields must not change, only additions. In Step 2 the parity test must pass before
the TS is deleted. Then open the query profile view in `bazel run //packages/dashql-app:dev` with a Hyper and a Trino
plan, in both orientations, and confirm edges and stage contours draw correctly.

## Bugs found on the way

These are TS fixes rather than ports, and are separate from the steps above:

1. **BigInt in Trino stats** (`connections/trino/trino_api_client.ts:435`, `query/query_progress_model.ts:214`): a stat
   of 2^53 or more makes `JSON.stringify` throw. It is caught, so the query continues, but progress stops updating and
   the download of the progress recording throws too. Rare (about 9 PiB). Fix: convert BigInts under `stats` to
   `Number` in the slow path of `parseTrinoJson`.
3. **Silently dropped contours** (`views/query_profile/profile_scene.ts:354,368`): an unclosed contour disappears
   without a log. Step 2 can carry this over or report it.
4. **Five copies of identifier quoting and four of literal quoting in TS**: merge them into one TS helper after
   comparing semantics.
