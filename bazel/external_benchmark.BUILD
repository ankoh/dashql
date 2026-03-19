# Google Benchmark (mirrors cmake/benchmark.cmake). No libpfm/perfcounters.
load("@rules_cc//cc:defs.bzl", "cc_library")

package(default_visibility = ["//visibility:public"])

cc_library(
    name = "benchmark",
    srcs = glob(
        [
            "src/*.cc",
            "src/*.h",
        ],
        exclude = ["src/benchmark_main.cc"],
    ),
    hdrs = [
        "include/benchmark/benchmark.h",
        "include/benchmark/export.h",
    ],
    linkopts = ["-pthread"],
    strip_include_prefix = "include",
    linkstatic = True,
    defines = ["BENCHMARK_STATIC_DEFINE"],
    tags = ["no-remote-cache"],
)

cc_library(
    name = "benchmark_main",
    srcs = ["src/benchmark_main.cc"],
    hdrs = ["include/benchmark/benchmark.h", "include/benchmark/export.h"],
    strip_include_prefix = "include",
    deps = [":benchmark"],
    tags = ["no-remote-cache"],
)
