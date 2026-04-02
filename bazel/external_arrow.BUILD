"""Arrow build from source: IPC only, no Acero"""

load("@rules_cc//cc:defs.bzl", "cc_library")

package(default_visibility = ["//visibility:public"])

# Arrow config headers (minimal configuration for WASM)
genrule(
    name = "arrow_config_header",
    outs = ["cpp/src/arrow/util/config.h"],
    cmd = """
cat > $@ <<'EOF'
#ifndef ARROW_UTIL_CONFIG_H
#define ARROW_UTIL_CONFIG_H

#define ARROW_VERSION_MAJOR 19
#define ARROW_VERSION_MINOR 0
#define ARROW_VERSION_PATCH 0
#define ARROW_VERSION ((ARROW_VERSION_MAJOR * 1000) + ARROW_VERSION_MINOR) * 1000 + ARROW_VERSION_PATCH

#define ARROW_VERSION_STRING "19.0.0"

#define ARROW_SO_VERSION "1900"
#define ARROW_FULL_SO_VERSION "1900.0.0"

#define ARROW_CXX_COMPILER_ID "Emscripten"
#define ARROW_CXX_COMPILER_VERSION "3.1.71"
#define ARROW_CXX_COMPILER_FLAGS ""

#define ARROW_BUILD_TYPE "Release"

#define ARROW_GIT_ID "apache-arrow-19.0.0"
#define ARROW_GIT_DESCRIPTION "Apache Arrow 19.0.0"

#define ARROW_PACKAGE_KIND ""

// Feature flags - IPC and compute
#define ARROW_IPC
#define ARROW_COMPUTE
#undef ARROW_CSV
#undef ARROW_DATASET
#undef ARROW_FILESYSTEM
#undef ARROW_FLIGHT
#undef ARROW_JSON
#undef ARROW_PARQUET

// Memory allocator
#undef ARROW_JEMALLOC
#undef ARROW_MIMALLOC

// SIMD
#define ARROW_SIMD_LEVEL 0
#define ARROW_RUNTIME_SIMD_LEVEL 0

#endif  // ARROW_UTIL_CONFIG_H
EOF
""",
)

genrule(
    name = "arrow_config_internal_header",
    outs = ["cpp/src/arrow/util/config_internal.h"],
    cmd = """
cat > $@ <<'EOF'
#ifndef ARROW_UTIL_CONFIG_INTERNAL_H
#define ARROW_UTIL_CONFIG_INTERNAL_H

#undef ARROW_USE_GLOG

#endif  // ARROW_UTIL_CONFIG_INTERNAL_H
EOF
""",
)

# Generate flatbuffer files for Arrow IPC
genrule(
    name = "arrow_ipc_generated",
    srcs = glob(["format/*.fbs"]),
    outs = [
        "cpp/src/generated/File_generated.h",
        "cpp/src/generated/Message_generated.h",
        "cpp/src/generated/Schema_generated.h",
        "cpp/src/generated/SparseTensor_generated.h",
        "cpp/src/generated/Tensor_generated.h",
    ],
    cmd = """
        OUT_DIR=$$(dirname $(location cpp/src/generated/Message_generated.h))
        $(location @com_google_flatbuffers//:flatc) --cpp --gen-mutable --scoped-enums --no-warnings -o $$OUT_DIR $(SRCS)
    """,
    tools = ["@com_google_flatbuffers//:flatc"],
)

# Vendored C sources (uriparser, xxhash, musl) need separate compilation without -std=c++17
cc_library(
    name = "arrow_vendored_c",
    srcs = glob(["cpp/src/arrow/vendored/**/*.c"]),
    hdrs = glob([
        "cpp/src/arrow/**/*.h",
    ], exclude = [
        "cpp/src/arrow/util/config.h",
        "cpp/src/arrow/util/config_internal.h",
    ]) + [
        ":arrow_config_header",
        ":arrow_config_internal_header",
    ],
    copts = [
        "-DARROW_STATIC",
        "-DARROW_EXPORT=",
        "-Wno-unused-parameter",
        "-Wno-unused-variable",
    ] + select({
        "@platforms//cpu:wasm32": [
            "-pthread",
            "-matomics",
            "-mbulk-memory",
        ],
        "//conditions:default": [],
    }),
    features = ["wasm_exceptions"],
    includes = [
        "cpp/src",
        "cpp/src/arrow/vendored",
    ],
)

