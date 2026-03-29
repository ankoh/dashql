"""DuckDB build from source.

Compiles a minimal subset of DuckDB from source. Suitable for WebAssembly and
other custom builds where prebuilt libraries are unavailable. Features are
minimized to reduce binary size.
"""

load("@rules_cc//cc:defs.bzl", "cc_library")

package(default_visibility = ["//visibility:public"])

# System OpenSSL library (macOS)
cc_library(
    name = "system_openssl",
    linkopts = select({
        "@platforms//os:macos": [
            "-L/opt/homebrew/opt/openssl@3/lib",
            "-lssl",
            "-lcrypto",
        ],
        "@platforms//os:linux": [
            "-lssl",
            "-lcrypto",
        ],
        "//conditions:default": [],
    }),
)

# DuckDB compile flags for slim build
DUCKDB_COPTS = [
    "-std=c++17",
    "-fexceptions",
    "-DDUCKDB_BUILD_LIBRARY",

    # Build metadata
    "-DDUCKDB_SOURCE_ID=\\\"bazel\\\"",
    "-DDUCKDB_VERSION=\\\"v1.5.1\\\"",

    # Warnings
    "-Wno-deprecated-declarations",
    "-Wno-unused-parameter",
    "-Wno-unused-variable",
    "-Wno-sign-compare",
]

DUCKDB_LINKOPTS = [
    "-fexceptions",
]

# Core DuckDB headers
cc_library(
    name = "duckdb_headers",
    hdrs = glob([
        "src/include/**/*.hpp",
        "src/include/**/*.h",
    ]),
    includes = [
        "src/include",
    ],
)

# utf8proc - Unicode processing library
cc_library(
    name = "utf8proc",
    srcs = [
        "third_party/utf8proc/utf8proc.cpp",
        "third_party/utf8proc/utf8proc_wrapper.cpp",
    ],
    hdrs = glob([
        "third_party/utf8proc/include/**/*.hpp",
    ]) + glob(
        [
            "third_party/utf8proc/*.hpp",
        ],
        allow_empty = True,
    ),
    textual_hdrs = [
        "third_party/utf8proc/utf8proc_data.cpp",  # Included by utf8proc.cpp
    ],
    copts = [
        "-fexceptions",
        "-Wno-everything",
    ],
    includes = [
        "third_party/utf8proc/include",
        "third_party/utf8proc",
    ],
    deps = [
        ":duckdb_headers",
    ],
)

# re2 - Regular expression library
cc_library(
    name = "re2",
    srcs = glob([
        "third_party/re2/re2/*.cc",
        "third_party/re2/util/*.cc",
    ]),
    hdrs = glob([
        "third_party/re2/re2/*.h",
        "third_party/re2/util/*.h",
    ]),
    copts = [
        "-fexceptions",
        "-Wno-everything",
    ],
    includes = [
        "third_party/re2",
    ],
)

# fast_float - Fast floating point parsing (header-only)
cc_library(
    name = "fast_float",
    hdrs = glob([
        "third_party/fast_float/**/*.h",
    ]),
    includes = [
        "third_party/fast_float",
    ],
)

# hyperloglog - Cardinality estimation
cc_library(
    name = "hyperloglog",
    srcs = glob([
        "third_party/hyperloglog/*.cpp",
    ]),
    hdrs = glob([
        "third_party/hyperloglog/*.hpp",
    ]),
    copts = [
        "-fexceptions",
        "-Wno-everything",
    ],
    includes = [
        "third_party/hyperloglog",
    ],
    deps = [
        ":duckdb_headers",
    ],
)

# mbedtls - Crypto library
cc_library(
    name = "mbedtls",
    srcs = glob([
        "third_party/mbedtls/library/**/*.cpp",
    ]),
    hdrs = glob([
        "third_party/mbedtls/include/**/*.hpp",
        "third_party/mbedtls/include/**/*.h",
        "third_party/mbedtls/library/**/*.h",
    ]),
    copts = [
        "-fexceptions",
        "-Wno-everything",
    ],
    includes = [
        "third_party/mbedtls/include",
        "third_party/mbedtls/library",
    ],
)

# miniz - Compression library
cc_library(
    name = "miniz",
    srcs = glob([
        "third_party/miniz/*.cpp",
    ]),
    hdrs = glob([
        "third_party/miniz/*.hpp",
    ]),
    copts = [
        "-fexceptions",
        "-Wno-everything",
    ],
    includes = [
        "third_party/miniz",
    ],
)

# fsst - String compression
cc_library(
    name = "fsst",
    srcs = glob([
        "third_party/fsst/*.cpp",
    ]),
    hdrs = glob([
        "third_party/fsst/*.hpp",
        "third_party/fsst/*.h",
    ]),
    copts = [
        "-fexceptions",
        "-Wno-everything",
    ],
    includes = [
        "third_party/fsst",
    ],
    deps = [
        ":duckdb_headers",
    ],
)

# pcg - Random number generator (header-only)
cc_library(
    name = "pcg",
    hdrs = glob([
        "third_party/pcg/**/*.hpp",
    ]),
    includes = [
        "third_party/pcg",
    ],
)

