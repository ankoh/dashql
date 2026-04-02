# Minimal FlatBuffers BUILD - runtime library + flatc compiler

load("@rules_cc//cc:defs.bzl", "cc_binary", "cc_library")

package(default_visibility = ["//visibility:public"])

# FlatBuffers C++ runtime library
cc_library(
    name = "flatbuffers",
    srcs = [
        "src/idl_gen_text.cpp",
        "src/idl_parser.cpp",
        "src/reflection.cpp",
        "src/util.cpp",
    ],
    hdrs = glob(["include/flatbuffers/**/*.h"]),
    includes = ["include"],
    copts = ["-DFLATBUFFERS_NO_ABSOLUTE_PATH_RESOLUTION"] + select({
        "@platforms//cpu:wasm32": [
            "-pthread",
            "-matomics",
            "-mbulk-memory",
        ],
        "//conditions:default": [],
    }),
)

# flatc compiler (host tool, no WASM flags needed)
cc_binary(
    name = "flatc",
    srcs = glob(
        ["src/**/*.cpp"],
        exclude = ["src/flathash.cpp"],
    ) + glob(["src/**/*.h"]),
    hdrs = glob(["include/**/*.h"]),
    includes = ["include"],
    copts = ["-DFLATBUFFERS_NO_ABSOLUTE_PATH_RESOLUTION"],
)
