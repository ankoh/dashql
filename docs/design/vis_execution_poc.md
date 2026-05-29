# VISUALIZE Execution — Proof of Concept

## Context

We recently added qualified-name targets for visualize statements (e.g. `visualize dashql.notebook."main/01-script.sql" as (...)`). Today everything stops at *analysis*: the analyzer collects a `VisualizationSpec`, the C++ side can already lift it into a Vega-Lite JSON via `dashql::visualize::GenerateVegaLiteSpec`, but:

1. The visualization specs are **not serialized** into `AnalyzedScript` (`analyzed_script.fbs`), so the app can't see them.
2. There is no execution path: when a user "sends" a script whose only statement is `VISUALIZE`, its raw text is shipped to the backend, which doesn't speak the dialect.
3. There is no Vega-Lite renderer on the frontend.

We want a user to write `visualize dashql.notebook."main/01-script.sql" as (...)` (or `visualize <table> as (...)` or `visualize (select ...) as (...)`), click run, see the underlying query result in the existing data table, and toggle a new third tab to see the rendered chart.

Key decisions:

- **Always re-execute the source** in v1; no cache reuse, no refcounted result map yet.
- **Vega-Lite JSON belongs on the analyzed-script flatbuffer.** The vis analysis is currently omitted entirely; we use this opportunity to wire it through. The TS side reads the spec from there.
- **Wrap in a new `QueryExecutionState`** for the visualize script (so its tabs behave like any other script's).
- Render with `vega-embed` + `vega-loader-arrow` to bind Apache Arrow results directly.
- Source-routing scope: support all three cases — qualified script ref, bare table ref, inline `(SELECT …)`.

## Files to modify

### Core (C++)

- `proto/fb/dashql/analyzed_script.fbs` — add a `VisualizationSpec` table (mark type, encodings, source kind, **`vegalite_json: string`**, ast/statement ids) and a `visualization_specs: [VisualizationSpec]` field on `AnalyzedScript`. The resolved source is encoded as: `source_kind: VisSourceKind`, plus *either* a `source_qualified_name: QualifiedTableName` (reusing the existing flatbuffer table type already used for table refs) for `ScriptReference`/`TableReference`, *or* `source_inline_select_ast_node_id: uint32` for `InlineSelect`.
- `packages/dashql-core/include/dashql/analyzer/analyzer_types.h` — extend the in-memory `VisualizationSpec` (around line 551) with a resolved-source classification:
  ```cpp
  enum class VisSourceKind { Unresolved, ScriptReference, TableReference, InlineSelect };
  struct ResolvedVisSource {
      VisSourceKind kind = VisSourceKind::Unresolved;
      // For ScriptReference / TableReference: the qualified table name as resolved
      // by NameResolutionPass (Name IDs into the script's name registry, exactly
      // like other AnalyzedScript::TableReference entries). The script-path case
      // is just a TableReference under the dashql.notebook schema — same shape.
      std::optional<AnalyzedScript::QualifiedTableName> qualified_name;
      // For InlineSelect: the AST root node of the parenthesised SELECT (the
      // OBJECT_SQL_SELECT subtree we'd hand to the executor verbatim).
      std::optional<uint32_t> inline_select_ast_node_id;
  };
  ```
  Add `ResolvedVisSource resolved_source;` and `std::string vegalite_json;` fields.
- `packages/dashql-core/src/analyzer/analyze_visualization_pass.cc` (around lines 306–323) — classify `select_node` (table ref vs. inline select), record qualified-name parts via the existing name-resolution data already populated by `NameResolutionPass`.
- `packages/dashql-core/src/analyzer/analyzer.cc` (the `Pack` path that produces `AnalyzedScript` flatbuffer) — call `visualize::GenerateVegaLiteSpec` once per spec, store the JSON, and serialize the new `VisualizationSpec` table into the flatbuffer. Reuse the existing logic in `tools/snapshotter.cc:797` and `test/visualize_snapshot_test_suite.cc:38` as the reference for how to call the generator.
- Add a snapshot test that asserts the new flatbuffer field round-trips.

### App (TypeScript)

- `packages/dashql-app/package.json` — add deps `vega`, `vega-lite`, `vega-embed`, `vega-loader-arrow`.
- `packages/dashql-app/src/connection/visualize_executor.ts` *(new)* — given a `ScriptData` with a single VIS_VISUALISE statement plus the notebook state:
  1. Read the analyzed flatbuffer's `VisualizationSpec`.
  2. Resolve the source to executable SQL:
     - `ScriptReference` → resolve the qualified-name IDs back to strings via the analyzed script's name registry, find the target `ScriptData` by matching `folderName/fileName`, use that script's text.
     - `TableReference` → reconstruct `<db>.<schema>.<table>` from the qualified name IDs (same registry lookup) and emit `SELECT * FROM <db>.<schema>.<table>` (quoted).
     - `InlineSelect` → look up the source AST node's text range in the parsed buffer (AST nodes carry `location_offset`/`location_length`) and slice that span from the visualize script's text.
  3. Call the existing `executeQuery` with that SQL, return the new `queryId` and a handle to the Vega-Lite JSON.
- `packages/dashql-app/src/view/notebook/notebook_script_feed.tsx` (around `handleSend`, line 303–330) — before calling `executeQuery`, detect VIS_VISUALISE via the analyzed buffer; if present, dispatch through `visualize_executor.ts` instead. Either way, wrap the resulting `queryId` into the script's `latestQueryId` via `REGISTER_QUERY` (unchanged action shape — visualize execution still produces one `QueryExecutionState`, just sourced from the resolved SQL).
- `packages/dashql-app/src/view/visualization/visualization_view.tsx` *(new)* — props: `{ queryState: QueryExecutionState, vegaLiteJson: string }`. Parses the JSON, attaches the result `arrow.Table` via `vega-loader-arrow`, and mounts `vega-embed`. Handles resize and errors. Disabled state when result is missing or not yet `SUCCEEDED`.
- `packages/dashql-app/src/view/notebook/notebook_script_details.tsx`:
  - Add `TabKey.Visualization = 3` to the enum (line 38).
  - Compute `hasVisualizeStmt` from `scriptData.scriptAnalysis.buffers.analyzed` (visualization-specs length > 0).
  - Update the `enabledTabs` counter (lines 233–236) to include the visualization tab only when `activeQueryState.status === SUCCEEDED && hasVisualizeStmt`.
  - Add the tab in `tabProps` (chart icon — pick an appropriate symbol from `@ankoh/dashql-svg-symbols`; reuse `#table_24` style as a placeholder if no chart icon exists yet) and the renderer in `tabRenderers`.
  - Update the keyboard cycle list (line 288) and split-tab fallback logic (lines 392–410) to include the new tab.
- `packages/dashql-app/src/notebook/notebook_state.ts` `deriveScriptAnnotations` (line 920) — also lift `hasVisualizeStmt` and the Vega-Lite JSON out of the analyzed buffer into `NotebookScriptAnnotations`, so consumers don't re-decode the flatbuffer per render.
- `packages/dashql-app/src/notebook/notebook_types.ts` — extend `NotebookScriptAnnotations` with `hasVisualizeStmt: boolean` and `vegaLiteSpec: string | null`.

## Reuse, not duplicate

- C++ Vega-Lite generation: `visualize::GenerateVegaLiteSpec` already exists and is exercised by snapshot tests. We just call it from the analyzer's `Pack` path.
- Query plumbing: `executeQuery` (`query_executor.tsx:281`) plus `REGISTER_QUERY` (`notebook_state.ts:108`, dispatched from `notebook_script_feed.tsx:325`) already covers ID allocation, dispatch, lifecycle, computation registry. Visualize execution piggy-backs on this — we don't add a parallel state machine.
- Catalog name resolution: `NameResolutionPass` already populates resolved table references; the new `ResolvedVisSource` reads from the same data rather than re-resolving.

## Out of scope (intentional)

- No refcounted result map; no result reuse. Every run of a `VISUALIZE` script issues a fresh source query.
- No multi-statement orchestration; we still treat a script as a single execution unit, and v1 assumes a `VISUALIZE` script contains exactly one VIS_VISUALISE statement.
- No edits to ggsql; no grammar changes.
- No footer-tab change. The third "Visualization" tab is added only to the script *details* panel (per the user's description of "below the result data table").

## Verification

1. **Bazel tests** (per repo convention — never `npx vitest` directly):
   - `bazel test //packages/dashql-core/...` — covers the new analyzer serialization snapshot.
   - `bazel test //packages/dashql-app/...` — covers `visualize_executor` source-resolution unit tests (script ref, table ref, inline select) and the annotations decode.
2. **Snapshot test** (new): write a fixture script that visualizes a qualified script ref and assert that the analyzed flatbuffer contains a `VisualizationSpec` with non-empty `vegalite_json` matching the existing snapshot generator's output.
3. **Manual end-to-end** (DashQL app dev server):
   - Page `main/`, script `01-script.sql` with `select i, i*2 as v from generate_series(0, 10) as t(i);`. Run it; result table populates.
   - Second script `02-vis.sql` with `visualize dashql.notebook."main/01-script.sql" as (mark => line, x => i, y => v);`. Run it.
   - Verify: data tab shows the same 11-row result; the new Visualization tab is enabled and renders a line chart via vega-embed.
   - Repeat with `visualize (select 1 as a, 2 as b) as (...)` (inline select) and `visualize my_table as (...)` (bare table ref) to cover all three source kinds.
4. **Regression check**: a script with no `VISUALIZE` statement keeps the same two-then-three tab progression (Editor / Status / Data) — the Visualization tab stays disabled and absent from cycling.