# jaro_winkler - String similarity
cc_library(
    name = "jaro_winkler",
    hdrs = glob([
        "third_party/jaro_winkler/**/*.hpp",
    ]),
    includes = [
        "third_party/jaro_winkler",
    ],
)

# vergesort - Sorting algorithm (header-only)
cc_library(
    name = "vergesort",
    hdrs = glob([
        "third_party/vergesort/**/*.h",
    ]),
    includes = [
        "third_party/vergesort",
    ],
)

# pdqsort - Pattern-defeating quicksort (header-only)
cc_library(
    name = "pdqsort",
    hdrs = glob([
        "third_party/pdqsort/**/*.h",
    ]),
    includes = [
        "third_party/pdqsort",
    ],
)

# ska_sort - Fast sorting (header-only)
cc_library(
    name = "ska_sort",
    hdrs = glob([
        "third_party/ska_sort/**/*.hpp",
    ]),
    includes = [
        "third_party/ska_sort",
    ],
)

# tdigest - T-Digest algorithm (header-only in this case)
cc_library(
    name = "tdigest",
    hdrs = glob([
        "third_party/tdigest/*.hpp",
    ]),
    includes = [
        "third_party/tdigest",
    ],
)

# concurrentqueue - Lock-free queue (header-only)
cc_library(
    name = "concurrentqueue",
    hdrs = glob([
        "third_party/concurrentqueue/**/*.h",
    ]),
    includes = [
        "third_party/concurrentqueue",
    ],
)

# zstd - Compression library
cc_library(
    name = "zstd",
    srcs = glob([
        "third_party/zstd/**/*.cpp",
    ]),
    hdrs = glob([
        "third_party/zstd/**/*.h",
        "third_party/zstd/**/*.hpp",
    ]),
    copts = [
        "-fexceptions",
        "-Wno-everything",
    ],
    includes = [
        "third_party/zstd/include",
        "third_party/zstd",
    ],
)

# yyjson - JSON parser
cc_library(
    name = "yyjson",
    srcs = glob([
        "third_party/yyjson/*.cpp",
    ]),
    hdrs = glob([
        "third_party/yyjson/include/**/*.hpp",
    ]),
    copts = [
        "-fexceptions",
        "-Wno-everything",
    ],
    includes = [
        "third_party/yyjson/include",
    ],
    deps = [
        ":duckdb_headers",
    ],
)

# fmt - formatting library
cc_library(
    name = "fmt",
    srcs = glob([
        "third_party/fmt/**/*.cc",
    ]),
    hdrs = glob([
        "third_party/fmt/include/**/*.h",
    ]),
    copts = [
        "-fexceptions",
        "-Wno-everything",
    ],
    includes = [
        "third_party/fmt/include",
    ],
    strip_include_prefix = "third_party/fmt/include",
    deps = [
        ":duckdb_headers",
    ],
)

# libpg_query - PostgreSQL parser
cc_library(
    name = "libpg_query",
    srcs = glob(
        [
            "third_party/libpg_query/**/*.cpp",
        ],
        exclude = [
            # Grammar files need special handling - pre-generated
            "third_party/libpg_query/grammar/**/*.cpp",
        ],
    ),
    hdrs = glob([
        "third_party/libpg_query/include/**/*.hpp",
        "third_party/libpg_query/grammar/**/*.hpp",
    ]),
    copts = DUCKDB_COPTS + [
        "-Wno-everything",  # Suppress warnings from third-party code
    ],
    includes = [
        "third_party/libpg_query/include",
        "third_party/libpg_query/grammar",
    ],
    deps = [
        ":duckdb_headers",
    ],
)

# Main DuckDB library (static build from source)
cc_library(
    name = "duckdb_static",
    srcs = glob(
        [
            "src/**/*.cpp",
        ],
        exclude = [
            # Tests
            "**/*test*.cpp",
            "**/*benchmark*.cpp",
            # Extensions we don't need
            "src/extension/**/*.cpp",
            # Platform-specific code
            "src/**/windows/**/*.cpp",
            # Compression requires generated bitpackinghelpers.h
            "src/storage/compression/**/*.cpp",
            "src/function/compression_config.cpp",
            # HTTP requires httplib.hpp third-party library
            "src/main/http/**/*.cpp",
            # Extension install/load
            "src/main/extension/extension_install.cpp",
            "src/main/extension/extension_load.cpp",
        ],
    ),
    hdrs = glob([
        "src/include/**/*.hpp",
        "src/include/**/*.h",
    ]),
    copts = DUCKDB_COPTS,
    includes = [
        "src/include",
    ],
    linkopts = DUCKDB_LINKOPTS,
    deps = [
        ":concurrentqueue",
        ":fast_float",
        ":fmt",
        ":fsst",
        ":hyperloglog",
        ":jaro_winkler",
        ":libpg_query",
        ":mbedtls",
        ":miniz",
        ":pcg",
        ":pdqsort",
        ":re2",
        ":ska_sort",
        ":tdigest",
        ":utf8proc",
        ":vergesort",
        ":yyjson",
        ":zstd",
    ],
)

