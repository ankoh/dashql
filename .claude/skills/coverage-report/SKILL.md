---
name: coverage-report
description: Run coverage for the Rust core and the TypeScript app and update the coverage reports
---

# Update the Coverage Reports

Run LLVM source-based coverage for the test targets of the Rust core (dashql-core and its -session, -shell and -profile siblings, dashql-dataflow, dashql-parser, dashql-snapshots) and the Rust tools (dashql-cli, dashql-native-proxy, dashql-pack) and regenerate `docs/reports/dashql_core_coverage_report.md`.
Then run the V8 coverage of the app's browser tests and regenerate `docs/reports/dashql_app_coverage_report.md`.

## Steps

1. Run coverage collection:

```bash
bazel coverage --config=fastbuild \
    --instrumentation_filter="//packages/dashql-core(-session|-shell|-profile)?[/:],//packages/dashql-dataflow[/:],//packages/dashql-parser[/:],//packages/dashql-cli[/:],//packages/dashql-native-proxy[/:],//packages/dashql-pack[/:]" \
    //packages/dashql-core/... //packages/dashql-core-session/... //packages/dashql-core-shell/... \
    //packages/dashql-core-profile/... //packages/dashql-dataflow/... //packages/dashql-parser/... //packages/dashql-snapshots/... \
    //packages/dashql-cli:tests //packages/dashql-native-proxy:test //packages/dashql-pack:test
```

2. Extract per-file coverage from the lcov report at `$(bazel info output_path)/_coverage/_coverage_report.dat`. Parse each `SF:` record for files matching `packages/dashql-core/src/`, `packages/dashql-core-session/src/`, `packages/dashql-core-shell/src/`, `packages/dashql-core-profile/src/`, `packages/dashql-dataflow/src/` and `packages/dashql-parser/src/` and extract `LH:` (lines hit) and `LF:` (lines found) values.

3. Rewrite `docs/reports/dashql_core_coverage_report.md` with:
   - Today's date
   - Overall line coverage percentage
   - Per-file table sorted by coverage percentage (descending)
   - Top offenders section listing files with the most uncovered lines
   - Suggested actions for improving coverage
   - A section for the Rust tools with the coverage of `dashql-cli`, `dashql-native-proxy` and `dashql-pack` and their largest gaps, not counted in the overall number of the core

4. Only include `src/` files in the table (exclude `tests/`, `benches/` and generated files such as `src/tables.rs`).

5. Report the overall coverage percentage and highlight any significant changes vs the previous report.

## TypeScript app

6. Run the browser tests with coverage:

```bash
bazel test //packages/dashql-app:coverage_chromium
```

7. Read `bazel-testlogs/packages/dashql-app/coverage_chromium/test.outputs/coverage_summary.txt` (`coverage.dat` next to
   it is the LCOV). It lists the gaps in logic (`.ts`) and in components (`.tsx`): the outermost functions and blocks that
   never ran, with `file:first-last` lines and the enclosing function, largest first. Then the files that no test loads,
   then the line coverage per file.

8. Rewrite `docs/reports/dashql_app_coverage_report.md` with today's date, the overall line coverage and the change vs
   the previous report, the top 20 gaps in logic, the top 15 gaps in components, the files that no test loads, and
   suggested next tests picked from the gaps. Name the gaps by function, not by percentage.

