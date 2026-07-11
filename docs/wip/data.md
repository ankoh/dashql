# Plan: `data.dashql.app` — hosted test datasets

## Context

dashql demo notebooks currently have **no real data**. Example schemas/queries are
static SQL under `packages/dashql-app/static/examples/{tpch,tpcds,ssb,…}`; at runtime
demo mode *synthesizes* random Arrow batches (`src/utils/random_data.ts`). There is no
CSV/Parquet checked in anywhere.

We want a `data.dashql.app` subdomain to host real test datasets (à la
[vega-datasets](https://github.com/vega/vega-datasets)) that demo notebooks can query
over HTTP. Design constraints:

- **No raw CSV/JSON committed to the repo**, and **no standalone scripts**. The datasets
  are produced entirely by Bazel: sources are **hash-pinned** downloads, conversion to
  Parquet runs in a **genrule** via a vendored DuckDB CLI, and the result is an assembled
  directory tree — a normal, cacheable build artifact.
- **The upload tool is a dumb mirror.** It takes a locally-built directory and mirrors it to
  the R2 bucket (skip-if-present for immutable files, overwrite `index.json`). It knows
  nothing about dataset definitions, DuckDB, or the network beyond R2.
- **A dedicated, tiny mirror binary lives in `packages/dashql-data`** — *not* a new
  subcommand on `dashql-pack`. `dashql-pack` is the release tool for get.dashql.app (git /
  semver / minisign / channel manifests); mixing a second bucket + credential set into it
  couples two unrelated jobs. The mirror shares almost no code with it (post-redesign it
  needs only ~10 lines of S3-client setup, which `dashql-pack` already duplicates internally
  between `publish`/`vacuum`), so the two stay independent. **`dashql-pack` is left
  untouched by this feature**, de-risking the release pipeline.
- **Scope = hosting + maintenance pipeline only.** We do **not** yet change how the app loads
  data (no HTTPFS wiring / example-SQL rewrites — that's a follow-up).
- **Immutable versioned paths** on R2 so old notebooks keep working and CDN caching is safe.

### Location
The datasets live in a new **`packages/dashql-data/`** package, matching the existing
`dashql-*` naming (`dashql-app`, `dashql-core`, `dashql-pack`, …). The packages dir already
holds non-library packages (`hyper-docker` builds an image, `tauri-aclgen` is a codegen
tool), so a data-build package fits the convention. We also relocate the existing example
session so `examples/` holds sessions only.

### Why this is fully hermetic
- Bazel **build actions are offline**; network is allowed only in the **fetch phase**
  (repo rules like `http_archive`/`http_file`, which *require* a pinned `sha256`). That's how
  the repo already pulls duckdb/arrow/flatbuffers in `bazel/core_dependencies.bzl`, with
  hashes maintained by `scripts/update_bazel_hashes.py` + Renovate.
- So each dataset source becomes an `http_file` (URL + `sha256`), and the genrule reads the
  **local** fetched file — `read_json_auto('<path>')` / `read_csv_auto('<path>')`, **not**
  HTTPFS. Conversion is deterministic and remote-cacheable; re-runs are free unless a source
  hash or the DuckDB version changes.
- Everything the app will eventually query is produced by the same DuckDB engine, so the
  Parquet is exactly what consumers see.

## Architecture

```
packages/dashql-data/datasets.bzl  (declares datasets: url+sha256 sources, tables, shaping SQL)
        │
        │  ── fetch phase (hash-pinned) ──►  @dataset_<name>_<src>//file   (http_file)
        ▼
packages/dashql-data/BUILD.bazel   (macro expands each dataset)
   genrule  ─ DuckDB CLI (exec tool) reads local source, COPY … TO Parquet ─►  *.parquet
   copy_to_directory  ─ assemble  <name>/v<version>/<table>.parquet  ──────►
   :index_json  ─ py_binary computes {url,bytes,sha256} ────────────────────►  index.json
        ▼
   :datasets   (one directory: all parquet + index.json)   ← the build artifact
        │
        ▼   bazel run //packages/dashql-data:sync   (mirror :datasets → R2)
   dashql-data-sync (tiny Rust bin): walk dir, per file head_object on `dashql-data`,
     skip-if-present (immutable), upload; always re-put index.json.
        ▼
R2 bucket `dashql-data`  ──►  data.dashql.app
   /<dataset>/v<version>/<file>.parquet   (immutable, cache-forever)
   /index.json                            (mutable registry, short TTL)
```

- **Bazel owns fetch + convert + assemble + manifest.** All hermetic, all cached.
- **`dashql-data-sync` owns only the R2 mirror.** No definitions parsing, no DuckDB, no
  fetch — and no coupling to the release tool.

## Changes

### 0. Move the example session + create the package
- **Move the existing session** `examples/hyper/` → `examples/sessions/hyper/` (`git mv`).
  Clean move: nothing in the codebase references `examples/hyper` (grep across
  ts/tsx/rs/bazel/py/json/md is empty) and there's no `BUILD.bazel` under `examples/`.
- **Create `packages/dashql-data/`** as the data.dashql.app package.

### 1. `packages/dashql-data/datasets.bzl` — dataset declarations (hash-pinned)
Datasets live in Starlark (not JSON) so source hashes sit beside `# renovate:` markers,
exactly like `core_dependencies.bzl`. One entry per dataset:
```python
DATASETS = [
    {
        "name": "vega-cars",
        "version": "1",
        "sources": [{
            "as": "cars",
            "url": "https://raw.githubusercontent.com/vega/vega-datasets/v2.9.0/data/cars.json",
            "sha256": "…",            # hash-pinned; Renovate can bump the tag + hash
            "format": "json",
        }],
        "tables": [{"name": "cars", "from": "cars", "sql": None}],  # sql: optional DuckDB SELECT
    },
]
```
Plus `packages/dashql-data/README.md` (how to add a dataset, pin a hash, run `:sync`, the URL scheme).

### 2. Vendor the DuckDB **CLI** as a Bazel external (exec-config build tool)
- **`bazel/core_dependencies.bzl`**: add two `http_archive`s beside `duckdb_prebuilt_*`,
  reusing `_DUCKDB_VERSION`, with matching `# renovate: … depName=duckdb/duckdb` markers:
  `duckdb_cli_osx` (`duckdb_cli-osx-universal.zip`) and `duckdb_cli_linux_amd64`
  (`duckdb_cli-linux-amd64.zip`), each with a new `//bazel:external_duckdb_cli.BUILD`
  (`exports_files(["duckdb"])`; zip preserves the exec bit).
- **`//bazel:BUILD.bazel`**: add an `alias` `duckdb_cli` selecting per
  `@platforms//os:{macos,linux}` (mirrors the existing prebuilt-lib alias).
- **`MODULE.bazel`**: add both repos to `use_repo(core_deps, …)`.
- **Hashes**: hand-set initially; maintained by the existing Renovate flow (optionally add a
  handler in `scripts/update_bazel_hashes.py`).

### 3. Fetch phase — one `http_file` per source (hash-pinned)
- A small **module extension** (new `packages/dashql-data/deps.bzl`, or fold into
  `core_dependencies.bzl`) iterates `DATASETS` and declares an `http_file` per source →
  `@dataset_<name>_<as>//file`. `http_file` is load-bearing for the pin: it *requires*
  `sha256`. Register the extension in `MODULE.bazel`.
- (Reading the Starlark `DATASETS` from the extension keeps a single source of truth for URLs
  + hashes across the fetch phase and the BUILD macro.)

### 4. `packages/dashql-data/BUILD.bazel` — convert, assemble, index (all in-build)
A macro (in `datasets.bzl`) expands each dataset into:
- **`genrule` per dataset**: `srcs = [@dataset_<name>_<as>//file …]`,
  `tools = ["//bazel:duckdb_cli"]`. `cmd` emits a DuckDB SQL script that reads each **local**
  source (`read_json_auto`/`read_csv_auto` on `$(location …)`), applies optional shaping
  `sql`, and `COPY … TO '<out>/<table>.parquet' (FORMAT PARQUET)` via
  `$(execpath //bazel:duckdb_cli)`. Fully offline (Parquet/CSV/JSON are core CLI features —
  no extension install).
- **`copy_to_directory`**: stage every dataset's outputs into the final layout
  `<name>/v<version>/<table>.parquet` (same rule `dashql-app` uses to assemble `pages`).
- **`:index_json`**: a `py_binary` (rules_python already present) run via genrule over the
  assembled dir, emitting `index.json` = `{ dataset → version → files[{url,bytes,sha256}] }`
  (URLs rooted at `https://data.dashql.app`).
- **`:datasets`** (`copy_to_directory` or filegroup): the parquet tree **+** `index.json` as
  one directory — the artifact `sync` mirrors.

### 5. `packages/dashql-data` — a dedicated, tiny R2-mirror binary (Rust)
A standalone crate (**not** a `dashql-pack` subcommand — see the constraint above), added as
a member of the root Cargo workspace (`Cargo.toml`, alongside `dashql-native`,
`tauri-aclgen`, `dashql-pack`) and to the `crate_universe` manifest so Bazel picks it up.
- **`packages/dashql-data/Cargo.toml`**: minimal deps — `aws-sdk-s3`, `aws-config`,
  `aws-credential-types`, `tokio`, `clap`, `anyhow`, `log`, `env_logger`, `walkdir`. **No**
  `git2` / `minisign` / `semver` / `serde_*` / `sha2` (hashes are computed by the Bazel index
  step; the mirror never inspects file contents).
- **`src/main.rs`** (single file is fine): args `--dir <path>` (the built `:datasets` dir) +
  `--dry-run`. Read the three `DASHQL_DATA_R2_*` env vars; build the R2 client exactly as
  `dashql-pack`'s `publish_command.rs` does (the only logic worth copying — ~10 lines).
  Walk `--dir`; for each file the key is its path relative to `--dir`; `head_object` on bucket
  `dashql-data` → **skip if present** (immutable), else `put_object` (single-shot;
  `application/octet-stream`, `application/json` for `index.json`, which is always re-put).
- Because dataset files are small (KB–MB), a single `put_object` suffices — no multipart, so
  none of `dashql-pack`'s `release.rs` upload machinery is needed or shared.

### 6. `packages/dashql-data:sync` — the ergonomic run target
In `packages/dashql-data/BUILD.bazel`, a `rust_binary` (`dashql-data-sync`) plus the
convert/assemble/index targets from §4. The `sync` run target is that binary with
`data = [":datasets"]` and `args = ["--dir", "$(rootpath :datasets)"]`, so
`bazel run //packages/dashql-data:sync` builds the hermetic tree and then mirrors it. Mark
`tags = ["manual"]` so it's excluded from wildcard builds (matches `dashql-pack:publish`).

### 7. CI — `.github/workflows/publish_data.yml` (new, decoupled from release)
Not on every main push. Triggers: `workflow_dispatch` + optionally `push` on
`packages/dashql-data/**`. Steps: checkout → `.github/actions/setup-bazel` (mTLS cache
secrets) → `bazel run --config=release //packages/dashql-data:sync` with env:
```
DASHQL_DATA_R2_ENDPOINT:          ${{ secrets.R2_DASHQL_DATA_ENDPOINT }}
DASHQL_DATA_R2_ACCESS_KEY_ID:     ${{ secrets.R2_DASHQL_DATA_ACCESS_KEY_ID }}
DASHQL_DATA_R2_SECRET_ACCESS_KEY: ${{ secrets.R2_DASHQL_DATA_SECRET_ACCESS_KEY }}
```
No Python/pip setup — Bazel provides the DuckDB CLI and the index generator.

### 8. Docs
- `README.md` "Continuous Deployment" section: add a `data.dashql.app` bullet (bucket,
  versioned URL scheme, `bazel run //packages/dashql-data:sync`).

## Manual (out-of-repo) prerequisites — do these first
1. Create R2 bucket **`dashql-data`**.
2. Bind custom domain **`data.dashql.app`** to it (Cloudflare R2 → Custom Domains).
3. R2 API token scoped to `dashql-data`; add endpoint/key/secret as the three GitHub secrets.
4. (Optional) Cache rule: long TTL for `/*/v*/*`, short/no-cache for `/index.json`.

## Verification
1. **Vendored CLI**: `bazel run //bazel:duckdb_cli -- --version` resolves per platform.
2. **Hermetic build**: `bazel build //packages/dashql-data:datasets` → inspect
   `bazel-bin/packages/dashql-data/…/vega-cars/v1/cars.parquet`
   (`duckdb -c "SELECT * FROM '…/cars.parquet' LIMIT 5"`) and `index.json`. Re-build → fully
   cached (no re-fetch, no re-convert).
3. **Dry-run mirror**: `bazel run //packages/dashql-data:sync -- --dry-run` prints planned
   keys + `index.json` without uploading.
4. **End-to-end (staging)**: set the three env vars, `bazel run //packages/dashql-data:sync`, then
   `curl https://data.dashql.app/index.json` and
   `duckdb -c "SELECT count(*) FROM read_parquet('https://data.dashql.app/vega-cars/v1/cars.parquet')"`.
5. **Idempotency**: re-run `:sync`; every versioned file is *skipped* (HeadObject hit); only
   `index.json` re-uploads.
6. **Move sanity**: `bazel build //...` after the `examples/hyper` → `examples/sessions/hyper`
   move (expected no-op).
7. **CI**: trigger `publish_data.yml` via `workflow_dispatch`.

## Out of scope (explicit follow-ups)
- Wiring the app to load these URLs (DuckDB HTTPFS in the query path, Vega-Lite `data.url`
  support, example-SQL/notebooks referencing `data.dashql.app`).
- A retention/`vacuum` command for old dataset versions (immutable + small; revisit if the
  bucket grows).
