# Harmonize UMAP projection into result post-processing

## Context

A methodological refactor renaming every `embeddingatlas` reference to `umap` is already staged in the working tree: the view folder is now `view/visualization/umap/`, the component is `UmapView` (`umap_view.tsx`), the spec is `UmapSpec` / `parseUmapSpec` (`umap_spec.ts`), the renderer discriminant is `'umap'`, and `ResolvedVisualizeQuery` carries `umapSpec`. This plan is written against those current names. A few files inside that folder still use an `embedding_*` prefix (`embedding_projection.ts`, `embedding_extraction.ts`, `embedding_scatter.tsx`, `embedding_projection_registry.tsx`); we finish that rename as part of this work.

dashql has **two parallel, disjoint pipelines** that both run after a query returns and both key off the same `queryId` and the same result `arrow.Table`:

1. **Result post-processing** — `analyzeTable()` (`packages/dashql-app/src/compute/computation_logic.ts:76`), triggered by `analyzeResults: true` in `query_executor.tsx:255`. It runs table aggregation → system columns (appends `_rownum`, `_X_bin`, `_X_id` to the table) → per-column aggregates, and stores everything in `TableComputationState` (`tableComputations[queryId]`), lifecycle-managed via `DELETE_COMPUTATION`.

2. **UMAP projection** — `UmapView` (`view/visualization/umap/umap_view.tsx`) lazily spawns `projectWithUMAP()` **on mount**, then stashes the `Projection2D` in a standalone `EmbeddingProjectionRegistry` keyed by `queryId + spec`.

This split is redundant: the projection is really just another per-row derived column, exactly like the system columns the post-processing step already appends. The separate registry also has a latent bug — its `clearQuery()` is **never called** (`grep` confirms no caller), so projections are never evicted for the app's lifetime.

**Goal:** UMAP projection becomes a **first-class feature of the computation module**, not a view concern. When a query resolves a `'umap'` visualize spec, the projection is computed as a step of `analyzeTable()`, appended to the post-processed arrow table as a `UMAP_COLUMN` column group (like the other computed columns), and the standalone cache is deleted. **All projection machinery — the UMAP worker, the `projectWithUMAP` driver, embedding-matrix extraction, and the spec→options mapping — moves under `compute/`.** `UmapView` is reduced to a pure renderer that reads coordinates out of the computation state.

**Decisions locked with the user:**
- **Ownership:** the entire UMAP/projection logic lives under `compute/` (a new `compute/umap/` folder). The view keeps only the scatter renderer + category extraction for coloring.
- **Column-group model:** the projection is a first-class `UMAP_COLUMN` `ColumnGroup` carrying its generated coordinate field names, appended to `columnGroups` like `ROWNUMBER_COLUMN`.
- **Storage:** append the `x` / `y` coordinates as Float32 columns to the arrow dataframe (not a separate `Projection2D` field).
- **Timing:** blocking — the projection is awaited inside `analyzeTable`, before `QUERY_PROCESSED_RESULTS` / `QUERY_SUCCEEDED`.

## Target architecture

```
compute/                                    ← ALL projection logic lives here
  computation_logic.ts   analyzeTable → projection step
  computation_types.ts   UMAP_COLUMN column group
  computation_state.ts   UMAP_COMPUTATION_SUCCEEDED
  umap/                  (moved out of view/visualization/umap/)
    umap_worker.ts            worker entrypoint
    umap_worker_request.ts    worker protocol
    umap_projection.ts        projectWithUMAP() + UmapRequest + Projection2D
    umap_extraction.ts        extractEmbeddingMatrix + extractFloat32Column

view/visualization/umap/                    ← rendering only
  umap_view.tsx           reads UMAP_COLUMN group from compute state
  umap_spec.ts            UmapSpec + parseUmapSpec + umapRequestFromSpec
  embedding_scatter.tsx   WebGPU/WebGL2 renderer (unchanged)
  umap_categories.ts      extractCategories (coloring only)
  renderer/…              (unchanged)


executeQuery({ query, analyzeResults: true, projection? })   ← projection derived from visualizeQuery
        │
   query_executor.executeImpl
        │  QUERY_PROCESSING_RESULTS
        ▼
   analyzeTable(tableId, table, dispatch, duckdb, logger, projection?)
        ├─ table aggregation      (existing)
        ├─ system columns         (existing → appends _rownum/_X_bin/_X_id)
        ├─ column aggregates      (existing)
        └─ projection (NEW, only if projection != null):
              extractEmbeddingMatrix(table, vectorColumn)
              await projectWithUMAP(matrix, options)      ← worker, blocking
              append coord columns to dataTable (pure arrow, no DuckDB)
              append UMAP_COLUMN group to columnGroups
              dispatch UMAP_COMPUTATION_SUCCEEDED
        │  QUERY_PROCESSED_RESULTS → QUERY_SUCCEEDED
        ▼
   UmapView reads tableComputations[queryId] → UMAP_COLUMN group,
   pulls coord columns + category column → renders scatter (no worker, no cache)
```

