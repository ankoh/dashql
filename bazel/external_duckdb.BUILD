# DuckDB: prebuilt shared library. One archive per platform, selected via alias in //bazel:BUILD.bazel.

load("@rules_cc//cc:defs.bzl", "cc_import")

package(default_visibility = ["//visibility:public"])

cc_import(
    name = "duckdb",
    hdrs = glob(["*.hpp", "*.h"]),
    shared_library = select({
        "@platforms//os:macos": "libduckdb.dylib",
        "@platforms//os:linux": "libduckdb.so",
    }),
    tags = ["no-remote-cache"],
)
