# dashql-datasets — hosted test datasets for `data.dashql.app`

Real test datasets (à la [vega-datasets](https://github.com/vega/vega-datasets)) that
demo workbooks can query over HTTP — e.g. from a local Hyper connector reading remote
Parquet. This package **builds** the datasets hermetically with Bazel and **mirrors**
them to the R2 bucket `dashql-data` (served at `https://data.dashql.app`).

## URL scheme

```
https://data.dashql.app/<dataset>/v<version>/<table>.parquet   # immutable, cache-forever
https://data.dashql.app/index.json                             # mutable registry, short TTL
```

`index.json` is `{ dataset -> version -> [ {url, bytes, sha256} ] }`.

## How it works

Everything up to the upload is a normal, cacheable Bazel build — **offline**, since
network access is only allowed in the fetch phase (repo rules requiring a pinned
`sha256`):

1. **Fetch** (`deps.bzl` module extension): each source in `DATASETS` becomes a
   hash-pinned `http_file`. (`tpch` datasets have no sources — see below.)
2. **Convert** (`datasets.bzl` → genrule): the vendored DuckDB CLI (`//bazel:duckdb_cli`)
   runs each output's **verbatim SQL** — the author writes the full statement (reader +
   `COPY … TO … (FORMAT …)`); the format is whatever the SQL says (Parquet, CSV, …).
   `tpch` datasets instead `LOAD` the vendored tpch extension and `CALL dbgen`.
3. **Assemble** (`copy_to_directory`): stage into `<dataset>/v<version>/<file>`.
4. **Index** (`dashql-datasets index`): walk the tree → `index.json`.
5. **Mirror** (`dashql-datasets sync`): upload to R2 — versioned files are immutable
   (skip-if-present via HeadObject), `index.json` is always re-put (and uploaded last).

## Add a dataset

[`docs/design/test_data.md`](../../docs/design/test_data.md) describes the entries of `DATASETS` in
[`datasets.bzl`](./datasets.bzl), the `sql` and `tpch` kinds, the vendored DuckDB CLI and tpch extension, and the
steps to add a dataset or a TPC-H scale factor.

## Build & publish

```bash
# Hermetic build (fetch + convert + assemble + index); re-runs are cached.
bazel build //tools/datasets:datasets

# Inspect
duckdb -c "SELECT * FROM 'bazel-bin/tools/datasets/datasets/vega-cars/v1/cars.parquet' LIMIT 5"

# Dry run — print planned uploads, touch nothing (no credentials needed)
bazel run //tools/datasets:sync -- --dry-run

# Live mirror to R2 (needs the three env vars below)
export DASHQL_DATA_R2_ENDPOINT=…
export DASHQL_DATA_R2_ACCESS_KEY_ID=…
export DASHQL_DATA_R2_SECRET_ACCESS_KEY=…
bazel run //tools/datasets:sync
```

CI does the same on `workflow_dispatch` via
`.github/workflows/publish_data.yml`, reading the credentials from GitHub secrets.
