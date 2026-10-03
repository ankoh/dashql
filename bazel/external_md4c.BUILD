# BUILD file for MD4C (CommonMark parser).

load("@rules_cc//cc:defs.bzl", "cc_library")

package(default_visibility = ["//visibility:public"])

cc_library(
    name = "md4c",
    srcs = [
        "src/entity.c",
        "src/md4c.c",
    ],
    hdrs = [
        "src/entity.h",
        "src/md4c.h",
    ],
    includes = ["src"],
)