The coordinate columns are modeled as a **first-class `ColumnGroup`**, like the existing computed columns. `ROWNUMBER_COLUMN` is the precedent: a column group carrying generated field names (`rowNumberFieldName`), appended to `columnGroups`, and excluded from grid rendering via the `type == SKIPPED_COLUMN || type == ROWNUMBER_COLUMN` checks. The new `UMAP_COLUMN` variant carries the coordinate field names; the scatter locates it in `columnGroups` and reads the columns by name (no hard-coded string), and the data-table grid skips it just like the row-number group.

## Implementation

### 1. Relocate the projection machinery into `compute/umap/`
Move these files (currently under `view/visualization/umap/`) into a new `compute/umap/` folder so the computation module owns them and there is no `compute → view` import. Use `git mv` to preserve the in-progress rename history:
- `umap_worker.ts`, `umap_worker_request.ts` — the worker + protocol. The `new URL('./umap_worker.js', import.meta.url)` reference moves with the driver, so worker bundling is unaffected (verify the Bazel/vite worker entry glob still matches the new path).
- `embedding_projection.ts` → `compute/umap/umap_projection.ts` — the `projectWithUMAP` driver, `Projection2D`, `RunningProjection`, `ProjectionProgress` (finishes the `embedding_* → umap_*` rename).
- `embedding_extraction.ts` → `compute/umap/umap_extraction.ts` — `extractEmbeddingMatrix` + `EmbeddingMatrix`. Split `extractCategories` / `CategoryAssignment` out into a view-layer `view/visualization/umap/umap_categories.ts` (it is coloring, not projection).
- Update all imports (`@dashql/umap-wasm` stays external).

### 2. Define the projection request and thread it into execution
- **`compute/umap/umap_projection.ts`** — define `UmapRequest = { vectorColumn: string; options: UMAPOptions }` beside `projectWithUMAP`.
- **`connection/query_execution_args.ts`** — add optional `projection?: UmapRequest` to `QueryExecutionArgs`.
- Move `umapOptionsFromSpec()` out of `umap_view.tsx`. Since it maps a `UmapSpec` (a view type) to `UMAPOptions`, host a `umapRequestFromSpec(spec: UmapSpec): UmapRequest` helper in **`view/visualization/umap/umap_spec.ts`** — the view/notebook layer builds the request; `compute/` only consumes the plain `UmapRequest`.
- At the three execute sites, derive `projection` from `scriptData.annotations.visualizeQuery` when `renderer === 'umap'`:
  - `view/notebook/notebook_script_feed.tsx:559` (agent re-execution) and `:585` (`handleSend`)
  - `notebook/notebook_commands.tsx:113` (`ExecuteEditorQuery`)

### 3. Add the `UMAP_COLUMN` column-group variant
- **`compute/computation_types.ts`**:
  - Add `export const UMAP_COLUMN = Symbol("UMAP_COLUMN")`.
  - Add `UmapGridColumnGroup { xFieldName: string; yFieldName: string; inputFieldName: string /* the vector column */ }` and add the variant to the `ColumnGroup` union.
  - Add the case to `getGridColumnTypeName` → `"UMAP"`.

### 4. Add the projection step to `analyzeTable`
- **`compute/computation_logic.ts`** — extend `analyzeTable(...)` with a `projection?: UmapRequest` param. After the column-aggregate loop, if `projection != null`:
  1. `extractEmbeddingMatrix(currentTable, projection.vectorColumn)` (reuse `compute/umap/umap_extraction.ts`); on failure, log and skip (do not fail the query).
  2. `await projectWithUMAP(matrix, projection.options).promise` — reuse the driver in `compute/umap/umap_projection.ts`. Wire `cancel()` to the `computeAbortCtrl` created at the top of `analyzeTable`.
  3. Allocate unique field names via the existing `createUniqueColumnName(...)` helper (e.g. `_umap_x` / `_umap_y`), build two Float32 arrow vectors from the returned `x` / `y` (`arrow.makeVector` / `arrow.vectorFromArray`), and `dataTable.assign(...)` to produce the extended table.
  4. Build a `UMAP_COLUMN` `ColumnGroup` carrying those field names and append it to `gridColumnGroups` (mirrors how `buildSystemColumnSQLFrame` prepends the `ROWNUMBER_COLUMN` group).
  5. `dispatch({ type: UMAP_COMPUTATION_SUCCEEDED, value: [tableId, extendedTable, updatedColumnGroups] })`.
- Straight inline `await` (matches the "blocking" decision); no new scheduler task type — the result is plain arrow columns with no DuckDB-backed lifetime to manage.

### 5. New reducer action to swap in the extended table + column groups
- **`compute/computation_state.ts`** — add `UMAP_COMPUTATION_SUCCEEDED` symbol + `ComputationAction` variant `[number, arrow.Table, ColumnGroup[]]`. Reducer branch updates `dataTable`, recomputes `dataTableFieldsByName` (via `createArrowFieldIndex`), and stores the updated `columnGroups` (now including the `UMAP_COLUMN` group). No `DataFrameRegistry` acquire/release (arrow-only).
- The grid already excludes `ROWNUMBER_COLUMN`/`SKIPPED_COLUMN`; extend the same guard sites so `UMAP_COLUMN` is skipped for rendering and for column/filtered-aggregate computation (the `type == SKIPPED_COLUMN || type == ROWNUMBER_COLUMN` checks in `computation_logic.ts` and `computation_state.ts:722`).

