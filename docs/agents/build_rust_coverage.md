# Rust Coverage under Bazel 8/9

The coverage workflow (`.github/workflows/coverage.yml`) covers the Rust core and the Rust tools: it runs
`bazel coverage` over the core crates (`//packages/dashql-core/...` and its `-session`, `-shell` and `-profile`
siblings), `//packages/dashql-dataflow/...`, `//packages/dashql-parser/...`, `//packages/dashql-snapshots/...` and the
unit tests of `dashql-cli`, `dashql-native-proxy` and `dashql-pack`, instruments those crates except
`dashql-snapshots`, and uploads Bazel's combined report (`_coverage_report.dat`) to Coveralls. It uploads the LCOV of
the app's browser tests (`//packages/dashql-app:coverage_chromium`, see `docs/reports/dashql_app_coverage_report.md`)
with it. It also renders both with `genhtml` and deploys the result to [coverage.dashql.app](https://coverage.dashql.app),
next to the raw tracefiles (`lcov_rust.info`, `lcov_app.info`) and the gaps of the app (`app_gaps.txt`). Coveralls keeps
the history, the page only shows the latest push to main.

## Test targets must name their crate

`bazel coverage` does not instrument test targets, only the libraries and binaries they test. A `rust_test` with its own
`srcs` passes but reports nothing (`There was no coverage found.`), so a crate's unit tests take `crate = ":<target>"`.

The end-to-end tests of `dashql-cli` (`:bridge_test`, `:bridge_harness_test`, `:lint_test`) run the `dashql` binary in a subprocess and
report nothing either, so the coverage of `dashql-cli` is a lower bound and `src/main.rs` shows as uncovered.

## Empty tracefiles under Bazel 8/9

Bazel 8 runs the coverage collection in its own spawn (`SPLIT_COVERAGE_POST_PROCESSING=1`), and
`collect_coverage.sh` clears `RUNFILES_DIR` before it runs the LCOV merger, which for Rust tests is the
`collect_coverage` binary of `rules_rust`. Up to `rules_rust` 0.69 that binary took the empty `RUNFILES_DIR` as
the execroot, did not find the test binary and wrote an empty `coverage.dat`. We patched it to derive the bin
directory from `COVERAGE_DIR` until `rules_rust` 0.70 shipped the same fix
([rules_rust PR #3812](https://github.com/bazelbuild/rules_rust/pull/3812)).

## Rust tests reported no coverage

Under Bazel 9 every `rust_test` produced an empty `coverage.dat`, and the per-test LCOV merger logged
`There was no coverage found.` `collect_coverage.sh` runs the collector of the test rule
(`CC_CODE_COVERAGE_SCRIPT`, the `collect_coverage` binary of `rules_rust`) only if `GENERATE_LLVM_LCOV` is set.
`--experimental_generate_llvm_lcov` does not set it for every test anymore: `cc_test` of `rules_cc` puts it into
its own test environment, `rust_test` does not. `.bazelrc` sets it for all tests under `coverage`:

```starlark
coverage --test_env=GENERATE_LLVM_LCOV=1
```

## Sources of dashql-parser were dropped

`dashql-parser` has generated sources (`src/tables.rs`, `src/keywords/table.rs`). `rules_rust` then copies all
sources of the crate into `bazel-out/<config>/bin`, and llvm-cov reports them as
`bazel-out/<config>/bin/packages/dashql-parser/src/...`. The LCOV merger keeps only files listed in the
instrumented files manifest, which names them at their source paths, so the whole parser vanished from the
report.

**`bazel/patches/rules_rust_coverage_source_paths.patch`** makes `collect_coverage.rs` strip the
`bazel-out/<config>/bin/` prefix from the `SF:` records. The checked-in sources now match the manifest; the
generated ones are not in it and stay excluded.

`MODULE.bazel` applies it with a `single_version_override` of `rules_rust`, and `bazel/patches/BUILD.bazel`
exports the patch files.

## Upstream

`rules_rust` 0.71 and newer move the collector to `rust/coverage/collect_rust_coverage.rs`, the patch has to
follow it there. They also fail on the crate_universe call of protobuf, which has no lockfile before protobuf 37,
so Renovate holds `rules_rust` below 0.71 for now.
