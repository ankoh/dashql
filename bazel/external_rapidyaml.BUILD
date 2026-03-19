# rapidyaml (ryml): YAML parsing/emitting. Depends on c4core for base c4 types.
# Include path: src/ so that #include "ryml.hpp" and #include "c4/yml/..." work.
# c4core is needed for c4::substr, c4::format, etc. (include from c4core's src).
load("@rules_cc//cc:defs.bzl", "cc_library")

package(default_visibility = ["//visibility:public"])

cc_library(
    name = "rapidyaml",
    srcs = glob(["src/c4/yml/**/*.cpp"]),
    hdrs = glob(["src/**/*.hpp"], allow_empty = True),
    includes = ["src"],
    deps = ["@c4core//:c4core"],
    copts = ["-DRYML_DEFAULT_CALLBACK_USES_EXCEPTIONS=1", "-include", "string"],
    tags = ["no-remote-cache"],
)
