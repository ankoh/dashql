# DashQL App Coverage Report

Date: 2026-11-02

Coverage of the TypeScript sources of `packages/dashql-app/src` in the Chromium browser tests (tests and `src/tests/`
excluded). The coverage workflow uploads it to Coveralls together with the Rust core, which shows the uncovered lines
of every file.

```bash
bazel test //packages/dashql-app:coverage_chromium
```

The target builds the pages bundle unminified and with source maps (`vite --mode coverage`), records the V8 block
coverage of the test page and its test frames, and maps it back to the sources (`test/browser_coverage.mjs`). It writes
`coverage.dat` (LCOV) and `coverage_summary.txt` to `bazel-testlogs/packages/dashql-app/coverage_chromium/test.outputs/`.
The summary lists the gaps: the outermost functions and blocks that never ran, with their lines and the enclosing
function, largest first. Workers are not covered.

**Overall: 75.2% (45,423 / 60,438 lines) in 544 files**, up from 69.1% before the tests of the Trino and
Salesforce connection reducers, channel and API client, the Trino Arrow conversion, the log buffer, the graph edges, more
Arrow value formats, the column aggregation and data search tasks, the completion focus, list and keys, the diff
decorations, the router navigation, the cross filters, the query result search, the native gRPC clients, the reducer
cases of the computation, query and connection states, the session restore and the native session storage.

## Gaps in logic (`.ts`)

The cheapest next tests: functions of `.ts` files that tests load but never call.

| Location | Function | Uncovered lines |
|---|---|---|
| `src/app/hyper_links.ts:41-75` | useHyperLinks | 33 |
| `src/connections/query_execution_mock.ts:47-69` | produce | 20 |
| `src/demos/stock_analysis/synthetic_feed.ts:142-161` | start | 19 |
| `src/views/query_result/data_table_column_resize.ts:141-162` | onPointerDownCapture | 19 |
| `src/shell/api.ts:104-121` | fetchShellWasm | 18 |
| `src/query/query_execution_state.ts:421-438` | reduceQueryAction | 17 |
| `src/views/query_result/data_table_column_resize.ts:164-183` | onPointerMove | 17 |
| `src/views/query_result/data_table_ordering.ts:37-53` | createOrderingTask | 17 |
| `src/compute/tasks/column_aggregation.ts:212-227` | computeFilteredColumnAggregates | 16 |
| `src/storage/opfs_storage_backend.ts:536-555` | reorderManifestSessions | 16 |
| `src/utils/format.ts:20-35` | formatNanoseconds | 16 |
| `src/views/plan/plan_scene.ts:164-179` | buildPipelinePath | 16 |
| `src/connections/catalog/catalog_query_pg_attribute.ts:181-198` | updatePgSchemaScript | 15 |
| `src/session/editor/dashql_quote_tombstone.ts:94-108` | defaultQuotedTokenFinder | 15 |
| `src/shell/shell_files.ts:239-253` | logDetails | 15 |
| `src/storage/opfs_storage_backend.ts:267-287` | renameScript | 15 |
| `src/storage/opfs_storage_backend.ts:370-391` | clearAllStorage | 15 |
| `src/storage/opfs_storage_backend.ts:581-596` | getFolderDir | 15 |
| `src/views/query_result/data_table_layout.ts:111-125` | computeTableLayout | 15 |
| `src/views/query_result/data_table_layout.ts:144-158` | computeTableLayout | 15 |

## Gaps in components (`.tsx`)

| Location | Function | Uncovered lines |
|---|---|---|
| `src/connections/trino_connection_settings.tsx:70-542` | TrinoConnectorSettings | 430 |
| `src/session/persistence/session_import_provider.tsx:89-394` | SessionImportProvider | 268 |
| `src/views/query_result/mostfrequent_cell.tsx:43-357` | MostFrequentCellImpl | 262 |
| `src/views/query_result/histogram_cell.tsx:32-348` | HistogramCellImpl | 259 |
| `src/agent/agent_bridge.tsx:99-374` | AgentBridgeProvider | 250 |
| `src/app/internals/app_settings_view.tsx:50-325` | AppSettings | 238 |
| `src/connections/hyper_connection_settings.tsx:99-365` | HyperConnectorSettings | 236 |
| `src/app/internals/storage_browser_view.tsx:264-494` | StorageBrowserView | 195 |
| `src/ui/logs/log_viewer.tsx:87-341` | LogViewer | 195 |
| `src/session/persistence/storage_writer_view.tsx:97-290` | StorageWriterView | 165 |
| `src/session/dashboard/dashboard.tsx:76-260` | Dashboard | 163 |
| `src/session/persistence/native_session_sync_react.tsx:131-333` | NativeSessionSync | 158 |
| `src/session/shell/session_shell_page.tsx:51-216` | SessionShellPage | 151 |
| `src/views/query_result/cell_detail_overlay.tsx:220-386` | CellDetailOverlayInner | 145 |
| `src/session/persistence/session_url_share_overlay.tsx:40-194` | SessionURLShareOverlay | 138 |

## Files that no test loads

Mostly entry points and pages: `oauth/oauth_redirect.tsx` (354 lines), `shell_app/shell_page.tsx` (294), the demos
(`demos/`, 564), `shell/filesystem_dialog.tsx` (152), `shell/filesystem_mount_dialog.tsx` (118),
`app/loading/shared_session_import.tsx` (142), `app/loading/app_setup.ts` (131), `app/app.tsx` (122),
`connections/salesforce/salesforce_connection_setup_mock.tsx` (103), `connections/health_check.ts` (44),
`connections/connection_setup.ts` (22) and 20 smaller files.

## Bugs found by the new tests

- `translateAnyRowsToArrowBatch` (Trino) dispatched on `type.typeId`, which is the type family (`Type.Int`,
  `Type.Date`, `Type.Time`) and never the flattened ids it matched (`Type.Int32`, `Type.DateDay`,
  `Type.TimeMillisecond`). Trino `date` and `time` columns became Utf8 data under a DateDay or TimeMillisecond field.
- `LogBuffer` froze a chunk at 1,025 records while `length` and `at()` expect 1,024: every frozen chunk hid its last
  record.
- `buildEdgePathBetweenRectangles` started `SouthEast` edges at the North side of the source.
- `selectEdgeTypeFromAngle` took the `atan2` result 180° (a target straight west) for a diagonal sector, so the edge
  got two turns instead of being direct.

## Suggested next tests

1. `onPointerDownCapture` and `onPointerMove` of the column resize of the data table, and `createOrderingTask` of the
   data table ordering.
2. `useHyperLinks`: render it with the connection and session registries like the session workbench tests.
3. `fetchShellWasm` of the shell API and `start` of the synthetic stock feed of the demos.
4. Render tests of `TrinoConnectorSettings` and `HyperConnectorSettings` like the Salesforce settings tests.
