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

**Overall: 81.5% (52,332 / 64,238 lines) in 572 files**, up from 79.0% (50,730 / 64,237) earlier on the same day
and 76.1% (46,091 / 60,569 lines in 544 files) on 2026-11-02. The app grew by 28 files between 2026-11-02 and
2026-11-04, so that part of the increase mixes new tests and new code. The tests of 2026-11-04 cover:
- the Hyper links of the app (`useHyperLinks`), the Trino and Hyper connection settings, the download of the shell Wasm,
  the session import transactions, the logging and pickers of the shell files, the pending diff of the editor, the
  restored connections, the mocked query results, the file download, the synthetic stock feed and `useLiveQuery`;
- the most frequent value and histogram cells of the data table, rendered with real column aggregates;
- `LogViewer`, `StorageWriterView` and `HttpRequestViewer`, `replaceShell` of the browser shell, the focus store of the
  data table, the drag events of the web listener, the flavor of the page url, the connection params label, the editor
  focus, the input types of the session, the dataflow module hook, a failed session restore and the Salesforce setup.

These files are now at 98% to 100%, except `shell/browser_shell.ts` (90.4%), `shell/api.ts` (90.5%) and
`compute/arrow_formatter.ts` (92.9%).

## Gaps in logic (`.ts`)

The cheapest next tests: functions of `.ts` files that tests load but never call.

| Location | Function | Uncovered lines |
|---|---|---|
| `src/compute/tasks/column_aggregation.ts:86-96` | computeColumnAggregates | 11 |
| `src/platform/hyperdb/hyperdb_provider_web.ts:148-158` | setupWebHyperDB | 11 |
| `src/views/query_result/use_cross_filters.ts:15-27` | scalarFiltersEqual | 11 |
| `src/session/persistence/app_state_loader.ts:526-536` | mergeRestoredSessionIntoScripts | 10 |
| `src/session/scripts/focus.ts:169-178` | deriveFocusFromCompletionCandidates | 10 |
| `src/session/scripts/session_scripts.ts:534-543` | reduceScripts | 10 |
| `src/session/scripts/session_scripts.ts:544-553` | reduceScripts | 10 |
| `src/session/editor/dashql_completion_hint.ts:215-226` | computeCompletionHintDecorations | 9 |
| `src/session/editor/dashql_completion_listener.ts:54-64` | handleMousedownEvent | 9 |
| `src/session/inputs/session_inputs.ts:108-116` | collectSessionInputs | 9 |
| `src/session/persistence/app_state_loader.ts:514-524` | mergeRestoredSessionIntoConnections | 9 |
| `src/session/scripts/script_reference_reports.ts:4-12` | sameReport | 9 |

## Gaps in components (`.tsx`)

| Location | Function | Uncovered lines |
|---|---|---|
| `src/session/persistence/session_import_provider.tsx:89-394` | SessionImportProvider | 268 |
| `src/agent/agent_bridge.tsx:100-377` | AgentBridgeProvider | 252 |
| `src/app/internals/app_settings_view.tsx:50-325` | AppSettings | 238 |
| `src/session/dashboard/dashboard.tsx:90-347` | Dashboard | 228 |
| `src/app/internals/storage_browser_view.tsx:264-494` | StorageBrowserView | 195 |
| `src/session/persistence/native_session_sync_react.tsx:131-333` | NativeSessionSync | 158 |
| `src/session/shell/session_shell_page.tsx:51-216` | SessionShellPage | 151 |
| `src/views/query_result/cell_detail_overlay.tsx:221-388` | CellDetailOverlayInner | 146 |
| `src/views/query_result/data_table_cell_header_plots.tsx:40-196` | HeaderPlotsCellImpl | 126 |
| `src/views/visualization/column_aggregation_bar.tsx:30-182` | ColumnAggregationBar | 126 |
| `src/session/trace_log_viewer.tsx:33-210` | TraceLogViewer | 122 |
| `src/session/persistence/query_cache_view.tsx:73-216` | QueryCacheView | 118 |

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
- The brush of `HistogramCell` converted pixels to bins without the outer padding of the band scale: brushing bars 1 and 2
  of 4 filtered bins 2 and 3. A controlled selection was drawn shifted by the same padding.
- The hover of `HistogramCell` took the paddings as fractions of the bandwidth instead of the step, so the pointer near the
  right edge of a higher bin focused the next bin. With a brush at the left edge, the hover measured against the box of
  the brush handles and picked the wrong bin.
- `MostFrequentCell` labeled the axis of a column without rows `NaN%`. Such a column still shows "all distinct".
- `LogViewer` threw `RangeError: Invalid index specified: 0` without rows, e.g. for a trace without records: it scrolled
  to the last row of an empty list.
- `deriveFocusFromEditorUpdate` marked the column references of a focused column as references of the target table.

## Suggested next tests

1. Render tests of `AppSettings`, `StorageBrowserView` and `QueryCacheView` with a test storage backend.
2. `scalarFiltersEqual` through `useCrossFilters` with a repeated selection, and `computeColumnAggregates` with the
   compute worker.
3. `collectSessionInputs` and `deriveFocusFromCompletionCandidates` of a session with core Wasm scripts.
4. `setupWebHyperDB` once a test can fail the engine after it started; it needs the browser Hyper engine.

## Flaky tests

- `hyper_log_metrics.test.ts` > extracts the queries of pooled connections by their client context: failed once with no
  queries in the log and passed on the reruns, it likely reads the Hyper log before the entries arrive.
