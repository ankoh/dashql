# BUILD for FlatBuffers C++ runtime and flatc compiler.

load("@rules_cc//cc:defs.bzl", "cc_binary", "cc_library")

package(default_visibility = ["//visibility:public"])

cc_library(
    name = "flatbuffers",
    srcs = [
        "src/idl_parser.cpp",
        "src/idl_gen_text.cpp",
        "src/reflection.cpp",
        "src/util.cpp",
    ] + glob(["src/*.h", "include/codegen/*.h", "include/codegen/*.cc"]),
    hdrs = glob(["include/flatbuffers/**/*.h"]),
    includes = ["include"],
    copts = ["-DFLATBUFFERS_NO_ABSOLUTE_PATH_RESOLUTION"],
)

cc_binary(
    name = "flatc",
    srcs = glob(
        ["src/*.cpp", "src/*.h", "include/flatbuffers/**/*.h", "include/codegen/*.h", "include/codegen/*.cc"],
        exclude = ["src/flathash.cpp"],
    ) + glob(["grpc/src/compiler/*.cc", "grpc/src/compiler/*.h"], allow_empty = True),
    includes = ["include", "grpc"],
    copts = ["-DFLATBUFFERS_NO_ABSOLUTE_PATH_RESOLUTION"],
)
