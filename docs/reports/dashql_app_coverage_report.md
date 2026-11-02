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

**Overall: 71.4% (43,076 / 60,304 lines) in 543 files**, up from 69.1% before the tests of the Trino and Salesforce
connection reducers, the Trino Arrow conversion, the log buffer, the graph edges and more Arrow value formats.

## Gaps in logic (`.ts`)

The cheapest next tests: functions of `.ts` files that tests load but never call.

| Location | Function | Uncovered lines |
|---|---|---|
| `src/views/query_result/use_query_result_search.ts:52-171` | useQueryResultSearch | 110 |
| `src/app/router/router.ts:86-191` | useRouterNavigate | 101 |
| `src/session/editor/dashql_completion_list.ts:45-154` | CandidateRenderer | 82 |
| `src/compute/tasks/column_aggregation.ts:176-261` | computeFilteredColumnAggregates | 80 |
| `src/session/scripts/focus.ts:124-208` | deriveFocusFromCompletionCandidates | 74 |
| `src/session/editor/dashql_diff_decorations.ts:56-136` | buildDiffDecorations | 61 |
| `src/session/editor/dashql_completion_listener.ts:103-176` | onTab | 59 |
| `src/session/editor/dashql_processor.ts:535-597` | updateCompletion | 52 |
| `src/platform/grpc/native_grpc_client.ts:85-143` | read | 47 |
| `src/connections/trino/trino_connection_setup.ts:39-91` | setupTrinoConnectionBasic | 46 |
| `src/compute/tasks/data_search.ts:9-50` | searchData | 42 |
| `src/compute/computation_state.ts:454-501` | reduceComputationState (`COLUMN_AGGREGATION_SUCCEEDED`) | 41 |
| `src/connections/trino/trino_channel.ts:66-117` | fetchNextQueryResult | 40 |
| `src/session/persistence/app_state_loader.ts:555-599` | restoreSingleSession | 40 |
| `src/views/query_result/use_cross_filters.ts:65-108` | scheduleLatestFilter | 39 |
| `src/views/query_result/use_cross_filters.ts:242-288` | useCrossFilters | 39 |
| `src/app/hyper_links.ts:41-75` | useHyperLinks | 33 |
| `src/connections/hyper/platform/native_hyperdb_grpc_client.ts:121-159` | produce | 32 |
| `src/session/editor/dashql_completion_list.ts:213-261` | render | 32 |
| `src/shell/shell_files.ts:107-138` | mountDirectory | 32 |

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

1. `computeFilteredColumnAggregates` and the `COLUMN_AGGREGATION_SUCCEEDED` case of `reduceComputationState`: the
   scheduler tests only mock the computation.
2. `searchData` and `useQueryResultSearch`: the search of query results has no test.
3. `deriveFocusFromCompletionCandidates` (`focus.ts`) and `buildDiffDecorations`: pure functions over core outputs.
4. `fetchNextQueryResult` of the Trino channel and `setupTrinoConnectionBasic`, with a fake Trino API client like
   `trino_channel.test.ts`.
5. Render tests of `TrinoConnectorSettings` and `HyperConnectorSettings` like the Salesforce settings tests.
