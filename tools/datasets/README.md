# dashql-datasets — hosted test datasets for `data.dashql.app`

Bazel builds the test datasets hermetically and `dashql-datasets` mirrors them to the R2 bucket `dashql-data`, served
at `https://data.dashql.app`. The design, the entries of `DATASETS` in [`datasets.bzl`](./datasets.bzl) and the steps
to add a dataset are in [`docs/design/test_data.md`](../../docs/design/test_data.md).

```bash
# Hermetic build (fetch, convert, assemble, index); re-runs are cached
bazel build //tools/datasets:datasets

# Dry run: print the planned uploads, touch nothing (no credentials needed)
bazel run //tools/datasets:sync -- --dry-run

# Mirror to R2
export DASHQL_DATA_R2_ENDPOINT=…
export DASHQL_DATA_R2_ACCESS_KEY_ID=…
export DASHQL_DATA_R2_SECRET_ACCESS_KEY=…
bazel run //tools/datasets:sync
```

CI does the same on `workflow_dispatch` via `.github/workflows/publish_data.yml`, with the credentials from GitHub
secrets.
