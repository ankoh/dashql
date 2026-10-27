"""Resolve the external build tools in one place (top-level bazel/).

    Fetched in this extension:
    - flatbuffers (flatc and the runtimes)
    - bison_src, m4_src (prebuilt xPack), binaryen, wabt
    - the DuckDB CLI
    googletest remains from BCR in MODULE.bazel.

    sha256 hashes are maintained by scripts/update_bazel_hashes.sh and are
    automatically recomputed by Renovate's postUpgradeTasks on version bumps.
"""

load("@bazel_tools//tools/build_defs/repo:http.bzl", "http_archive")

load("//bazel:external_binaryen.bzl", "binaryen_prebuilt_repository")
load("//bazel:external_bison.bzl", "bison_prebuilt_repository")
load("//bazel:external_m4.bzl", "m4_prebuilt_repository")
load("//bazel:external_wabt.bzl", "wabt_prebuilt_repository")
# renovate: datasource=github-releases depName=google/flatbuffers
_FLATBUFFERS_VERSION = "25.12.19"
# renovate: datasource=github-releases depName=duckdb/duckdb
_DUCKDB_VERSION = "2.0.0"

def _dashql_core_deps_impl(mctx):
    bison_prebuilt_repository(name = "bison_src")
    m4_prebuilt_repository(name = "m4_src")
    binaryen_prebuilt_repository(name = "binaryen")
    wabt_prebuilt_repository(name = "wabt")

    http_archive(
        name = "com_google_flatbuffers",
        sha256 = "f5d4636bfc4d30c622c9ad238ce947848c2b90b10aecd387dc62cdee2584359b",
        strip_prefix = "flatbuffers-" + _FLATBUFFERS_VERSION,
        urls = ["https://github.com/google/flatbuffers/archive/refs/tags/v" + _FLATBUFFERS_VERSION + ".zip"],
    )
    # DuckDB CLI: exec-config build tool used by //packages/dashql-datasets to convert
    # dataset sources to Parquet in a genrule. One archive per exec platform,
    # selected via the //bazel:duckdb_cli alias. The zip preserves the exec bit.
    # renovate: datasource=github-releases depName=duckdb/duckdb
    http_archive(
        name = "duckdb_cli_osx",
        sha256 = "8a8f67e7c7f7d1392fa63ba3971948391392fe2a25fca63e7008e33c50beb4c2",
        urls = ["https://github.com/duckdb/duckdb/releases/download/v" + _DUCKDB_VERSION + "/duckdb-cli-osx-universal.tar.gz"],
        build_file = "//bazel:external_duckdb_cli.BUILD",
    )
    # renovate: datasource=github-releases depName=duckdb/duckdb
    http_archive(
        name = "duckdb_cli_linux_amd64",
        sha256 = "c6507206baf7793c6013dbd82368469a45f20dc0e17a6f92f204602f652ed2bc",
        urls = ["https://github.com/duckdb/duckdb/releases/download/v" + _DUCKDB_VERSION + "/duckdb-cli-linux-amd64.tar.gz"],
        build_file = "//bazel:external_duckdb_cli.BUILD",
    )

dashql_core_dependencies = module_extension(
    implementation = _dashql_core_deps_impl,
)
