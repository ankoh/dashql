# DashQL App Coverage Report

Date: 2026-11-04

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

**Overall: 79.0% (50,730 / 64,237 lines) in 572 files**, up from 76.1% (46,091 / 60,569 lines in 544 files) on
2026-11-02. The app grew by 28 files in between, so the percentage mixes new tests and new code. The new tests cover
the Hyper links of the app (`useHyperLinks`), the Trino and Hyper connection settings, the download of the shell Wasm,
the session import transactions, the logging and pickers of the shell files, the pending diff of the editor, the
restored connections, the mocked query results, the file download, the synthetic stock feed and `useLiveQuery`. These
files are now at 99% to 100%; `shell/api.ts` is at 90.5% and `compute/arrow_formatter.ts` at 92.9%.

## Gaps in logic (`.ts`)

The cheapest next tests: functions of `.ts` files that tests load but never call.

| Location | Function | Uncovered lines |
|---|---|---|
| `src/connections/salesforce/salesforce_connection_setup.ts:223-234` | createSalesforceSetup | 12 |
| `src/session/dataflow/dataflow_module.ts:31-42` | useDataflowModule | 12 |
| `src/session/persistence/app_state_loader.ts:698-711` | restoreAppState | 12 |
| `src/session/scripts/session_scripts.ts:1430-1441` | replaceSessionScriptsFromStorage | 12 |
| `src/shell/browser_shell.ts:372-383` | replaceShell | 12 |
| `src/compute/tasks/column_aggregation.ts:86-96` | computeColumnAggregates | 11 |
| `src/platform/hyperdb/hyperdb_provider_web.ts:148-158` | setupWebHyperDB | 11 |
| `src/views/query_result/data_table_focus.ts:19-32` | setFocus | 11 |
| `src/views/query_result/use_cross_filters.ts:15-27` | scalarFiltersEqual | 11 |
| `src/config/flavor_resolution.ts:28-39` | getRequestedFlavor | 10 |
| `src/connections/connection_label.ts:71-81` | connectionParamsLabel | 10 |
| `src/platform/events/web_event_listener.ts:55-64` | processDragOverEvent | 10 |
| `src/session/inputs/session_inputs.ts:90-99` | readSessionInputType | 10 |
| `src/session/scripts/focus.ts:96-105` | deriveFocusFromEditorUpdate | 10 |
| `src/storage/opfs_storage_backend.ts:134-147` | loadSession | 10 |

## Gaps in components (`.tsx`)

| Location | Function | Uncovered lines |
|---|---|---|
| `src/session/persistence/session_import_provider.tsx:89-394` | SessionImportProvider | 268 |
| `src/views/query_result/mostfrequent_cell.tsx:43-357` | MostFrequentCellImpl | 262 |
| `src/views/query_result/histogram_cell.tsx:32-348` | HistogramCellImpl | 259 |
| `src/agent/agent_bridge.tsx:100-377` | AgentBridgeProvider | 252 |
| `src/app/internals/app_settings_view.tsx:50-325` | AppSettings | 238 |
| `src/session/dashboard/dashboard.tsx:90-347` | Dashboard | 228 |
| `src/app/internals/storage_browser_view.tsx:264-494` | StorageBrowserView | 195 |
| `src/ui/logs/log_viewer.tsx:87-341` | LogViewer | 195 |
| `src/session/persistence/storage_writer_view.tsx:97-290` | StorageWriterView | 165 |
| `src/session/persistence/native_session_sync_react.tsx:131-333` | NativeSessionSync | 158 |
| `src/ui/http/http_request_viewer.tsx:162-339` | HttpRequestViewer | 155 |
| `src/session/shell/session_shell_page.tsx:51-216` | SessionShellPage | 151 |
| `src/views/query_result/cell_detail_overlay.tsx:221-388` | CellDetailOverlayInner | 146 |

## Files that no test loads

Mostly entry points and pages: `oauth/oauth_redirect.tsx` (354 lines), `shell_app/shell_page.tsx` (294), the demo pages
(`demos/`, 564), `shell/filesystem_dialog.tsx` (152), `app/loading/shared_session_import.tsx` (142),
`app/loading/app_setup.ts` (131), `app/app.tsx` (122), `shell/filesystem_mount_dialog.tsx` (118),
`connections/salesforce/salesforce_connection_setup_mock.tsx` (103) and 22 smaller files.

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
- The mocked query results of the Hyper and Salesforce mocks built their batches with the global `length` of the window
  instead of 1000 rows: every batch was empty.
- The Int64 fallback of `ArrowTextColumnFormatter` passed timestamps beyond the range of dates to
  `Intl.DateTimeFormat`, which threw `RangeError: Invalid time value`, and `getValue` of a single cell had no fallback at
  all. Such values now render as their epoch milliseconds.
- Clicking the selected auth type of the Trino settings again replaced the auth params and dropped the saved username and
  secret (or the OAuth fields).
- A concealed text field showed `*` for every character and passed the shown text back on input, so typing into the Trino
  secret stored `*b` for `ab`. Concealed fields are now password inputs with the real value.

## Suggested next tests

1. `computeColumnAggregates` and `setupWebHyperDB` with the Hyper test pool.
2. `replaceShell` of the browser shell and `replaceSessionScriptsFromStorage` of the session scripts.
3. Render tests of `MostFrequentCellImpl` and `HistogramCellImpl` with column aggregates like the data table tests.
4. Render tests of `LogViewer` and `StorageWriterView` with a test logger and storage writer.

## Flaky tests

- `hyper_log_metrics.test.ts` > extracts the queries of pooled connections by their client context: failed once with no
  queries in the log and passed on the reruns, it likely reads the Hyper log before the entries arrive.
