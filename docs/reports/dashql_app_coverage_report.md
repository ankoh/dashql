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

**Overall: 76.1% (46,091 / 60,569 lines) in 544 files**, up from 69.1% before the tests of the Trino and
Salesforce connection reducers, channel and API client, the Trino Arrow conversion and types, the log buffer, the graph
edges, more Arrow value formats, the column aggregation and data search tasks, the completion focus, list and keys, the
diff decorations, the router navigation, the cross filters, the query result search, the column resize, layout and ordering
of the data table, the plan pipelines, the quoted tokens of the editor, the app event messages, the native gRPC clients, the reducer cases of the computation, query and connection states, the session
restore, the OPFS and native session storage and the formatting helpers.

## Gaps in logic (`.ts`)

The cheapest next tests: functions of `.ts` files that tests load but never call.

| Location | Function | Uncovered lines |
|---|---|---|
| `src/app/hyper_links.ts:41-75` | useHyperLinks | 33 |
| `src/connections/query_execution_mock.ts:47-69` | produce | 20 |
| `src/demos/stock_analysis/synthetic_feed.ts:142-161` | start | 19 |
| `src/shell/api.ts:104-121` | fetchShellWasm | 18 |
| `src/shell/shell_files.ts:239-253` | logDetails | 15 |
| `src/compute/arrow_formatter.ts:553-570` | ensureBatchIsLoaded | 14 |
| `src/connections/query_execution_mock.ts:12-26` | QueryExecutionResponseStreamMock | 14 |
| `src/demos/shared/use_live_query.ts:91-104` | useLiveQuery | 13 |
| `src/connections/salesforce/salesforce_connection_setup.ts:223-234` | createSalesforceSetup | 12 |
| `src/session/persistence/app_state_loader.ts:698-711` | restoreAppState | 12 |
| `src/session/scripts/session_scripts.ts:1422-1433` | replaceSessionScriptsFromStorage | 12 |
| `src/shell/browser_shell.ts:372-383` | replaceShell | 12 |
| `src/views/plan/plan_scene.ts:494-505` | materializePlanScene | 12 |
| `src/compute/tasks/column_aggregation.ts:86-96` | computeColumnAggregates | 11 |
| `src/connections/connection_import.ts:29-41` | decodeConnectionFromProto | 11 |
| `src/platform/file/web_file_downloader.ts:4-19` | downloadBufferAsFile | 11 |
| `src/platform/hyperdb/hyperdb_provider_web.ts:148-158` | setupWebHyperDB | 11 |
| `src/session/editor/dashql_diff_hint.ts:17-31` | rejectPendingDiff | 11 |
| `src/storage/session_import_transaction.ts:112-123` | registerNativeSession | 11 |
| `src/storage/session_import_transaction.ts:160-171` | rollbackPortableReplacement | 11 |

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
- `formatNanoseconds` divided by a million for seconds, 2 s of the script statistics showed as `2000.0 s`.
- The cache signature of Trino connections sorted the schemas of the connection params in place.

## Suggested next tests

1. `useHyperLinks`: render it with the connection and session registries like the session workbench tests.
2. `fetchShellWasm` of the shell API and `start` of the synthetic stock feed of the demos.
3. `logDetails` and the remaining file mounts of the shell files.
4. Render tests of `TrinoConnectorSettings` and `HyperConnectorSettings` like the Salesforce settings tests.

## Flaky tests

- `hyper_log_metrics.test.ts` > extracts the queries of pooled connections by their client context: failed once with no
  queries in the log and passed on the reruns, it likely reads the Hyper log before the entries arrive.
