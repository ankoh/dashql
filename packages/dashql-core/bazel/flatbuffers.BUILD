# BUILD for FlatBuffers C++ runtime only (no flatc).

load("@rules_cc//cc:defs.bzl", "cc_library")

package(default_visibility = ["//visibility:public"])

cc_library(
    name = "flatbuffers",
    srcs = [
        "src/idl_parser.cpp",
        "src/idl_gen_text.cpp",
        "src/reflection.cpp",
        "src/util.cpp",
    ],
    hdrs = glob(["include/flatbuffers/**/*.h"]),
    includes = ["include"],
    copts = ["-DFLATBUFFERS_NO_ABSOLUTE_PATH_RESOLUTION"],
)
