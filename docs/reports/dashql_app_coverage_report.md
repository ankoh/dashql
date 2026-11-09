# DashQL App Coverage Report

Date: 2026-11-09

Coverage of the TypeScript sources of `packages/dashql-app/src` in the Chromium browser tests (tests and `src/tests/`
excluded). The coverage workflow uploads it to Coveralls together with the Rust core and publishes both to
[coverage.dashql.app](https://coverage.dashql.app), which show the uncovered lines of every file.

```bash
bazel test //packages/dashql-app:coverage_chromium
```

The target builds the pages bundle unminified and with source maps (`vite --mode coverage`), records the V8 block
coverage of the test page, its test frames and the real pages of the page tests, and maps it back to the sources
(`test/browser_coverage.mjs`). It writes `coverage.dat` (LCOV) and `coverage_summary.txt` to
`bazel-testlogs/packages/dashql-app/coverage_chromium/test.outputs/`. The summary lists the gaps: the outermost functions
and blocks that never ran, with their lines and the enclosing function, largest first. Workers are not covered.

**Overall: 93.8% (62,253 / 66,396 lines) in 592 files**, up from 93.7% (61,186 / 65,309 lines in 578 files) in the report of
2026-11-06. The page tests (`test/browser_page_tests.mjs`) boot the real `index.html`, `shell.html`, `demos.html` and
`oauth.html`:
- the app: a query in the composer, the dashboard and its editor overlay, the dataflow canvas and its editor dialog, an edit
  that survives a reload, the session storage, the navbar, the color scheme, a session opened from its link, and the warning
  and the drawer of a narrow screen;
- the shell: a query and its result in the overlay, `.last`, its query history, a file mounted with `.fs`, a reset;
- the demos: the index, the stock analysis on the synthetic feed, the UI foundations, Wobble;
- the redirect page of OAuth without a provider response.

The folders that moved most since the previous report:

| Folder | 2026-11-06 | Now |
|---|---|---|
| `demos` | 97.2% | 84.3%, the new landing backdrop demo has no page test |
| `shell_app` | 90.2% | 90.8% |
| `shell` | 93.8% | 94.0% |
| `session` | 93.7% | 94.1% |
| `connections` | 93.1% | 93.3% |
| `app` | 92.7% | 92.6% |

Every result of the shell now opens in the overlay, so a page test runs the analysis and the view of a result in the real
`shell.html`. Much of the coverage of the demos and the app shell only shows that they render, it does not check their
behavior line by line like the tests in the test frame.

## Gaps in logic (`.ts`)

The cheapest next tests: functions of `.ts` files that tests load but never call.

| Location | Function | Uncovered lines |
|---|---|---|
| `src/compute/tasks/column_aggregation.ts:86-96` | computeColumnAggregates | 11 |
| `src/session/scripts/focus.ts:169-178` | deriveFocusFromCompletionCandidates | 10 |
| `src/app/loading/app_setup.ts:199-207` | useAppSetup | 9 |
| `src/session/scripts/focus.ts:160-168` | deriveFocusFromCompletionCandidates | 9 |
| `src/storage/composite_storage_backend.ts:522-536` | loadNativeSession | 9 |
| `src/utils/hash_murmur3.ts:54-62` | clone | 9 |
| `src/platform/process.ts:4-11` | relaunch | 8 |
| `src/shell/api.ts:286-293` | applyCompletion | 8 |
| `src/shell/api.ts:666-673` | formatElapsed | 8 |
| `src/storage/session_test_backend.ts:140-147` | renameDataFile | 8 |
| `src/utils/base64.ts:105-112` | decode | 8 |
| `src/compute/computation_state.ts:702-708` | reduceComputationState | 7 |
| `src/compute/tasks/table_aggregation.ts:60-68` | computeTableAggregates | 7 |
| `src/connections/hyper/hyper_error_info.ts:116-123` | decodeGrpcStatusDetails | 7 |
| `src/connections/trino/trino_connection_setup.ts:251-257` | setupTrinoConnectionOAuth | 7 |
| `src/session/dataflow/dataflow_scene.ts:532-538` | buildDataflowScene | 7 |
| `src/session/editor/dashql_completion_listener.ts:66-73` | handleScrollEvent | 7 |
| `src/session/editor/dashql_completion_listener.ts:75-82` | handleBlurEvent | 7 |
| `src/session/editor/dashql_completion_patches.ts:205-211` | updateCursorWithCompletion | 7 |
| `src/session/inputs/use_apply_session_input.ts:34-40` | useApplySessionInput | 7 |

## Gaps in components (`.tsx`)

| Location | Function | Uncovered lines |
|---|---|---|
| `src/connections/salesforce_connection_settings.tsx:341-477` | SalesforceConnectorSettings | 117 |
| `src/connections/salesforce/salesforce_connection_setup_mock.tsx:29-137` | setupSalesforceConnection | 91 |
| `src/connections/hyper/hyper_log_metrics_provider.tsx:100-156` | useHyperLogRows | 49 |
| `src/shell_app/shell_page.tsx:146-196` | authenticate | 48 |
| `src/ui/json/json_copy_button.tsx:39-92` | click | 43 |
| `src/session/dataflow/dataflow_canvas.tsx:961-1003` | DataflowInputBox | 39 |
| `src/connections/connection_overview_page.tsx:28-63` | ConnectionOverviewPage | 32 |
| `src/ui/logger/logger_toast.tsx:31-66` | Toast | 32 |
| `src/query/query_history_viewer.tsx:55-85` | entryToObject | 31 |
| `src/connections/hyper/hyper_log_dashboard.tsx:424-453` | HyperLogDashboard | 29 |
| `src/connections/connection_status.tsx:32-66` | - | 28 |
| `src/ui/version/version_viewer.tsx:176-205` | VersionInfo | 27 |
| `src/views/visualization/visualization_panel.tsx:30-58` | VisualizationPanel | 26 |
| `src/ui/version/release_bundle.tsx:20-45` | ReleaseBundle | 25 |
| `src/connections/connection_settings_overlay.tsx:249-270` | ConnectionSaveBar | 21 |

## Files where no line ran

`demos/landing_backdrop/landing_backdrop_page.tsx` (179), `connections/salesforce/salesforce_connection_setup_mock.tsx`
(103), `demos/landing_backdrop/landing_backdrop.tsx` (18) and `platform/process.ts` (8). A loaded module of function
declarations has no line that runs on import, so this does not mean that no test loads them. The gap tables include these
files, too.

## Bugs found by the new tests

- `NativeSessionSync` recorded the attachment listing of a session before it read the session file. When that read failed,
  the next check saw no difference and the changed attachments stayed unknown until they changed again. The listing is now
  recorded once the change was handled.
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
- `ColumnAggregationBar` attached its `ResizeObserver` only on the first render, when it usually rendered nothing yet
  because the table computation did not exist. The width stayed 0 and every plot remained a blank placeholder.
- `SessionShellPage` did not check its run again after the terminal opened. A catalog that changed meanwhile left two
  terminals in the page, a page that closed meanwhile left its terminal and shell behind, and a terminal that could not open
  left its shell behind.
- `SessionShellPage` replaced the shell of a new ordinal under the old prompt, e.g. `hyper#2>` after the connection became
  `#1`.
- The terminal of `SessionShellPage` took the focus in the frame after it opened, also when its page was hidden by then.
- `QueryResultActionMenu` took every `ResultProjectionError` for a projected text, the errors are strings as well.
  "Project Columns" stayed enabled for a script whose last statement is no query, and replaced the script text with
  `no_query`.

## Suggested next tests

1. The landing backdrop demo in the page test of the demos: `LandingBackdropPage` is most of the drop of `demos`.
2. `SalesforceConnectorSettings`, as a render test or with the Salesforce mock in a page test.
3. The remaining paths of the entry points: a session loaded from a shared URL (`useSharedSessionImport`), a dropped file
   (`file_dropzone.tsx`), and the login (`authenticate`, `onSuccess`), the shared scripts and `showResultError` of
   `shell_page.tsx`. The session shell tests a result that fails to render, the standalone shell does not.
4. `formatElapsed` of `shell/api.ts` past one minute, the cheapest gap of the shell.
5. `computeColumnAggregates` with the compute worker, and `deriveFocusFromCompletionCandidates` of a session with core Wasm
   scripts.

## Other findings

- A local edit while `NativeSessionSync` asks about an external change leads to three questions when the user agrees: the
  first, the warning about the pending edit, and the same warning again, because the edit moved the write generation and
  the check starts over. Starting over is what keeps a stale decision from being applied, the third question is only
  redundant. `native_session_sync.test.tsx` pins the three questions.
- `styles/theme.test.ts` fails on a checkout with an old `bazel-bin`: its glob also finds the CSS files that `copy_to_bin`
  left there for sources that moved. On 2026-11-05 that was all of its 1,123 violations, the sources have none.
- The JSON schema of the saved app settings (`AppSettings` in `proto/json/dashql/app_manifest.json`) rejects unknown
  fields but lacks `experimental_wasm_backend`, `macWindowLayout`, `navRailWide`, `agentHarness`, `agentModel` and
  `agentEffort`. The app saves them anyway, nothing validates the settings when they are written.
- With the core loaded, `detectFormats` of the cell detail overlay offers SQL for any text, `hello world` included.
- `oauth.html` without a `state` shows `Unexpected end of JSON input` under "Authorization Failed": the parser error of the
  missing state, not a message about the missing provider response.

## Flaky tests

- `hyper_log_metrics.test.ts` > extracts the queries of pooled connections by their client context: failed once with no
  queries in the log and passed on the reruns, it likely reads the Hyper log before the entries arrive.
