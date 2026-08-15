"""Dataset declarations and the build macro for data.dashql.app.

`DATASETS` is the single source of truth for what gets hosted. It is consumed in
two places:

  * the fetch phase (`deps.bzl` module extension) turns every source into a
    hash-pinned `http_file` — `http_file` *requires* `sha256`, so the pin is
    load-bearing, exactly like `bazel/core_dependencies.bzl`;
  * the build phase (`declare_datasets()`, called from `BUILD.bazel`) converts each
    source to Parquet with the vendored DuckDB CLI, assembles the versioned tree,
    and computes `index.json`.

Adding a dataset = one entry here + `bazel run //packages/dashql-data:sync`. See
`README.md`. Source hashes sit beside `# renovate:` markers so Renovate can bump a
tag and its hash together.

Dataset schema:
    {
        "name":    "vega-cars",       # URL path segment; also the R2 key prefix
        "version": "1",               # bumped on any breaking reshape (immutable paths)
        "sources": [{
            "as":     "cars",         # placeholder name referenced from `sql` as {cars}
            "url":    "https://…",
            "sha256": "…",            # hash-pinned
        }],
        "outputs": [{
            "file": "cars.parquet",   # exact output file -> <name>/v<version>/cars.parquet
            "sql":  "COPY (...) TO '{output}' (FORMAT PARQUET)",
        }],
    }

Each output is produced by running its `sql` verbatim through the DuckDB CLI. The
only substitutions are two placeholders:

  * `{output}`        -> the output file's path (the COPY target),
  * `{<source as>}`   -> the local path of that fetched source (e.g. `{cars}`).

So the author writes the full statement — no reader is inferred, no SELECT/COPY is
assembled. The output format is whatever the SQL says: `(FORMAT PARQUET)`,
`(FORMAT CSV, HEADER)`, etc. The `.file` extension is cosmetic (it's just the R2
key); it does not drive conversion.
"""

load("@aspect_bazel_lib//lib:copy_to_directory.bzl", "copy_to_directory")

# Two dataset kinds, distinguished by the optional "kind" field (default "sql"):
#
#   * "sql"  — fetch each source (http_file), run each output's verbatim SQL through
#     the DuckDB CLI. This is the general case documented above.
#   * "tpch" — no sources; generate all 8 TPC-H tables at `scale_factor` with DuckDB's
#     tpch extension (`CALL dbgen`) and write each to Parquet. The extension is
#     vendored (see TPCH_* below) and LOADed offline, so generation stays hermetic —
#     no `INSTALL` (network), no dbgen submodule, no bespoke Arrow/Parquet transcoder.
DATASETS = [
    {
        "name": "vega-cars",
        "version": "1",
        "sources": [{
            "as": "cars",
            # renovate: datasource=github-tags depName=vega/vega-datasets
            "url": "https://raw.githubusercontent.com/vega/vega-datasets/v2.9.0/data/cars.json",
            "sha256": "f686a53678b21f4231e2f6a5ba7ce5761d9d39204fccdea1caa29fb8c460e319",
        }],
        "outputs": [{
            "file": "cars.parquet",
            "sql": "COPY (SELECT * FROM read_json_auto('{cars}')) TO '{output}' (FORMAT PARQUET)",
        }, {
            "file": "cars.csv",
            "sql": "COPY (SELECT * FROM read_json_auto('{cars}')) TO '{output}' (FORMAT CSV, HEADER)",
        }],
    },
    # TPC-H at several scale factors (each an independent, immutably-versioned dataset,
    # e.g. tpch-0.01/v1/lineitem.parquet). Rows scale ~linearly with the SF: SF 1 is
    # the full ~1 GB standard scale (lineitem ~6M rows); SF 0.001 is a ~1 MB smoke-test
    # set (lineitem ~6k rows).
    {"name": "tpch-0.001", "version": "1", "kind": "tpch", "scale_factor": "0.001"},
    {"name": "tpch-0.01", "version": "1", "kind": "tpch", "scale_factor": "0.01"},
    {"name": "tpch-0.1", "version": "1", "kind": "tpch", "scale_factor": "0.1"},
    {"name": "tpch-1", "version": "1", "kind": "tpch", "scale_factor": "1"},
]

# --- TPC-H generation via the vendored DuckDB tpch extension ----------------------
#
# DuckDB's tpch extension is NOT statically linked into the release CLI: `CALL dbgen`
# normally requires `INSTALL tpch` (network), which the genrule sandbox forbids. So we
# vendor the *signed* extension as gzipped, hash-pinned http_files (one per exec
# platform, deps.bzl), gunzip it in the convert genrule, and LOAD it by absolute path
# — fully offline. This replaces both moving parts of the classic pipeline (the
# tpch-dbgen submodule and a hand-written .tbl->Parquet converter) with the CLI we
# already vendor for the other datasets.

