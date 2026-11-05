# DashQL App Coverage Report

Date: 2026-11-05

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

**Overall: 87.1% (56,806 / 65,216 lines) in 578 files**, up from 85.3% (55,413 / 64,946 lines in 575 files) earlier the
same day, 81.7% at the start of the day and 81.5% on 2026-11-04. The app sources changed between the two runs of the day,
so not all of the difference comes from tests. The latest tests cover session import, the sync of native session folders,
the query executor and the OAuth redirect page:
- `SessionImportProvider` 0.3% → 97.8%: portable bundles and native folders, conflicts, connection questions, failures of
  the writes and the restoration. It takes `reload` and the dependencies of its card as `dependencies`, so the paths that
  reload the app can run in the test frame.
- `NativeSessionSync` 14.7% → 98.2%: external changes, local edits while the question is open, connections and script
  files that a session file brings along, attachments.
- `QueryExecutorProvider` 53.6% → 93.0%: results, failures, cancellation, the query result cache, profiles.
- `oauth_redirect.tsx` 0% → 100%: both flows, errors of the provider, states that cannot be trusted, callback urls. The
  page moved out of its entry point, `oauth_redirect_main.tsx`, which is the file a test can't load.

The earlier tests of 2026-11-05 render these components:
- `AppSettings`, `StorageBrowserView` (on a mocked OPFS), `QueryCacheView`, `InternalsViewer` with the query history,
  and `AppSettingsSync`;
- `Dashboard` (run, rename, delete, renderers, staged changes, keyboard and pointer resize, keyboard drag),
  `ScriptDiagnosticsButton` and `collectScriptDiagnostics`, `ScriptStatisticsBar`, `TraceLogViewer`, and the save and
  share overlays of a session;
- `CellDetailOverlay` with the core, the header plots of the data table, `ColumnAggregationBar` end to end with Hyper
  and the compute scheduler, `QueryResultActionMenu`, and `scalarFiltersEqual` of the cross filters.

These components are now at 97% to 100%. `Dashboard` takes its run function and overlays as `dependencies`, like
`DashboardCard` and `SessionFeed`.

## Gaps in logic (`.ts`)

The cheapest next tests: functions of `.ts` files that tests load but never call.

| Location | Function | Uncovered lines |
|---|---|---|
| `src/compute/tasks/column_aggregation.ts:86-96` | computeColumnAggregates | 11 |
| `src/platform/hyperdb/hyperdb_provider_web.ts:148-158` | setupWebHyperDB | 11 |
| `src/session/scripts/focus.ts:169-178` | deriveFocusFromCompletionCandidates | 10 |
| `src/session/scripts/session_scripts.ts:534-543` | reduceScripts | 10 |
| `src/session/scripts/session_scripts.ts:544-553` | reduceScripts | 10 |
| `src/session/editor/dashql_completion_hint.ts:215-226` | computeCompletionHintDecorations | 9 |
| `src/session/editor/dashql_completion_listener.ts:54-64` | handleMousedownEvent | 9 |
| `src/session/inputs/session_inputs.ts:108-116` | collectSessionInputs | 9 |
| `src/session/scripts/focus.ts:160-168` | deriveFocusFromCompletionCandidates | 9 |
| `src/session/scripts/session_scripts.ts:554-563` | reduceScripts | 9 |
| `src/storage/composite_storage_backend.ts:522-536` | loadNativeSession | 9 |
| `src/storage/opfs_storage_backend.ts:451-460` | updateConnections | 9 |
| `src/utils/hash_murmur3.ts:54-62` | clone | 9 |
| `src/connections/embedded_connection.ts:31-38` | useNewSessionConnection | 8 |
| `src/connections/embedded_connection.ts:41-48` | useEmbeddedConnection | 8 |
| `src/session/editor/dashql_processor.ts:328-335` | update | 8 |
| `src/session/editor/dashql_script_references.ts:22-29` | referenceDiagnostics | 8 |
| `src/session/editor/editor_focus.ts:8-15` | dashqlEditorOf | 8 |
| `src/session/inputs/session_inputs.ts:186-193` | sessionInputLiteral | 8 |
| `src/session/scripts/session_scripts.ts:518-525` | reduceScripts | 8 |

## Gaps in components (`.tsx`)

| Location | Function | Uncovered lines |
|---|---|---|
| `src/agent/agent_bridge.tsx:100-377` | AgentBridgeProvider | 252 |
| `src/session/shell/session_shell_page.tsx:51-216` | SessionShellPage | 151 |
| `src/connections/salesforce_connection_settings.tsx:341-477` | SalesforceConnectorSettings | 117 |
| `src/session/scripts/script_editor.tsx:148-269` | updateEditor | 91 |
| `src/session/feed/script_entry_header.tsx:49-139` | (anonymous) | 84 |
| `src/connections/connection_settings_overlay.tsx:35-118` | ConnectionSettingsOverlay | 74 |
| `src/demos/stock_analysis/live_board.tsx:100-159` | LiveBoard | 54 |
| `src/connections/hyper/hyper_log_metrics_provider.tsx:100-156` | useHyperLogRows | 49 |
| `src/ui/logger/logger_toast.tsx:68-140` | LoggerToast | 49 |
| `src/ui/json/json_copy_button.tsx:39-92` | click | 43 |
| `src/app/app_setup_page.tsx:45-87` | AppSetupPage | 41 |
| `src/session/persistence/session_storage_overlay.tsx:68-114` | SessionStorageViewer | 40 |
| `src/shell_app/internals.tsx:24-65` | ShellInternalsViewer | 40 |
| `src/session/dataflow/dataflow_canvas.tsx:961-1003` | DataflowInputBox | 39 |
| `src/connections/connection_overview_page.tsx:28-63` | ConnectionOverviewPage | 32 |

## Files that no test loads

Mostly entry points and pages: `shell_app/shell_page.tsx` (294 lines), the demo pages
(`demos/`, 706 with the new agent face page), `shell/filesystem_dialog.tsx` (152),
`app/loading/shared_session_import.tsx` (142), `app/loading/app_setup.ts` (134),
`session/scripts/script_editor_dialog.tsx` (126), `app/app.tsx` (122), `shell/filesystem_mount_dialog.tsx` (118),
`connections/salesforce/salesforce_connection_setup_mock.tsx` (103) and 19 smaller files. `connections/query_viewer.tsx`
and `views/query_profile/engine_profile_view.tsx` are now loaded by the tests of the internals and the cell detail
overlay.

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
- `QueryResultActionMenu` took every `ResultProjectionError` for a projected text, the errors are strings as well.
  "Project Columns" stayed enabled for a script whose last statement is no query, and replaced the script text with
  `no_query`.

## Suggested next tests

1. `AgentBridgeProvider`, and `SessionShellPage` with a test storage backend and the shell Wasm.
2. `ConnectionSettingsOverlay`, `SalesforceConnectorSettings` and `LoggerToast` as render tests.
3. `script_entry_header.tsx` and `script_editor_dialog.tsx` of the feed, and `updateEditor` of `ScriptEditor`.
4. `computeColumnAggregates` with the compute worker, and `collectSessionInputs` and
   `deriveFocusFromCompletionCandidates` of a session with core Wasm scripts.
5. `setupWebHyperDB` once a test can fail the engine after it started; it needs the browser Hyper engine.

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

## Flaky tests

- `hyper_log_metrics.test.ts` > extracts the queries of pooled connections by their client context: failed once with no
  queries in the log and passed on the reruns, it likely reads the Hyper log before the entries arrive.
