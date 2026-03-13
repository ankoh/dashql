"""Resolve all external projects (mirror of packages/dashql-core/cmake).

    All CMake externals are resolved here so one place (top-level bazel/) owns
    fetches and build overlays. Fetched/built in this extension:
    - flatbuffers, ankerl, rapidjson, c4core, rapidyaml (http_archive + build_file)
    - bison_src, m4_src, flex_src (prebuilt xPack)
    - com_google_benchmark (http_archive + external_benchmark.BUILD)
    - duckdb (http_archive + rules_foreign_cc cmake in external_duckdb.BUILD)
    googletest and gflags remain from BCR in MODULE.bazel.

    sha256 hashes are maintained by scripts/update_bazel_hashes.sh and are
    automatically recomputed by Renovate's postUpgradeTasks on version bumps.
"""

load("@bazel_tools//tools/build_defs/repo:http.bzl", "http_archive")

load("//bazel:external_binaryen.bzl", "binaryen_prebuilt_repository")
load("//bazel:external_bison.bzl", "bison_prebuilt_repository")
load("//bazel:external_flex.bzl", "flex_prebuilt_repository")
load("//bazel:external_m4.bzl", "m4_prebuilt_repository")
load("//bazel:external_wabt.bzl", "wabt_prebuilt_repository")
load("//bazel:external_wasi_sdk.bzl", "wasi_sdk_repository")

# renovate: datasource=github-releases depName=google/flatbuffers
_FLATBUFFERS_VERSION = "24.3.25"
# renovate: datasource=github-releases depName=martinus/unordered_dense
_ANKERL_VERSION = "4.5.0"
# renovate: datasource=github-releases depName=Tencent/rapidjson
_RAPIDJSON_VERSION = "1.1.0"
# renovate: datasource=github-releases depName=biojppm/c4core
_C4CORE_VERSION = "0.2.3"
# renovate: datasource=github-releases depName=biojppm/rapidyaml
_RAPIDYAML_VERSION = "0.7.2"
# renovate: datasource=github-releases depName=google/benchmark
_BENCHMARK_VERSION = "1.9.1"
# renovate: datasource=github-releases depName=duckdb/duckdb
_DUCKDB_VERSION = "1.2.1"

def _dashql_core_deps_impl(mctx):
    bison_prebuilt_repository(name = "bison_src")
    m4_prebuilt_repository(name = "m4_src")
    flex_prebuilt_repository(name = "flex_src")
    binaryen_prebuilt_repository(name = "binaryen")
    wabt_prebuilt_repository(name = "wabt")
    wasi_sdk_repository(name = "wasi_sdk")

    http_archive(
        name = "com_google_flatbuffers",
        sha256 = "e706f5eb6ca8f78e237bf3f7eccffa1c5ec9a96d3c1c938f08dc09aab1884528",
        strip_prefix = "flatbuffers-" + _FLATBUFFERS_VERSION,
        urls = ["https://github.com/google/flatbuffers/archive/refs/tags/v" + _FLATBUFFERS_VERSION + ".zip"],
    )
    http_archive(
        name = "ankerl_unordered_dense",
        sha256 = "637fb9d9e5bbd7b9c16497b39033a78abf17ea23fd7b965b6e5456822f73231d",
        strip_prefix = "unordered_dense-" + _ANKERL_VERSION,
        urls = ["https://github.com/martinus/unordered_dense/archive/refs/tags/v" + _ANKERL_VERSION + ".zip"],
        build_file = "//bazel:external_ankerl.BUILD",
    )
    http_archive(
        name = "rapidjson",
        sha256 = "8e00c38829d6785a2dfb951bb87c6974fa07dfe488aa5b25deec4b8bc0f6a3ab",
        strip_prefix = "rapidjson-" + _RAPIDJSON_VERSION,
        urls = ["https://github.com/Tencent/rapidjson/archive/refs/tags/v" + _RAPIDJSON_VERSION + ".zip"],
        build_file = "//bazel:external_rapidjson.BUILD",
    )
    http_archive(
        name = "c4core",
        sha256 = "efc05568c9e1a802f58005dfb9446a959538c770fa1827c02475f4493ea29be3",
        strip_prefix = "c4core-" + _C4CORE_VERSION,
        urls = ["https://github.com/biojppm/c4core/archive/refs/tags/v" + _C4CORE_VERSION + ".zip"],
        build_file = "//bazel:external_c4core.BUILD",
    )
    http_archive(
        name = "rapidyaml",
        sha256 = "91916a1dd38539d555d7d09981b48cc1882954bcbd68743ec5a009a8ba3a04a4",
        strip_prefix = "rapidyaml-" + _RAPIDYAML_VERSION,
        urls = ["https://github.com/biojppm/rapidyaml/archive/refs/tags/v" + _RAPIDYAML_VERSION + ".zip"],
        build_file = "//bazel:external_rapidyaml.BUILD",
    )
    http_archive(
        name = "com_google_benchmark",
        sha256 = "8a63c9c6adf9e7ce8d0d81f251c47de83efb5e077e147d109fa2045daac8368b",
        strip_prefix = "benchmark-" + _BENCHMARK_VERSION,
        urls = ["https://github.com/google/benchmark/archive/refs/tags/v" + _BENCHMARK_VERSION + ".zip"],
        build_file = "//bazel:external_benchmark.BUILD",
    )
    http_archive(
        name = "duckdb",
        sha256 = "8d17ce47dc16c8e3dde41a09916eb63034cb19dd2c6bd71b90372261a43b8b71",
        strip_prefix = "duckdb-" + _DUCKDB_VERSION,
        urls = ["https://github.com/duckdb/duckdb/archive/refs/tags/v" + _DUCKDB_VERSION + ".zip"],
        build_file = "//bazel:external_duckdb.BUILD",
    )

dashql_core_dependencies = module_extension(
    implementation = _dashql_core_deps_impl,
)