# The DuckDB version whose tpch extension we vendor. MUST equal _DUCKDB_VERSION in
# bazel/core_dependencies.bzl: an extension only loads into the exact CLI build it was
# compiled against. Bump both (and the four hashes below) together; the hashes are
# refreshed by scripts/update_bazel_hashes.py.
# renovate: datasource=github-releases depName=duckdb/duckdb
TPCH_DUCKDB_VERSION = "1.5.5"

# sha256 of tpch.duckdb_extension.gz per platform, keyed by DuckDB's own `PRAGMA
# platform` name (osx_amd64 == x86_64 macOS, linux_amd64 == x86_64 Linux, …).
TPCH_EXTENSION_SHA256 = {
    "osx_arm64": "8f4594b1fdeac4629f5ba70f9a5c4909d78107ff3b7807704e32bcfde16fd280",
    "osx_amd64": "dd9f9cace23e5e9787ad7847db644685aa1cfbd770f845c90a6ca0465e48b9b8",
    "linux_amd64": "e7cfefa4e18d32e2f8aaa0e6e265487da13cc0f4fbffbcc970030526051c2e9c",
    "linux_arm64": "6bd3ec4a7925f8ec5e39ac59a0ba712762bab734408690e9d1a7876013ef0306",
}

# The 8 TPC-H tables dbgen populates. Each becomes <dataset>/v<version>/<table>.parquet.
TPCH_TABLES = ["customer", "lineitem", "nation", "orders", "part", "partsupp", "region", "supplier"]

def tpch_extension_url(platform):
    """CDN URL for one platform's gzipped tpch extension (fetch phase, deps.bzl)."""
    return "https://extensions.duckdb.org/v{v}/{p}/tpch.duckdb_extension.gz".format(
        v = TPCH_DUCKDB_VERSION,
        p = platform,
    )

def tpch_extension_repo_name(platform):
    """The `http_file` repo name for one platform's tpch extension. Shared between
    deps.bzl (declares the repo) and BUILD.bazel (selects one via alias)."""
    return "tpch_extension_{}".format(platform)

# Public base URL the hosted files are served from (used to root index.json URLs).
DATA_BASE_URL = "https://data.dashql.app"

def _sanitize(name):
    """Turn a dataset name into a bzlmod-safe repo-name fragment."""
    return name.replace("-", "_").replace(".", "_")

def dataset_repo_name(dataset_name, src_as):
    """The `http_file` repo name for one source. Shared with deps.bzl so the fetch
    phase and the build phase agree on a single name."""
    return "dataset_{}_{}".format(_sanitize(dataset_name), src_as)

def _source_label(dataset_name, src_as):
    return "@{}//file".format(dataset_repo_name(dataset_name, src_as))

# The vendored tpch extension, selected per exec platform by the alias in BUILD.bazel.
_TPCH_EXTENSION = "//packages/dashql-data:tpch_extension"

def _resolve_sql(dataset, output):
    """Substitute the two placeholders in an output's verbatim SQL:

      * `{output}`      -> the output file's build path ($(RULEDIR)/…),
      * `{<source as>}` -> $(location …) of that fetched source.

    Everything else is passed through untouched (Bazel then expands the make-vars).
    Only these exact tokens are replaced, so DuckDB struct/list literals like
    `{'k': 1}` are safe. A literal `$` in SQL must be written `$$` (standard Bazel
    genrule escaping)."""
    sql = output["sql"]
    out_path = "$(RULEDIR)/{}/v{}/{}".format(dataset["name"], dataset["version"], output["file"])
    sql = sql.replace("{output}", out_path)
    for src in dataset["sources"]:
        placeholder = "{" + src["as"] + "}"
        sql = sql.replace(placeholder, "$(location {})".format(_source_label(dataset["name"], src["as"])))
    return sql

def _declare_sql_dataset(dataset):
    """Convert genrule for a "sql" dataset: fetched sources -> DuckDB CLI runs each
    output's verbatim SQL. Returns the genrule label."""
    convert_name = "convert_{}".format(_sanitize(dataset["name"]))
    srcs = [_source_label(dataset["name"], src["as"]) for src in dataset["sources"]]
    outs = [
        "{}/v{}/{}".format(dataset["name"], dataset["version"], output["file"])
        for output in dataset["outputs"]
    ]
    version_dir = "$(RULEDIR)/{}/v{}".format(dataset["name"], dataset["version"])

    # One combined SQL script per dataset, fed to the CLI via a quoted heredoc so
    # arbitrary author SQL (single AND double quotes) passes through verbatim.
    # Bazel expands the $(RULEDIR)/$(location) make-vars before the shell runs.
    sql_lines = [_resolve_sql(dataset, output) + ";" for output in dataset["outputs"]]
    cmd = "\n".join([
        "mkdir -p {}".format(version_dir),
        "$(execpath //bazel:duckdb_cli) <<'__DASHQL_SQL__'",
    ] + sql_lines + [
        "__DASHQL_SQL__",
    ])
    native.genrule(
        name = convert_name,
        srcs = srcs,
        outs = outs,
        tools = ["//bazel:duckdb_cli"],
        cmd = cmd,
    )
    return ":" + convert_name