### 6. Reduce `UmapView` to a pure renderer
- **`umap_view.tsx`** — replace the `useEffect` + worker + registry logic with a synchronous read:
  - `useComputationRegistry()` → `tableComputations[props.query.queryId]` → find the `UMAP_COLUMN` group in `columnGroups`.
  - Read its `xFieldName` / `yFieldName` columns from `dataTable` into Float32Arrays (add a tiny `extractFloat32Column` helper in `compute/umap/umap_extraction.ts`, mirroring the zero-copy single-chunk path). Reading by the group's field names (not a hard-coded string) keeps the naming an internal detail of the compute module.
  - Keep `extractCategories` (now from `umap_categories.ts`) reading the same `dataTable`.
  - No projection group yet (query still processing, or no spec) → keep the existing "Projecting…"/empty placeholders. Since projection is blocking, by `SUCCEEDED` the group is present.
  - The view no longer imports the worker, driver, or `UMAPOptions`.

### 7. Delete the separate cache
- Delete **`view/visualization/umap/embedding_projection_registry.tsx`**.
- Remove `<EmbeddingProjectionRegistry>` from **`app.tsx:45,69,73`**.
- Remove `projectionCacheKey` / `useEmbeddingProjectionRegistry` usages. This also disposes the never-evicted-cache leak.

## Files to modify
- **Move** `view/visualization/umap/{umap_worker,umap_worker_request}.ts` → `compute/umap/`; `embedding_projection.ts` → `compute/umap/umap_projection.ts`; `embedding_extraction.ts` → `compute/umap/umap_extraction.ts`; split `extractCategories` into `view/visualization/umap/umap_categories.ts`
- `connection/query_execution_args.ts` — add `projection?: UmapRequest`
- `connection/query_executor.tsx` — pass `args.projection` into `analyzeTable`
- `compute/computation_types.ts` — `UMAP_COLUMN` symbol + `UmapGridColumnGroup` + union/`getGridColumnTypeName`
- `compute/computation_logic.ts` — projection step in `analyzeTable`; add `UMAP_COLUMN` to the skip guards
- `compute/computation_state.ts` — `UMAP_COMPUTATION_SUCCEEDED` action + reducer; `UMAP_COLUMN` in the aggregate-skip guard (~line 722)
- `compute/umap/umap_extraction.ts` — add `extractFloat32Column`
- `view/visualization/umap/umap_view.tsx` — read the `UMAP_COLUMN` group from compute state; drop worker/driver imports
- `view/visualization/umap/umap_spec.ts` — host `umapRequestFromSpec`
- `view/visualization/umap/embedding_extraction.test.ts` — move/rename alongside `umap_extraction.ts`; update to cover `extractFloat32Column`
- `view/notebook/notebook_script_feed.tsx`, `notebook/notebook_commands.tsx` — build `projection` at execute sites
- **Delete** `view/visualization/umap/embedding_projection_registry.tsx`; edit `app.tsx`
- Update Bazel `BUILD` files for the moved sources / worker entry (per memory: build & test via bazel targets)

## Tradeoffs / notes
- **Blocking cost:** a multi-second UMAP now holds the card (including the data-table tab) in `QUERY_PROCESSING_RESULTS` until it finishes — accepted per the timing decision. Streaming UMAP progress (`stage`/`percent`) previously shown by the scatter needs a new home; simplest is to forward `onProgress` to `logger`/the card's processing indicator. Flag for follow-up if finer progress UI is wanted.
- **Recompute on spec change:** projection is now tied to the query result, so changing `neighbors`/`minDist` requires re-executing the query (which the agent-edit and `handleSend` paths already do). Changing only the **category/color** column does **not** touch the coordinates, so re-rendering colors is free — *unless* an agent edit forces a re-execution, which will reproject. Minor wasted compute, not a correctness issue; the old spec-keyed cache is gone.
- **Cleanup:** projection columns live on `dataTable` and are freed with the `TableComputationState` on `DELETE_COMPUTATION` — no bespoke eviction needed.

## Verification
- Bazel unit tests for the compute module (per memory: use bazel targets, never `npx vitest`). Add/extend a `computation_logic` test asserting that after `analyzeTable` with a projection request, `columnGroups` contains a `UMAP_COLUMN` group and its coordinate columns exist on `dataTable`; and that neither is present without a projection request. Keep the migrated extraction test green.
- Run the app (`/run`): open a notebook, execute a `VISUALIZE ... USING umap` over a Float32 vector column. Confirm: (a) the scatter renders after the query succeeds, (b) collapsing/reopening the card or switching footer tabs re-renders instantly with no reprojection (state persists), (c) the data-table grid does not render the projection columns, (d) editing the projection options and re-running reprojects.
- Confirm no remaining references to `EmbeddingProjectionRegistry` / `projectionCacheKey` and no `compute → view` import of the worker/driver (`grep`); confirm the moved worker still bundles (scatter loads without a worker-not-found error).
