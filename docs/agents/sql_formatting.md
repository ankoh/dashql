# Extending and Validating SQL Formatting

This guide documents the standard workflow to add or improve SQL formatter behavior in DashQL and validate it end-to-end.

## 1) Implement formatter behavior

1. Update formatter logic in `packages/dashql-core/src/formatter/formatter.cc`.
2. If needed, add declarations in `packages/dashql-core/include/dashql/formatter/formatter.h`.
3. Ensure the node is handled in `Formatter::FormatNode(...)` dispatch.
4. Keep output style consistent with existing formatter conventions (lowercase SQL keywords, current break/indent behavior).

Example: for `OBJECT_SQL_ORDER`, read attributes like `SQL_ORDER_VALUE`, `SQL_ORDER_DIRECTION`, and `SQL_ORDER_NULLRULE`, then render the order item text used by `order by` clauses.

## 2) Add/extend formatter snapshot templates

Formatter snapshot templates live in:
- `snapshots/formatter/*.tpl.yaml`

Generated snapshot files live in:
- `snapshots/formatter/*.yaml`

To add a new category:
1. Create `snapshots/formatter/<category>.tpl.yaml`.
2. Follow template structure used by existing files such as `expressions.tpl.yaml`.
3. Add multiple focused test cases with:
   - `name`
   - `input`
   - `dialects.duckdb`
4. Prefer adding `validation.setup` for DuckDB-validatable SQL so formatted outputs can be executed in validation tests.
5. Add per-mode overrides in `formatted` only when needed (for example, custom `width` in compact mode).

## 3) Generate snapshots from templates

Run:

```bash
bazel run //snapshots/formatter:update
```

This generates/updates `snapshots/formatter/<category>.yaml` from all `.tpl.yaml` files in the formatter snapshot folder.

## 4) Register snapshot suites

Add your new generated snapshot file to C++ test suite instantiations.

### Snapshot equality suite
File:
- `packages/dashql-core/test/formatter_snapshot_test_suite.cc`

Add an `INSTANTIATE_TEST_SUITE_P(...)` entry using:
- `FormatterSnapshotTest::GetTests("<category>.yaml")`

### DuckDB validation suite
File:
- `packages/dashql-core/test/formatter_validation_duckdb_test_suite.cc`

Add an `INSTANTIATE_TEST_SUITE_P(...)` entry using:
- `FormatterSnapshotTest::GetTestsWithValidation("<category>.yaml", "duckdb")`

This ensures both textual snapshot checks and executable SQL validation are covered.

## 5) Add a JS API formatting test (recommended)

File:
- `packages/dashql-app/src/core/api_formatting.test.ts`

Add at least one focused runtime formatting test that:
1. Creates a script via API
2. Inserts SQL input
3. Formats with `FormattingConfigT`
4. Asserts exact output string

This catches integration regressions between core formatter and app-side API/WASM binding behavior.

## 6) Run required Bazel tests

Run the full targets used for acceptance:

```bash
bazel test //packages/dashql-core:all
bazel test //packages/dashql-app:all
```

If failures occur:
1. Fix formatter or expected snapshots as needed.
2. Re-run `bazel run //snapshots/formatter:update` if templates changed.
3. Re-run both test targets until green.

## 7) Typical change checklist

- [ ] Formatter logic updated in core (`formatter.cc` / `formatter.h` if needed)
- [ ] New/updated `.tpl.yaml` tests added
- [ ] Snapshots regenerated via `//snapshots/formatter:update`
- [ ] Snapshot suite registration updated
- [ ] DuckDB validation suite registration updated (if validatable)
- [ ] JS API formatting test added/updated
- [ ] `bazel test //packages/dashql-core:all` passes
- [ ] `bazel test //packages/dashql-app:all` passes
