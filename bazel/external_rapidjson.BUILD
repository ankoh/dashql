# BUILD file for Tencent/rapidjson (header-only).

load("@rules_cc//cc:defs.bzl", "cc_library")

package(default_visibility = ["//visibility:public"])

cc_library(
    name = "rapidjson",
    hdrs = glob(["include/**/*.h"]),
    includes = ["include"],
)
