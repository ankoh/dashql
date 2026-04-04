"""Resolve all external projects (mirror of packages/dashql-core/cmake).

    All CMake externals are resolved here so one place (top-level bazel/) owns
    fetches and build overlays. Fetched/built in this extension:
    - flatbuffers, ankerl, rapidjson, c4core, rapidyaml (http_archive + build_file)
    - bison_src, m4_src, flex_src (prebuilt xPack)
    - com_google_benchmark (http_archive + external_benchmark.BUILD)
    - duckdb (http_archive + bazel/duckdb/BUILD.bazel)
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
# renovate: datasource=github-releases depName=google/flatbuffers
_FLATBUFFERS_VERSION = "25.12.19"
# renovate: datasource=github-releases depName=martinus/unordered_dense
_ANKERL_VERSION = "4.8.1"
# renovate: datasource=github-releases depName=Tencent/rapidjson
_RAPIDJSON_VERSION = "1.1.0"
# renovate: datasource=github-releases depName=biojppm/c4core
_C4CORE_VERSION = "0.2.9"
# renovate: datasource=github-releases depName=biojppm/rapidyaml
_RAPIDYAML_VERSION = "0.11.1"
# renovate: datasource=github-releases depName=google/benchmark
_BENCHMARK_VERSION = "1.9.5"
# renovate: datasource=github-releases depName=duckdb/duckdb
_DUCKDB_VERSION = "1.5.1"
# renovate: datasource=github-releases depName=apache/arrow
_ARROW_VERSION = "19.0.0"

def _dashql_core_deps_impl(mctx):
    bison_prebuilt_repository(name = "bison_src")
    m4_prebuilt_repository(name = "m4_src")
    flex_prebuilt_repository(name = "flex_src")
    binaryen_prebuilt_repository(name = "binaryen")
    wabt_prebuilt_repository(name = "wabt")

    http_archive(
        name = "com_google_flatbuffers",
        sha256 = "f5d4636bfc4d30c622c9ad238ce947848c2b90b10aecd387dc62cdee2584359b",
        strip_prefix = "flatbuffers-" + _FLATBUFFERS_VERSION,
        urls = ["https://github.com/google/flatbuffers/archive/refs/tags/v" + _FLATBUFFERS_VERSION + ".zip"],
        patches = ["//bazel/patches:flatbuffers_pthread.patch"],
        patch_args = ["-p1"],
    )
    http_archive(
        name = "ankerl_unordered_dense",
        sha256 = "a763ab0d6061f69f7fe86f4c277dba6502cee6afeb095e36bc92fdb57d313679",
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
        patch_cmds = [
            # GenericStringRef has a copy-assignment definition with a body that tries to
            # assign to const members (const Ch* const s, const SizeType length).
            # With clang 19 (wasi-sdk v32) this is a hard error. Explicitly delete the operator.
            "sed -i.bak 's/GenericStringRef& operator=(const GenericStringRef& rhs) {[^}]*}/GenericStringRef\\& operator=(const GenericStringRef\\& rhs) = delete;/g' include/rapidjson/document.h && rm -f include/rapidjson/document.h.bak",
            # SetArrayRaw/SetObjectRaw use memcpy on non-trivially-copyable types, triggering
            # -Wnontrivial-memcall on clang 16+. Cast to void* as the compiler itself suggests.
            "sed -i.bak 's/std::memcpy(e, values,/std::memcpy((void*)e, values,/g' include/rapidjson/document.h && rm -f include/rapidjson/document.h.bak",
            "sed -i.bak 's/std::memcpy(m, members,/std::memcpy((void*)m, members,/g' include/rapidjson/document.h && rm -f include/rapidjson/document.h.bak",
        ],
    )
    http_archive(
        name = "c4core",
        sha256 = "cb1ba40fbde6c4a415d26feee150544cf6d67bbaf7aec1724e5dc4875f4ed75f",
        strip_prefix = "c4core-" + _C4CORE_VERSION,
        urls = ["https://github.com/biojppm/c4core/archive/refs/tags/v" + _C4CORE_VERSION + ".zip"],
        build_file = "//bazel:external_c4core.BUILD",
    )
    http_archive(
        name = "rapidyaml",
        sha256 = "481cafba4b4388faa709ded7fd47f4abcbbf6d2e87ab3972956980413b1ea3fc",
        strip_prefix = "rapidyaml-" + _RAPIDYAML_VERSION,
        urls = ["https://github.com/biojppm/rapidyaml/archive/refs/tags/v" + _RAPIDYAML_VERSION + ".zip"],
        build_file = "//bazel:external_rapidyaml.BUILD",
    )
    http_archive(
        name = "com_google_benchmark",
        sha256 = "68c9c65cee4864db42c3af9ff5b5cfa32ce1b01d9653136c5f4ff96e18a9b8f2",
        strip_prefix = "benchmark-" + _BENCHMARK_VERSION,
        urls = ["https://github.com/google/benchmark/archive/refs/tags/v" + _BENCHMARK_VERSION + ".zip"],
        build_file = "//bazel:external_benchmark.BUILD",
    )
    # renovate: datasource=github-releases depName=duckdb/duckdb
    http_archive(
        name = "duckdb_prebuilt_osx",
        sha256 = "d9dd723c59f8571202b468f6bf71d4555238544553dd1445e6c9ecb39f54c0f3",
        urls = ["https://github.com/duckdb/duckdb/releases/download/v" + _DUCKDB_VERSION + "/libduckdb-osx-universal.zip"],
        build_file = "//bazel:external_duckdb_prebuilt.BUILD",
    )
    # renovate: datasource=github-releases depName=duckdb/duckdb
    http_archive(
        name = "duckdb_prebuilt_linux_amd64",
        sha256 = "21aec66a60eae1696270ba715a481ab066a88d99a62718d0577579ac1a7a4834",
        urls = ["https://github.com/duckdb/duckdb/releases/download/v" + _DUCKDB_VERSION + "/libduckdb-linux-amd64.zip"],
        build_file = "//bazel:external_duckdb_prebuilt.BUILD",
    )
    # DuckDB source (WASM and custom builds)
    http_archive(
        name = "duckdb_source",
        sha256 = "2de9901f05d445e6a24b79127fd70f2e4fbd552b44dc1dc668aca07fbf97f716",
        strip_prefix = "duckdb-" + _DUCKDB_VERSION,
        urls = ["https://github.com/duckdb/duckdb/archive/refs/tags/v" + _DUCKDB_VERSION + ".tar.gz"],
        build_file = "//bazel/duckdb:duckdb.bazel",
    )
    # Apache Arrow (minimal: IPC only)
    http_archive(
        name = "apache_arrow",
        sha256 = "7bee51bb6c1176eb08070bd2c7fb7e9e4d17f277e59c9cf80a88082443b124de",
        strip_prefix = "arrow-apache-arrow-" + _ARROW_VERSION,
        urls = ["https://github.com/apache/arrow/archive/refs/tags/apache-arrow-" + _ARROW_VERSION + ".tar.gz"],
        build_file = "//bazel:external_arrow.BUILD",
    )

dashql_core_dependencies = module_extension(
    implementation = _dashql_core_deps_impl,
)