# Minimal Arrow: core types, memory, arrays, and IPC only
cc_library(
    name = "arrow",
    srcs = glob(
        [
            "cpp/src/arrow/*.cc",
            "cpp/src/arrow/array/*.cc",
            "cpp/src/arrow/c/*.cc",
            "cpp/src/arrow/tensor/*.cc",
            "cpp/src/arrow/util/*.cc",
            "cpp/src/arrow/vendored/**/*.cc",
            "cpp/src/arrow/vendored/**/*.cpp",
            "cpp/src/arrow/io/*.cc",
            "cpp/src/arrow/ipc/*.cc",
            "cpp/src/arrow/extension/*.cc",
            "cpp/src/arrow/compute/*.cc",
            "cpp/src/arrow/compute/kernels/*.cc",
            "cpp/src/arrow/compute/row/*.cc",
        ],
        exclude = [
            # Tests and benchmarks
            "**/*_test.cc",
            "**/*_benchmark.cc",
            "**/test_*.cc",
            "**/benchmark_*.cc",
            # Include files (added to hdrs instead)
            "**/*.inc.cc",
            # Don't compile tz.cpp separately - it's included by datetime.cpp
            "cpp/src/arrow/vendored/datetime/tz.cpp",
            # SIMD-specific implementations (exclude AVX2/AVX512/SSE4 variants)
            "**/*_avx2.cc",
            "**/*_avx512.cc",
            "**/*_sse4.cc",
            # Features we don't need (keep compression.cc for Codec base class)
            "cpp/src/arrow/util/compression_brotli.cc",
            "cpp/src/arrow/util/compression_bz2.cc",
            "cpp/src/arrow/util/compression_lz4.cc",
            "cpp/src/arrow/util/compression_snappy.cc",
            "cpp/src/arrow/util/compression_zlib.cc",
            "cpp/src/arrow/util/compression_zstd.cc",
            "cpp/src/arrow/util/*bpacking*.cc",
            "cpp/src/arrow/util/tracing_internal.cc",
            "cpp/src/arrow/memory_pool_jemalloc.cc",
            "cpp/src/arrow/io/hdfs*.cc",
            # Feather is legacy, skip it
            "cpp/src/arrow/ipc/feather.cc",
            # JSON serialization (optional, needs rapidjson)
            "cpp/src/arrow/ipc/json*.cc",
            # IPC utility tools with main() functions (not library code)
            "cpp/src/arrow/ipc/file_to_stream.cc",
            "cpp/src/arrow/ipc/stream_to_file.cc",
            "cpp/src/arrow/ipc/*_fuzz.cc",
            "cpp/src/arrow/ipc/generate_*_corpus.cc",
            # Other optional features
            "cpp/src/arrow/csv/*.cc",
            "cpp/src/arrow/dataset/*.cc",
            "cpp/src/arrow/filesystem/*.cc",
            "cpp/src/arrow/flight/*.cc",
            "cpp/src/arrow/integration/*.cc",
        ],
    ),
    hdrs = glob(
        [
            "cpp/src/arrow/**/*.h",
            "cpp/src/arrow/**/*.hpp",
            "cpp/src/arrow/**/*.inc.cc",
        ],
        exclude = [
            "cpp/src/arrow/util/config.h",
            "cpp/src/arrow/util/config_internal.h",
        ],
    ) + [
        ":arrow_config_header",
        ":arrow_config_internal_header",
        ":arrow_ipc_generated",
        "cpp/src/arrow/vendored/datetime/tz.cpp",
    ],
    copts = [
        "-std=c++17",
        "-DARROW_STATIC",
        "-DARROW_NO_DEPRECATED_API",
        "-DARROW_EXPORT=",
        "-DARROW_USE_NATIVE_INT128=1",
        "-Wno-deprecated-declarations",
        "-Wno-unused-parameter",
        "-Wno-unused-variable",
        "-Wno-deprecated-literal-operator",
        "-Wno-missing-braces",
        "-fexceptions",
    ] + select({
        "@platforms//cpu:wasm32": [
            "-pthread",
            "-matomics",
            "-mbulk-memory",
        ],
        "//conditions:default": [],
    }),
    features = ["wasm_exceptions"],
    includes = [
        "cpp/src",
        "cpp/src/arrow/vendored",
    ],
    linkopts = [
        "-fexceptions",
    ] + select({
        "@platforms//cpu:wasm32": [
            "-pthread",
            "-matomics",
            "-mbulk-memory",
            "-msimd128",
        ],
        "//conditions:default": [],
    }),
    deps = [
        ":arrow_vendored_c",
        "@com_google_flatbuffers//:flatbuffers",
        "@rapidjson//:rapidjson",
    ],
)
