# DuckDB: build via CMake (mirrors cmake/duckdb.cmake). Uses rules_foreign_cc.
load("@rules_foreign_cc//foreign_cc:defs.bzl", "cmake")

package(default_visibility = ["//visibility:public"])

# All sources for the cmake rule (DuckDB root has CMakeLists.txt)
filegroup(
    name = "all_srcs",
    srcs = glob(["**"]),
    visibility = ["//visibility:private"],
)

cmake(
    name = "duckdb",
    lib_source = ":all_srcs",
    cache_entries = {
        "CMAKE_BUILD_TYPE": "Release",
        "BUILD_SHELL": "FALSE",
        "BUILD_UNITTESTS": "FALSE",
        "DISABLE_BUILTIN_EXTENSIONS": "TRUE",
    },
    out_static_libs = [
        "libduckdb_static.a",
        "libduckdb_re2.a",
        "libduckdb_zstd.a",
        "libduckdb_fmt.a",
        "libduckdb_fsst.a",
        "libduckdb_hyperloglog.a",
        "libduckdb_miniz.a",
        "libduckdb_mbedtls.a",
        "libduckdb_yyjson.a",
        "libduckdb_pg_query.a",
        "libduckdb_utf8proc.a",
        "libduckdb_fastpforlib.a",
    ],
)