def _declare_tpch_dataset(dataset):
    """Convert genrule for a "tpch" dataset: LOAD the vendored tpch extension offline,
    `CALL dbgen(sf=…)`, then COPY each of the 8 tables to Parquet. Returns the label.

    The extension is gzipped, so we gunzip it to an mktemp dir first: DuckDB will only
    LOAD a path ending in `.duckdb_extension`, and rejects relative paths ("hardened
    program"), so the target must be an absolute *.duckdb_extension file. autoinstall/
    autoload are disabled so nothing touches the network inside the sandbox."""
    convert_name = "convert_{}".format(_sanitize(dataset["name"]))
    sf = dataset["scale_factor"]
    version_dir = "$(RULEDIR)/{}/v{}".format(dataset["name"], dataset["version"])
    outs = [
        "{}/v{}/{}.parquet".format(dataset["name"], dataset["version"], table)
        for table in TPCH_TABLES
    ]

    # COPY one Parquet per table into the version dir.
    copy_lines = [
        "COPY (SELECT * FROM {t}) TO '{d}/{t}.parquet' (FORMAT PARQUET);".format(t = table, d = version_dir)
        for table in TPCH_TABLES
    ]
    cmd = "\n".join([
        # Absolute gunzip target ending in .duckdb_extension (DuckDB LOAD constraints).
        "TPCH_EXT_DIR=$$(mktemp -d)",
        "gunzip -c $(execpath {ext}) > $$TPCH_EXT_DIR/tpch.duckdb_extension".format(ext = _TPCH_EXTENSION),
        "mkdir -p {}".format(version_dir),
        "$(execpath //bazel:duckdb_cli) <<__DASHQL_SQL__",
        "SET autoinstall_known_extensions=false;",
        "SET autoload_known_extensions=false;",
        "LOAD '$$TPCH_EXT_DIR/tpch.duckdb_extension';",
        "CALL dbgen(sf={});".format(sf),
    ] + copy_lines + [
        "__DASHQL_SQL__",
    ])
    native.genrule(
        name = convert_name,
        srcs = [_TPCH_EXTENSION],
        outs = outs,
        tools = ["//bazel:duckdb_cli"],
        cmd = cmd,
    )
    return ":" + convert_name

def declare_datasets(name = "datasets", index_tool = "//packages/dashql-data:dashql-data"):
    """Expand every dataset into convert genrules + assembled tree + index.json.

    Produces:
      * `convert_<dataset>` genrule per dataset (DuckDB CLI runs each output's SQL),
      * `<name>_tree` copy_to_directory (versioned output tree only),
      * `index_json` genrule (walks the tree → index.json),
      * `<name>` copy_to_directory (output tree + index.json) — the sync artifact.
    """
    output_targets = []
    for dataset in DATASETS:
        if dataset.get("kind", "sql") == "tpch":
            output_targets.append(_declare_tpch_dataset(dataset))
        else:
            output_targets.append(_declare_sql_dataset(dataset))

    # Output tree (<dataset>/v<version>/<file> at the root) — a single directory the
    # index tool can walk. The package prefix is stripped by default.
    tree = name + "_tree"
    copy_to_directory(
        name = tree,
        srcs = output_targets,
        out = tree,
    )

    # index.json = { dataset -> version -> files[{url,bytes,sha256}] }, computed by
    # walking the assembled tree. Rust, not a py_binary (no Python toolchain is
    # registered in this repo).
    native.genrule(
        name = "index_json",
        srcs = [":" + tree],
        outs = ["index.json"],
        tools = [index_tool],
        cmd = "$(execpath {tool}) index --dir $(location :{tree}) --base-url {base} --out $@".format(
            tool = index_tool,
            tree = tree,
            base = DATA_BASE_URL,
        ),
    )

    # Final artifact the mirror uploads: the versioned output files + index.json, all
    # rooted at the top. Built from the output *files* (not the tree directory) plus
    # index.json — all package-relative files, so no directory-nesting ambiguity.
    copy_to_directory(
        name = name,
        srcs = output_targets + [":index_json"],
        out = name,
    )
