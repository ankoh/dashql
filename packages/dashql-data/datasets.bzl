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
]

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
        output_targets.append(":" + convert_name)

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
