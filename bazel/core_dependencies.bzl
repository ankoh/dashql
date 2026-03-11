"""Resolve all external projects (mirror of packages/dashql-core/cmake).

    All CMake externals are resolved here so one place (top-level bazel/) owns
    fetches and build overlays. Fetched/built in this extension:
    - flatbuffers, ankerl, rapidjson, c4core, rapidyaml (http_archive + build_file)
    - bison_src, m4_src, flex_src (prebuilt xPack)
    - com_google_benchmark (http_archive + external_benchmark.BUILD)
    - duckdb (http_archive + rules_foreign_cc cmake in external_duckdb.BUILD)
    googletest and gflags remain from BCR in MODULE.bazel.
"""

load("@bazel_tools//tools/build_defs/repo:http.bzl", "http_archive")

load("//bazel:external_binaryen.bzl", "binaryen_prebuilt_repository")
load("//bazel:external_bison.bzl", "bison_prebuilt_repository")
load("//bazel:external_flex.bzl", "flex_prebuilt_repository")
load("//bazel:external_m4.bzl", "m4_prebuilt_repository")
load("//bazel:external_wabt.bzl", "wabt_prebuilt_repository")
load("//bazel:external_wasi_sdk.bzl", "wasi_sdk_repository")

def _dashql_core_deps_impl(mctx):
    bison_prebuilt_repository(name = "bison_src")
    m4_prebuilt_repository(name = "m4_src")
    flex_prebuilt_repository(name = "flex_src")
    binaryen_prebuilt_repository(name = "binaryen")
    wabt_prebuilt_repository(name = "wabt")
    wasi_sdk_repository(name = "wasi_sdk")

    http_archive(
        name = "com_google_flatbuffers",
        integrity = "sha256-/NT65CXxbNXG+F1t/YIElG1kFMiWNGVKdWxQ6AwFOk4=",
        strip_prefix = "flatbuffers-ee848a02e17a94edaacd1dd95a1664b59c6f06b2",
        urls = ["https://github.com/google/flatbuffers/archive/ee848a02e17a94edaacd1dd95a1664b59c6f06b2.zip"],
    )
    http_archive(
        name = "ankerl_unordered_dense",
        integrity = "sha256-xQxMp9VlltgIdjabzGlcrrXQeuhUBWsLy8pAemOMb58=",
        strip_prefix = "unordered_dense-3add2a63444869d123e24792f17b5618edfaee44",
        urls = ["https://github.com/martinus/unordered_dense/archive/3add2a63444869d123e24792f17b5618edfaee44.zip"],
        build_file = "//bazel:external_ankerl.BUILD",
    )
    http_archive(
        name = "rapidjson",
        integrity = "sha256-3wf13f67wpQBgQOfbJOewnZKcwPvebF5WNl5KjZDBrs=",
        strip_prefix = "rapidjson-24b5e7a8b27f42fa16b96fc70aade9106cf7102f",
        urls = ["https://github.com/Tencent/rapidjson/archive/24b5e7a8b27f42fa16b96fc70aade9106cf7102f.zip"],
        build_file = "//bazel:external_rapidjson.BUILD",
    )
    http_archive(
        name = "c4core",
        integrity = "sha256-S8TcJY4nW7ZcdwdtrEAUvD3gbYpckQEqO8QCYeEcfuM=",
        strip_prefix = "c4core-828c552761e43de8a7c2807acc4fd6276bd6e9b1",
        urls = ["https://github.com/biojppm/c4core/archive/828c552761e43de8a7c2807acc4fd6276bd6e9b1.zip"],
        build_file = "//bazel:external_c4core.BUILD",
    )
    http_archive(
        name = "rapidyaml",
        integrity = "sha256-sMtDMSUTVKSmOkqNXyCfJjJNDJ5+rMFXCB4aygBaxXI=",
        strip_prefix = "rapidyaml-653eac9741c7728f2a87435b981737894149e002",
        urls = ["https://github.com/biojppm/rapidyaml/archive/653eac9741c7728f2a87435b981737894149e002.zip"],
        build_file = "//bazel:external_rapidyaml.BUILD",
    )
    http_archive(
        name = "com_google_benchmark",
        strip_prefix = "benchmark-d572f4777349d43653b21d6c2fc63020ab326db2",
        urls = ["https://github.com/google/benchmark/archive/d572f47.zip"],
        build_file = "//bazel:external_benchmark.BUILD",
    )
    http_archive(
        name = "duckdb",
        strip_prefix = "duckdb-6ddac802ffa9bcfbcc3f5f0d71de5dff9b0bc250",
        urls = ["https://github.com/duckdb/duckdb/archive/6ddac80.zip"],
        build_file = "//bazel:external_duckdb.BUILD",
    )

dashql_core_dependencies = module_extension(
    implementation = _dashql_core_deps_impl,
)
